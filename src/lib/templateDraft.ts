/**
 * Editable (form) state for template columns and rules, shared by the template builder and the
 * upload screen (M3). Inputs stay strings while the user types; toTemplateInput() converts them and
 * the shared zod schema validates the result, so the browser and the API apply exactly the same checks.
 */
import type { ColumnType } from '@datadesk/shared/types';
import {
  MULTI_DELIMITERS,
  RULES_FOR_TYPE,
  templateInputSchema,
  toColumnKey,
  type RuleInput,
  type RuleType,
  type Severity,
  type TemplateColumn,
  type TemplateInput,
} from '@datadesk/shared/rules';
import type { TemplateDetail } from '@datadesk/shared/api';
import { uid } from './id';

export interface DraftRule {
  type: RuleType;
  /** min / max / min_length / max_length */
  value: string;
  /** regex */
  pattern: string;
  ignoreCase: boolean;
  /** allowed_values: one value per line */
  valuesText: string;
  caseSensitive: boolean;
  severity: Severity;
  message: string;
}

export interface DraftColumn {
  uid: string;
  /** Key of the saved column this draft came from; kept while the name is unchanged. */
  savedKey?: string;
  savedName?: string;
  name: string;
  type: ColumnType;
  required: boolean;
  delimiter: string;
  aliasesText: string;
  rules: DraftRule[];
}

export interface DraftTemplate {
  name: string;
  description: string;
  hasHeaderRow: boolean;
  allowExtraColumns: boolean;
  columns: DraftColumn[];
}

export const newRule = (type: RuleType): DraftRule => ({
  type,
  value: '',
  pattern: '',
  ignoreCase: false,
  valuesText: '',
  caseSensitive: false,
  severity: 'error',
  message: '',
});

export const newColumn = (name = '', type: ColumnType = 'text'): DraftColumn => ({
  uid: uid('dc_'),
  name,
  type,
  required: false,
  delimiter: ',',
  aliasesText: '',
  rules: [],
});

export const emptyTemplate = (): DraftTemplate => ({
  name: '',
  description: '',
  hasHeaderRow: true,
  allowExtraColumns: true,
  columns: [newColumn()],
});

/** Changing a column's type drops rules that don't apply to the new type. */
export const withType = <T extends DraftColumn>(col: T, type: ColumnType): T => ({
  ...col,
  type,
  rules: col.rules.filter((r) => RULES_FOR_TYPE[type].includes(r.type)),
});

export function ruleToDraft(rule: TemplateColumn['rules'][number]): DraftRule {
  const d = { ...newRule(rule.type), severity: rule.severity, message: rule.message ?? '' };
  switch (rule.type) {
    case 'min':
    case 'max':
    case 'min_length':
    case 'max_length':
      return { ...d, value: String(rule.params.value) };
    case 'regex':
      return { ...d, pattern: rule.params.pattern, ignoreCase: rule.params.flags === 'i' };
    case 'allowed_values':
      return { ...d, valuesText: rule.params.values.join('\n'), caseSensitive: rule.params.case_sensitive };
    default:
      return d;
  }
}

export function draftToRule(d: DraftRule, type: ColumnType): RuleInput {
  const common = { severity: d.severity, message: d.message.trim() || undefined };
  const num = (s: string) => (s.trim() !== '' && Number.isFinite(Number(s)) ? Number(s) : (s as unknown as number));
  switch (d.type) {
    case 'min':
    case 'max':
      // Dates stay strings (ISO); numbers are converted. Anything unparsable is passed through so the
      // schema reports it next to the field.
      return { type: d.type, params: { value: type === 'date' ? d.value.trim() : num(d.value) }, ...common };
    case 'min_length':
    case 'max_length':
      return { type: d.type, params: { value: num(d.value) }, ...common };
    case 'regex':
      return { type: 'regex', params: { pattern: d.pattern, flags: d.ignoreCase ? 'i' : '' }, ...common };
    case 'allowed_values':
      return {
        type: 'allowed_values',
        params: {
          values: d.valuesText.split('\n').map((v) => v.trim()).filter(Boolean),
          case_sensitive: d.caseSensitive,
        },
        ...common,
      };
    case 'unique':
      return { type: 'unique', params: {}, ...common };
  }
}

export function fromTemplate(t: TemplateDetail): DraftTemplate {
  return {
    name: t.name,
    description: t.description ?? '',
    hasHeaderRow: t.hasHeaderRow,
    allowExtraColumns: t.allowExtraColumns,
    columns: t.columns.map((c) => ({
      uid: uid('dc_'),
      savedKey: c.key,
      savedName: c.name,
      name: c.name,
      type: c.type,
      required: c.required,
      delimiter: c.delimiter ?? ',',
      aliasesText: c.aliases.join(', '),
      rules: c.rules.map(ruleToDraft),
    })),
  };
}

/** Draft columns → schema input. Keys are derived from names (kept for unrenamed saved columns). */
export function toColumnsInput(columns: DraftColumn[]) {
  const taken = new Set<string>();
  for (const c of columns) if (c.savedKey && c.name.trim() === c.savedName) taken.add(c.savedKey);
  return columns.map((c) => {
    const key = c.savedKey && c.name.trim() === c.savedName ? c.savedKey : toColumnKey(c.name, taken);
    taken.add(key);
    return {
      key,
      name: c.name,
      type: c.type,
      required: c.required,
      delimiter: c.type === 'multiselect' ? (c.delimiter as (typeof MULTI_DELIMITERS)[number]) : null,
      aliases: c.aliasesText.split(',').map((a) => a.trim()).filter(Boolean),
      rules: c.rules.map((r) => draftToRule(r, c.type)),
    };
  });
}

/** Validates the draft with the shared schema. Errors are keyed by path, e.g. "columns.2.rules.0.params.value". */
export function validateDraft(
  draft: DraftTemplate,
): { ok: true; input: TemplateInput } | { ok: false; errors: Record<string, string> } {
  const result = templateInputSchema.safeParse({
    name: draft.name,
    description: draft.description,
    hasHeaderRow: draft.hasHeaderRow,
    allowExtraColumns: draft.allowExtraColumns,
    columns: toColumnsInput(draft.columns),
  });
  if (result.success) return { ok: true, input: result.data };
  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) errors[issue.path.join('.') || '_'] ??= issue.message;
  return { ok: false, errors };
}

/** Errors that belong to one column (any path under columns.<i>), for red markers in the column list. */
export const columnHasErrors = (errors: Record<string, string>, i: number) =>
  Object.keys(errors).some((k) => k === `columns.${i}` || k.startsWith(`columns.${i}.`));
