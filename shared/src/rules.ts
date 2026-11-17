/**
 * Column rules and template definitions, shared by the browser (template builder, live pre-check),
 * the API (validating saved templates) and the worker (validating uploaded files).
 *
 * Rules are declarative data. No user-supplied code is ever run. Regex patterns are compiled by a
 * caller-supplied function, so the server can use RE2 (linear time) while the browser uses RegExp.
 */
import { z } from 'zod';
import type { CellValue, ColumnSpec, ColumnType } from './types';
import { isEmptyValue, parseDate, parseNumber, parseBool, validateCell, joinMulti, splitMulti } from './columnTypes';

// ---------------------------------------------------------------- rule catalogue

export const RULE_TYPES = ['min', 'max', 'min_length', 'max_length', 'regex', 'allowed_values', 'unique'] as const;
export type RuleType = (typeof RULE_TYPES)[number];
export type Severity = 'error' | 'warning';

export const COLUMN_TYPES = [
  'text', 'number', 'integer', 'boolean', 'date', 'email', 'url', 'select', 'multiselect',
] as const satisfies readonly ColumnType[];

export const MULTI_DELIMITERS = [',', ';', '|', '/'] as const;

/** Which rules make sense for which column type (the builder only offers these; the API enforces them). */
export const RULES_FOR_TYPE: Record<ColumnType, readonly RuleType[]> = {
  text: ['min_length', 'max_length', 'regex', 'allowed_values', 'unique'],
  number: ['min', 'max', 'unique'],
  integer: ['min', 'max', 'unique'],
  boolean: [],
  date: ['min', 'max', 'unique'],
  email: ['max_length', 'regex', 'allowed_values', 'unique'],
  url: ['max_length', 'regex', 'unique'],
  select: ['allowed_values', 'unique'],
  multiselect: ['allowed_values'],
};

export const RULE_LABELS: Record<RuleType, string> = {
  min: 'Minimum',
  max: 'Maximum',
  min_length: 'Minimum length',
  max_length: 'Maximum length',
  regex: 'Pattern (regex)',
  allowed_values: 'Allowed values',
  unique: 'Unique',
};

// ---------------------------------------------------------------- schemas (API + builder + snapshot)

const severity = z.enum(['error', 'warning']).default('error');
const message = z.string().trim().max(300, 'Message must be at most 300 characters.').optional()
  .transform((m) => (m ? m : undefined));

const isoDate = z.string().refine((s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && parseDate(s) !== null, 'Use a date like 2024-01-31.');
const limit = z.union([z.number().finite(), isoDate]);
const length = z.number({ invalid_type_error: 'Enter a number.' }).int('Use a whole number.').min(0).max(100_000);

export const ruleSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('min'), params: z.object({ value: limit }), severity, message }),
  z.object({ type: z.literal('max'), params: z.object({ value: limit }), severity, message }),
  z.object({ type: z.literal('min_length'), params: z.object({ value: length }), severity, message }),
  z.object({ type: z.literal('max_length'), params: z.object({ value: length }), severity, message }),
  z.object({
    type: z.literal('regex'),
    params: z.object({
      pattern: z.string().min(1, 'Enter a pattern.').max(500, 'Pattern is too long.'),
      flags: z.enum(['', 'i']).default(''),
    }),
    severity,
    message,
  }),
  z.object({
    type: z.literal('allowed_values'),
    params: z.object({
      values: z.array(z.string().trim().min(1).max(200)).min(1, 'Add at least one value.').max(500, 'At most 500 values.')
        .transform((v) => [...new Set(v)]),
      case_sensitive: z.boolean().default(false),
    }),
    severity,
    message,
  }),
  z.object({ type: z.literal('unique'), params: z.object({}).strict().default({}), severity, message }),
]);
export type Rule = z.infer<typeof ruleSchema>;
export type RuleInput = z.input<typeof ruleSchema>;

export const columnSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/, 'Key must be snake_case, e.g. ticket_id.'),
  name: z.string().trim().min(1, 'Column name is required.').max(100, 'Column name is too long.'),
  type: z.enum(COLUMN_TYPES),
  required: z.boolean().default(false),
  delimiter: z.enum(MULTI_DELIMITERS).nullable().default(null),
  aliases: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
  rules: z.array(ruleSchema).max(RULE_TYPES.length).default([]),
});
export type TemplateColumn = z.infer<typeof columnSchema>;

export const templateInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Template name is required.').max(100, 'Template name is too long.'),
    description: z.string().trim().max(1000).optional().transform((d) => (d ? d : undefined)),
    hasHeaderRow: z.boolean().default(true),
    allowExtraColumns: z.boolean().default(true),
    columns: z.array(columnSchema).min(1, 'Add at least one column.').max(200, 'At most 200 columns.'),
  })
  .superRefine((t, ctx) => checkColumns(t.columns, ctx));
