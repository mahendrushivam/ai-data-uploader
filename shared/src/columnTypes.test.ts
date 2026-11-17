import { describe, expect, it } from 'vitest';
import {
  convertValue,
  detectType,
  fromText,
  joinMulti,
  parseBool,
  parseDate,
  parseNumber,
  splitMulti,
  toText,
  validateCell,
} from './columnTypes';
import type { ColumnSpec, ColumnType } from './types';

const col = (type: ColumnType, extra: Partial<ColumnSpec> = {}): ColumnSpec => ({
  type,
  delimiter: ',',
  required: false,
  ...extra,
});

describe('parseNumber', () => {
  it.each([
    ['42', 42],
    ['-3.5', -3.5],
    ['1,234.50', 1234.5],
    ['$1,000', 1000],
    ['50%', 0.5],
    ['1e3', 1000],
    [' 7 ', 7],
  ])('parses %s', (input, expected) => expect(parseNumber(input)).toBe(expected));

  it.each(['', 'n/a', 'abc', '1,23', '--1', '.', '$'])('rejects %j', (input) => expect(parseNumber(input)).toBeNull());
});

describe('parseBool', () => {
  it.each(['true', 'Yes', 'y', 'T', '1'])('%s is true', (v) => expect(parseBool(v)).toBe(true));
  it.each(['false', 'NO', 'n', 'f', '0'])('%s is false', (v) => expect(parseBool(v)).toBe(false));
  it.each(['maybe', '', '2'])('%j is not a boolean', (v) => expect(parseBool(v)).toBeNull());
});

describe('parseDate', () => {
  it('accepts ISO dates and date-times', () => {
    expect(parseDate('2026-10-04')).toBe(Date.UTC(2026, 9, 4));
    expect(parseDate('2026-10-04T13:45:00Z')).toBe(Date.UTC(2026, 9, 4, 13, 45));
  });
  it('accepts slash dates (MM/DD unless the first part must be a day)', () => {
    expect(parseDate('10/04/2026')).toBe(Date.UTC(2026, 9, 4));
    expect(parseDate('25/12/2026')).toBe(Date.UTC(2026, 11, 25));
  });
  it.each(['2026-13-45', '2026-02-30', '2026-10-04T24:00', 'yesterday', ''])('rejects %j', (v) =>
    expect(parseDate(v)).toBeNull(),
  );
});

describe('validateCell', () => {
  it('treats empty as valid unless required', () => {
    expect(validateCell('', col('number'))).toBeNull();
    expect(validateCell('  ', col('number', { required: true }))).toBe('Required value is missing');
    expect(validateCell([], col('multiselect', { required: true }))).toBe('Required value is missing');
  });

  it.each<[ColumnType, string, string | null]>([
    ['number', '0.87', null],
    ['number', 'n/a', '"n/a" is not a number'],
    ['integer', '1003', null],
    ['integer', '10.5', '"10.5" is not a whole number'],
    ['boolean', 'yes', null],
    ['boolean', 'maybe', '"maybe" is not true/false'],
    ['date', '2026-10-04', null],
    ['date', '2026-13-45', '"2026-13-45" is not a valid date (use YYYY-MM-DD)'],
    ['email', 'ann@example.com', null],
    ['email', 'ann@', '"ann@" is not a valid email'],
    ['url', 'https://support.example.com/tickets/1', null],
    ['url', 'not-a-link', '"not-a-link" is not a valid URL'],
    ['url', 'javascript:alert(1)', '"javascript:alert(1)" is not a valid URL'],
    ['text', 'anything goes', null],
  ])('%s %j', (type, value, expected) => expect(validateCell(value, col(type))).toBe(expected));
});

describe('multi-value helpers', () => {
  it('splits, trims and drops empty items', () => {
    expect(splitMulti(' ux, web ,, mobile ', ',')).toEqual(['ux', 'web', 'mobile']);
  });
  it('joins back with readable spacing', () => {
    expect(joinMulti(['a', 'b'], ',')).toBe('a, b');
    expect(joinMulti(['a', 'b'], '|')).toBe('a | b');
  });
  it('round-trips through text', () => {
    const c = col('multiselect');
    expect(toText(fromText('ux, web', c), c)).toBe('ux, web');
  });
  it('converts between types without losing data', () => {
    expect(convertValue(['a', 'b'], col('multiselect'), col('text'))).toBe('a, b');
    expect(convertValue('a; b', col('text'), col('multiselect', { delimiter: ';' }))).toEqual(['a', 'b']);
  });
});

describe('detectType', () => {
  it('detects clean columns', () => {
    expect(detectType(['1', '2', '3']).type).toBe('integer');
    expect(detectType(['0.5', '1.25']).type).toBe('number');
    expect(detectType(['yes', 'no', 'yes']).type).toBe('boolean');
    expect(detectType(['2026-01-01', '2026-02-03']).type).toBe('date');
    expect(detectType(['a@b.co', 'c@d.io']).type).toBe('email');
    expect(detectType(['https://a.com', 'https://b.org']).type).toBe('url');
  });
  it('tolerates up to 10% bad values (they are flagged later, not used to pick the type)', () => {
    const values = [...Array.from({ length: 19 }, (_, i) => String(i / 10 + 0.05)), 'n/a'];
    expect(detectType(values).type).toBe('number');
  });
  it('detects multi-value lists but not prose with commas', () => {
    const tags = ['ux, web', 'mobile', 'web, payments', 'ux', 'mobile, ux', 'payments', 'web', 'ux, mobile', 'web', 'payments'];
    expect(detectType(tags)).toEqual({ type: 'multiselect', delimiter: ',' });
    const prose = ['Hello, world, this is a long sentence', 'Another, quite different, sentence here', 'Third one, unique words'];
    expect(detectType(prose).type).toBe('text');
  });
  it('falls back to text for empty columns', () => {
    expect(detectType(['', '  ']).type).toBe('text');
  });
});
