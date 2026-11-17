import type { Db } from '../db.js';
import type { UploadDetail, UploadIssue, UploadList, UploadRow, UploadStatusFilter, UploadSummary } from '@datadesk/shared/api';
import type { CellValue } from '@datadesk/shared/types';
import type { UploadSnapshot } from '@datadesk/shared/upload';
import type { TemplateColumn } from '@datadesk/shared/rules';
import { loadColumns, withTransaction } from '../templates/repo.js';

export type { UploadSummary };

/** A template version the user may upload against (their own, not archived), with its columns. */
export async function loadVersionForUpload(
  db: Db,
  ownerId: string,
  versionId: string,
): Promise<{ id: string; hasHeaderRow: boolean; allowExtraColumns: boolean; columns: TemplateColumn[] } | null> {
  const { rows } = await db.query(
    `SELECT tv.id, tv.has_header_row, tv.allow_extra_columns
     FROM template_versions tv JOIN templates t ON t.id = tv.template_id
     WHERE tv.id = $1 AND t.owner_id = $2 AND t.archived_at IS NULL`,
    [versionId, ownerId],
  );
  const v = rows[0];
  if (!v) return null;
  return { id: v.id, hasHeaderRow: v.has_header_row, allowExtraColumns: v.allow_extra_columns, columns: await loadColumns(db, v.id) };
}

/**
 * Stores the upload and its file in ONE transaction with status 'queued'. That row is the job the
 * background worker picks up (docs/DATABASE.md §5).
 */
export async function createUpload(
  db: Db,
  u: {
    ownerId: string;
    name: string;
    snapshot: UploadSnapshot;
    filename: string;
    content: Buffer;
    sha256: Buffer;
    delimiter: string;
  },
): Promise<string> {
  return withTransaction(db, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO uploads (owner_id, name, template_version_id, schema_snapshot, original_filename, size_bytes, sha256, detected_delimiter)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [u.ownerId, u.name, u.snapshot.templateVersionId, JSON.stringify(u.snapshot), u.filename, u.content.length, u.sha256, u.delimiter],
    );
    await client.query('INSERT INTO upload_files (upload_id, content) VALUES ($1, $2)', [rows[0].id, u.content]);
    return rows[0].id;
  });
}

/** Columns of UploadSummary; shared by the single-upload lookup and the listing. */
const SUMMARY_SELECT = `
  SELECT u.id, u.name, u.status, u.status_message, u.original_filename, u.size_bytes, u.total_rows,
         u.error_count, u.warning_count, u.created_at, u.validation_started_at,
         t.id AS template_id, t.name AS template_name, tv.version
  FROM uploads u
  LEFT JOIN template_versions tv ON tv.id = u.template_version_id
  LEFT JOIN templates t ON t.id = tv.template_id`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toSummary(r: any): UploadSummary {
  return {
    id: r.id,
    name: r.name,
    status: r.status,
    statusMessage: r.status_message,
    originalFilename: r.original_filename,
    sizeBytes: r.size_bytes,
    template: r.template_id ? { id: r.template_id, name: r.template_name, version: r.version } : null,
    totalRows: r.total_rows,
    errorCount: r.error_count,
    warningCount: r.warning_count,
    createdAt: r.created_at.toISOString(),
    validationStartedAt: r.validation_started_at?.toISOString() ?? null,
  };
}

export async function getUpload(db: Db, ownerId: string, id: string): Promise<UploadSummary | null> {
  const { rows } = await db.query(`${SUMMARY_SELECT} WHERE u.id = $1 AND u.owner_id = $2 AND u.deleted_at IS NULL`, [id, ownerId]);
  return rows[0] ? toSummary(rows[0]) : null;
}

export interface ListFilter {
  status?: UploadStatusFilter;
  /** a template id, or 'none' for uploads without a template */
  template?: string;
  q?: string;
  limit: number;
}

/**
 * The user's uploads, newest first, filtered by status / template / search text (name or file name).
 * Also returns per-status counts for the other filters, so the status chips always show real numbers.
 */
