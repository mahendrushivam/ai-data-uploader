import { loadConfig } from './config.js';
import { createDb } from './db.js';
import { buildApp } from './app.js';

const config = loadConfig();
const db = createDb(config.DATABASE_URL);
const app = buildApp({ config, db });

const shutdown = async (signal: string) => {
  app.log.info(`${signal} received, shutting down`);
  await app.close();
  await db.end();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: config.PORT, host: config.HOST });
