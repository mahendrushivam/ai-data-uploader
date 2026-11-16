import type { CellValue, Column, ColumnType } from '../types';

export const TYPE_DEFS: Record<ColumnType, { label: string; icon: string; hint: string }> = {
  text: { label: 'Text', icon: 'Aa', hint: 'Free-form text' },
  number: { label: 'Number', icon: '#', hint: 'Decimals, e.g. 3.14, 1,200, 45%' },
  integer: { label: 'Integer', icon: '123', hint: 'Whole numbers only' },
  boolean: { label: 'Boolean', icon: '✓', hint: 'true/false, yes/no, 1/0' },
  date: { label: 'Date', icon: 'D', hint: 'YYYY-MM-DD or MM/DD/YYYY' },
  email: { label: 'Email', icon: '@', hint: 'A valid email address' },
  url: { label: 'URL', icon: '↗', hint: 'http(s)://…' },
  select: { label: 'Single select', icon: '◉', hint: 'One value from a set of options' },
  multiselect: { label: 'Multi-value list', icon: '≡', hint: 'Several values in one cell, split by a delimiter' },
};

export const TYPE_ORDER: ColumnType[] = [
  'text',
  'number',
  'integer',
  'boolean',
  'date',
  'email',
  'url',
  'select',
  'multiselect',
];

export const DELIMITERS: { value: string; label: string }[] = [
  { value: ',', label: 'Comma  ( , )' },
  { value: ';', label: 'Semicolon  ( ; )' },
  { value: '|', label: 'Pipe  ( | )' },
  { value: '/', label: 'Slash  ( / )' },
];

// ---------- parsing helpers ----------

const TRUE_WORDS = new Set(['true', 'yes', 'y', 't', '1']);
const FALSE_WORDS = new Set(['false', 'no', 'n', 'f', '0']);

export function parseBool(s: string): boolean | null {
  const t = s.trim().toLowerCase();
  if (TRUE_WORDS.has(t)) return true;
  if (FALSE_WORDS.has(t)) return false;
  return null;
}

