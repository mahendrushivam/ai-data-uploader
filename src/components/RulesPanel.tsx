import { RULE_LABELS, RULES_FOR_TYPE, type RuleType } from '@datadesk/shared/rules';
import { TYPE_DEFS } from '../lib/columnTypes';
import { newRule, type DraftColumn, type DraftRule } from '../lib/templateDraft';

interface Props {
  column: DraftColumn;
  onChange: (rules: DraftRule[]) => void;
  /** Validation errors keyed by path; `prefix` is this column's path, e.g. "columns.2". */
  errors: Record<string, string>;
  prefix: string;
}

const HINTS: Record<RuleType, string> = {
  min: 'Lower limit (inclusive)',
  max: 'Upper limit (inclusive)',
  min_length: 'Fewest characters allowed',
  max_length: 'Most characters allowed',
  regex: 'The whole value must match. Example: ^[A-Z]{3}-\\d+$',
  allowed_values: 'One value per line',
  unique: 'No two rows may have the same value (ignores case and surrounding spaces)',
};

/** Rules of one column: edit parameters, severity and message; add or remove rules. Reused by uploads (M3). */
export function RulesPanel({ column, onChange, errors, prefix }: Props) {
  const available = RULES_FOR_TYPE[column.type].filter((t) => !column.rules.some((r) => r.type === t));
  const update = (i: number, patch: Partial<DraftRule>) => onChange(column.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const err = (i: number, ...path: string[]) => errors[[prefix, 'rules', i, ...path].join('.')];

  return (
    <div className="rules-panel">
      <div className="muted small">
        Built in: {column.required ? 'a value is required, and it ' : 'empty cells are allowed; a value '}
        must be a valid {TYPE_DEFS[column.type].label.toLowerCase()}.
      </div>

      {column.rules.map((rule, i) => {
        const fieldErr = err(i, 'params', 'value') ?? err(i, 'params', 'pattern') ?? err(i, 'params', 'values');
        return (
          <div key={i} className={`rule-card${rule.severity === 'warning' ? ' warning' : ''}${err(i) || fieldErr ? ' invalid' : ''}`}>
            <div className="row between">
              <strong>{RULE_LABELS[rule.type]}</strong>
              <div className="row gap">
                <select
                  aria-label="Severity"
                  value={rule.severity}
                  onChange={(e) => update(i, { severity: e.target.value as DraftRule['severity'] })}
                >
                  <option value="error">Error (fails the upload)</option>
                  <option value="warning">Warning (flag only)</option>
                </select>
                <button type="button" className="btn sm ghost" aria-label={`Remove ${RULE_LABELS[rule.type]} rule`} onClick={() => onChange(column.rules.filter((_, j) => j !== i))}>
                  ✕
                </button>
              </div>
            </div>
            <div className="muted small">{HINTS[rule.type]}</div>

            {(rule.type === 'min' || rule.type === 'max' || rule.type === 'min_length' || rule.type === 'max_length') && (
              <input
                aria-label={`${RULE_LABELS[rule.type]} value`}
                type={column.type === 'date' && (rule.type === 'min' || rule.type === 'max') ? 'date' : 'number'}
                step="any"
                value={rule.value}
                onChange={(e) => update(i, { value: e.target.value })}
              />
            )}
            {rule.type === 'regex' && (
              <>
                <input
                  aria-label="Pattern"
                  className="mono"
                  placeholder="^[A-Z]{3}-\d+$"
                  value={rule.pattern}
                  onChange={(e) => update(i, { pattern: e.target.value })}
                />
                <label className="check">
                  <input type="checkbox" checked={rule.ignoreCase} onChange={(e) => update(i, { ignoreCase: e.target.checked })} />
                  Ignore upper/lower case
                </label>
              </>
            )}
            {rule.type === 'allowed_values' && (
              <>
                <textarea
                  aria-label="Allowed values"
                  rows={4}
                  placeholder={'US\nGB\nDE'}
                  value={rule.valuesText}
                  onChange={(e) => update(i, { valuesText: e.target.value })}
                />
                <label className="check">
                  <input type="checkbox" checked={rule.caseSensitive} onChange={(e) => update(i, { caseSensitive: e.target.checked })} />
                  Match upper/lower case exactly
                </label>
              </>
            )}
            {fieldErr && <span className="field-error">{fieldErr}</span>}
            {err(i) && <span className="field-error">{err(i)}</span>}
            <input
              aria-label="Custom message"
              className="small"
              placeholder="Custom message (optional)"
              value={rule.message}
              onChange={(e) => update(i, { message: e.target.value })}
            />
          </div>
        );
      })}

      {available.length > 0 ? (
        <select
          aria-label="Add rule"
          className="add-rule"
          value=""
          onChange={(e) => e.target.value && onChange([...column.rules, newRule(e.target.value as RuleType)])}
        >
          <option value="">+ Add rule…</option>
          {available.map((t) => (
            <option key={t} value={t}>
              {RULE_LABELS[t]}
            </option>
          ))}
        </select>
      ) : (
        <div className="muted small">
          {RULES_FOR_TYPE[column.type].length ? 'All rules for this type are in use.' : 'No extra rules apply to this type.'}
        </div>
      )}
    </div>
  );
}
