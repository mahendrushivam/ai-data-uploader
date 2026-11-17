/**
 * Background validation (docs/DATABASE.md §5). The `uploads` table is the queue:
 *   claim (FOR UPDATE SKIP LOCKED) → validate with the shared validateFile() → save everything in ONE
 *   transaction. A crash before the commit leaves nothing half-written; the job is simply claimed again.
 */
import { fromText } from '@datadesk/shared/columnTypes';
import {
  decodeCsv,
  firstInvalidUtf8,
  parseCsv,
  splitRows,
  uploadSnapshotSchema,
  validateFile,
  type UploadSnapshot,
} from '@datadesk/shared/upload';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { re2Compiler } from '../re2.js';
import { withTransaction } from '../templates/repo.js';

export const MAX_ATTEMPTS = 3;
/** A job locked for longer than this is assumed to belong to a crashed worker and is claimed again. */
export const STALE_MINUTES = 5;
/** Issues stored per upload; counts and the per-column summary stay exact beyond this. */
export const ISSUE_LIMIT = 100_000;

export interface Job {
  id: string;
  attempt: number;
}
export type Outcome = 'passed' | 'passed_with_warnings' | 'failed_validation' | 'error';

/** Claims the oldest queued upload (or a stale one). Safe with any number of workers running at once. */
export async function claimNext(db: Db): Promise<Job | null> {
  const { rows } = await db.query<Job>(
    `UPDATE uploads SET status = 'validating', attempt = attempt + 1, locked_at = now(), validation_started_at = now()
     WHERE id = (
       SELECT id FROM uploads
       WHERE deleted_at IS NULL
         AND (status = 'queued' OR (status = 'validating' AND locked_at < now() - make_interval(mins => $1)))
       ORDER BY created_at
       FOR UPDATE SKIP LOCKED
       LIMIT 1)
     RETURNING id, attempt`,
    [STALE_MINUTES],
  );
  return rows[0] ?? null;
}

/** A file- or system-level failure: no rows were checked. The message is shown to the user as-is. */
async function finishWithError(db: Db, id: string, message: string): Promise<Outcome> {
  await db.query(
    `UPDATE uploads SET status = 'error', status_message = $2, locked_at = NULL, validation_finished_at = now()
     WHERE id = $1 AND status = 'validating'`,
    [id, message],
  );
  return 'error';
}