export type TemplateInput = z.infer<typeof templateInputSchema>;

/**
 * Cross-field checks on a list of columns (unique keys and names, delimiters, which rules fit which type,
 * min ≤ max, valid regex). Used for templates and for uploads without a template. Issue paths start at
 * ["columns", i].
 */
export function checkColumns(columns: TemplateColumn[], ctx: z.RefinementCtx): void {
  const keys = new Map<string, number>();
  const names = new Map<string, number>();
  columns.forEach((col, i) => {
    const at = (...path: (string | number)[]) => ['columns', i, ...path];
    const add = (message: string, ...path: (string | number)[]) => ctx.addIssue({ code: 'custom', message, path: at(...path) });

    if (keys.has(col.key)) add(`Duplicate key "${col.key}" (also column ${keys.get(col.key)! + 1}).`, 'key');
    keys.set(col.key, i);
    const lower = col.name.toLowerCase();
    if (names.has(lower)) add(`Duplicate column name "${col.name}".`, 'name');
    names.set(lower, i);

    if (col.type === 'multiselect' && !col.delimiter) add('Choose how values are separated.', 'delimiter');
    if (col.type !== 'multiselect' && col.delimiter) add('Only multi-value columns have a delimiter.', 'delimiter');

    const seen = new Set<RuleType>();
    col.rules.forEach((rule, r) => {
      if (seen.has(rule.type)) add(`Only one "${RULE_LABELS[rule.type]}" rule per column.`, 'rules', r);
      seen.add(rule.type);
      if (!RULES_FOR_TYPE[col.type].includes(rule.type)) {
        add(`"${RULE_LABELS[rule.type]}" can't be used on a ${col.type} column.`, 'rules', r);
        return;
      }
      if (rule.type === 'min' || rule.type === 'max') {
        const wantsDate = col.type === 'date';
        if (wantsDate !== (typeof rule.params.value === 'string')) {
          add(wantsDate ? 'Use a date like 2024-01-31.' : 'Enter a number.', 'rules', r, 'params', 'value');
        }
        if (col.type === 'integer' && typeof rule.params.value === 'number' && !Number.isInteger(rule.params.value)) {
          add('Use a whole number for an integer column.', 'rules', r, 'params', 'value');
        }
      }
      if (rule.type === 'regex') {
        try {
          new RegExp(rule.params.pattern, rule.params.flags);
        } catch {
          add('This pattern is not a valid regular expression.', 'rules', r, 'params', 'pattern');
        }
      }
    });

    const min = col.rules.find((r) => r.type === 'min');
    const max = col.rules.find((r) => r.type === 'max');
    if (min && max && compareLimits(min.params.value, max.params.value) > 0) {
      add('Minimum is greater than maximum.', 'rules', col.rules.indexOf(min), 'params', 'value');
    }
    const minL = col.rules.find((r) => r.type === 'min_length');
    const maxL = col.rules.find((r) => r.type === 'max_length');
    if (minL && maxL && minL.params.value > maxL.params.value) {
      add('Minimum length is greater than maximum length.', 'rules', col.rules.indexOf(minL), 'params', 'value');
    }
  });
}


function compareLimits(a: number | string, b: number | string): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return (parseDate(String(a)) ?? 0) - (parseDate(String(b)) ?? 0);
}