export async function listUploads(db: Db, ownerId: string, f: ListFilter): Promise<UploadList> {
  const where = ['u.owner_id = $1', 'u.deleted_at IS NULL'];
  const params: unknown[] = [ownerId];
  if (f.template === 'none') where.push('u.template_version_id IS NULL');
  else if (f.template) where.push(`tv.template_id = $${params.push(f.template)}`);
  if (f.q?.trim()) {
    const like = `%${f.q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`; // the user's % and _ are literal
    where.push(`(u.name ILIKE $${params.push(like)} OR u.original_filename ILIKE $${params.length})`);
  }
  const base = where.join(' AND ');

  const statusWhere =
    f.status === 'in_progress' ? ` AND u.status IN ('queued', 'validating')` : f.status ? ` AND u.status = $${params.length + 1}` : '';
  const listParams = f.status && f.status !== 'in_progress' ? [...params, f.status] : params;

  const [list, counts, templates] = await Promise.all([
    db.query(`${SUMMARY_SELECT} WHERE ${base}${statusWhere} ORDER BY u.created_at DESC, u.id LIMIT ${f.limit + 1}`, listParams),
    db.query(
      `SELECT u.status, count(*)::int AS n FROM uploads u LEFT JOIN template_versions tv ON tv.id = u.template_version_id
       WHERE ${base} GROUP BY u.status`,
      params,
    ),
    db.query(
      `SELECT DISTINCT t.id, t.name, t.archived_at IS NOT NULL AS archived
       FROM uploads u JOIN template_versions tv ON tv.id = u.template_version_id JOIN templates t ON t.id = tv.template_id
       WHERE u.owner_id = $1 AND u.deleted_at IS NULL ORDER BY t.name`,
      [ownerId],
    ),
  ]);
  const byStatus = Object.fromEntries(counts.rows.map((r) => [r.status, r.n]));
  const statuses = ['queued', 'validating', 'passed', 'passed_with_warnings', 'failed_validation', 'error'] as const;
  return {
    uploads: list.rows.slice(0, f.limit).map(toSummary),
    truncated: list.rows.length > f.limit,
    counts: {
      ...(Object.fromEntries(statuses.map((st) => [st, byStatus[st] ?? 0])) as Record<(typeof statuses)[number], number>),
      all: counts.rows.reduce((n, r) => n + r.n, 0),
    },
    templates: templates.rows,
  };
}

/** "Remove from list": hidden everywhere, kept in the database (purged later by a retention job). */
export async function softDeleteUpload(db: Db, ownerId: string, id: string): Promise<boolean> {
  const { rowCount } = await db.query(
    'UPDATE uploads SET deleted_at = now() WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL',
    [id, ownerId],
  );
  return rowCount === 1;
}

/** Extracted rows for the Data tab (paged), each with its issues so cells can be highlighted. */
export async function listDataRows(
  db: Db,
  uploadId: string,
  f: { offset: number; limit: number; onlyIssues: boolean },
): Promise<{ rows: UploadRow[]; total: number }> {
  const filter = f.onlyIssues
    ? ' AND EXISTS (SELECT 1 FROM validation_issues vi WHERE vi.upload_id = r.upload_id AND vi.row_number = r.row_number)'
    : '';
  const [{ rows: countRows }, { rows }] = await Promise.all([
    db.query(`SELECT count(*)::int AS n FROM upload_rows r WHERE r.upload_id = $1${filter}`, [uploadId]),
    db.query<{ row_number: number; data: Record<string, string | string[]> }>(
      `SELECT r.row_number, r.data FROM upload_rows r WHERE r.upload_id = $1${filter}
       ORDER BY r.row_number LIMIT $2 OFFSET $3`,
      [uploadId, f.limit, f.offset],
    ),
  ]);
  const numbers = rows.map((r) => r.row_number);
  const { rows: issues } = numbers.length
    ? await db.query(
        `SELECT row_number, column_key, severity, message FROM validation_issues
         WHERE upload_id = $1 AND row_number = ANY($2::int[]) ORDER BY id`,
        [uploadId, numbers],
      )
    : { rows: [] };
  const byRow = new Map<number, UploadRow['issues']>();
  for (const i of issues) {
    byRow.set(i.row_number, [...(byRow.get(i.row_number) ?? []), { column: i.column_key, severity: i.severity, message: i.message }]);
  }
  return {
    total: countRows[0].n,
    rows: rows.map((r) => ({ row: r.row_number, data: r.data, issues: byRow.get(r.row_number) ?? [] })),
  };
}