export async function processJob(db: Db, job: Job, config: Pick<Config, 'MAX_ROWS'>): Promise<Outcome> {
  if (job.attempt > MAX_ATTEMPTS) {
    return finishWithError(db, job.id, 'Validation failed repeatedly on our side. Please upload the file again.');
  }
  try {
    const { rows } = await db.query<{ schema_snapshot: unknown; content: Buffer }>(
      `SELECT u.schema_snapshot, f.content FROM uploads u JOIN upload_files f ON f.upload_id = u.id WHERE u.id = $1`,
      [job.id],
    );
    if (!rows[0]) return finishWithError(db, job.id, 'The uploaded file is missing. Please upload it again.');
    const snap = uploadSnapshotSchema.safeParse(rows[0].schema_snapshot);
    if (!snap.success) return finishWithError(db, job.id, 'This upload has an invalid column setup. Please upload the file again.');

    const bytes = new Uint8Array(rows[0].content);
    const bad = firstInvalidUtf8(bytes);
    if (bad) {
      const hex = `0x${bad.byte.toString(16).toUpperCase().padStart(2, '0')}`;
      return finishWithError(
        db,
        job.id,
        `The file is not valid UTF-8 (byte ${hex} on line ${bad.line}). Save it as "CSV UTF-8" and upload it again.`,
      );
    }

    const parsed = parseCsv(decodeCsv(bytes).text);
    const result = validateFile(parsed, snap.data, { maxRows: config.MAX_ROWS, compileRegex: re2Compiler, issueLimit: ISSUE_LIMIT });
    const status: Outcome = result.errorCount ? 'failed_validation' : result.warningCount ? 'passed_with_warnings' : 'passed';
    const tooManyRows = result.issues.some((i) => i.rule === 'too_many_rows');
    const dataRows = tooManyRows ? [] : rowsForStorage(parsed.rows, snap.data);

    await withTransaction(db, async (client) => {
      // Idempotent: a retried job starts from a clean slate.
      await client.query('DELETE FROM upload_rows WHERE upload_id = $1', [job.id]);
      await client.query('DELETE FROM validation_issues WHERE upload_id = $1', [job.id]);
      if (dataRows.length) {
        await client.query(
          `INSERT INTO upload_rows (upload_id, row_number, data, has_errors)
           SELECT $1, n, d, e FROM unnest($2::int[], $3::jsonb[], $4::bool[]) AS t(n, d, e)`,
          [job.id, dataRows.map((_, i) => i + 1), dataRows.map((d) => JSON.stringify(d)), dataRows.map((_, i) => result.rowsWithErrors.has(i + 1))],
        );
      }
      if (result.issues.length) {
        const is = result.issues;
        await client.query(
          `INSERT INTO validation_issues (upload_id, row_number, column_key, rule, severity, message, raw_value)
           SELECT $1, r, c, ru, s::issue_severity, m, v
           FROM unnest($2::int[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[]) AS t(r, c, ru, s, m, v)`,
          [job.id, is.map((i) => i.row), is.map((i) => i.column), is.map((i) => i.rule), is.map((i) => i.severity), is.map((i) => i.message), is.map((i) => i.value)],
        );
      }
      const summary = result.summary.map((s) => ({ column_key: s.column, rule: s.rule, severity: s.severity, count: s.count }));
      const { rowCount } = await client.query(
        `UPDATE uploads SET status = $2, total_rows = $3, error_count = $4, warning_count = $5, invalid_row_count = $6,
                issue_summary = $7, issues_truncated = $8, locked_at = NULL, validation_finished_at = now(), status_message = NULL
         WHERE id = $1 AND status = 'validating'`,
        [job.id, status, result.totalRows, result.errorCount, result.warningCount, result.invalidRowCount, JSON.stringify(summary), result.issuesTruncated],
      );
      // Someone else finished or deleted it meanwhile: roll back rather than overwrite.
      if (rowCount !== 1) throw new Error(`upload ${job.id} is no longer being validated by this worker`);
    });
    return status;
  } catch (err) {
    // Unexpected failure (e.g. database hiccup): put it back in the queue, or give up after MAX_ATTEMPTS.
    console.error(`validation of ${job.id} failed (attempt ${job.attempt}):`, err instanceof Error ? err.message : err);
    if (job.attempt >= MAX_ATTEMPTS) {
      return finishWithError(db, job.id, 'Validation failed repeatedly on our side. Please upload the file again.');
    }
    await db.query(`UPDATE uploads SET status = 'queued', locked_at = NULL WHERE id = $1 AND status = 'validating'`, [job.id]);
    throw err;
  }
}

/** Parsed rows keyed by template column key; multi-value cells are stored as arrays. */
function rowsForStorage(rows: string[][], snapshot: UploadSnapshot) {
  const { body } = splitRows(rows, snapshot.hasHeaderRow);
  const cols = snapshot.columns.filter((c) => c.sourceIndex !== null);
  return body.map((cells) =>
    Object.fromEntries(
      cols.map((c) => [c.key, fromText(cells[c.sourceIndex!] ?? '', { type: c.type, delimiter: c.delimiter ?? ',', required: c.required })]),
    ),
  );
}

/** Claims and processes one job. Returns false when the queue is empty. */
export async function runOnce(db: Db, config: Pick<Config, 'MAX_ROWS'>): Promise<{ id: string; outcome: Outcome } | false> {
  const job = await claimNext(db);
  if (!job) return false;
  return { id: job.id, outcome: await processJob(db, job, config) };
}
