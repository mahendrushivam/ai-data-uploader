import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { createDb } from '../db.js';
import { testConfig } from '../testing.js';

const DOMAIN = 'templates-test.local';
const config = testConfig();
const db = createDb(config.DATABASE_URL);
let app: FastifyInstance;
let alice: string; // session cookies
let bob: string;

const ticketTemplate = (name = `Support tickets ${randomUUID().slice(0, 6)}`) => ({
  name,
  description: 'Weekly export',
  columns: [
    { key: 'ticket_id', name: 'Ticket ID', type: 'integer', required: true, aliases: ['Ticket #', 'id'], rules: [{ type: 'unique', params: {} }] },
    { key: 'tags', name: 'Tags', type: 'multiselect', delimiter: ',' },
    {
      key: 'confidence',
      name: 'Confidence',
      type: 'number',
      rules: [
        { type: 'min', params: { value: 0.6 }, severity: 'warning', message: 'Low confidence' },
        { type: 'max', params: { value: 1 } },
      ],
    },
  ],
});

async function signup(): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/signup',
    remoteAddress: `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
    payload: { name: 'T', email: `${randomUUID()}@${DOMAIN}`, password: 'password123' },
  });
  const c = res.cookies.find((x) => x.name === 'dd_session')!;
  return `dd_session=${c.value}`;
}
const call = (cookie: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, payload });
const create = async (cookie: string, body: object = ticketTemplate()) => {
  const res = await call(cookie, 'POST', '/api/templates', body);
  expect(res.statusCode).toBe(201);
  return res.json().template;
};

beforeAll(async () => {
  app = buildApp({ config, db });
  await app.ready();
  alice = await signup();
  bob = await signup();
});
afterAll(async () => {
  await db.query(`DELETE FROM users WHERE email LIKE $1`, [`%@${DOMAIN}`]);
  await db.query(`DELETE FROM login_attempts WHERE email LIKE $1`, [`%@${DOMAIN}`]);
  await app.close();
  await db.end();
});

describe('templates API', () => {
  it('requires sign-in', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/templates' });
    expect(res.statusCode).toBe(401);
  });

  it('creates version 1 and returns the full definition with defaults filled in', async () => {
    const t = await create(alice);
    expect(t).toMatchObject({ version: 1, isDefault: false, hasHeaderRow: true, allowExtraColumns: true, description: 'Weekly export' });
    expect(t.columns).toHaveLength(3);
    expect(t.columns[0]).toEqual({
      key: 'ticket_id',
      name: 'Ticket ID',
      type: 'integer',
      required: true,
      delimiter: null,
      aliases: ['Ticket #', 'id'],
      rules: [{ type: 'unique', params: {}, severity: 'error' }],
    });
    expect(t.columns[2].rules).toEqual([
      { type: 'min', params: { value: 0.6 }, severity: 'warning', message: 'Low confidence' },
      { type: 'max', params: { value: 1 }, severity: 'error' },
    ]);
  });

  it('lists templates with counts for the cards', async () => {
    const t = await create(alice);
    const res = await call(alice, 'GET', '/api/templates');
    const card = res.json().templates.find((x: { id: string }) => x.id === t.id);
    expect(card).toMatchObject({ version: 1, columnCount: 3, ruleCount: 3, uploadCount: 0 });
    expect(card.columns[0]).toEqual({ name: 'Ticket ID', type: 'integer', required: true });
  });

  it('editing saves version 2 and leaves version 1 untouched in the database', async () => {
    const t = await create(alice);
    const edited = { ...ticketTemplate(t.name), columns: [...ticketTemplate().columns, { key: 'note', name: 'Note', type: 'text' }] };
    const res = await call(alice, 'PUT', `/api/templates/${t.id}`, edited);
    expect(res.statusCode).toBe(200);
    expect(res.json().template).toMatchObject({ version: 2 });
    expect(res.json().template.columns).toHaveLength(4);
    const { rows } = await db.query(
      `SELECT tv.version, count(c.id)::int AS columns FROM template_versions tv
       JOIN template_columns c ON c.template_version_id = tv.id WHERE tv.template_id = $1 GROUP BY tv.version ORDER BY 1`,
      [t.id],
    );
    expect(rows).toEqual([{ version: 1, columns: 3 }, { version: 2, columns: 4 }]);
  });

  it('only one default per user; switching moves the star; it can be cleared', async () => {
    const a = await create(alice);
    const b = await create(alice);
    expect((await call(alice, 'PUT', `/api/templates/${a.id}/default`, { isDefault: true })).json().template.isDefault).toBe(true);
    await call(alice, 'PUT', `/api/templates/${b.id}/default`, { isDefault: true });
    const list = (await call(alice, 'GET', '/api/templates')).json().templates;
    expect(list.filter((t: { isDefault: boolean }) => t.isDefault).map((t: { id: string }) => t.id)).toEqual([b.id]);
    expect(list[0].id).toBe(b.id); // the default is listed first
    await call(alice, 'PUT', `/api/templates/${b.id}/default`, { isDefault: false });
    const after = (await call(alice, 'GET', '/api/templates')).json().templates;
    expect(after.some((t: { isDefault: boolean }) => t.isDefault)).toBe(false);
  });

  it('concurrent "set default" calls never end with two defaults or a server error', async () => {
    const ids = await Promise.all([create(alice), create(alice), create(alice)]).then((ts) => ts.map((t) => t.id));
    const results = await Promise.all(ids.map((id) => call(alice, 'PUT', `/api/templates/${id}/default`, { isDefault: true })));
    expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200]);
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM templates WHERE is_default AND owner_id = (SELECT owner_id FROM templates WHERE id = $1)`,
      [ids[0]],
    );
    expect(rows[0].n).toBe(1);
  });

  it('delete archives: gone from the list, no longer default, and the name can be reused', async () => {
    const t = await create(alice);
    await call(alice, 'PUT', `/api/templates/${t.id}/default`, { isDefault: true });
    expect((await call(alice, 'DELETE', `/api/templates/${t.id}`)).statusCode).toBe(204);
    const list = (await call(alice, 'GET', '/api/templates')).json().templates;
    expect(list.find((x: { id: string }) => x.id === t.id)).toBeUndefined();
    expect((await call(alice, 'GET', `/api/templates/${t.id}`)).statusCode).toBe(404);
    await create(alice, ticketTemplate(t.name));
  });

  it('a duplicate name is a 409 with a field error (case-insensitive)', async () => {
    const t = await create(alice);
    const res = await call(alice, 'POST', '/api/templates', ticketTemplate(t.name.toUpperCase()));
    expect(res.statusCode).toBe(409);
    expect(res.json().error.fields).toEqual({ name: 'You already have a template with this name.' });
  });

  it('invalid rules are rejected with the path of the offending field', async () => {
    const bad = ticketTemplate();
    bad.columns[2].rules = [{ type: 'min', params: { value: 5 } }, { type: 'max', params: { value: 1 } }];
    const res = await call(alice, 'POST', '/api/templates', bad);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.fields).toEqual({ 'columns.2.rules.0.params.value': 'Minimum is greater than maximum.' });
  });

  it('regex patterns must compile in RE2 (no lookahead), which the worker uses', async () => {
    const t = ticketTemplate();
    const res = await call(alice, 'POST', '/api/templates', {
      ...t,
      columns: [{ key: 'code', name: 'Code', type: 'text', rules: [{ type: 'regex', params: { pattern: '^(?=.*\\d)[A-Z0-9]+$' } }] }],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.fields['columns.0.rules.0.params.pattern']).toMatch(/not supported/);
    const ok = await call(alice, 'POST', '/api/templates', {
      ...ticketTemplate(),
      columns: [{ key: 'code', name: 'Code', type: 'text', rules: [{ type: 'regex', params: { pattern: '^[A-Z]{3}-\\d+$', flags: 'i' } }] }],
    });
    expect(ok.statusCode).toBe(201);
  });

  it("another user's templates are invisible: 404 for read, edit, default and delete", async () => {
    const t = await create(alice);
    expect((await call(bob, 'GET', '/api/templates')).json().templates.find((x: { id: string }) => x.id === t.id)).toBeUndefined();
    expect((await call(bob, 'GET', `/api/templates/${t.id}`)).statusCode).toBe(404);
    expect((await call(bob, 'PUT', `/api/templates/${t.id}`, ticketTemplate())).statusCode).toBe(404);
    expect((await call(bob, 'PUT', `/api/templates/${t.id}/default`, { isDefault: true })).statusCode).toBe(404);
    expect((await call(bob, 'DELETE', `/api/templates/${t.id}`)).statusCode).toBe(404);
    expect((await call(alice, 'GET', `/api/templates/${t.id}`)).json().template.version).toBe(1); // unchanged
  });

  it('a malformed id is a 404, not a server error', async () => {
    expect((await call(alice, 'GET', '/api/templates/not-a-uuid')).statusCode).toBe(404);
  });
});
