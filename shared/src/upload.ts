/**
 * Everything about turning an uploaded CSV into checked rows, shared by the browser (live pre-check
 * in the upload screen) and the worker (authoritative validation after upload). Because both run this
 * exact code, the pre-check and the final result agree.
 */
import Papa from 'papaparse';
import { z } from 'zod';
import { fromText } from './columnTypes';
import {
  browserRegex,
  checkCell,
  checkColumns,
  columnSchema,
  findDuplicates,
  type RegexCompiler,
  type Severity,
  type TemplateColumn,
} from './rules';

/** Phase 1 limits (agreed). The server reads its own copies from config; these are the defaults. */
export const LIMITS = { maxBytes: 5 * 1024 * 1024, maxRows: 20_000 } as const;

/** Header the "file with errors marked" download adds. Always ignored when the file comes back. */
export const ERRORS_COLUMN = '__errors';

// ---------------------------------------------------------------- decoding and parsing

/** Decodes bytes as UTF-8 (the BOM is dropped). validUtf8 = false means some bytes were replaced. */
export function decodeCsv(bytes: Uint8Array): { text: string; validUtf8: boolean } {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), validUtf8: true };
  } catch {
    return { text: new TextDecoder('utf-8').decode(bytes), validUtf8: false };
  }
}

/**
 * Where a file stops being valid UTF-8: the offending byte and its 1-based line, or null if the whole
 * file is valid. Used for a precise message ("byte 0xE9 on line 2") instead of a generic one.
 */
export function firstInvalidUtf8(bytes: Uint8Array): { offset: number; byte: number; line: number } | null {
  let line = 1;
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i];
    let extra: number;
    let min: number;
    if (b < 0x80) extra = 0, min = 0;
    else if (b >= 0xc2 && b <= 0xdf) extra = 1, min = 0x80;
    else if (b >= 0xe0 && b <= 0xef) extra = 2, min = 0x800;
    else if (b >= 0xf0 && b <= 0xf4) extra = 3, min = 0x10000;
    else return { offset: i, byte: b, line };
    let cp = extra === 0 ? b : b & (0x3f >> extra);
    for (let k = 1; k <= extra; k++) {
      const c = bytes[i + k];
      if (c === undefined || (c & 0xc0) !== 0x80) return { offset: i, byte: b, line };
      cp = (cp << 6) | (c & 0x3f);
    }
    if (cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return { offset: i, byte: b, line };
    if (b === 0x0a) line++;
    i += extra + 1;
  }
  return null;
}

export interface ParsedFile {
  rows: string[][];
  delimiter: string;
  /** Malformed quoting, with the 0-based index in `rows` where it was detected (null if unknown). */
  parseErrors: { index: number | null; message: string }[];
}

export function parseCsv(text: string): ParsedFile {
  const res = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy' });
  return {
    rows: res.data,
    delimiter: res.meta.delimiter || ',',
    // "UndetectableDelimiter" just means a single-column file; comma is assumed, which is correct.
    parseErrors: res.errors
      .filter((e) => e.code !== 'UndetectableDelimiter')
      .map((e) => ({ index: e.row ?? null, message: e.message })),
  };
}

/** Header row (or generated "Column N" names) and data rows. `width` is the widest row. */
export function splitRows(rows: string[][], hasHeaderRow: boolean) {
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
  const first = hasHeaderRow ? rows[0] ?? [] : [];
  const headers = Array.from({ length: width }, (_, i) => (first[i] ?? '').trim() || `Column ${i + 1}`);
  return { headers, headerLength: hasHeaderRow ? first.length : width, body: hasHeaderRow ? rows.slice(1) : rows, width };
}

// ---------------------------------------------------------------- header matching

export type MatchHow = 'exact' | 'name' | 'alias';
export interface HeaderMatch {
  index: number | null;
  how: MatchHow | null;
}

const norm = (s: string) =>
  s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * Maps each template column to a file column: exact name first, then the name ignoring case, spaces
 * and punctuation, then the column's aliases (same leniency). Each file column is used at most once.
 */
