import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { createDb } from '../db.js';
import { testConfig } from '../testing.js';
import { cleanFilename } from './routes.js';

const DOMAIN = 'uploads-test.local';
const config = testConfig({ MAX_ROWS: '50', MAX_FILE_BYTES: String(64 * 1024) });
const db = createDb(config.DATABASE_URL);
let app: FastifyInstance;
let alice: string;
let bob: string;
let ticketsVersionId: string;

const ticketsCsv = readFileSync(new URL('../../../fixtures/tickets_oct.csv', import.meta.url));

const ticketsTemplate = {
  name: 'Support tickets',
  columns: [
    { key: 'ticket_id', name: 'ticket_id', type: 'integer', required: true, aliases: ['Ticket #'], rules: [{ type: 'unique', params: {} }] },
    { key: 'text', name: 'text', type: 'text', required: true },
    { key: 'confidence', name: 'confidence', type: 'number', rules: [{ type: 'min', params: { value: 0.6 }, severity: 'warning' }] },
    { key: 'owner', name: 'owner', type: 'email' },
  ],
};

async function signup(): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/signup',
    remoteAddress: `10.7.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
    payload: { name: 'U', email: `${randomUUID()}@${DOMAIN}`, password: 'password123' },
  });
  return `dd_session=${res.cookies.find((c) => c.name === 'dd_session')!.value}`;
}

/** POST /api/uploads as a real multipart request (built by the platform FormData, like the browser). */
async function upload(cookie: string, meta: unknown, content: Buffer | string = ticketsCsv, filename = 'tickets_oct.csv') {
  const form = new FormData();
  form.append('meta', typeof meta === 'string' ? meta : JSON.stringify(meta));
  form.append('file', new Blob([content]), filename);
  const req = new Request('http://x', { method: 'POST', body: form });
  return app.inject({
    method: 'POST',
    url: '/api/uploads',
    headers: { cookie, 'content-type': req.headers.get('content-type')! },
    payload: Buffer.from(await req.arrayBuffer()),
  });
}
const templateMeta = (mapping: Record<string, number | null>, extra: object = {}) => ({
  mode: 'template',
  name: 'October tickets',
  templateVersionId: ticketsVersionId,
  mapping,
  ...extra,
});

beforeAll(async () => {
  app = buildApp({ config, db });
  await app.ready();
  alice = await signup();
  bob = await signup();
  const t = await app.inject({ method: 'POST', url: '/api/templates', headers: { cookie: alice }, payload: ticketsTemplate });
  ticketsVersionId = t.json().template.versionId;
});
afterAll(async () => {
  await db.query(`DELETE FROM users WHERE email LIKE $1`, [`%@${DOMAIN}`]);
  await db.query(`DELETE FROM login_attempts WHERE email LIKE $1`, [`%@${DOMAIN}`]);
  await app.close();
  await db.end();
});

describe('POST /api/uploads with a template', () => {
  it('stores the file and a queued job whose snapshot comes from the template in the database', async () => {
    const res = await upload(alice, templateMeta({ ticket_id: 0, text: 1, confidence: 4, owner: null }));
    expect(res.statusCode).toBe(201);
    const u = res.json().upload;
    expect(u).toMatchObject({ name: 'October tickets', status: 'queued', originalFilename: 'tickets_oct.csv', sizeBytes: ticketsCsv.length });
    expect(u.template).toMatchObject({ name: 'Support tickets', version: 1 });

    const { rows } = await db.query(
      `SELECT u.schema_snapshot AS s, u.sha256, u.detected_delimiter, u.status, f.content
       FROM uploads u JOIN upload_files f ON f.upload_id = u.id WHERE u.id = $1`,
      [u.id],
    );
    expect(rows[0].content.equals(ticketsCsv)).toBe(true);
    expect(rows[0].sha256.equals(createHash('sha256').update(ticketsCsv).digest())).toBe(true);
    expect(rows[0].detected_delimiter).toBe(',');
    expect(rows[0].s.templateVersionId).toBe(ticketsVersionId);
    expect(rows[0].s.columns.map((c: { key: string; sourceIndex: number | null; sourceHeader: string | null }) => [c.key, c.sourceIndex, c.sourceHeader])).toEqual([
      ['ticket_id', 0, 'ticket_id'],
      ['text', 1, 'text'],
      ['confidence', 4, 'confidence'],
      ['owner', null, null],
    ]);
    // rules come from the template, not from the client
    expect(rows[0].s.columns[2].rules).toEqual([{ type: 'min', params: { value: 0.6 }, severity: 'warning' }]);
  });

  it('ignores any rules the client tries to sneak into a template upload', async () => {
    const res = await upload(alice, templateMeta({ ticket_id: 0 }, { columns: [{ key: 'x', rules: [] }] }));
    expect(res.statusCode).toBe(201);
    const { rows } = await db.query(`SELECT schema_snapshot AS s FROM uploads WHERE id = $1`, [res.json().upload.id]);
    expect(rows[0].s.columns).toHaveLength(4);
  });

  it('counts toward the template card', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/templates', headers: { cookie: alice } });
    expect(list.json().templates[0].uploadCount).toBeGreaterThanOrEqual(2);
  });

  it.each([
    ['an unknown column key', { nope: 0 }, 'Unknown template column "nope".'],
    ['a file column that does not exist', { ticket_id: 99 }, 'Column 100 does not exist in this file.'],
    ['two template columns on one file column', { ticket_id: 0, text: 0 }, 'This file column is already used by another column.'],
  ])('rejects %s', async (_label, mapping, message) => {
    const res = await upload(alice, templateMeta(mapping));
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toBe(message);
  });

  it("another user's template version is a 404", async () => {
    const res = await upload(bob, templateMeta({ ticket_id: 0 }));
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/uploads without a template', () => {
  const adhoc = {
    mode: 'adhoc',
    name: 'Vendor list',
    hasHeaderRow: true,
    columns: [
      { key: 'vendor', name: 'vendor', type: 'text', required: true, sourceIndex: 0 },
      { key: 'spend', name: 'Annual spend', type: 'number', sourceIndex: 2, rules: [{ type: 'min', params: { value: 0 } }] },
    ],
  };
  const vendors = 'vendor,contact,annual_spend\nAcme,ap@acme.test,120000\nGlobex,billing@globex.test,-5\n';

  it('stores the columns and rules the user set up, with their positions in the file', async () => {
    const res = await upload(alice, adhoc, vendors, 'vendors.csv');
    expect(res.statusCode).toBe(201);
    expect(res.json().upload.template).toBeNull();
    const { rows } = await db.query(`SELECT schema_snapshot AS s, template_version_id FROM uploads WHERE id = $1`, [res.json().upload.id]);
    expect(rows[0].template_version_id).toBeNull();
    expect(rows[0].s.columns.map((c: { key: string; sourceHeader: string }) => `${c.key}<-${c.sourceHeader}`)).toEqual(['vendor<-vendor', 'spend<-annual_spend']);
  });

  it('validates the columns like a template (paths point at the field)', async () => {
    const res = await upload(alice, { ...adhoc, columns: [{ ...adhoc.columns[1], rules: [{ type: 'min', params: { value: 'x' } }] }] }, vendors);
    expect(res.statusCode).toBe(400);
    expect(Object.keys(res.json().error.fields)).toEqual(['columns.0.rules.0.params.value']);
  });
});

describe('POST /api/uploads limits and bad requests', () => {
  it('rejects files over the size limit with 413', async () => {
    const res = await upload(alice, templateMeta({ ticket_id: 0 }), Buffer.alloc(64 * 1024 + 1, 'a'));
    expect(res.statusCode).toBe(413);
    expect(res.json().error.message).toBe('The file is larger than 0.1 MB. Split it or remove unused columns, then try again.');
  });

  it('rejects files over the row limit', async () => {
    const csv = 'ticket_id\n' + Array.from({ length: 51 }, (_, i) => i).join('\n');
    const res = await upload(alice, templateMeta({ ticket_id: 0 }), csv);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toBe('This file has 51 rows. The limit is 50.');
  });

  it('accepts exactly the row limit', async () => {
    const csv = 'ticket_id\n' + Array.from({ length: 50 }, (_, i) => i).join('\n');
    expect((await upload(alice, templateMeta({ ticket_id: 0 }), csv)).statusCode).toBe(201);
  });

  it('rejects an empty file, a missing name, and malformed meta', async () => {
    expect((await upload(alice, templateMeta({}), '')).json().error.message).toBe('The file is empty.');
    expect((await upload(alice, templateMeta({}, { name: ' ' }))).json().error.fields).toEqual({ name: 'Give this upload a name.' });
    expect((await upload(alice, '{oops')).json().error.message).toBe('The "meta" field is not valid JSON.');
  });

  it('rejects a JSON body (must be multipart) and requires sign-in', async () => {
    const json = await app.inject({ method: 'POST', url: '/api/uploads', headers: { cookie: alice }, payload: { a: 1 } });
    expect(json.statusCode).toBe(400);
    const anon = await app.inject({ method: 'POST', url: '/api/uploads', payload: { a: 1 } });
    expect(anon.statusCode).toBe(401);
  });
});

describe('GET /api/uploads/:id', () => {
  it('returns the upload to its owner only', async () => {
    const id = (await upload(alice, templateMeta({ ticket_id: 0 }))).json().upload.id;
    expect((await app.inject({ method: 'GET', url: `/api/uploads/${id}`, headers: { cookie: alice } })).json().upload.status).toBe('queued');
    expect((await app.inject({ method: 'GET', url: `/api/uploads/${id}`, headers: { cookie: bob } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/uploads/nope', headers: { cookie: alice } })).statusCode).toBe(404);
  });
});

describe('cleanFilename', () => {
  it.each([
    ['C:\\Users\\me\\Desktop\\data.csv', 'data.csv'],
    ['../../etc/passwd', 'passwd'],
    ['bad\u0000name\n.csv', 'badname.csv'],
    ['', 'upload.csv'],
  ])('%j -> %j', (raw, clean) => expect(cleanFilename(raw)).toBe(clean));
});
