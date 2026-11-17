import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Papa from 'papaparse';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { createDb } from '../db.js';
import { testConfig } from '../testing.js';
import { claimNext, processJob, runOnce } from './jobs.js';

const DOMAIN = 'worker-test.local';
const config = testConfig();
const db = createDb(config.DATABASE_URL);
let app: FastifyInstance;
let cookie: string;
let versionId: string;

const fixture = (name: string) => readFileSync(new URL(`../../../fixtures/${name}`, import.meta.url));

/** "Support tickets" v2 from the dev seed. */
const supportTickets = {
  name: `Support tickets ${randomUUID().slice(0, 6)}`,
  columns: [
    { key: 'ticket_id', name: 'ticket_id', type: 'integer', required: true, aliases: ['Ticket #'], rules: [{ type: 'unique', params: {} }] },
    { key: 'text', name: 'text', type: 'text', required: true, rules: [{ type: 'max_length', params: { value: 500 } }] },
    { key: 'label', name: 'label', type: 'select', required: true, rules: [{ type: 'allowed_values', params: { values: ['bug', 'praise', 'billing', 'question', 'feature_request'] } }] },
    { key: 'tags', name: 'tags', type: 'multiselect', delimiter: ',' },
    { key: 'confidence', name: 'confidence', type: 'number', rules: [
      { type: 'min', params: { value: 0.6 }, severity: 'warning', message: 'Low confidence: double-check the label' },
      { type: 'max', params: { value: 1 } },
    ] },
    { key: 'needs_review', name: 'needs_review', type: 'boolean' },
    { key: 'created_at', name: 'created_at', type: 'date', required: true },
    { key: 'source_url', name: 'source_url', type: 'url' },
  ],
};
const MAPPING = { ticket_id: 0, text: 1, label: 2, tags: 3, confidence: 4, needs_review: 5, created_at: 6, source_url: 7 };

async function upload(content: Buffer | string, mapping: Record<string, number | null> = MAPPING, filename = 'f.csv'): Promise<string> {
  const form = new FormData();
  form.append('meta', JSON.stringify({ mode: 'template', name: 'October tickets', templateVersionId: versionId, mapping }));
  form.append('file', new Blob([content]), filename);
  const req = new Request('http://x', { method: 'POST', body: form });
  const res = await app.inject({
    method: 'POST',
    url: '/api/uploads',
    headers: { cookie, 'content-type': req.headers.get('content-type')! },
    payload: Buffer.from(await req.arrayBuffer()),
  });
  expect(res.statusCode).toBe(201);
  const id = res.json().upload.id;
  // Make it the oldest job, so the worker picks it before anything else queued in this database.
  await db.query(`UPDATE uploads SET created_at = '2000-01-01'::timestamptz + (random() * interval '1 second') WHERE id = $1`, [id]);
  return id;
}
const get = (url: string) => app.inject({ method: 'GET', url, headers: { cookie } });
const detail = async (id: string) => (await get(`/api/uploads/${id}`)).json().upload;
const parse = (csv: string) => Papa.parse<string[]>(csv.replace(/^\uFEFF/, ''), { skipEmptyLines: true }).data;

/** Upload, then let the worker process exactly that upload. */
async function uploadAndValidate(content: Buffer | string, mapping?: Record<string, number | null>) {
  const id = await upload(content, mapping);
  const done = await runOnce(db, config);
  expect(done && done.id).toBe(id);
  return detail(id);
}

beforeAll(async () => {
  app = buildApp({ config, db });
  await app.ready();
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/signup',
    remoteAddress: '10.8.0.1',
    payload: { name: 'W', email: `${randomUUID()}@${DOMAIN}`, password: 'password123' },
  });
  cookie = `dd_session=${res.cookies.find((c) => c.name === 'dd_session')!.value}`;
  versionId = (await app.inject({ method: 'POST', url: '/api/templates', headers: { cookie }, payload: supportTickets })).json().template.versionId;
});
afterAll(async () => {
  await db.query(`DELETE FROM users WHERE email LIKE $1`, [`%@${DOMAIN}`]);
  await app.close();
  await db.end();
});