export function matchHeaders(
  headers: string[],
  columns: Pick<TemplateColumn, 'key' | 'name' | 'aliases'>[],
): Record<string, HeaderMatch> {
  const result: Record<string, HeaderMatch> = Object.fromEntries(columns.map((c) => [c.key, { index: null, how: null }]));
  const used = new Set<number>();
  const pass = (how: MatchHow, candidates: (c: (typeof columns)[number]) => string[], same: (h: string, x: string) => boolean) => {
    for (const col of columns) {
      if (result[col.key].index !== null) continue;
      const index = headers.findIndex((h, i) => !used.has(i) && h !== ERRORS_COLUMN && candidates(col).some((x) => same(h, x)));
      if (index >= 0) {
        used.add(index);
        result[col.key] = { index, how };
      }
    }
  };
  pass('exact', (c) => [c.name], (h, x) => h.trim() === x.trim());
  pass('name', (c) => [c.name, c.key], (h, x) => norm(h) !== '' && norm(h) === norm(x));
  pass('alias', (c) => c.aliases, (h, x) => norm(h) !== '' && norm(h) === norm(x));
  return result;
}

// ---------------------------------------------------------------- snapshot and upload request

/** A column as used for one upload: the template/ad-hoc definition plus where it is in this file. */
export const snapshotColumnSchema = columnSchema.extend({
  sourceIndex: z.number().int().min(0).nullable(),
  sourceHeader: z.string().nullable(),
});
export type SnapshotColumn = z.infer<typeof snapshotColumnSchema>;

/** Stored in uploads.schema_snapshot; the worker validates against exactly this. */
export const uploadSnapshotSchema = z
  .object({
    templateVersionId: z.string().uuid().nullable(),
    hasHeaderRow: z.boolean(),
    allowExtraColumns: z.boolean(),
    columns: z.array(snapshotColumnSchema).min(1).max(200),
  })
  .superRefine((s, ctx) => {
    checkColumns(s.columns, ctx);
    checkSourcesUnique(s.columns, ctx);
  });
export type UploadSnapshot = z.infer<typeof uploadSnapshotSchema>;

function checkSourcesUnique(columns: { sourceIndex: number | null }[], ctx: z.RefinementCtx) {
  const seen = new Map<number, number>();
  columns.forEach((c, i) => {
    if (c.sourceIndex === null) return;
    if (seen.has(c.sourceIndex)) {
      ctx.addIssue({ code: 'custom', path: ['columns', i, 'sourceIndex'], message: 'This file column is already used by another column.' });
    }
    seen.set(c.sourceIndex, i);
  });
}

const uploadName = z.string().trim().min(1, 'Give this upload a name.').max(200, 'Name is too long.');

/** What the browser sends with the file (multipart field "meta"). */
export const uploadRequestSchema = z
  .discriminatedUnion('mode', [
    z.object({
      mode: z.literal('template'),
      name: uploadName,
      templateVersionId: z.string().uuid(),
      /** template column key → 0-based file column index, or null when the column isn't in the file */
      mapping: z.record(z.string(), z.number().int().min(0).nullable()),
    }),
    z.object({
      mode: z.literal('adhoc'),
      name: uploadName,
      hasHeaderRow: z.boolean(),
      columns: z
        .array(columnSchema.extend({ sourceIndex: z.number().int().min(0) }))
        .min(1, 'Include at least one column.')
        .max(200),
    }),
  ])
  .superRefine((r, ctx) => {
    if (r.mode !== 'adhoc') return;
    checkColumns(r.columns, ctx);
    checkSourcesUnique(r.columns, ctx);
    // (the mapping of a template upload is checked by the server against the template it loads)
  });
export type UploadRequest = z.infer<typeof uploadRequestSchema>;
export type UploadRequestInput = z.input<typeof uploadRequestSchema>;

