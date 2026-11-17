// Runs a SQL file (seed or schema tests) without needing psql installed.
// psql meta-commands (lines starting with a backslash, e.g. \set, \echo) are skipped; the rest is sent
// as one script, so the file's own BEGIN/COMMIT/ROLLBACK apply and the first error stops it.
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { describe, loadDatabaseUrl } from './env.mjs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node server/scripts/run-sql.mjs <file.sql>');
  process.exit(1);
}
const url = loadDatabaseUrl();
const sql = readFileSync(file, 'utf8')
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('\\'))
  .join('\n');

const client = new pg.Client({ connectionString: url });
client.on('notice', (n) => console.log(`  ${n.message}`));
try {
  await client.connect();
  console.log(`Running ${file} on ${describe(url)}`);
  const results = [].concat(await client.query(sql));
  const last = results.at(-1);
  if (last?.rows?.length) console.table(last.rows);
  console.log(`OK: ${file}`);
} catch (err) {
  console.error(`FAILED: ${file}\n  ${err.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
