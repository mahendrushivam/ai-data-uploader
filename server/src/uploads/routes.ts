import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  decodeCsv,
  parseCsv,
  snapshotFromAdhoc,
  snapshotFromTemplate,
  splitRows,
  uploadRequestSchema,
  uploadSnapshotSchema,
  type UploadSnapshot,
} from '@datadesk/shared/upload';
import type { AppDeps } from '../app.js';
import { requireUser } from '../auth/routes.js';
import { HttpError } from '../http.js';
import { attachment, downloadName, errorReportCsv, templateFormatCsv } from './exports.js';
import {
  createUpload,
  getUpload,
  getUploadDetail,
  listDataRows,
  listIssues,
  listRows,
  listUploads,
  loadVersionForUpload,
  originalFile,
  softDeleteUpload,
} from './repo.js';

const mb = (bytes: number) => `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`;

/** Keep just the file name (no path), without control characters, at most 255 characters. */
export function cleanFilename(raw: string | undefined): string {
  const base = (raw ?? '').replace(/\\/g, '/').split('/').pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 255);
  return cleaned || 'upload.csv';
}

const bad = (message: string, fields?: Record<string, string>) => new HttpError(400, 'validation_failed', message, fields);

/** Reads the multipart body: one "meta" JSON field and one "file". */
async function readMultipart(req: FastifyRequest, maxBytes: number) {
  if (!req.isMultipart()) throw bad('Send the file as multipart/form-data with "meta" and "file" fields.');
  let meta: unknown;
  let file: { filename: string; content: Buffer } | undefined;
  for await (const part of req.parts()) {
    if (part.type === 'file') {
      if (part.fieldname !== 'file' || file) throw bad('Send exactly one file, in the "file" field.');
      try {
        file = { filename: cleanFilename(part.filename), content: await part.toBuffer() };
      } catch (err) {
        if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
          throw new HttpError(413, 'file_too_large', `The file is larger than ${mb(maxBytes)}. Split it or remove unused columns, then try again.`);
        }
        throw err;
      }
    } else if (part.fieldname === 'meta') {
      try {
        meta = JSON.parse(String(part.value));
      } catch {
        throw bad('The "meta" field is not valid JSON.');
      }
    }
  }
  if (!file) throw bad('No file was uploaded.');
  if (meta === undefined) throw bad('The "meta" field is missing.');
  return { meta, file };
}

