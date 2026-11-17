import { fileURLToPath } from 'node:url';
import { loadConfig, type Config } from './config.js';

// Like dbmate, pick up DATABASE_URL from the repo's .env when it isn't already set.
if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url)));
  } catch {
    /* no .env file: the check below explains what to do */
  }
}

/** Config for API tests: a real, migrated PostgreSQL is required (DATABASE_URL). */
export function testConfig(overrides: Partial<Record<keyof Config, string>> = {}): Config {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'API tests need a migrated PostgreSQL. Set DATABASE_URL (e.g. from .env) and run `npm run db:migrate` first.',
    );
  }
  return loadConfig({ ...process.env, NODE_ENV: 'test', ...overrides });
}
