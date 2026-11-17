import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';

/**
 * Every API error has the same JSON shape:
 *   { "error": { "code": "validation_failed", "message": "…", "fields": { "password": "…" } } }
 */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

/** Validates a request body with zod; on failure answers 400 with one message per field. */
export function parseBody<S extends z.ZodTypeAny>(schema: S, req: FastifyRequest): z.infer<S> {
  const result = schema.safeParse(req.body ?? {});
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_';
    fields[key] ??= issue.message;
  }
  throw new HttpError(400, 'validation_failed', Object.values(fields)[0] ?? 'Invalid request.', fields);
}

export function sendError(reply: FastifyReply, err: HttpError) {
  return reply.code(err.status).send({
    error: { code: err.code, message: err.message, ...(err.fields ? { fields: err.fields } : {}) },
  });
}
