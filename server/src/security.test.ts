/**
 * Release check: every endpoint that touches a user's data refuses everyone else.
 * Another user gets 404 (not 403, so they can't even learn the resource exists); no session gets 401.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { createDb } from './db.js';
import { testConfig } from './testing.js';
import { runOnce } from './worker/jobs.js';

const DOMAIN = 'security-test.local';
const config = testConfig();
const db = createDb(config.DATABASE_URL);
let app: FastifyInstance;
let alice: string;
let bob: string;
let template: { id: string; versionId: string };
let uploadId: string;

const session = async (ip: string) => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/signup',
    remoteAddress: ip,
    payload: { name: 'S', email: `${randomUUID()}@${DOMAIN}`, password: 'password123' },
  });
  return `dd_session=${res.cookies.find((c) => c.name === 'dd_session')!.value}`;
};

async function uploadAs(cookie: string, meta: object) {
  const form = new FormData();
  form.append('meta', JSON.stringify(meta));
  form.append('file', new Blob(['code\nA1\nA1\n']), 'codes.csv');
  const req = new Request('http://x', { method: 'POST', body: form });
  return app.inject({
    method: 'POST',
    url: '/api/uploads',
    headers: { ...(cookie ? { cookie } : {}), 'content-type': req.headers.get('content-type')! },
    payload: Buffer.from(await req.arrayBuffer()),
  });
}

beforeAll(async () => {
  app = buildApp({ config, db });
  await app.ready();
  alice = await session('10.5.0.1');
  bob = await session('10.5.0.2');
  template = (
    await app.inject({
      method: 'POST',
      url: '/api/templates',
      headers: { cookie: alice },
      payload: { name: 'Codes', columns: [{ key: 'code', name: 'code', type: 'text', rules: [{ type: 'unique', params: {} }] }] },
    })
  ).json().template;
  const res = await uploadAs(alice, { mode: 'template', name: 'Alice codes', templateVersionId: template.versionId, mapping: { code: 0 } });
  uploadId = res.json().upload.id;
  await db.query(`UPDATE uploads SET created_at = '2000-01-01' WHERE id = $1`, [uploadId]);
  await runOnce(db, config); // finished, so every download endpoint is live for its owner
});
afterAll(async () => {
  await db.query(`DELETE FROM users WHERE email LIKE $1`, [`%@${DOMAIN}`]);
  await app.close();
  await db.end();
});

const endpoints = () =>
  [
    ['GET', `/api/templates/${template.id}`],
    ['PUT', `/api/templates/${template.id}`, { name: 'Stolen', columns: [{ key: 'x', name: 'x', type: 'text' }] }],
    ['PUT', `/api/templates/${template.id}/default`, { isDefault: true }],
    ['DELETE', `/api/templates/${template.id}`],
    ['GET', `/api/uploads/${uploadId}`],
    ['GET', `/api/uploads/${uploadId}/issues`],
    ['GET', `/api/uploads/${uploadId}/rows`],
    ['GET', `/api/uploads/${uploadId}/errors.csv`],
    ['GET', `/api/uploads/${uploadId}/export.csv`],
    ['GET', `/api/uploads/${uploadId}/export.csv?errors=1`],
    ['GET', `/api/uploads/${uploadId}/original`],
    ['DELETE', `/api/uploads/${uploadId}`],
  ] as const;

describe('ownership', () => {
  it('the owner can use every endpoint (sanity check for the test itself)', async () => {
    for (const [method, url] of endpoints()) {
      if (method !== 'GET') continue; // don't modify the owner's data here
      expect((await app.inject({ method, url, headers: { cookie: alice } })).statusCode, url).toBe(200);
    }
  });

  it("another user gets 404 from every endpoint of someone else's templates and uploads", async () => {
    for (const [method, url, payload] of endpoints()) {
      const res = await app.inject({ method, url, headers: { cookie: bob }, payload: payload as object | undefined });
      expect(res.statusCode, `${method} ${url}`).toBe(404);
    }
  });

  it("...and can't upload with someone else's template", async () => {
    const res = await uploadAs(bob, { mode: 'template', name: 'x', templateVersionId: template.versionId, mapping: { code: 0 } });
    expect(res.statusCode).toBe(404);
  });

  it("...and never sees them in lists", async () => {
    expect((await app.inject({ method: 'GET', url: '/api/templates', headers: { cookie: bob } })).json().templates).toEqual([]);
    expect((await app.inject({ method: 'GET', url: '/api/uploads', headers: { cookie: bob } })).json().uploads).toEqual([]);
  });

  it("the owner's data is untouched by all of those attempts", async () => {
    const t = (await app.inject({ method: 'GET', url: `/api/templates/${template.id}`, headers: { cookie: alice } })).json().template;
    expect(t).toMatchObject({ name: 'Codes', version: 1, isDefault: false });
    const u = (await app.inject({ method: 'GET', url: `/api/uploads/${uploadId}`, headers: { cookie: alice } })).json().upload;
    expect(u).toMatchObject({ name: 'Alice codes', status: 'failed_validation', errorCount: 1 }); // the duplicate A1
  });

  it('without a session, every endpoint is 401', async () => {
    const all = [...endpoints(), ['GET', '/api/templates'], ['POST', '/api/templates', {}], ['GET', '/api/uploads'], ['GET', '/api/auth/me']] as const;
    for (const [method, url, payload] of all) {
      const res = await app.inject({ method, url, payload: payload as object | undefined });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
    expect((await uploadAs('', { mode: 'template', name: 'x', templateVersionId: template.versionId, mapping: {} })).statusCode).toBe(401);
  });
});
