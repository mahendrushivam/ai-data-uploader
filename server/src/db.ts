import pg from 'pg';

export type Db = pg.Pool;

export function createDb(databaseUrl: string): Db {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  // An idle client erroring (e.g. the DB restarted) must not crash the process.
  pool.on('error', (err) => console.error('postgres pool error:', err.message));
  return pool;
}
