// Shared helpers for the database scripts: load .env (like dbmate does) and describe the target DB.
import { fileURLToPath } from 'node:url';

export function loadDatabaseUrl() {
  if (!process.env.DATABASE_URL) {
    try {
      process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url)));
    } catch {
      /* handled below */
    }
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. Copy .env.example to .env (or export DATABASE_URL) first.');
    process.exit(1);
  }
  return url;
}

/** "user@host:port/db" without the password, for log lines. */
export function describe(url) {
  const u = new URL(url);
  return `${u.username || '(default user)'}@${u.hostname || u.searchParams.get('host') || 'localhost'}:${u.port || 5432}${u.pathname}`;
}
