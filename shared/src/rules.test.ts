import { describe, expect, it } from 'vitest';
import {
  checkCell,
  findDuplicates,
  normalizeValue,
  ruleSchema,
  templateInputSchema,
  toColumnKey,
  type RuleInput,
  type TemplateColumn,
} from './rules';
import type { ColumnType } from './types';

const column = (type: ColumnType, rules: RuleInput[] = [], extra: Partial<TemplateColumn> = {}): TemplateColumn => ({
  key: 'c',
  name: 'C',
  type,
  required: false,
  delimiter: type === 'multiselect' ? ',' : null,
  aliases: [],
  rules: rules.map((r) => ruleSchema.parse(r)),
  ...extra,
});
const messages = (issues: ReturnType<typeof checkCell>) => issues.map((i) => `${i.severity}:${i.rule}:${i.message}`);

describe('checkCell', () => {
  it('required and type checks come first, and a type error suppresses rule checks', () => {
    const c = column('number', [{ type: 'min', params: { value: 0 } }], { required: true });
    expect(messages(checkCell('', c))).toEqual(['error:required:Required value is missing']);
    expect(messages(checkCell('n/a', c))).toEqual(['error:type:"n/a" is not a number']);
  });

  it('skips rules on empty optional cells', () => {
    expect(checkCell('', column('text', [{ type: 'min_length', params: { value: 3 } }]))).toEqual([]);
  });

  it('min / max on numbers, with severity and custom messages', () => {
    const c = column('number', [
      { type: 'min', params: { value: 0.6 }, severity: 'warning', message: 'Low confidence: double-check the label' },
      { type: 'max', params: { value: 1 } },
    ]);
    expect(checkCell('0.7', c)).toEqual([]);
    expect(messages(checkCell('0.59', c))).toEqual(['warning:min:Low confidence: double-check the label']);
    expect(messages(checkCell('1.4', c))).toEqual(['error:max:Must be at most 1.']);
    expect(messages(checkCell('$1,200', column('number', [{ type: 'max', params: { value: 1000 } }])))).toEqual([
      'error:max:Must be at most 1000.',
    ]);
  });

  it('min / max on dates', () => {
    const c = column('date', [{ type: 'min', params: { value: '2020-01-01' } }, { type: 'max', params: { value: '2026-12-31' } }]);
    expect(checkCell('2024-05-01', c)).toEqual([]);
    expect(messages(checkCell('2019-12-31', c))).toEqual(['error:min:Must be at least 2020-01-01.']);
    expect(messages(checkCell('01/15/2027', c))).toEqual(['error:max:Must be at most 2026-12-31.']);
  });

  it('min / max length count characters, not bytes', () => {
    const c = column('text', [{ type: 'min_length', params: { value: 2 } }, { type: 'max_length', params: { value: 3 } }]);
    expect(checkCell('née', c)).toEqual([]);
    expect(messages(checkCell('a', c))).toEqual(['error:min_length:Must be at least 2 characters.']);
    expect(messages(checkCell('abcd', c))).toEqual(['error:max_length:Must be at most 3 characters.']);
  });

  it('regex tests the trimmed value, with optional case-insensitivity, and uses the supplied compiler', () => {
    const c = column('text', [{ type: 'regex', params: { pattern: '^[A-Z]{3}-\\d+$' } }]);
    expect(checkCell(' ABC-12 ', c)).toEqual([]);
    expect(messages(checkCell('abc-12', c))).toEqual(["error:regex:Doesn't match the required pattern."]);
    const ci = column('text', [{ type: 'regex', params: { pattern: '^[A-Z]{3}-\\d+$', flags: 'i' } }]);
    expect(checkCell('abc-12', ci)).toEqual([]);
    const calls: string[] = [];
    const spy = (p: string, f: string) => (calls.push(p), new RegExp(p, f));
    checkCell('X', column('text', [{ type: 'regex', params: { pattern: '^X$' } }]), spy);
    checkCell('Y', column('text', [{ type: 'regex', params: { pattern: '^X$' } }]), spy);
    expect(calls).toEqual(['^X$']); // compiled once, then cached
  });

  it('allowed values: case-insensitive by default, checks every item of a multi-value cell', () => {
    const c = column('select', [{ type: 'allowed_values', params: { values: ['US', 'GB', 'DE', 'IN'] } }]);
    expect(checkCell('us', c)).toEqual([]);
    expect(messages(checkCell('Germany', c))).toEqual(['error:allowed_values:"Germany" is not allowed (allowed: US, GB, DE, IN).']);
    const strict = column('select', [{ type: 'allowed_values', params: { values: ['US'], case_sensitive: true } }]);
    expect(checkCell('us', strict)).toHaveLength(1);
    const tags = column('multiselect', [{ type: 'allowed_values', params: { values: ['ux', 'web'] } }]);
    expect(checkCell(['ux', 'web'], tags)).toEqual([]);
    expect(messages(checkCell(['ux', 'mobile', 'x'], tags))).toEqual([
      'error:allowed_values:"mobile", "x" are not allowed (allowed: ux, web).',
    ]);
  });
});

describe('findDuplicates', () => {
  it('maps each repeat to its first occurrence, ignoring case, spaces and empty cells', () => {
    expect([...findDuplicates(['1', '2', '1', '', '', ' 2 ', 'A', 'a'])]).toEqual([
      [2, 0],
      [5, 1],
      [7, 6],
    ]);
  });
});

