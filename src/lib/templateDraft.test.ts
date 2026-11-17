import { describe, expect, it } from 'vitest';
import { templateDetail } from '../test/data';
import {
  columnHasErrors,
  draftToRule,
  emptyTemplate,
  fromTemplate,
  newColumn,
  newRule,
  ruleToDraft,
  toColumnsInput,
  validateDraft,
  withType,
} from './templateDraft';

describe('templateDraft', () => {
  it('new columns, rules and templates start empty with safe defaults', () => {
    expect(newColumn('Email', 'email')).toMatchObject({ name: 'Email', type: 'email', required: false, delimiter: ',', aliasesText: '', rules: [] });
    expect(newColumn().uid).not.toBe(newColumn().uid);
    expect(newRule('regex')).toMatchObject({ type: 'regex', severity: 'error', pattern: '', message: '' });
    expect(emptyTemplate()).toMatchObject({ name: '', hasHeaderRow: true, allowExtraColumns: true, columns: [{ name: '' }] });
  });

  it('changing a column type drops the rules that no longer apply', () => {
    const c = { ...newColumn('Amount', 'number'), rules: [newRule('min'), newRule('unique')] };
    expect(withType(c, 'text').rules.map((r) => r.type)).toEqual(['unique']);
    expect(withType(c, 'boolean').rules).toEqual([]);
  });

  it.each([
    [{ type: 'min' as const, params: { value: 0.6 }, severity: 'warning' as const, message: 'Low' }, 'number'],
    [{ type: 'max' as const, params: { value: '2026-12-31' }, severity: 'error' as const }, 'date'],
    [{ type: 'min_length' as const, params: { value: 2 }, severity: 'error' as const }, 'text'],
    [{ type: 'regex' as const, params: { pattern: '^A', flags: 'i' as const }, severity: 'error' as const }, 'text'],
    [{ type: 'allowed_values' as const, params: { values: ['US', 'GB'], case_sensitive: true }, severity: 'error' as const }, 'select'],
    [{ type: 'unique' as const, params: {}, severity: 'error' as const }, 'text'],
  ])('rule %j survives saved → form → saved', (rule, type) => {
    const back = draftToRule(ruleToDraft(rule as never), type as never);
    expect(back).toEqual({ ...rule, message: 'message' in rule ? rule.message : undefined });
  });

  it('form values are converted: numbers parsed, dates kept as text, unparsable input passed through for the schema to report', () => {
    expect(draftToRule({ ...newRule('min'), value: ' 5 ' }, 'number')).toMatchObject({ params: { value: 5 } });
    expect(draftToRule({ ...newRule('min'), value: 'abc' }, 'number')).toMatchObject({ params: { value: 'abc' } });
    expect(draftToRule({ ...newRule('max'), value: '2024-01-31' }, 'date')).toMatchObject({ params: { value: '2024-01-31' } });
    expect(draftToRule({ ...newRule('allowed_values'), valuesText: ' US \n\nGB\n' }, 'select')).toMatchObject({ params: { values: ['US', 'GB'] } });
    expect(draftToRule({ ...newRule('unique'), message: '   ' }, 'text')).toMatchObject({ message: undefined });
  });

  it('loads a saved template into form state (aliases as text, rules as drafts)', () => {
    const d = fromTemplate(templateDetail());
    expect(d).toMatchObject({ name: 'Support tickets', description: 'Weekly export', hasHeaderRow: true });
    expect(d.columns[0]).toMatchObject({ savedKey: 'ticket_id', savedName: 'ticket_id', aliasesText: 'Ticket #' });
    expect(d.columns[2].rules.map((r) => [r.type, r.value, r.severity])).toEqual([
      ['min', '0.6', 'warning'],
      ['max', '1', 'error'],
    ]);
  });

  it('keys: kept for unrenamed saved columns, derived (and made unique) for new or renamed ones', () => {
    const d = fromTemplate(templateDetail());
    d.columns[1] = { ...d.columns[1], name: 'Category' }; // renamed
    d.columns.push(newColumn('Ticket ID'), newColumn('ticket id'));
    const cols = toColumnsInput(d.columns);
    expect(cols.map((c) => c.key)).toEqual(['ticket_id', 'category', 'confidence', 'ticket_id_2', 'ticket_id_3']);
    expect(cols[0].aliases).toEqual(['Ticket #']);
    expect(cols[0].delimiter).toBeNull();
  });

  it('validateDraft returns the schema input, or errors keyed by path', () => {
    const ok = validateDraft({ ...emptyTemplate(), name: 'T', columns: [newColumn('A')] });
    expect(ok.ok && ok.input.columns[0].key).toBe('a');
    const bad = validateDraft({
      ...emptyTemplate(),
      name: '',
      columns: [{ ...newColumn('N', 'number'), rules: [{ ...newRule('min'), value: '5' }, { ...newRule('max'), value: '1' }] }],
    });
    expect(bad.ok).toBe(false);
    const errors = (bad as { errors: Record<string, string> }).errors;
    expect(errors).toMatchObject({ name: 'Template name is required.', 'columns.0.rules.0.params.value': 'Minimum is greater than maximum.' });
    expect(columnHasErrors(errors, 0)).toBe(true);
    expect(columnHasErrors(errors, 1)).toBe(false);
  });
});
