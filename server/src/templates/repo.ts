import type pg from 'pg';
import type { Db } from '../db.js';
import type { Rule, TemplateColumn, TemplateInput } from '@datadesk/shared/rules';
import type { TemplateDetail, TemplateSummary } from '@datadesk/shared/api';

export type { TemplateDetail, TemplateSummary };

/** Active templates of one user, default first, then most recently edited. */
export async function listTemplates(db: Db, ownerId: string): Promise<TemplateSummary[]> {
  const { rows } = await db.query(
    `SELECT t.id, t.name, t.description, t.is_default, tv.version, t.created_at, t.updated_at,
            (SELECT count(*)::int FROM template_columns c WHERE c.template_version_id = tv.id) AS column_count,
            (SELECT count(*)::int FROM column_rules r JOIN template_columns c ON c.id = r.template_column_id
              WHERE c.template_version_id = tv.id) AS rule_count,
            (SELECT count(*)::int FROM uploads u JOIN template_versions v ON v.id = u.template_version_id
              WHERE v.template_id = t.id AND u.deleted_at IS NULL) AS upload_count,
            COALESCE((SELECT json_agg(json_build_object('name', c.display_name, 'type', c.data_type, 'required', c.required)
                                      ORDER BY c.position)
                      FROM (SELECT * FROM template_columns WHERE template_version_id = tv.id ORDER BY position LIMIT 6) c),
                     '[]') AS columns
     FROM templates t
     JOIN template_versions tv ON tv.id = t.current_version_id
     WHERE t.owner_id = $1 AND t.archived_at IS NULL
     ORDER BY t.is_default DESC, t.updated_at DESC`,
    [ownerId],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    isDefault: r.is_default,
    version: r.version,
    columnCount: r.column_count,
    ruleCount: r.rule_count,
    uploadCount: r.upload_count,
    columns: r.columns,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  }));
}

/** One template with its current version's full definition, or null if it isn't this user's. */
export async function getTemplate(db: Db | pg.PoolClient, ownerId: string, id: string): Promise<TemplateDetail | null> {
  const { rows } = await db.query(
    `SELECT t.id, t.name, t.description, t.is_default, t.created_at, t.updated_at,
            tv.id AS version_id, tv.version, tv.has_header_row, tv.allow_extra_columns
     FROM templates t JOIN template_versions tv ON tv.id = t.current_version_id
     WHERE t.id = $1 AND t.owner_id = $2 AND t.archived_at IS NULL`,
    [id, ownerId],
  );
  const t = rows[0];
  if (!t) return null;
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    isDefault: t.is_default,
    version: t.version,
    versionId: t.version_id,
    hasHeaderRow: t.has_header_row,
    allowExtraColumns: t.allow_extra_columns,
    columns: await loadColumns(db, t.version_id),
    createdAt: t.created_at.toISOString(),
    updatedAt: t.updated_at.toISOString(),
  };
}

/** The columns (with rules) of one immutable template version. Also used by uploads (M3) and the worker (M4). */
export async function loadColumns(db: Db | pg.PoolClient, versionId: string): Promise<TemplateColumn[]> {
  const { rows } = await db.query(
    `SELECT c.key, c.display_name, c.data_type, c.required, c.multi_delimiter, c.header_aliases,
            COALESCE(json_agg(json_build_object('type', r.rule_type, 'params', r.params, 'severity', r.severity,
                                                'message', r.message) ORDER BY r.rule_type)
                     FILTER (WHERE r.id IS NOT NULL), '[]') AS rules
     FROM template_columns c LEFT JOIN column_rules r ON r.template_column_id = c.id
     WHERE c.template_version_id = $1
     GROUP BY c.id ORDER BY c.position`,
    [versionId],
  );
  return rows.map((c) => ({
    key: c.key,
    name: c.display_name,
    type: c.data_type,
    required: c.required,
    delimiter: c.multi_delimiter,
    aliases: c.header_aliases,
    rules: c.rules.map((r: Rule & { message: string | null }) => ({ ...r, message: r.message ?? undefined })),
  }));
}

