import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { createDb } from '../db.js';
import { testConfig } from '../testing.js';
import { runOnce } from '../worker/jobs.js';

const DOMAIN = 'listing-test.local';
const config = testConfig();
const db = createDb(config.DATABASE_URL);
let app: FastifyInstance;
let alice: string;
let bob: string;
let tickets: { id: string; versionId: string };
let contacts: { id: string; versionId: string };
const ids: Record<string, string> = {};

const fixture = (name: string) => readFileSync(new URL(`../../../fixtures/${name}`, import.meta.url));

async function signup(ip: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/signup',
    remoteAddress: ip,
    payload: { name: 'L', email: `${randomUUID()}@${DOMAIN}`, password: 'password123' },
  });
  return `dd_session=${res.cookies.find((c) => c.name === 'dd_session')!.value}`;
}
const get = (cookie: string, url: string) => app.inject({ method: 'GET', url, headers: { cookie } });
const list = async (cookie: string, query = '') => (await get(cookie, `/api/uploads${query}`)).json();

async function upload(cookie: string, meta: object, content: Buffer | string, filename: string, createdAt: string) {
  const form = new FormData();
  form.append('meta', JSON.stringify(meta));
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
  await db.query('UPDATE uploads SET created_at = $2 WHERE id = $1', [id, createdAt]);
  return id;
}

beforeAll(async () => {
  app = buildApp({ config, db });
  await app.ready();
  alice = await signup('10.6.0.1');
  bob = await signup('10.6.0.2');
  const mk = async (payload: object) => (await app.inject({ method: 'POST', url: '/api/templates', headers: { cookie: alice }, payload })).json().template;
  tickets = await mk({
    name: 'Support tickets',
    columns: [
      { key: 'ticket_id', name: 'ticket_id', type: 'integer', required: true },
      { key: 'confidence', name: 'confidence', type: 'number', rules: [{ type: 'min', params: { value: 0.6 }, severity: 'warning' }] },
      { key: 'needs_review', name: 'needs_review', type: 'boolean' },
      { key: 'created_at', name: 'created_at', type: 'date' },
      { key: 'source_url', name: 'source_url', type: 'url' },
    ],
  });
  contacts = await mk({ name: 'Customer contacts', columns: [{ key: 'email', name: 'Email', type: 'email' }] });
  const t = (name: string, mapping: object, v = tickets.versionId) => ({ mode: 'template', name, templateVersionId: v, mapping });
  const ticketMap = { ticket_id: 0, confidence: 4, needs_review: 5, created_at: 6, source_url: 7 };

  // Created oldest-first (year 2000, so the worker handles these before anything else in the database).
  ids.failed = await upload(alice, t('October tickets', ticketMap), fixture('tickets_oct.csv'), 'tickets_oct.csv', '2000-01-01T00:00:01Z');
  ids.warned = await upload(alice, t('October tickets (corrected)', ticketMap), fixture('tickets_oct_fixed.csv'), 'tickets_oct_fixed.csv', '2000-01-01T00:00:02Z');
  ids.passed = await upload(alice, t('Leads – November', { email: 0 }, contacts.versionId), 'Email\na@b.co\n', 'leads_nov.csv', '2000-01-01T00:00:03Z');
  for (let i = 0; i < 3; i++) await runOnce(db, config); // the three above get real results
  ids.error = await upload(alice, { mode: 'adhoc', name: 'Legacy export', hasHeaderRow: true, columns: [{ key: 'name', name: 'name', type: 'text', sourceIndex: 0 }] }, fixture('legacy_latin1.csv'), 'legacy_export.csv', '2000-01-01T00:00:04Z');
  await runOnce(db, config);
  ids.validating = await upload(alice, t('Q3 contacts', { email: 0 }, contacts.versionId), 'Email\nq@x.co\n', 'q3_contacts.csv', '2000-01-01T00:00:05Z');
  await db.query(`UPDATE uploads SET status = 'validating', attempt = 1, locked_at = now(), validation_started_at = now() - interval '3 seconds' WHERE id = $1`, [ids.validating]);
  ids.queued = await upload(alice, { mode: 'adhoc', name: '50% discount list', hasHeaderRow: true, columns: [{ key: 'vendor', name: 'vendor', type: 'text', sourceIndex: 0 }] }, 'vendor\nAcme\n', 'vendors.csv', '2000-01-01T00:00:06Z');
  // keep the worker away from the queued one: make it newer than anything else in the database
  await db.query(`UPDATE uploads SET created_at = now() + interval '1 day' WHERE id = $1`, [ids.queued]);
});
afterAll(async () => {
  await db.query(`DELETE FROM users WHERE email LIKE $1`, [`%@${DOMAIN}`]);
  await app.close();
  await db.end();
});