describe('acceptance: the reference files', () => {
  it('tickets_oct.csv → failed_validation with exactly the 4 planted errors and 7 warnings', async () => {
    const u = await uploadAndValidate(fixture('tickets_oct.csv'));
    expect(u).toMatchObject({ status: 'failed_validation', totalRows: 40, errorCount: 4, warningCount: 7, invalidRowCount: 4, issuesTruncated: false });
    expect(u.summary).toContainEqual({ column: 'confidence', rule: 'min', severity: 'warning', count: 7 });
    const errors = (await get(`/api/uploads/${u.id}/issues?severity=error`)).json();
    expect(errors.total).toBe(4);
    expect(errors.issues.map((i: { row: number; column: string; value: string }) => `${i.row} ${i.column} ${i.value}`)).toEqual([
      '4 confidence n/a',
      '12 source_url not-a-link',
      '18 created_at 2026-13-45',
      '26 needs_review maybe',
    ]);
    const { rows } = await db.query(
      `SELECT count(*)::int AS n, array_agg(row_number ORDER BY row_number) FILTER (WHERE has_errors) AS bad
       FROM upload_rows WHERE upload_id = $1`,
      [u.id],
    );
    expect(rows[0]).toEqual({ n: 40, bad: [4, 12, 18, 26] });
  });

  it('tickets_oct_fixed.csv → passed_with_warnings (0 errors, 7 warnings)', async () => {
    const u = await uploadAndValidate(fixture('tickets_oct_fixed.csv'));
    expect(u).toMatchObject({ status: 'passed_with_warnings', errorCount: 0, warningCount: 7 });
  });

  it('legacy_latin1.csv → error with a precise, actionable message and no rows', async () => {
    const form = new FormData();
    form.append('meta', JSON.stringify({ mode: 'adhoc', name: 'Legacy', hasHeaderRow: true, columns: [{ key: 'name', name: 'name', type: 'text', sourceIndex: 0 }] }));
    form.append('file', new Blob([fixture('legacy_latin1.csv')]), 'legacy.csv');
    const req = new Request('http://x', { method: 'POST', body: form });
    const res = await app.inject({ method: 'POST', url: '/api/uploads', headers: { cookie, 'content-type': req.headers.get('content-type')! }, payload: Buffer.from(await req.arrayBuffer()) });
    const id = res.json().upload.id;
    await db.query(`UPDATE uploads SET created_at = '2000-01-01' WHERE id = $1`, [id]);
    expect(await runOnce(db, config)).toEqual({ id, outcome: 'error' });
    const u = await detail(id);
    expect(u.status).toBe('error');
    expect(u.statusMessage).toBe('The file is not valid UTF-8 (byte 0xE9 on line 2). Save it as "CSV UTF-8" and upload it again.');
    expect((await get(`/api/uploads/${id}/errors.csv`)).statusCode).toBe(409);
  });

  it('a malformed file reports parse problems, a missing required column and row-length problems', async () => {
    const csv = 'ticket_id,text,label\n1,"unclosed,bug\n2,ok,bug,extra\n';
    const u = await uploadAndValidate(csv, { ticket_id: 0, text: 1, label: 2, created_at: null });
    expect(u.status).toBe('failed_validation');
    const rules = u.summary.map((s: { rule: string; severity: string }) => `${s.rule}/${s.severity}`);
    expect(rules).toEqual(expect.arrayContaining(['parse/error', 'missing_column/error']));
  });

  it('a clean file → passed', async () => {
    const csv = 'ticket_id,text,label,tags,confidence,needs_review,created_at,source_url\n1,Hi,bug,"ux, web",0.9,yes,2026-10-01,https://a.example\n';
    expect((await uploadAndValidate(csv)).status).toBe('passed');
  });
});

