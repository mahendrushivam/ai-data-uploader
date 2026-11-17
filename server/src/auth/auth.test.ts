import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../app.js';
import { createDb } from '../db.js';
import { testConfig } from '../testing.js';

const DOMAIN = 'auth-test.local';
const config = testConfig({ LOGIN_MAX_FAILURES_PER_EMAIL: '5', LOGIN_MAX_FAILURES_PER_IP: '20' });
const db = createDb(config.DATABASE_URL);
let app: FastifyInstance;

// Each test uses its own email and client IP, so rate-limit counters never leak between tests.
let ipCounter = 0;
const newIdentity = () => ({ email: `${randomUUID()}@${DOMAIN}`, ip: `10.1.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}` });

const cookieFrom = (res: LightMyRequestResponse) => {
  const c = res.cookies.find((x) => x.name === 'dd_session');
  return c ? `dd_session=${c.value}` : undefined;
};

async function signup(email: string, ip: string, password = 'correct horse 1') {
  return app.inject({ method: 'POST', url: '/api/auth/signup', remoteAddress: ip, payload: { name: 'Test User', email, password } });
}
async function login(email: string, password: string, ip: string) {
  return app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress: ip, payload: { email, password } });
}
async function me(cookie?: string) {
  return app.inject({ method: 'GET', url: '/api/auth/me', headers: cookie ? { cookie } : {} });
}

beforeAll(async () => {
  app = buildApp({ config, db });
  await app.ready();
});
afterAll(async () => {
  await db.query(`DELETE FROM login_attempts WHERE email LIKE $1`, [`%@${DOMAIN}`]);
  await db.query(`DELETE FROM users WHERE email LIKE $1`, [`%@${DOMAIN}`]);
  await app.close();
  await db.end();
});

describe('sign up', () => {
  it('creates the account, signs the user in, and sets a secure session cookie', async () => {
    const { email, ip } = newIdentity();
    const res = await signup(email.toUpperCase(), ip);
    expect(res.statusCode).toBe(201);
    expect(res.json().user).toMatchObject({ name: 'Test User', email });  // email stored lower-case
    const c = res.cookies.find((x) => x.name === 'dd_session')!;
    expect(c).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 14 * 24 * 3600 });
    expect((await me(cookieFrom(res))).json().user.email).toBe(email);
  });

  it('stores only argon2id hashes and SHA-256 session token hashes, never the secrets', async () => {
    const { email, ip } = newIdentity();
    const res = await signup(email, ip, 'my secret pw 123');
    const token = res.cookies.find((x) => x.name === 'dd_session')!.value;
    const { rows } = await db.query(
      `SELECT u.password_hash, s.token_hash FROM users u JOIN sessions s ON s.user_id = u.id WHERE u.email = $1`,
      [email],
    );
    expect(rows[0].password_hash).toMatch(/^\$argon2id\$/);
    expect(rows[0].password_hash).not.toContain('my secret pw 123');
    expect(rows[0].token_hash.equals(createHash('sha256').update(token).digest())).toBe(true);
  });

  it('rejects a duplicate email regardless of case', async () => {
    const { email, ip } = newIdentity();
    await signup(email, ip);
    const res = await signup(email.replace(/^./, (c) => c.toUpperCase()), ip);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({ code: 'email_taken', fields: { email: expect.any(String) } });
  });

  it.each([
    ['short password', { name: 'A', email: 'a@b.co', password: '1234567' }, 'password', 'Password must be at least 8 characters.'],
    ['bad email', { name: 'A', email: 'not-an-email', password: '12345678' }, 'email', 'Please enter a valid email address.'],
    ['blank name', { name: '   ', email: 'a@b.co', password: '12345678' }, 'name', 'Please enter your name.'],
    ['missing fields', {}, 'name', 'Name is required.'],
  ])('rejects %s with a field error', async (_label, payload, field, message) => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/signup', payload });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_failed');
    expect(res.json().error.fields[field]).toBe(message);
  });

  it('accepts exactly 8 characters', async () => {
    const { email, ip } = newIdentity();
    expect((await signup(email, ip, '12345678')).statusCode).toBe(201);
  });
});