export function snapshotFromTemplate(
  version: { id: string; hasHeaderRow: boolean; allowExtraColumns: boolean; columns: TemplateColumn[] },
  mapping: Record<string, number | null>,
  headers: string[],
): UploadSnapshot {
  return {
    templateVersionId: version.id,
    hasHeaderRow: version.hasHeaderRow,
    allowExtraColumns: version.allowExtraColumns,
    columns: version.columns.map((c) => {
      const sourceIndex = mapping[c.key] ?? null;
      return { ...c, sourceIndex, sourceHeader: sourceIndex === null ? null : headers[sourceIndex] ?? null };
    }),
  };
}

export function snapshotFromAdhoc(
  columns: (TemplateColumn & { sourceIndex: number })[],
  hasHeaderRow: boolean,
  headers: string[],
): UploadSnapshot {
  return {
    templateVersionId: null,
    hasHeaderRow,
    allowExtraColumns: true, // ad-hoc: columns the user didn't include are simply left out
    columns: columns.map((c) => ({ ...c, sourceHeader: headers[c.sourceIndex] ?? null })),
  };
}

// ---------------------------------------------------------------- validating a whole file

export interface FileIssue {
  /** 1-based data row (the header is not counted), or null for file-level problems */
  row: number | null;
  /** column key, or null when the issue isn't about one column */
  column: string | null;
  /** 'required' | 'type' | a rule type | 'parse' | 'empty_file' | 'too_many_rows' | 'missing_column' | 'extra_column' | 'duplicate_header' | 'row_length' */
  rule: string;
  severity: Severity;
  message: string;
  /** the raw value from the file (cut to 500 characters), when the issue is about a cell */
  value: string | null;
}

export interface IssueSummary {
  column: string | null;
  rule: string;
  severity: Severity;
  count: number;
}

export interface ValidationResult {
  totalRows: number;
  issues: FileIssue[];
  /** true when more issues were found than `issueLimit` (all counts stay exact) */
  issuesTruncated: boolean;
  errorCount: number;
  warningCount: number;
  /** data rows with at least one error */
  invalidRowCount: number;
  rowsWithErrors: Set<number>;
  summary: IssueSummary[];
}

export interface ValidateOptions {
  maxRows?: number;
  compileRegex?: RegexCompiler;
  issueLimit?: number;
}

/**
 * Validates parsed rows against an upload snapshot: parsing problems, file-level checks (empty file,
 * row limit, missing/extra/duplicate columns), row length, then every cell (required → type → rules),
 * then `unique` across the file.
 */