describe('GET /api/uploads', () => {
  it('lists all six statuses, newest first, with template names and counts for the chips', async () => {
    const r = await list(alice);
    expect(r.uploads.map((u: { name: string; status: string }) => `${u.name}: ${u.status}`)).toEqual([
      '50% discount list: queued',
      'Q3 contacts: validating',
      'Legacy export: error',
      'Leads – November: passed',
      'October tickets (corrected): passed_with_warnings',
      'October tickets: failed_validation',
    ]);
    expect(r.counts).toEqual({ all: 6, queued: 1, validating: 1, passed: 1, passed_with_warnings: 1, failed_validation: 1, error: 1 });
    const failed = r.uploads.find((u: { id: string }) => u.id === ids.failed);
    expect(failed).toMatchObject({ template: { name: 'Support tickets', version: 1 }, totalRows: 40, errorCount: 4, warningCount: 7 });
    expect(r.uploads[0].template).toBeNull();
    expect(r.uploads[1].validationStartedAt).not.toBeNull();
    expect(r.templates.map((t: { name: string }) => t.name)).toEqual(['Customer contacts', 'Support tickets']);
    expect(r.truncated).toBe(false);
  });

  it('"in progress" = queued + validating; a single status narrows to that status; counts ignore the status filter', async () => {
    const r = await list(alice, '?status=in_progress');
    expect(r.uploads.map((u: { status: string }) => u.status)).toEqual(['queued', 'validating']);
    expect(r.counts.all).toBe(6);
    expect((await list(alice, '?status=failed_validation')).uploads.map((u: { id: string }) => u.id)).toEqual([ids.failed]);
  });

  it('filters by template, or by "no template", and the counts follow', async () => {
    const byContacts = await list(alice, `?template=${contacts.id}`);
    expect(byContacts.uploads.map((u: { name: string }) => u.name)).toEqual(['Q3 contacts', 'Leads – November']);
    expect(byContacts.counts).toMatchObject({ all: 2, validating: 1, passed: 1, failed_validation: 0 });
    expect((await list(alice, '?template=none')).uploads.map((u: { name: string }) => u.name)).toEqual(['50% discount list', 'Legacy export']);
  });

  it('searches upload and file names, case-insensitively, with % and _ taken literally', async () => {
    expect((await list(alice, '?q=OCTOBER')).uploads).toHaveLength(2);
    expect((await list(alice, '?q=leads_nov')).uploads.map((u: { name: string }) => u.name)).toEqual(['Leads – November']); // file name
    expect((await list(alice, '?q=50%25')).uploads.map((u: { name: string }) => u.name)).toEqual(['50% discount list']);
    expect((await list(alice, '?q=%25')).uploads).toHaveLength(1); // "%" is not a wildcard
    expect((await list(alice, '?q=tickets&status=passed_with_warnings')).uploads).toHaveLength(1); // filters combine
  });

  it('limit + truncated, and invalid filters are a 400', async () => {
    const r = await list(alice, '?limit=2');
    expect([r.uploads.length, r.truncated]).toEqual([2, true]);
    expect((await get(alice, '/api/uploads?status=done')).statusCode).toBe(400);
    expect((await get(alice, '/api/uploads?template=abc')).statusCode).toBe(400);
  });

  it("another user sees none of them", async () => {
    const r = await list(bob);
    expect(r.uploads).toEqual([]);
    expect(r.counts.all).toBe(0);
  });
});

describe('GET /api/uploads/:id/rows (Data tab)', () => {
  it('pages through the extracted rows, each with its issues', async () => {
    const r = (await get(alice, `/api/uploads/${ids.failed}/rows?limit=5`)).json();
    expect(r.total).toBe(40);
    expect(r.rows.map((x: { row: number }) => x.row)).toEqual([1, 2, 3, 4, 5]);
    expect(r.rows[0].data).toMatchObject({ ticket_id: '1000', confidence: '0.87', needs_review: 'no' });
    expect(r.rows[3].issues).toEqual([{ column: 'confidence', severity: 'error', message: '"n/a" is not a number' }]);
    const next = (await get(alice, `/api/uploads/${ids.failed}/rows?limit=5&offset=35`)).json();
    expect(next.rows.map((x: { row: number }) => x.row)).toEqual([36, 37, 38, 39, 40]);
  });

  it('"rows with issues" returns only rows that have an error or a warning', async () => {
    const r = (await get(alice, `/api/uploads/${ids.failed}/rows?onlyIssues=1&limit=50`)).json();
    expect(r.total).toBe(11);
    expect(r.rows.map((x: { row: number }) => x.row)).toEqual([4, 7, 11, 12, 15, 18, 19, 23, 26, 34, 38]);
    const detail = (await get(alice, `/api/uploads/${ids.failed}`)).json().upload;
    expect(detail.rowsWithIssues).toBe(11);
  });

  it('is not available before validation has finished, or to another user', async () => {
    expect((await get(alice, `/api/uploads/${ids.queued}/rows`)).statusCode).toBe(409);
    expect((await get(bob, `/api/uploads/${ids.failed}/rows`)).statusCode).toBe(404);
  });
});

describe('DELETE /api/uploads/:id (remove from list)', () => {
  it("hides the upload everywhere for its owner; other users can't remove it", async () => {
    expect((await app.inject({ method: 'DELETE', url: `/api/uploads/${ids.error}`, headers: { cookie: bob } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/api/uploads/${ids.error}`, headers: { cookie: alice } })).statusCode).toBe(204);
    const r = await list(alice);
    expect(r.uploads.some((u: { id: string }) => u.id === ids.error)).toBe(false);
    expect(r.counts).toMatchObject({ all: 5, error: 0 });
    expect((await get(alice, `/api/uploads/${ids.error}`)).statusCode).toBe(404);
    const { rows } = await db.query('SELECT deleted_at IS NOT NULL AS deleted FROM uploads WHERE id = $1', [ids.error]);
    expect(rows[0].deleted).toBe(true); // kept in the database, only hidden
  });
});