/** Column name → snake_case key, unique within `taken` (e.g. "Ticket #" → "ticket", "2024 sales" → "col_2024_sales"). */
export function toColumnKey(name: string, taken: Set<string> = new Set()): string {
  let base = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50);
  if (!base) base = 'column';
  if (!/^[a-z]/.test(base)) base = `col_${base}`;
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base}_${n}`;
  return key;
}

// ---------------------------------------------------------------- checking values

export interface CellIssue {
  /** 'required', 'type', or a rule type */
  rule: 'required' | 'type' | RuleType;
  severity: Severity;
  message: string;
}

export type RegexCompiler = (pattern: string, flags: string) => { test(s: string): boolean };
export const browserRegex: RegexCompiler = (pattern, flags) => new RegExp(pattern, flags);

const fmt = (v: number | string) => (typeof v === 'number' ? String(v) : v);

/**
 * Checks one cell against its column: required → type → rules. A value that fails its type check
 * gets only that one issue (rules aren't meaningful on it). `unique` is checked per file with
 * findDuplicates(), not here.
 */
export function checkCell(
  value: CellValue | undefined,
  column: Pick<TemplateColumn, 'type' | 'required' | 'delimiter' | 'rules'>,
  compileRegex: RegexCompiler = browserRegex,
): CellIssue[] {
  const spec: ColumnSpec = { type: column.type, required: column.required, delimiter: column.delimiter ?? ',' };
  const base = validateCell(value, spec);
  if (base) return [{ rule: isEmptyValue(value) ? 'required' : 'type', severity: 'error', message: base }];
  if (isEmptyValue(value)) return [];

  const issues: CellIssue[] = [];
  const text = Array.isArray(value) ? '' : (value as string).trim();
  for (const rule of column.rules) {
    const fail = (defaultMessage: string) =>
      issues.push({ rule: rule.type, severity: rule.severity, message: rule.message ?? defaultMessage });
    switch (rule.type) {
      case 'min':
      case 'max': {
        const isDate = column.type === 'date';
        const actual = isDate ? parseDate(text) : parseNumber(text);
        const limit = isDate ? parseDate(String(rule.params.value)) : Number(rule.params.value);
        if (actual === null || limit === null) break;
        if (rule.type === 'min' && actual < limit) fail(`Must be at least ${fmt(rule.params.value)}.`);
        if (rule.type === 'max' && actual > limit) fail(`Must be at most ${fmt(rule.params.value)}.`);
        break;
      }
      case 'min_length':
        if ([...text].length < rule.params.value) fail(`Must be at least ${rule.params.value} characters.`);
        break;
      case 'max_length':
        if ([...text].length > rule.params.value) fail(`Must be at most ${rule.params.value} characters.`);
        break;
      case 'regex':
        if (!compileRegexCached(compileRegex, rule.params.pattern, rule.params.flags).test(text)) {
          fail(`Doesn't match the required pattern.`);
        }
        break;
      case 'allowed_values': {
        const norm = (s: string) => (rule.params.case_sensitive ? s : s.toLowerCase());
        const allowed = new Set(rule.params.values.map(norm));
        const items = Array.isArray(value) ? value : [text];
        const bad = items.filter((item) => !allowed.has(norm(item.trim())));
        if (bad.length) {
          const list = rule.params.values.slice(0, 6).join(', ') + (rule.params.values.length > 6 ? ', …' : '');
          fail(`${bad.map((b) => `"${b}"`).join(', ')} ${bad.length > 1 ? 'are' : 'is'} not allowed (allowed: ${list}).`);
        }
        break;
      }
      case 'unique':
        break; // whole-file check: findDuplicates()
    }
  }
  return issues;
}

const regexCache = new WeakMap<RegexCompiler, Map<string, { test(s: string): boolean }>>();
function compileRegexCached(compile: RegexCompiler, pattern: string, flags: string) {
  let byCompiler = regexCache.get(compile);
  if (!byCompiler) regexCache.set(compile, (byCompiler = new Map()));
  const key = `${flags}/${pattern}`;
  let re = byCompiler.get(key);
  if (!re) byCompiler.set(key, (re = compile(pattern, flags)));
  return re;
}

/**
 * For a `unique` rule: returns, for every row index whose value repeats an earlier one, the row
 * index (0-based) of the first occurrence. Empty values are ignored. Comparison trims and ignores case.
 */
export function findDuplicates(values: (string | undefined)[]): Map<number, number> {
  const first = new Map<string, number>();
  const dupes = new Map<number, number>();
  values.forEach((v, i) => {
    const k = (v ?? '').trim().toLowerCase();
    if (!k) return;
    if (first.has(k)) dupes.set(i, first.get(k)!);
    else first.set(k, i);
  });
  return dupes;
}

// ---------------------------------------------------------------- normalisation (template-format export)

/**
 * The value as written in the "template format" download. Valid values are normalised; anything that
 * doesn't parse as its type is returned unchanged. Data is never dropped or guessed.
 *   date → YYYY-MM-DD (date-times → YYYY-MM-DDTHH:MM:SSZ) · boolean → true/false · number/integer → plain number (no $ or thousands
 *   separators; 50% → 0.5) · multiselect → items joined with the column delimiter · everything trimmed
 */
export function normalizeValue(value: CellValue | undefined, column: Pick<TemplateColumn, 'type' | 'delimiter'>): string {
  if (value === undefined) return '';
  if (Array.isArray(value)) return joinMulti(value, column.delimiter ?? ',');
  const text = value.trim();
  if (!text) return '';
  switch (column.type) {
    case 'date': {
      const t = parseDate(text);
      if (t === null) return value;
      const iso = new Date(t).toISOString(); // keep the time if there is one, never drop it
      return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.replace('.000Z', 'Z');
    }
    case 'boolean': {
      const b = parseBool(text);
      return b === null ? value : String(b);
    }
    case 'number':
    case 'integer': {
      const n = parseNumber(text);
      return n === null ? value : String(n);
    }
    case 'multiselect':
      return joinMulti(splitMulti(text, column.delimiter ?? ','), column.delimiter ?? ',');
    default:
      return text;
  }
}
