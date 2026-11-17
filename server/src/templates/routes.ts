import type { FastifyInstance, FastifyRequest } from 'fastify';
import { re2Compiler } from '../re2.js';
import { z } from 'zod';
import { templateInputSchema, type TemplateInput } from '@datadesk/shared/rules';
import type { AppDeps } from '../app.js';
import { requireUser } from '../auth/routes.js';
import { HttpError, parseBody } from '../http.js';
import { archiveTemplate, createTemplate, getTemplate, listTemplates, saveNewVersion, setDefault } from './repo.js';

const NOT_FOUND = new HttpError(404, 'not_found', 'Template not found.');

/** Route ids must be UUIDs; anything else is simply "not found" (never a database error). */
function templateId(req: FastifyRequest): string {
  const parsed = z.string().uuid().safeParse((req.params as { id?: string }).id);
  if (!parsed.success) throw NOT_FOUND;
  return parsed.data;
}

/**
 * The shared schema already checks patterns with the browser's RegExp. The worker runs them with RE2
 * (linear time, no catastrophic backtracking), which doesn't support a few constructs such as
 * lookahead and backreferences, so patterns must also compile there.
 */
function parseTemplate(req: FastifyRequest): TemplateInput {
  const input = parseBody(templateInputSchema, req);
  const fields: Record<string, string> = {};
  input.columns.forEach((col, i) =>
    col.rules.forEach((rule, r) => {
      if (rule.type !== 'regex') return;
      try {
        re2Compiler(rule.params.pattern, rule.params.flags);
      } catch {
        fields[`columns.${i}.rules.${r}.params.pattern`] =
          'This pattern uses a feature that is not supported (for example lookahead or backreferences).';
      }
    }),
  );
  if (Object.keys(fields).length) throw new HttpError(400, 'validation_failed', Object.values(fields)[0], fields);
  return input;
}

const nameTaken = (err: unknown) =>
  (err as { code?: string; constraint?: string }).code === '23505' &&
  (err as { constraint?: string }).constraint === 'templates_owner_name_uq';
const NAME_TAKEN = new HttpError(409, 'name_taken', 'You already have a template with this name.', {
  name: 'You already have a template with this name.',
});

export async function templateRoutes(app: FastifyInstance, { db }: AppDeps) {
  app.get('/api/templates', async (req) => ({ templates: await listTemplates(db, requireUser(req).id) }));

  app.get('/api/templates/:id', async (req) => {
    const template = await getTemplate(db, requireUser(req).id, templateId(req));
    if (!template) throw NOT_FOUND;
    return { template };
  });

  app.post('/api/templates', async (req, reply) => {
    const user = requireUser(req);
    const input = parseTemplate(req);
    let id: string;
    try {
      id = await createTemplate(db, user.id, input);
    } catch (err) {
      if (nameTaken(err)) throw NAME_TAKEN;
      throw err;
    }
    return reply.code(201).send({ template: await getTemplate(db, user.id, id) });
  });

  /** Editing saves a new version; earlier versions (and uploads that used them) are untouched. */
  app.put('/api/templates/:id', async (req) => {
    const user = requireUser(req);
    const id = templateId(req);
    const input = parseTemplate(req);
    try {
      if (!(await saveNewVersion(db, user.id, id, input))) throw NOT_FOUND;
    } catch (err) {
      if (nameTaken(err)) throw NAME_TAKEN;
      throw err;
    }
    return { template: await getTemplate(db, user.id, id) };
  });

  app.put('/api/templates/:id/default', async (req) => {
    const user = requireUser(req);
    const id = templateId(req);
    const { isDefault } = parseBody(z.object({ isDefault: z.boolean() }), req);
    if (!(await setDefault(db, user.id, id, isDefault))) throw NOT_FOUND;
    return { template: await getTemplate(db, user.id, id) };
  });

  app.delete('/api/templates/:id', async (req, reply) => {
    const user = requireUser(req);
    if (!(await archiveTemplate(db, user.id, templateId(req)))) throw NOT_FOUND;
    return reply.code(204).send();
  });
}