export async function uploadRoutes(app: FastifyInstance, { config, db }: AppDeps) {
  app.post('/api/uploads', async (req, reply) => {
    const user = requireUser(req);
    const { meta, file } = await readMultipart(req, config.MAX_FILE_BYTES);

    const parsedMeta = uploadRequestSchema.safeParse(meta);
    if (!parsedMeta.success) {
      const fields: Record<string, string> = {};
      for (const i of parsedMeta.error.issues) fields[i.path.join('.') || '_'] ??= i.message;
      throw bad(Object.values(fields)[0], fields);
    }
    const request = parsedMeta.data;
    if (file.content.length === 0) throw bad('The file is empty.');

    // The template (or the ad-hoc settings) decides whether there is a header row.
    const version =
      request.mode === 'template' ? await loadVersionForUpload(db, user.id, request.templateVersionId) : null;
    if (request.mode === 'template' && !version) throw new HttpError(404, 'not_found', 'Template not found.');
    const hasHeaderRow = version ? version.hasHeaderRow : request.mode === 'adhoc' && request.hasHeaderRow;

    // Re-check the limits here: the browser checks them too, but it can't be trusted.
    const parsed = parseCsv(decodeCsv(file.content).text);
    const { headers, body, width } = splitRows(parsed.rows, hasHeaderRow);
    if (body.length > config.MAX_ROWS) {
      throw bad(`This file has ${body.length.toLocaleString('en-US')} rows. The limit is ${config.MAX_ROWS.toLocaleString('en-US')}.`);
    }

    let snapshot: UploadSnapshot;
    if (request.mode === 'template') {
      const keys = new Set(version!.columns.map((c) => c.key));
      for (const [key, index] of Object.entries(request.mapping)) {
        if (!keys.has(key)) throw bad(`Unknown template column "${key}".`, { [`mapping.${key}`]: 'Not a column of this template.' });
        if (index !== null && index >= width) throw bad(`Column ${index + 1} does not exist in this file.`, { [`mapping.${key}`]: 'Not a column of this file.' });
      }
      snapshot = snapshotFromTemplate(version!, request.mapping, headers);
    } else {
      for (const [i, c] of request.columns.entries()) {
        if (c.sourceIndex >= width) throw bad(`Column ${c.sourceIndex + 1} does not exist in this file.`, { [`columns.${i}.sourceIndex`]: 'Not a column of this file.' });
      }
      snapshot = snapshotFromAdhoc(request.columns, hasHeaderRow, headers);
    }
    const checked = uploadSnapshotSchema.safeParse(snapshot);
    if (!checked.success) {
      const issue = checked.error.issues[0];
      throw bad(issue.message, { [issue.path.join('.')]: issue.message }); // e.g. two template columns mapped to one file column
    }

    const id = await createUpload(db, {
      ownerId: user.id,
      name: request.name,
      snapshot: checked.data,
      filename: file.filename,
      content: file.content,
      sha256: createHash('sha256').update(file.content).digest(),
      delimiter: parsed.delimiter,
    });
    return reply.code(201).send({ upload: await getUpload(db, user.id, id) });
  });

  /** The upload if it belongs to the signed-in user; 404 otherwise (also for malformed ids). */
  async function ownUpload(req: FastifyRequest) {
    const user = requireUser(req);
    const id = z.string().uuid().safeParse((req.params as { id?: string }).id);
    const found = id.success ? await getUploadDetail(db, user.id, id.data) : null;
    if (!found) throw new HttpError(404, 'not_found', 'Upload not found.');
    return found;
  }
  /** Downloads built from the stored rows exist only once validation has finished with rows. */
  const HAS_ROWS = new Set(['passed', 'passed_with_warnings', 'failed_validation']);

  const listQuery = z.object({
    status: z.enum(['queued', 'validating', 'passed', 'passed_with_warnings', 'failed_validation', 'error', 'in_progress']).optional(),
    template: z.union([z.literal('none'), z.string().uuid()]).optional(),
    q: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(100),
  });
  app.get('/api/uploads', async (req) => {
    const user = requireUser(req);
    const q = listQuery.safeParse(req.query);
    if (!q.success) throw bad('Invalid filter.');
    return listUploads(db, user.id, q.data);
  });

  app.get('/api/uploads/:id', async (req) => ({ upload: (await ownUpload(req)).detail }));

  app.delete('/api/uploads/:id', async (req, reply) => {
    const { detail } = await ownUpload(req);
    await softDeleteUpload(db, requireUser(req).id, detail.id);
    return reply.code(204).send();
  });

  const rowsQuery = z.object({
    offset: z.coerce.number().int().min(0).default(0),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    onlyIssues: z.enum(['0', '1']).default('0').transform((v) => v === '1'),
  });
  /** Extracted rows (Data tab), with each row's issues. */
  app.get('/api/uploads/:id/rows', async (req) => {
    const { detail } = await ownUpload(req);
    if (!HAS_ROWS.has(detail.status)) throw new HttpError(409, 'not_ready', 'The data is available once validation has finished.');
    const q = rowsQuery.safeParse(req.query);
    if (!q.success) throw bad('Invalid paging.');
    return listDataRows(db, detail.id, q.data);
  });

  const issueQuery = z.object({
    severity: z.enum(['error', 'warning']).optional(),
    column: z.string().max(100).optional(),
    offset: z.coerce.number().int().min(0).default(0),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  });
  app.get('/api/uploads/:id/issues', async (req) => {
    const { detail } = await ownUpload(req);
    const q = issueQuery.safeParse(req.query);
    if (!q.success) throw bad('Invalid filter.');
    return listIssues(db, detail.id, q.data);
  });

  app.get('/api/uploads/:id/errors.csv', async (req, reply) => {
    const { detail, snapshot } = await ownUpload(req);
    if (!HAS_ROWS.has(detail.status)) throw new HttpError(409, 'not_ready', 'The error report is available once validation has finished.');
    const { issues } = await listIssues(db, detail.id);
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', attachment(downloadName(detail.name, detail.errorCount ? 'errors' : 'issues')))
      .send(errorReportCsv(issues, snapshot.columns));
  });

  /** The file in template format; ?errors=1 adds the __errors column (the "file with errors marked"). */
  app.get('/api/uploads/:id/export.csv', async (req, reply) => {
    const { detail, snapshot } = await ownUpload(req);
    if (!HAS_ROWS.has(detail.status)) throw new HttpError(409, 'not_ready', 'This download is available once validation has finished.');
    const withErrors = (req.query as { errors?: string }).errors === '1';
    const rows = await listRows(db, detail.id);
    const issues = withErrors ? (await listIssues(db, detail.id)).issues : undefined;
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', attachment(downloadName(detail.name, withErrors ? 'errors_marked' : detail.template ? 'template_format' : 'clean')))
      .send(templateFormatCsv(rows, snapshot.columns, issues));
  });

  app.get('/api/uploads/:id/original', async (req, reply) => {
    const { detail } = await ownUpload(req);
    const content = await originalFile(db, detail.id);
    if (!content) throw new HttpError(404, 'not_found', 'The original file is no longer stored.');
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', attachment(detail.originalFilename))
      .send(content);
  });
}