/**
 * Inserts a new immutable version (v1 for a new template) with its columns and rules, and makes it
 * the template's current version. Must run inside the caller's transaction.
 */
async function insertVersion(client: pg.PoolClient, templateId: string, input: TemplateInput): Promise<void> {
  const { rows } = await client.query(
    `INSERT INTO template_versions (template_id, version, has_header_row, allow_extra_columns)
     SELECT $1, COALESCE(max(version), 0) + 1, $2, $3 FROM template_versions WHERE template_id = $1
     RETURNING id`,
    [templateId, input.hasHeaderRow, input.allowExtraColumns],
  );
  const versionId = rows[0].id;
  for (const [position, col] of input.columns.entries()) {
    const { rows: inserted } = await client.query(
      `INSERT INTO template_columns
         (template_version_id, position, key, display_name, data_type, required, multi_delimiter, header_aliases)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [versionId, position, col.key, col.name, col.type, col.required, col.type === 'multiselect' ? col.delimiter : null, col.aliases],
    );
    for (const rule of col.rules) {
      await client.query(
        `INSERT INTO column_rules (template_column_id, rule_type, params, severity, message) VALUES ($1, $2, $3, $4, $5)`,
        [inserted[0].id, rule.type, JSON.stringify(rule.params), rule.severity, rule.message ?? null],
      );
    }
  }
  await client.query('UPDATE templates SET current_version_id = $2 WHERE id = $1', [templateId, versionId]);
}

export async function withTransaction<T>(db: Db, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function createTemplate(db: Db, ownerId: string, input: TemplateInput): Promise<string> {
  return withTransaction(db, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO templates (owner_id, name, description) VALUES ($1, $2, $3) RETURNING id`,
      [ownerId, input.name, input.description ?? null],
    );
    await insertVersion(client, rows[0].id, input);
    return rows[0].id;
  });
}

/** Saves an edit as the next version. Returns false if the template isn't this user's (or is archived). */
export async function saveNewVersion(db: Db, ownerId: string, id: string, input: TemplateInput): Promise<boolean> {
  return withTransaction(db, async (client) => {
    // Lock the template row so two simultaneous saves get consecutive version numbers.
    const { rowCount } = await client.query(
      `SELECT 1 FROM templates WHERE id = $1 AND owner_id = $2 AND archived_at IS NULL FOR UPDATE`,
      [id, ownerId],
    );
    if (!rowCount) return false;
    await client.query('UPDATE templates SET name = $2, description = $3 WHERE id = $1', [id, input.name, input.description ?? null]);
    await insertVersion(client, id, input);
    return true;
  });
}

/** Makes one template the user's default (clearing any other), or clears it. False if not found. */
export async function setDefault(db: Db, ownerId: string, id: string, isDefault: boolean): Promise<boolean> {
  return withTransaction(db, async (client) => {
    // Serialise default changes per user; otherwise two concurrent "set default" calls for different
    // templates could both clear-then-set and trip the one-default-per-user unique index.
    await client.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [ownerId]);
    const { rowCount } = await client.query(
      `SELECT 1 FROM templates WHERE id = $1 AND owner_id = $2 AND archived_at IS NULL`,
      [id, ownerId],
    );
    if (!rowCount) return false;
    if (isDefault) {
      await client.query('UPDATE templates SET is_default = false WHERE owner_id = $1 AND is_default AND id <> $2', [ownerId, id]);
    }
    await client.query('UPDATE templates SET is_default = $2 WHERE id = $1', [id, isDefault]);
    return true;
  });
}

/** "Delete" in the UI: archive, so uploads keep pointing at the exact version they used. */
export async function archiveTemplate(db: Db, ownerId: string, id: string): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE templates SET archived_at = now(), is_default = false
     WHERE id = $1 AND owner_id = $2 AND archived_at IS NULL`,
    [id, ownerId],
  );
  return rowCount === 1;
}