export function validateFile(
  parsed: ParsedFile,
  snapshot: Pick<UploadSnapshot, 'hasHeaderRow' | 'allowExtraColumns' | 'columns'>,
  { maxRows = LIMITS.maxRows, compileRegex = browserRegex, issueLimit = 100_000 }: ValidateOptions = {},
): ValidationResult {
  const { rows, parseErrors } = parsed;
  const { headers, headerLength, body, width } = splitRows(rows, snapshot.hasHeaderRow);
  const issues: FileIssue[] = [];
  const counts = new Map<string, IssueSummary>();
  const rowsWithErrors = new Set<number>();
  let errorCount = 0;
  let warningCount = 0;
  let truncated = false;

  const add = (issue: FileIssue) => {
    if (issue.severity === 'error') {
      errorCount++;
      if (issue.row !== null) rowsWithErrors.add(issue.row);
    } else warningCount++;
    const k = `${issue.column}\u0000${issue.rule}\u0000${issue.severity}`;
    const s = counts.get(k);
    if (s) s.count++;
    else counts.set(k, { column: issue.column, rule: issue.rule, severity: issue.severity, count: 1 });
    if (issues.length < issueLimit) issues.push(issue);
    else truncated = true;
  };
  const fileIssue = (rule: string, severity: Severity, message: string, column: string | null = null) =>
    add({ row: null, column, rule, severity, message, value: null });
  const toRow = (index: number) => index - (snapshot.hasHeaderRow ? 1 : 0) + 1; // rows[] index → data row number

  for (const e of parseErrors) {
    const row = e.index === null || toRow(e.index) < 1 ? null : toRow(e.index);
    add({ row, column: null, rule: 'parse', severity: 'error', message: `The file couldn't be read cleanly here: ${e.message}.`, value: null });
  }

  if (body.length === 0) fileIssue('empty_file', 'error', 'The file has no data rows.');
  if (body.length > maxRows) {
    fileIssue('too_many_rows', 'error', `The file has ${body.length.toLocaleString('en-US')} rows. The limit is ${maxRows.toLocaleString('en-US')}.`);
    return finish();
  }

  // Columns: missing, extra, duplicate headers
  const mapped = new Set<number>();
  for (const col of snapshot.columns) {
    if (col.sourceIndex === null || col.sourceIndex >= width) {
      if (col.required) fileIssue('missing_column', 'error', `Required column "${col.name}" was not found in the file.`, col.key);
      else fileIssue('missing_column', 'warning', `Column "${col.name}" was not found in the file; it will be empty.`, col.key);
    } else mapped.add(col.sourceIndex);
  }
  if (snapshot.hasHeaderRow) {
    const seen = new Map<string, number>();
    headers.forEach((h, i) => {
      if (h === ERRORS_COLUMN) return;
      const k = h.toLowerCase();
      if (seen.has(k)) fileIssue('duplicate_header', 'warning', `Header "${h}" appears more than once (columns ${seen.get(k)! + 1} and ${i + 1}).`);
      else seen.set(k, i);
      if (!snapshot.allowExtraColumns && !mapped.has(i)) fileIssue('extra_column', 'error', `Column "${h}" is not part of the template.`);
    });
  }

  // Cells
  const specs = snapshot.columns.filter((c) => c.sourceIndex !== null && c.sourceIndex < width);
  const badCells = new Set<string>(); // cells with a required/type error are excluded from `unique`
  body.forEach((cells, i) => {
    const row = i + 1;
    if (cells.length > headerLength && cells.slice(headerLength).some((c) => c.trim() !== '')) {
      add({ row, column: null, rule: 'row_length', severity: 'error', value: null,
        message: `This row has ${cells.length} cells but the header has ${headerLength}; the extra cells can't be placed in a column.` });
    } else if (cells.length < headerLength) {
      add({ row, column: null, rule: 'row_length', severity: 'warning', value: null,
        message: `This row has ${cells.length} cells but the header has ${headerLength}; the missing cells are treated as empty.` });
    }
    for (const col of specs) {
      const raw = cells[col.sourceIndex!] ?? '';
      const value = fromText(raw, { type: col.type, delimiter: col.delimiter ?? ',', required: col.required });
      for (const issue of checkCell(value, col, compileRegex)) {
        if (issue.rule === 'required' || issue.rule === 'type') badCells.add(`${row}:${col.key}`);
        add({ row, column: col.key, rule: issue.rule, severity: issue.severity, message: issue.message, value: raw.slice(0, 500) });
      }
    }
  });

  // Whole-file rule: unique
  for (const col of specs) {
    const rule = col.rules.find((r) => r.type === 'unique');
    if (!rule) continue;
    const values = body.map((cells, i) => (badCells.has(`${i + 1}:${col.key}`) ? undefined : cells[col.sourceIndex!]));
    for (const [i, first] of findDuplicates(values)) {
      add({ row: i + 1, column: col.key, rule: 'unique', severity: rule.severity, value: (values[i] ?? '').slice(0, 500),
        message: rule.message ?? `Duplicate value; it already appears in row ${first + 1}.` });
    }
  }

  return finish();

  function finish(): ValidationResult {
    const order = new Map(snapshot.columns.map((c, i) => [c.key, i]));
    issues.sort((a, b) => (a.row ?? 0) - (b.row ?? 0) || (order.get(a.column ?? '') ?? -1) - (order.get(b.column ?? '') ?? -1));
    return {
      totalRows: body.length,
      issues,
      issuesTruncated: truncated,
      errorCount,
      warningCount,
      invalidRowCount: rowsWithErrors.size,
      rowsWithErrors,
      summary: [...counts.values()].sort((a, b) => (a.severity === b.severity ? b.count - a.count : a.severity === 'error' ? -1 : 1)),
    };
  }
}
