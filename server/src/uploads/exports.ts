/**
 * The three generated downloads (nothing is stored; they're built from upload_rows and validation_issues):
 *   - error report: one line per problem
 *   - template format: the "updated file as per schema" (template columns/order/names, normalised values)
 *   - template format + __errors column: the file to fix in Excel and upload again
 */
import Papa from 'papaparse';
import type { CellValue } from '@datadesk/shared/types';
import { parseNumber } from '@datadesk/shared/columnTypes';
import { normalizeValue } from '@datadesk/shared/rules';
import { ERRORS_COLUMN, type SnapshotColumn } from '@datadesk/shared/upload';
import type { UploadIssue } from '@datadesk/shared/api';

/**
 * CSV/formula injection: a cell starting with = + - @ (or tab/CR) could run as a formula when the file
 * is opened in Excel. Such cells get a leading apostrophe, except plain numbers like -5 or +3.2.
 */
export function csvSafe(value: string): string {
  return /^[=+\-@\t\r]/.test(value) && parseNumber(value) === null ? `'${value}` : value;
}

/** UTF-8 BOM so Excel detects the encoding; Windows line endings for Excel. */
const toCsv = (fields: string[], data: string[][]) =>
  '\uFEFF' + Papa.unparse({ fields: fields.map(csvSafe), data: data.map((r) => r.map(csvSafe)) }, { newline: '\r\n' });

export function errorReportCsv(issues: UploadIssue[], columns: SnapshotColumn[]): string {
  const name = new Map(columns.map((c) => [c.key, c.name]));
  // File-level problems first, then errors by row, then warnings by row.
  const ordered = [...issues].sort(
    (a, b) =>
      Number(a.row !== null) - Number(b.row !== null) ||
      Number(a.severity === 'warning') - Number(b.severity === 'warning') ||
      (a.row ?? 0) - (b.row ?? 0),
  );
  return toCsv(
    ['row', 'column', 'value', 'severity', 'problem'],
    ordered.map((i) => [i.row === null ? '' : String(i.row), i.column ? name.get(i.column) ?? i.column : '', i.value ?? '', i.severity, i.message]),
  );
}

export function templateFormatCsv(
  rows: { row_number: number; data: Record<string, CellValue> }[],
  columns: SnapshotColumn[],
  issues?: UploadIssue[],
): string {
  const fields = columns.map((c) => c.name);
  let byRow: Map<number, string[]> | undefined;
  if (issues) {
    const name = new Map(columns.map((c) => [c.key, c.name]));
    byRow = new Map();
    for (const i of issues) {
      if (i.row === null) continue;
      const text = i.column ? `${name.get(i.column) ?? i.column}: ${i.message}` : i.message;
      byRow.set(i.row, [...(byRow.get(i.row) ?? []), i.severity === 'warning' ? `(warning) ${text}` : text]);
    }
    fields.push(ERRORS_COLUMN);
  }
  const data = rows.map((r) => {
    const cells = columns.map((c) => normalizeValue(r.data[c.key], c));
    if (byRow) cells.push((byRow.get(r.row_number) ?? []).join('; '));
    return cells;
  });
  return toCsv(fields, data);
}

/** Content-Disposition for a download name (ASCII fallback + UTF-8 version for non-ASCII names). */
export function attachment(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** "October tickets" → "October tickets_errors.csv" (characters that are invalid in file names removed). */
export const downloadName = (uploadName: string, suffix: string) =>
  `${uploadName.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 150)}_${suffix}.csv`;
