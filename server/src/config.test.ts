import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const base = { DATABASE_URL: 'postgres://x@localhost/db' };

describe('config', () => {
  it('session cookie is Secure by default in production, not in development', () => {
    expect(loadConfig({ ...base, NODE_ENV: 'production' }).COOKIE_SECURE).toBe(true);
    expect(loadConfig({ ...base, NODE_ENV: 'development' }).COOKIE_SECURE).toBe(false);
  });
  it('COOKIE_SECURE=false really means false (not coerced to true)', () => {
    expect(loadConfig({ ...base, NODE_ENV: 'production', COOKIE_SECURE: 'false' }).COOKIE_SECURE).toBe(false);
    expect(loadConfig({ ...base, TRUST_PROXY: 'true' }).TRUST_PROXY).toBe(true);
  });
  it('agreed limits are the defaults', () => {
    const c = loadConfig(base);
    expect([c.MAX_FILE_BYTES, c.MAX_ROWS, c.SESSION_TTL_DAYS, c.LOGIN_MAX_FAILURES_PER_EMAIL]).toEqual([5242880, 20000, 14, 5]);
  });
  it('explains what is wrong', () => {
    expect(() => loadConfig({ COOKIE_SECURE: 'yes' })).toThrow(/DATABASE_URL: Required.*COOKIE_SECURE/);
  });
});
