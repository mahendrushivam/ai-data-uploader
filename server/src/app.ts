import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { HttpError, sendError } from './http.js';
import { authPlugin } from './auth/routes.js';
import { templateRoutes } from './templates/routes.js';
import { uploadRoutes } from './uploads/routes.js';

export interface AppDeps {
  config: Config;
  db: Db;
}

/** Builds the API without starting it, so tests can use app.inject() against a real database. */
export function buildApp(deps: AppDeps): FastifyInstance {
  const { config, db } = deps;
  const app = Fastify({
    logger: config.NODE_ENV === 'test' ? false : { level: config.NODE_ENV === 'production' ? 'info' : 'debug' },
    trustProxy: config.TRUST_PROXY,
  });

  app.register(cookie);
  // One file per request, capped at the agreed 5 MB (the exact limit comes from config).
  app.register(multipart, { limits: { fileSize: config.MAX_FILE_BYTES, files: 1, fields: 2, fieldSize: 1_000_000, parts: 4 } });

  app.setErrorHandler((err: Error, req, reply) => {
    if (err instanceof HttpError) return sendError(reply, err);
    // Fastify's own client errors (malformed JSON, body too large, ...)
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return sendError(reply, new HttpError(status, 'bad_request', err.message));
    }
    req.log.error({ err }, 'unhandled error');
    return sendError(reply, new HttpError(500, 'internal_error', 'Something went wrong. Please try again.'));
  });

  app.setNotFoundHandler((_req, reply) => sendError(reply, new HttpError(404, 'not_found', 'Not found.')));

  /** Liveness + readiness: is the database reachable and migrated? */
  app.get('/api/health', async (_req, reply) => {
    try {
      const { rows } = await db.query<{ version: string }>(
        'SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1',
      );
      return { status: 'ok', db: 'ok', migration: rows[0]?.version ?? null };
    } catch (err) {
      app.log.error({ err }, 'health check failed');
      return reply.code(503).send({ status: 'error', db: 'unavailable' });
    }
  });

  // Registered in order and NOT encapsulated (fastify-plugin), so the session hook runs after cookie
  // parsing and applies to every route, including those added in later milestones.
  app.register(authPlugin, deps);
  app.register(templateRoutes, deps);
  app.register(uploadRoutes, deps);

  return app;
}
