import { readdirSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createDb } from './db.js';
import { testConfig } from './testing.js';

describe('GET /api/health', () => {
  const config = testConfig();
  const db = createDb(config.DATABASE_URL);
  const app = buildApp({ config, db });
  afterAll(async () => {
    await app.close();
    await db.end();
  });

  it('reports the database and the latest applied migration', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    const latest = readdirSync(new URL('../../db/migrations', import.meta.url)).sort().at(-1)!.split('_')[0];
    expect(res.json()).toEqual({ status: 'ok', db: 'ok', migration: latest });
  });

  it('returns 503 when the database is unreachable', async () => {
    const badDb = createDb('postgres://nobody@127.0.0.1:1/none?connect_timeout=2');
    const badApp = buildApp({ config, db: badDb });
    const res = await badApp.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'error', db: 'unavailable' });
    await badApp.close();
    await badDb.end();
  });
});