export interface UploadRecord {
  detail: UploadDetail;
  snapshot: UploadSnapshot;
}

/** Full result for the owner, with the snapshot's columns (or null if not theirs / deleted). */
export async function getUploadDetail(db: Db, ownerId: string, id: string): Promise<UploadRecord | null> {
  const summary = await getUpload(db, ownerId, id);
  if (!summary) return null;
  const { rows } = await db.query(
    `SELECT invalid_row_count, issues_truncated, issue_summary, schema_snapshot, validation_finished_at,
            (SELECT count(DISTINCT row_number)::int FROM validation_issues WHERE upload_id = $1 AND row_number IS NOT NULL) AS rows_with_issues
     FROM uploads WHERE id = $1`,
    [id],
  );
  const r = rows[0];
  const snapshot = r.schema_snapshot as UploadSnapshot;
  return {
    snapshot,
    detail: {
      ...summary,
      invalidRowCount: r.invalid_row_count,
      issuesTruncated: r.issues_truncated,
      summary: (r.issue_summary as { column_key: string | null; rule: string; severity: 'error' | 'warning'; count: number }[]).map((s) => ({
        column: s.column_key,
        rule: s.rule,
        severity: s.severity,
        count: s.count,
      })),
      columns: snapshot.columns.map((c) => ({
        key: c.key,
        name: c.name,
        type: c.type,
        delimiter: c.delimiter,
        required: c.required,
        sourceHeader: c.sourceHeader,
      })),
      validationFinishedAt: r.validation_finished_at?.toISOString() ?? null,
      rowsWithIssues: r.rows_with_issues,
    },
  };
}

export interface IssueFilter {
  severity?: 'error' | 'warning';
  column?: string;
  offset?: number;
  limit?: number;
}

/** Issues of one upload (caller has checked ownership): file-level first, then by row. */
export async function listIssues(db: Db, uploadId: string, f: IssueFilter = {}): Promise<{ issues: UploadIssue[]; total: number }> {
  const where = ['upload_id = $1'];
  const params: unknown[] = [uploadId];
  if (f.severity) where.push(`severity = $${params.push(f.severity)}`);
  if (f.column) where.push(`column_key = $${params.push(f.column)}`);
  const { rows: countRows } = await db.query(`SELECT count(*)::int AS n FROM validation_issues WHERE ${where.join(' AND ')}`, params);
  const limit = f.limit ?? 1_000_000;
  const { rows } = await db.query(
    `SELECT row_number, column_key, rule, severity, message, raw_value FROM validation_issues
     WHERE ${where.join(' AND ')} ORDER BY row_number NULLS FIRST, id
     LIMIT $${params.push(limit)} OFFSET $${params.push(f.offset ?? 0)}`,
    params,
  );
  return {
    total: countRows[0].n,
    issues: rows.map((r) => ({ row: r.row_number, column: r.column_key, rule: r.rule, severity: r.severity, message: r.message, value: r.raw_value })),
  };
}

export async function listRows(db: Db, uploadId: string) {
  const { rows } = await db.query<{ row_number: number; data: Record<string, CellValue> }>(
    'SELECT row_number, data FROM upload_rows WHERE upload_id = $1 ORDER BY row_number',
    [uploadId],
  );
  return rows;
}

export async function originalFile(db: Db, uploadId: string): Promise<Buffer | null> {
  const { rows } = await db.query<{ content: Buffer }>('SELECT content FROM upload_files WHERE upload_id = $1', [uploadId]);
  return rows[0]?.content ?? null;
}
