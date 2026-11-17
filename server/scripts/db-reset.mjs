// DEVELOPMENT ONLY: drop the database, recreate it, apply all migrations and load the demo seed.
// Refuses to run in production or against a database that isn't clearly local.
import { execFileSync } from 'node:child_process';
import { describe, loadDatabaseUrl } from './env.mjs';

const url = loadDatabaseUrl();
const u = new URL(url);
const host = u.hostname || u.searchParams.get('host') || 'localhost';
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]', 'db', 'postgres'];

if (process.env.NODE_ENV === 'production') {
  console.error('db:reset refuses to run with NODE_ENV=production.');
  process.exit(1);
}
if (!LOCAL_HOSTS.includes(host) && !host.startsWith('/')) {
  console.error(`db:reset refuses to run against "${host}". It only resets local databases (${LOCAL_HOSTS.join(', ')}).`);
  process.exit(1);
}

console.log(`Resetting ${describe(url)}: drop, create, migrate, seed`);
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit', env: { ...process.env, DATABASE_URL: url } });
const dbmate = ['dbmate', '--migrations-dir', 'db/migrations', '--no-dump-schema'];
run('npx', [...dbmate, 'drop']);
run('npx', [...dbmate, 'create']);
run('npx', [...dbmate, '--wait', 'up']);
run('node', ['server/scripts/run-sql.mjs', 'db/seeds/dev_seed.sql']);
console.log('Database reset complete.');