describe('sign in', () => {
  it('signs in with the right password', async () => {
    const { email, ip } = newIdentity();
    await signup(email, ip);
    const res = await login(email, 'correct horse 1', ip);
    expect(res.statusCode).toBe(200);
    expect(res.json().user.email).toBe(email);
    expect((await me(cookieFrom(res))).statusCode).toBe(200);
  });

  it('gives the same generic error for a wrong password and an unknown email', async () => {
    const { email, ip } = newIdentity();
    await signup(email, ip);
    const wrong = await login(email, 'wrong password', ip);
    const unknown = await login(`nobody-${email}`, 'whatever1', ip);
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
    expect(wrong.json().error.message).toBe('Incorrect email or password.');
    expect(cookieFrom(wrong)).toBeUndefined();
  });

  it('blocks an email after 5 failures, even with the right password, and records attempts', async () => {
    const { email, ip } = newIdentity();
    await signup(email, ip);
    for (let i = 0; i < 5; i++) expect((await login(email, 'wrong password', ip)).statusCode).toBe(401);
    const blocked = await login(email, 'correct horse 1', ip);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBe(String(15 * 60));
    expect(blocked.json().error.message).toBe('Too many failed sign-in attempts. Try again in 15 minutes.');
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM login_attempts WHERE email = $1 AND NOT succeeded`, [email]);
    expect(rows[0].n).toBe(5);
  });

  it('a successful sign-in resets the per-email failure count', async () => {
    const { email, ip } = newIdentity();
    await signup(email, ip);
    for (let i = 0; i < 4; i++) await login(email, 'wrong password', ip);
    expect((await login(email, 'correct horse 1', ip)).statusCode).toBe(200);
    for (let i = 0; i < 4; i++) await login(email, 'wrong password', ip);
    expect((await login(email, 'correct horse 1', ip)).statusCode).toBe(200);
  });

  it('blocks an IP after 20 failures across different emails', async () => {
    const { ip } = newIdentity();
    for (let i = 0; i < 20; i++) await login(`${randomUUID()}@${DOMAIN}`, 'wrong password', ip);
    expect((await login(`${randomUUID()}@${DOMAIN}`, 'whatever1', ip)).statusCode).toBe(429);
    // a different IP is unaffected
    expect((await login(`${randomUUID()}@${DOMAIN}`, 'whatever1', newIdentity().ip)).statusCode).toBe(401);
  });

  it('refuses disabled accounts with the same generic error', async () => {
    const { email, ip } = newIdentity();
    await signup(email, ip);
    await db.query(`UPDATE users SET status = 'disabled' WHERE email = $1`, [email]);
    expect((await login(email, 'correct horse 1', ip)).json().error.code).toBe('invalid_credentials');
  });
});

describe('sessions', () => {
  it('me without a cookie is 401', async () => {
    const res = await me();
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('unauthenticated');
  });

  it('logout revokes the session server-side (the old cookie stops working)', async () => {
    const { email, ip } = newIdentity();
    const cookie = cookieFrom(await signup(email, ip))!;
    const out = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
    expect(out.statusCode).toBe(204);
    expect(out.cookies.find((c) => c.name === 'dd_session')?.value).toBe('');
    expect((await me(cookie)).statusCode).toBe(401);
  });

  it('an expired session is rejected and its cookie cleared', async () => {
    const { email, ip } = newIdentity();
    const cookie = cookieFrom(await signup(email, ip))!;
    await db.query(
      `UPDATE sessions SET created_at = now() - interval '20 days', expires_at = now() - interval '1 minute'
       WHERE user_id = (SELECT id FROM users WHERE email = $1)`,
      [email],
    );
    const res = await me(cookie);
    expect(res.statusCode).toBe(401);
    expect(res.cookies.find((c) => c.name === 'dd_session')?.value).toBe('');
  });

  it('sliding expiry: activity after an hour extends the session and re-sends the cookie', async () => {
    const { email, ip } = newIdentity();
    const cookie = cookieFrom(await signup(email, ip))!;
    await db.query(
      `UPDATE sessions SET created_at = now() - interval '2 days', last_seen_at = now() - interval '2 hours',
              expires_at = now() + interval '1 day'
       WHERE user_id = (SELECT id FROM users WHERE email = $1)`,
      [email],
    );
    const res = await me(cookie);
    expect(res.statusCode).toBe(200);
    expect(res.cookies.find((c) => c.name === 'dd_session')?.maxAge).toBe(14 * 24 * 3600);
    const { rows } = await db.query(
      `SELECT expires_at > now() + interval '13 days' AS extended FROM sessions
       WHERE user_id = (SELECT id FROM users WHERE email = $1)`,
      [email],
    );
    expect(rows[0].extended).toBe(true);
  });

  it('a forged cookie is rejected', async () => {
    expect((await me('dd_session=forged-token-value')).statusCode).toBe(401);
  });
});

describe('CSRF origin check', () => {
  it('blocks a state-changing request from another site', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: 'https://evil.example', host: 'localhost:8000' },
      payload: { email: 'a@b.co', password: 'x' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('bad_origin');
  });

  it('allows the same origin (host and port must match)', async () => {
    const { email, ip } = newIdentity();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      remoteAddress: ip,
      headers: { origin: 'http://localhost:8000', host: 'localhost:8000' },
      payload: { name: 'Same Origin', email, password: '12345678' },
    });
    expect(res.statusCode).toBe(201);
  });
});

describe('errors', () => {
  it('malformed JSON gets the standard error shape', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: '{not json',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('bad_request');
  });

  it('unknown API routes are 404 JSON', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'not_found', message: 'Not found.' } });
  });
});
