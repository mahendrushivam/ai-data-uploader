import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { columnSchema, type TemplateColumn } from './rules';
import {
  decodeCsv,
  firstInvalidUtf8,
  matchHeaders,
  parseCsv,
  snapshotFromAdhoc,
  snapshotFromTemplate,
  splitRows,
  uploadRequestSchema,
  uploadSnapshotSchema,
  validateFile,
  type UploadSnapshot,
} from './upload';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../fixtures/${name}`, import.meta.url)));
const col = (c: Partial<TemplateColumn> & { key: string; type: TemplateColumn['type'] }): TemplateColumn =>
  columnSchema.parse({ name: c.key, ...c });

/** "Support tickets" v2, exactly as in the dev seed. */
const ticketsV2: TemplateColumn[] = [
  col({ key: 'ticket_id', type: 'integer', required: true, aliases: ['Ticket #', 'ticket id', 'id'], rules: [{ type: 'unique', params: {} }] as never }),
  col({ key: 'text', type: 'text', required: true, aliases: ['message', 'body'], rules: [{ type: 'max_length', params: { value: 500 } }] as never }),
  col({ key: 'label', type: 'select', required: true, rules: [{ type: 'allowed_values', params: { values: ['bug', 'praise', 'billing', 'question', 'feature_request'] } }] as never }),
  col({ key: 'tags', type: 'multiselect', delimiter: ',' }),
  col({ key: 'confidence', type: 'number', rules: [
    { type: 'min', params: { value: 0.6 }, severity: 'warning', message: 'Low confidence: double-check the label' },
    { type: 'max', params: { value: 1 } },
  ] as never }),
  col({ key: 'needs_review', type: 'boolean' }),
  col({ key: 'created_at', type: 'date', required: true }),
  col({ key: 'source_url', type: 'url' }),
];
const version = { id: '11000000-0000-4000-8000-000000000002', hasHeaderRow: true, allowExtraColumns: true, columns: ticketsV2 };

function check(bytes: Uint8Array) {
  const parsed = parseCsv(decodeCsv(bytes).text);
  const { headers } = splitRows(parsed.rows, true);
  const mapping = Object.fromEntries(Object.entries(matchHeaders(headers, ticketsV2)).map(([k, m]) => [k, m.index]));
  return validateFile(parsed, snapshotFromTemplate(version, mapping, headers));
}

describe('the reference files (acceptance for M3 pre-check and M4 worker)', () => {
  it('tickets_oct.csv: exactly the 4 planted errors and 7 low-confidence warnings', () => {
    const r = check(fixture('tickets_oct.csv'));
    expect(r.totalRows).toBe(40);
    expect(r.issues.filter((i) => i.severity === 'error').map((i) => `${i.row} ${i.column}: ${i.message}`)).toEqual([
      '4 confidence: "n/a" is not a number',
      '12 source_url: "not-a-link" is not a valid URL',
      '18 created_at: "2026-13-45" is not a valid date (use YYYY-MM-DD)',
      '26 needs_review: "maybe" is not true/false',
    ]);
    expect(r.issues.filter((i) => i.severity === 'warning').map((i) => i.row)).toEqual([7, 11, 15, 19, 23, 34, 38]);
    expect([r.errorCount, r.warningCount, r.invalidRowCount]).toEqual([4, 7, 4]);
    expect(r.summary).toContainEqual({ column: 'confidence', rule: 'min', severity: 'warning', count: 7 });
  });

  it('tickets_oct_fixed.csv: no errors, the same 7 warnings', () => {
    const r = check(fixture('tickets_oct_fixed.csv'));
    expect([r.errorCount, r.warningCount]).toEqual([0, 7]);
  });

  it('legacy_latin1.csv is detected as not UTF-8', () => {
    expect(decodeCsv(fixture('legacy_latin1.csv')).validUtf8).toBe(false);
    expect(decodeCsv(fixture('tickets_oct.csv')).validUtf8).toBe(true);
  });

  it('pinpoints the first byte that is not UTF-8', () => {
    expect(firstInvalidUtf8(fixture('legacy_latin1.csv'))).toEqual({ offset: 13, byte: 0xe9, line: 2 });
    expect(firstInvalidUtf8(fixture('tickets_oct.csv'))).toBeNull();
    expect(firstInvalidUtf8(new TextEncoder().encode('naïve, 日本, 😀\n'))).toBeNull();
    expect(firstInvalidUtf8(new Uint8Array([0x61, 0xc0, 0xaf]))).toMatchObject({ offset: 1 }); // overlong encoding
    expect(firstInvalidUtf8(new Uint8Array([0xed, 0xa0, 0x80]))).toMatchObject({ offset: 0 }); // UTF-16 surrogate
  });

  it('a UTF-8 byte-order mark is removed', () => {
    expect(decodeCsv(new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0x2c, 0x62])).text).toBe('a,b');
  });
});

describe('matchHeaders', () => {
  it('exact name, then ignoring case/spaces/punctuation, then aliases; each file column used once', () => {
    const m = matchHeaders(['Ticket #', 'TEXT', 'label ', 'Created-At', 'agent'], ticketsV2);
    expect(m.ticket_id).toEqual({ index: 0, how: 'alias' });
    expect(m.text).toEqual({ index: 1, how: 'name' });
    expect(m.label).toEqual({ index: 2, how: 'exact' });
    expect(m.created_at).toEqual({ index: 3, how: 'name' });
    expect(m.confidence).toEqual({ index: null, how: null });
  });
  it('never matches the __errors column of an annotated download', () => {
    expect(matchHeaders(['__errors'], [col({ key: 'errors', type: 'text', aliases: ['__errors'] })]).errors.index).toBeNull();
  });
});

describe('validateFile: file-level and row-level problems', () => {
  const snap = (columns: UploadSnapshot['columns'], extra: Partial<UploadSnapshot> = {}) => ({
    hasHeaderRow: true,
    allowExtraColumns: true,
    columns,
    ...extra,
  });
  const c = (key: string, sourceIndex: number | null, extra: Partial<TemplateColumn> = {}) => ({
    ...col({ key, type: 'text', ...extra }),
    sourceIndex,
    sourceHeader: null,
  });
  const rules = (r: ReturnType<typeof validateFile>) => r.issues.map((i) => `${i.row ?? '-'} ${i.rule} ${i.severity}`);

  it('empty file', () => {
    expect(rules(validateFile(parseCsv('a,b\n'), snap([c('a', 0)])))).toEqual(['- empty_file error']);
  });

  it('too many rows stops before checking cells', () => {
    const r = validateFile(parseCsv('a\n1\n2\n3\n'), snap([c('a', 0, { type: 'integer' })]), { maxRows: 2 });
    expect(r.issues.map((i) => i.message)).toEqual(['The file has 3 rows. The limit is 2.']);
  });

  it('missing required column is an error, missing optional column a warning', () => {
    const r = validateFile(parseCsv('a\n1\n'), snap([c('a', 0), c('b', null, { required: true }), c('x', null)]));
    expect(r.issues.filter((i) => i.rule === 'missing_column').map((i) => `${i.severity}: ${i.message}`)).toEqual([
      'error: Required column "b" was not found in the file.',
      'warning: Column "x" was not found in the file; it will be empty.',
    ]);
  });

  it('extra columns are errors only when the template rejects them; __errors is always ignored', () => {
    const csv = 'a,agent,__errors\n1,bob,\n';
    expect(rules(validateFile(parseCsv(csv), snap([c('a', 0)])))).toEqual([]);
    expect(validateFile(parseCsv(csv), snap([c('a', 0)], { allowExtraColumns: false })).issues.map((i) => i.message)).toEqual([
      'Column "agent" is not part of the template.',
    ]);
  });

  it('duplicate headers are a warning', () => {
    expect(rules(validateFile(parseCsv('a,A\n1,2\n'), snap([c('a', 0)])))).toEqual(['- duplicate_header warning']);
  });

  it('rows with extra non-empty cells are errors; short rows are warnings; trailing empty cells are fine', () => {
    const r = validateFile(parseCsv('a,b\n1,2,3\n1\n1,2,\n'), snap([c('a', 0), c('b', 1)]));
    expect(rules(r)).toEqual(['1 row_length error', '2 row_length warning']);
  });

  it('an unclosed quote is reported as a parse error', () => {
    const r = validateFile(parseCsv('a,b\n1,"unclosed\n2,3\n'), snap([c('a', 0), c('b', 1)]));
    expect(r.issues.some((i) => i.rule === 'parse' && i.severity === 'error')).toBe(true);
  });

  it('unique: reports repeats with the row of the first occurrence, skipping cells that are already invalid', () => {
    const r = validateFile(
      parseCsv('id\n1\n2\n1\nx\nx\n'),
      snap([c('id', 0, { type: 'integer', rules: [{ type: 'unique', params: {}, severity: 'error' }] })]),
    );
    expect(r.issues.map((i) => `${i.row} ${i.rule}: ${i.message}`)).toEqual([
      '3 unique: Duplicate value; it already appears in row 1.',
      '4 type: "x" is not a whole number',
      '5 type: "x" is not a whole number',
    ]);
  });

  it('keeps counts exact when stored issues are capped', () => {
    const r = validateFile(parseCsv('n\n' + 'x\n'.repeat(10)), snap([c('n', 0, { type: 'number' })]), { issueLimit: 3 });
    expect([r.issues.length, r.errorCount, r.issuesTruncated]).toEqual([3, 10, true]);
  });
});

describe('snapshots and upload requests', () => {
  it('a template snapshot records where each column is in this file', () => {
    const s = snapshotFromTemplate(version, { ticket_id: 2, text: null }, ['a', 'b', 'Ticket #']);
    expect(s.columns[0]).toMatchObject({ key: 'ticket_id', sourceIndex: 2, sourceHeader: 'Ticket #' });
    expect(s.columns[1]).toMatchObject({ key: 'text', sourceIndex: null, sourceHeader: null });
    expect(uploadSnapshotSchema.safeParse(s).success).toBe(true);
  });

  it('an ad-hoc request is checked like a template, and one file column cannot be used twice', () => {
    const bad = uploadRequestSchema.safeParse({
      mode: 'adhoc',
      name: 'Vendors',
      hasHeaderRow: true,
      columns: [
        { key: 'a', name: 'A', type: 'number', sourceIndex: 0, rules: [{ type: 'min', params: { value: 5 } }, { type: 'max', params: { value: 1 } }] },
        { key: 'b', name: 'B', type: 'text', sourceIndex: 0 },
      ],
    });
    expect(bad.success).toBe(false);
    expect(bad.error!.issues.map((i) => i.message)).toEqual([
      'Minimum is greater than maximum.',
      'This file column is already used by another column.',
    ]);
    const s = snapshotFromAdhoc([{ ...col({ key: 'a', type: 'text' }), sourceIndex: 1 }], true, ['x', 'vendor']);
    expect(s).toMatchObject({ templateVersionId: null, columns: [{ sourceIndex: 1, sourceHeader: 'vendor' }] });
  });
});