describe('normalizeValue (template-format download)', () => {
  it.each<[ColumnType, string, string]>([
    ['date', '10/04/2026', '2026-10-04'],
    ['date', '2026-10-04 13:45', '2026-10-04T13:45:00Z'],
    ['boolean', 'Yes', 'true'],
    ['boolean', 'n', 'false'],
    ['number', '$1,234.50', '1234.5'],
    ['number', '50%', '0.5'],
    ['integer', ' 42 ', '42'],
    ['text', '  padded  ', 'padded'],
  ])('%s %j → %j', (type, input, expected) => expect(normalizeValue(input, column(type))).toBe(expected));

  it('leaves invalid values exactly as they were', () => {
    expect(normalizeValue('2026-13-45', column('date'))).toBe('2026-13-45');
    expect(normalizeValue('maybe', column('boolean'))).toBe('maybe');
    expect(normalizeValue(' n/a ', column('number'))).toBe(' n/a ');
  });

  it('joins multi-value cells with the column delimiter', () => {
    expect(normalizeValue(['ux', 'web'], column('multiselect'))).toBe('ux, web');
    expect(normalizeValue('ux;web', column('multiselect', [], { delimiter: ';' }))).toBe('ux; web');
  });
});

describe('toColumnKey', () => {
  it.each([
    ['Ticket ID', 'ticket_id'],
    ['Ticket #', 'ticket'],
    ['  Créé le ', 'cree_le'],
    ['2024 sales', 'col_2024_sales'],
    ['***', 'column'],
  ])('%j → %j', (name, key) => expect(toColumnKey(name)).toBe(key));

  it('makes keys unique', () => {
    expect(toColumnKey('Email', new Set(['email', 'email_2']))).toBe('email_3');
  });
});

describe('templateInputSchema', () => {
  const valid = {
    name: 'Support tickets',
    columns: [
      { key: 'ticket_id', name: 'ticket_id', type: 'integer', required: true, rules: [{ type: 'unique', params: {} }] },
      { key: 'tags', name: 'tags', type: 'multiselect', delimiter: ',' },
      { key: 'confidence', name: 'confidence', type: 'number', rules: [{ type: 'min', params: { value: 0 } }, { type: 'max', params: { value: 1 } }] },
    ],
  };
  const errorsOf = (input: unknown) => {
    const r = templateInputSchema.safeParse(input);
    return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  };

  it('accepts a valid template and fills defaults', () => {
    const t = templateInputSchema.parse(valid);
    expect(t.hasHeaderRow).toBe(true);
    expect(t.columns[0].rules[0]).toEqual({ type: 'unique', params: {}, severity: 'error', message: undefined });
  });

  it.each([
    ['no columns', { ...valid, columns: [] }, 'columns: Add at least one column.'],
    ['blank name', { ...valid, name: ' ' }, 'name: Template name is required.'],
    ['duplicate keys', { ...valid, columns: [valid.columns[0], { ...valid.columns[0], name: 'x' }] }, 'columns.1.key: Duplicate key "ticket_id" (also column 1).'],
    ['duplicate names', { ...valid, columns: [valid.columns[0], { ...valid.columns[0], key: 'x', name: 'TICKET_ID' }] }, 'columns.1.name: Duplicate column name "TICKET_ID".'],
    ['multiselect without delimiter', { ...valid, columns: [{ key: 't', name: 't', type: 'multiselect' }] }, 'columns.0.delimiter: Choose how values are separated.'],
    ['rule not allowed for type', { ...valid, columns: [{ key: 'b', name: 'b', type: 'boolean', rules: [{ type: 'unique', params: {} }] }] }, `columns.0.rules.0: "Unique" can't be used on a boolean column.`],
    ['min greater than max', { ...valid, columns: [{ key: 'n', name: 'n', type: 'number', rules: [{ type: 'min', params: { value: 5 } }, { type: 'max', params: { value: 1 } }] }] }, 'columns.0.rules.0.params.value: Minimum is greater than maximum.'],
    ['date limit on a number column', { ...valid, columns: [{ key: 'n', name: 'n', type: 'number', rules: [{ type: 'min', params: { value: '2020-01-01' } }] }] }, 'columns.0.rules.0.params.value: Enter a number.'],
    ['number limit on a date column', { ...valid, columns: [{ key: 'd', name: 'd', type: 'date', rules: [{ type: 'min', params: { value: 3 } }] }] }, 'columns.0.rules.0.params.value: Use a date like 2024-01-31.'],
    ['invalid regex', { ...valid, columns: [{ key: 't', name: 't', type: 'text', rules: [{ type: 'regex', params: { pattern: '([a-z' } }] }] }, 'columns.0.rules.0.params.pattern: This pattern is not a valid regular expression.'],
    ['the same rule twice', { ...valid, columns: [{ key: 't', name: 't', type: 'text', rules: [{ type: 'max_length', params: { value: 3 } }, { type: 'max_length', params: { value: 4 } }] }] }, 'columns.0.rules.1: Only one "Maximum length" rule per column.'],
    ['empty allowed values', { ...valid, columns: [{ key: 's', name: 's', type: 'select', rules: [{ type: 'allowed_values', params: { values: [] } }] }] }, 'columns.0.rules.0.params.values: Add at least one value.'],
    ['bad key', { ...valid, columns: [{ key: 'Ticket ID', name: 't', type: 'text' }] }, 'columns.0.key: Key must be snake_case, e.g. ticket_id.'],
  ])('rejects %s', (_label, input, expected) => expect(errorsOf(input)).toContain(expected));
});
