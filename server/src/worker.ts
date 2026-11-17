import { loadConfig } from './config.js';
import { createDb } from './db.js';
import { runOnce } from './worker/jobs.js';

/**
 * Background validation worker (separate process, same image as the API). It drains the queue, then
 * waits WORKER_POLL_MS before looking again. Any number of workers can run: jobs are claimed with
 * FOR UPDATE SKIP LOCKED, so no upload is processed twice.
 */
const config = loadConfig();
const db = createDb(config.DATABASE_URL);
let running = true;

const log = (msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ time: new Date().toISOString(), msg, ...extra }));

async function main() {
  await db.query('SELECT 1');
  log('worker started', { pollMs: config.WORKER_POLL_MS, maxRows: config.MAX_ROWS });
  while (running) {
    let worked = false;
    try {
      const started = Date.now();
      const done = await runOnce(db, config);
      if (done) {
        worked = true;
        log('upload validated', { upload: done.id, outcome: done.outcome, ms: Date.now() - started });
      }
    } catch (err) {
      log('worker tick failed', { error: err instanceof Error ? err.message : String(err) });
    }
    if (!worked) await new Promise((r) => setTimeout(r, config.WORKER_POLL_MS));
  }
  await db.end();
  log('worker stopped');
}

const stop = () => {
  running = false;
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

await main();