describe('downloads', () => {
  let failedId: string;
  beforeAll(async () => {
    failedId = (await uploadAndValidate(fixture('tickets_oct.csv'))).id;
  });

  it('error report: file-level first, then errors, then warnings; named after the upload', async () => {
    const res = await get(`/api/uploads/${failedId}/errors.csv`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toContain('filename="October tickets_errors.csv"');
    expect(res.body.startsWith('\uFEFF')).toBe(true); // so Excel reads it as UTF-8
    const rows = parse(res.body);
    expect(rows[0]).toEqual(['row', 'column', 'value', 'severity', 'problem']);
    expect(rows.slice(1, 5).map((r) => r.slice(0, 4).join(' '))).toEqual([
      '4 confidence n/a error',
      '12 source_url not-a-link error',
      '18 created_at 2026-13-45 error',
      '26 needs_review maybe error',
    ]);
    expect(rows.slice(5).every((r) => r[3] === 'warning')).toBe(true);
    expect(rows).toHaveLength(1 + 4 + 7);
  });

  it('template format: template columns and names, normalised values, invalid values unchanged', async () => {
    const res = await get(`/api/uploads/${failedId}/export.csv`);
    const rows = parse(res.body);
    expect(rows[0]).toEqual(['ticket_id', 'text', 'label', 'tags', 'confidence', 'needs_review', 'created_at', 'source_url']);
    expect(rows).toHaveLength(41);
    expect(rows[1]).toEqual(['1000', 'The checkout page keeps timing out on mobile', 'bug', 'export, web', '0.87', 'false', '2026-10-01', 'https://support.example.com/tickets/1000']);
    expect(rows[3][5]).toBe('true'); // "yes" → true
    expect(rows[4][4]).toBe('n/a'); // invalid value kept as-is
    expect(rows[26][5]).toBe('maybe');
  });

  it('file with errors marked: same file plus __errors, which makes it valid to re-upload as-is', async () => {
    const res = await get(`/api/uploads/${failedId}/export.csv?errors=1`);
    expect(res.headers['content-disposition']).toContain('October tickets_errors_marked.csv');
    const rows = parse(res.body);
    expect(rows[0].at(-1)).toBe('__errors');
    expect(rows[4].at(-1)).toBe('confidence: "n/a" is not a number');
    expect(rows[7].at(-1)).toBe('(warning) confidence: Low confidence: double-check the label');
    expect(rows[1].at(-1)).toBe('');

    // Round trip: fix the 4 cells in the downloaded file and upload it again (with the __errors column still in it).
    const fixed = rows.map((r, i) => {
      const c = [...r];
      if (i === 4) c[4] = '0.98';
      if (i === 12) c[7] = 'https://support.example.com/tickets/1011';
      if (i === 18) c[6] = '2026-10-18';
      if (i === 26) c[5] = 'no';
      return c;
    });
    const again = await uploadAndValidate(Papa.unparse(fixed));
    expect(again).toMatchObject({ status: 'passed_with_warnings', errorCount: 0, warningCount: 7 });
  });

  it('original file: the exact bytes that were uploaded', async () => {
    const res = await get(`/api/uploads/${failedId}/original`);
    expect(res.rawPayload.equals(fixture('tickets_oct.csv'))).toBe(true);
  });

  it('downloads are private', async () => {
    const other = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      remoteAddress: '10.8.0.2',
      payload: { name: 'B', email: `${randomUUID()}@${DOMAIN}`, password: 'password123' },
    });
    const bob = `dd_session=${other.cookies.find((c) => c.name === 'dd_session')!.value}`;
    for (const path of ['', '/issues', '/errors.csv', '/export.csv', '/original']) {
      expect((await app.inject({ method: 'GET', url: `/api/uploads/${failedId}${path}`, headers: { cookie: bob } })).statusCode).toBe(404);
    }
  });
});

describe('worker robustness', () => {
  it('two workers claiming at the same time never get the same upload', async () => {
    const a = await upload(fixture('tickets_oct_fixed.csv'));
    const b = await upload(fixture('tickets_oct_fixed.csv'));
    const [j1, j2] = await Promise.all([claimNext(db), claimNext(db)]);
    expect(new Set([j1!.id, j2!.id])).toEqual(new Set([a, b]));
    await Promise.all([processJob(db, j1!, config), processJob(db, j2!, config)]);
    expect((await detail(a)).status).toBe('passed_with_warnings');
    expect((await detail(b)).status).toBe('passed_with_warnings');
  });

  it('a job left "validating" by a crashed worker is claimed again after 5 minutes', async () => {
    const id = await upload(fixture('tickets_oct_fixed.csv'));
    await db.query(`UPDATE uploads SET status = 'validating', attempt = 1, locked_at = now() - interval '2 minutes', validation_started_at = now() WHERE id = $1`, [id]);
    expect((await claimNext(db))?.id).not.toBe(id); // still fresh: left alone
    await db.query(`UPDATE uploads SET locked_at = now() - interval '6 minutes' WHERE id = $1`, [id]);
    const job = await claimNext(db);
    expect(job).toEqual({ id, attempt: 2 });
    expect(await processJob(db, job!, config)).toBe('passed_with_warnings');
  });

  it('gives up with a readable error after 3 attempts', async () => {
    const id = await upload(fixture('tickets_oct_fixed.csv'));
    await db.query(`UPDATE uploads SET attempt = 3 WHERE id = $1`, [id]);
    expect(await runOnce(db, config)).toEqual({ id, outcome: 'error' });
    expect((await detail(id)).statusMessage).toBe('Validation failed repeatedly on our side. Please upload the file again.');
  });
});