const NUM_RE = /^[-+]?\$?(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?(?:e[-+]?\d+)?%?$/i;

export function parseNumber(s: string): number | null {
  const t = s.trim();
  if (!t || !NUM_RE.test(t) || !/^[-+]?\$?[\d.]/.test(t) || !/\d/.test(t)) return null;
  const pct = t.endsWith('%');
  const n = Number(t.replace(/[$,%]/g, ''));
  if (!Number.isFinite(n)) return null;
  return pct ? n / 100 : n;
}

const ISO_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const SLASH_DATE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/;

function validYMD(y: number, m: number, d: number) {
  if (m < 1 || m > 12 || d < 1) return false;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= days;
}

/** Returns a UTC timestamp, or null if the string is not a recognisable date. */
export function parseDate(s: string): number | null {
  const t = s.trim();
  let m = ISO_DATE.exec(t);
  if (m) {
    const [y, mo, d] = [+m[1], +m[2], +m[3]];
    if (!validYMD(y, mo, d)) return null;
    const hh = m[4] ? +m[4] : 0;
    const mm = m[5] ? +m[5] : 0;
    if (hh > 23 || mm > 59) return null;
    return Date.UTC(y, mo - 1, d, hh, mm, m[6] ? +m[6] : 0);
  }
  m = SLASH_DATE.exec(t);
  if (m) {
    let [a, b, y] = [+m[1], +m[2], +m[3]];
    if (y < 100) y += y < 50 ? 2000 : 1900;
    // Assume MM/DD/YYYY unless the first part can only be a day.
    const [mo, d] = a > 12 ? [b, a] : [a, b];
    return validYMD(y, mo, d) ? Date.UTC(y, mo - 1, d) : null;
  }
  return null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isUrl(s: string) {
  const t = s.trim();
  if (/^www\.[^\s]+\.[^\s]+$/i.test(t)) return true;
  try {
    const u = new URL(t);
    return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname;
  } catch {
    return false;
  }
}

// ---------- multi-value helpers ----------

export function splitMulti(raw: string, delimiter: string): string[] {
  return raw
    .split(delimiter)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function joinMulti(items: string[], delimiter: string): string {
  return items.join(delimiter === '|' || delimiter === '/' ? ` ${delimiter} ` : `${delimiter} `);
}

// ---------- value <-> text ----------

export function emptyValue(col: Column): CellValue {
  return col.type === 'multiselect' ? [] : '';
}

export function isEmptyValue(v: CellValue | undefined): boolean {
  return v === undefined || (Array.isArray(v) ? v.length === 0 : v.trim() === '');
}

export function toText(v: CellValue | undefined, col: Column): string {
  if (v === undefined) return '';
  return Array.isArray(v) ? joinMulti(v, col.delimiter) : v;
}

export function fromText(text: string, col: Column): CellValue {
  return col.type === 'multiselect' ? splitMulti(text, col.delimiter) : text;
}

/** Non-destructive conversion when a column's type or delimiter changes. */
export function convertValue(v: CellValue, from: Column, to: Column): CellValue {
  return fromText(toText(v, from), to);
}

export function sameValue(a: CellValue | undefined, b: CellValue | undefined) {
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
  return (a ?? '') === (b ?? '');
}

// ---------- validation ----------

/** Returns an error message, or null when the cell is valid. */
export function validateCell(v: CellValue | undefined, col: Column): string | null {
  if (isEmptyValue(v)) return col.required ? 'Required value is missing' : null;
  if (Array.isArray(v)) return null;
  const s = v as string;
  switch (col.type) {
    case 'number':
      return parseNumber(s) === null ? `"${s}" is not a number` : null;
    case 'integer': {
      const n = parseNumber(s);
      return n === null || !Number.isInteger(n) ? `"${s}" is not a whole number` : null;
    }
    case 'boolean':
      return parseBool(s) === null ? `"${s}" is not true/false` : null;
    case 'date':
      return parseDate(s) === null ? `"${s}" is not a valid date (use YYYY-MM-DD)` : null;
    case 'email':
      return EMAIL_RE.test(s.trim()) ? null : `"${s}" is not a valid email`;
    case 'url':
      return isUrl(s) ? null : `"${s}" is not a valid URL`;
    default:
      return null;
  }
}

// ---------- type detection ----------

export function detectType(values: string[]): { type: ColumnType; delimiter: string } {
  const sample = values
    .map((v) => (v ?? '').trim())
    .filter(Boolean)
    .slice(0, 500);
  const fallback = { type: 'text' as ColumnType, delimiter: ',' };
  if (!sample.length) return fallback;

  // Real-world data is messy: a column gets a type when >= 90% of its values fit it.
  // The outliers are imported as-is and flagged as invalid for review.
  const THRESHOLD = 0.9;
  const every = (fn: (v: string) => boolean) => sample.filter(fn).length / sample.length >= THRESHOLD;
  const lower = sample.map((v) => v.toLowerCase());

  if (every((v) => parseBool(v) !== null) && lower.some((v) => parseBool(v) !== null && v !== '0' && v !== '1')) {
    return { type: 'boolean', delimiter: ',' };
  }
  if (every((v) => parseNumber(v) !== null)) {
    const nums = sample.filter((v) => parseNumber(v) !== null);
    const allInt = nums.every((v) => Number.isInteger(parseNumber(v)!) && !v.includes('.') && !v.includes('%'));
    return { type: allInt ? 'integer' : 'number', delimiter: ',' };
  }
  if (every((v) => parseDate(v) !== null)) return { type: 'date', delimiter: ',' };
  if (every((v) => EMAIL_RE.test(v))) return { type: 'email', delimiter: ',' };
  if (every(isUrl)) return { type: 'url', delimiter: ',' };

  // Multi-value lists: a good share of cells contain a delimiter, the pieces are short,
  // and pieces repeat across rows (tags/labels do, prose with commas doesn't).
  for (const delimiter of [',', ';', '|']) {
    const withDelim = sample.filter((v) => v.includes(delimiter)).length;
    if (withDelim / sample.length < 0.2) continue;
    const pieces = sample.flatMap((v) => splitMulti(v, delimiter));
    if (!pieces.length) continue;
    const avgLen = pieces.reduce((n, p) => n + p.length, 0) / pieces.length;
    const shortWords = pieces.filter((p) => p.split(/\s+/).length <= 4).length / pieces.length;
    const uniqueRatio = new Set(pieces.map((p) => p.toLowerCase())).size / pieces.length;
    if (avgLen <= 25 && shortWords > 0.9 && (pieces.length < 10 || uniqueRatio <= 0.6)) {
      return { type: 'multiselect', delimiter };
    }
  }

  // Low-cardinality short values -> single select
  const distinct = new Set(sample).size;
  const avgLen = sample.reduce((n, v) => n + v.length, 0) / sample.length;
  if (sample.length >= 8 && avgLen <= 30 && distinct <= Math.max(2, Math.min(20, sample.length * 0.3))) {
    return { type: 'select', delimiter: ',' };
  }
  return fallback;
}

// ---------- sorting ----------

export function compareCells(a: CellValue | undefined, b: CellValue | undefined, col: Column): number {
  const ta = toText(a, col);
  const tb = toText(b, col);
  if (col.type === 'number' || col.type === 'integer') {
    const na = parseNumber(ta);
    const nb = parseNumber(tb);
    if (na !== null && nb !== null) return na - nb;
  } else if (col.type === 'date') {
    const da = parseDate(ta);
    const db = parseDate(tb);
    if (da !== null && db !== null) return da - db;
  } else if (col.type === 'boolean') {
    const ba = parseBool(ta);
    const bb = parseBool(tb);
    if (ba !== null && bb !== null) return Number(ba) - Number(bb);
  }
  return ta.localeCompare(tb, undefined, { numeric: true, sensitivity: 'base' });
}

/** Deterministic pastel colour per tag so the same value always looks the same. */
export function chipStyle(text: string): { background: string; color: string } {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.toLowerCase().charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return { background: `hsl(${hue} 70% 92%)`, color: `hsl(${hue} 45% 28%)` };
}
