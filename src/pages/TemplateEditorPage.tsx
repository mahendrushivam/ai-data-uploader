import { useEffect, useMemo, useState } from 'react';
import type { Session } from '../types';
import { COLUMN_TYPES, MULTI_DELIMITERS } from '@datadesk/shared/rules';
import { DELIMITERS, TYPE_DEFS } from '../lib/columnTypes';
import { ApiError } from '../lib/api';
import { createTemplate, getTemplate, saveTemplate } from '../lib/templates';
import {
  columnHasErrors,
  emptyTemplate,
  fromTemplate,
  newColumn,
  validateDraft,
  withType,
  type DraftColumn,
  type DraftTemplate,
} from '../lib/templateDraft';
import { navigate } from '../router';
import { TopBar } from '../components/TopBar';
import { RulesPanel } from '../components/RulesPanel';
import { Field } from '../components/Field';

/** Create (id undefined) or edit a template. Saving an existing template creates its next version. */
export function TemplateEditorPage({ id, session, onLogout }: { id?: string; session: Session; onLogout: () => void }) {
  const [draft, setDraft] = useState<DraftTemplate | null>(id ? null : emptyTemplate());
  const [version, setVersion] = useState<number | null>(null);
  const [selected, setSelected] = useState(0);
  // After the first save attempt, problems are re-checked live as the user edits, so fixed ones disappear.
  const [attempted, setAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    getTemplate(id)
      .then((t) => {
        setDraft(fromTemplate(t));
        setVersion(t.version);
      })
      .catch((e) => setLoadError(e.message));
  }, [id]);

  const errors = useMemo(
    () => ({ ...(attempted && draft ? (validateDraft(draft) as { errors?: Record<string, string> }).errors ?? {} : {}), ...serverErrors }),
    [attempted, draft, serverErrors],
  );

  if (loadError || !draft) {
    return (
      <div className="page">
        <TopBar session={session} onLogout={onLogout} />
        <main className="container">
          {loadError ? (
            <div className="not-found">
              <div className="empty-icon">⌕</div>
              <h2>{loadError}</h2>
              <p className="muted">It may have been deleted, or it belongs to another account.</p>
              <a className="btn primary" href="#/templates">
                ← Back to Templates
              </a>
            </div>
          ) : (
            <p className="muted">Loading…</p>
          )}
        </main>
      </div>
    );
  }

  const set = (patch: Partial<DraftTemplate>) => {
    setDraft({ ...draft, ...patch });
    setServerErrors({}); // server errors refer to what was sent; the live check takes over
  };
  const setColumn = (i: number, patch: Partial<DraftColumn>) =>
    set({ columns: draft.columns.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const move = (i: number, by: -1 | 1) => {
    const cols = [...draft.columns];
    [cols[i], cols[i + by]] = [cols[i + by], cols[i]];
    set({ columns: cols });
    if (selected === i) setSelected(i + by);
    else if (selected === i + by) setSelected(i);
  };
  const remove = (i: number) => {
    set({ columns: draft.columns.filter((_, j) => j !== i) });
    setSelected(Math.max(0, Math.min(selected, draft.columns.length - 2)));
  };

  const save = async () => {
    setSaveError('');
    setAttempted(true);
    const checked = validateDraft(draft);
    if (!checked.ok) {
      const firstColumn = Object.keys(checked.errors).map((k) => /^columns\.(\d+)/.exec(k)?.[1]).find(Boolean);
      if (firstColumn !== undefined) setSelected(Number(firstColumn));
      return;
    }
    setSaving(true);
    try {
      if (id) await saveTemplate(id, checked.input);
      else await createTemplate(checked.input);
      navigate('/templates');
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) setServerErrors(e.fields);
      else setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const errorCount = Object.keys(errors).length;
  const current = draft.columns[selected];

  return (
    <div className="page">
      <TopBar session={session} onLogout={onLogout} />
      <main className="container builder">
        <div className="page-head">
          <div className="row gap wrap" style={{ alignItems: 'flex-start' }}>
            <Field
              compact
              label="Template name"
              value={draft.name}
              onChange={(e) => set({ name: e.target.value })}
              placeholder="e.g. Support tickets"
              autoFocus={!id}
              error={errors.name}
            />
            <Field
              compact
              label="Description (optional)"
              style={{ minWidth: 480 }}
              value={draft.description}
              onChange={(e) => set({ description: e.target.value })}
            />
          </div>
          <div className="row gap">
            {version !== null && <span className="muted small">Current: v{version}</span>}
            <button className="btn" onClick={() => navigate('/templates')}>
              Cancel
            </button>
            <button className="btn primary" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : version !== null ? `Save as v${version + 1}` : 'Create template'}
            </button>
          </div>
        </div>

        {errorCount > 0 && (
          <div className="alert error mb">
            Fix the highlighted problem{errorCount === 1 ? '' : 's'} ({errorCount}) before saving.
            {errors.columns && ` ${errors.columns}`}
          </div>
        )}
        {saveError && <div className="alert error mb">{saveError}</div>}

        <div className="row gap wrap mb">
          <label className="check">
            <input type="checkbox" checked={draft.hasHeaderRow} onChange={(e) => set({ hasHeaderRow: e.target.checked })} />
            First row contains column names
          </label>
          <label className="inline">
            Columns in the file that aren't in this template:
            <select value={draft.allowExtraColumns ? 'ignore' : 'reject'} onChange={(e) => set({ allowExtraColumns: e.target.value === 'ignore' })}>
              <option value="ignore">Ignore them</option>
              <option value="reject">Report an error</option>
            </select>
          </label>
        </div>

        <div className="builder-layout">
          <section className="table-card">
            <table className="list-table builder-table">
              <thead>
                <tr>
                  <th className="c-move" />
                  <th className="c-name">Column name</th>
                  <th className="c-type">Type</th>
                  <th className="c-req">Required</th>
                  <th className="c-alias">Also matches headers</th>
                  <th className="c-rules">Rules</th>
                  <th className="c-del" />
                </tr>
              </thead>
              <tbody>
                {draft.columns.map((c, i) => (
                  <tr
                    key={c.uid}
                    className={`${i === selected ? 'selected' : ''}${columnHasErrors(errors, i) ? ' has-error' : ''}`}
                    onClick={() => setSelected(i)}
                  >
                    <td className="muted">
                      <button className="icon-btn" aria-label="Move up" disabled={i === 0} onClick={(e) => (e.stopPropagation(), move(i, -1))}>
                        ↑
                      </button>
                      <button className="icon-btn" aria-label="Move down" disabled={i === draft.columns.length - 1} onClick={(e) => (e.stopPropagation(), move(i, 1))}>
                        ↓
                      </button>
                    </td>
                    <td>
                      <input aria-label={`Column ${i + 1} name`} value={c.name} placeholder="Column name" onChange={(e) => setColumn(i, { name: e.target.value })} />
                      {(errors[`columns.${i}.name`] ?? errors[`columns.${i}.key`]) && (
                        <span className="field-error">{errors[`columns.${i}.name`] ?? errors[`columns.${i}.key`]}</span>
                      )}
                    </td>
                    <td>
                      <select aria-label={`Column ${i + 1} type`} value={c.type} onChange={(e) => setColumn(i, withType(c, e.target.value as DraftColumn['type']))}>
                        {COLUMN_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {TYPE_DEFS[t].icon} {TYPE_DEFS[t].label}
                          </option>
                        ))}
                      </select>
                      {c.type === 'multiselect' && (
                        <select aria-label={`Column ${i + 1} delimiter`} value={c.delimiter} onChange={(e) => setColumn(i, { delimiter: e.target.value })}>
                          {DELIMITERS.filter((d) => (MULTI_DELIMITERS as readonly string[]).includes(d.value)).map((d) => (
                            <option key={d.value} value={d.value}>
                              split by {d.label}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td>
                      <input type="checkbox" aria-label={`Column ${i + 1} required`} checked={c.required} onChange={(e) => setColumn(i, { required: e.target.checked })} />
                    </td>
                    <td>
                      <input
                        aria-label={`Column ${i + 1} aliases`}
                        placeholder="e.g. Ticket #, id"
                        value={c.aliasesText}
                        onChange={(e) => setColumn(i, { aliasesText: e.target.value })}
                      />
                    </td>
                    <td>
                      <button className={`chip rules-chip${columnHasErrors(errors, i) ? ' bad' : ''}`} onClick={() => setSelected(i)}>
                        {c.rules.length ? `${c.rules.length} rule${c.rules.length === 1 ? '' : 's'}` : 'Add rules'}
                      </button>
                    </td>
                    <td>
                      <button
                        className="icon-btn danger"
                        aria-label={`Remove column ${i + 1}`}
                        disabled={draft.columns.length === 1}
                        onClick={(e) => (e.stopPropagation(), remove(i))}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="builder-foot">
              <button
                className="btn sm"
                onClick={() => {
                  set({ columns: [...draft.columns, newColumn()] });
                  setSelected(draft.columns.length);
                }}
              >
                + Add column
              </button>
            </div>
          </section>

          {current && (
            <aside className="table-card rules-aside">
              <div className="muted small strong">RULES FOR</div>
              <h3>{current.name.trim() || `Column ${selected + 1}`}</h3>
              <RulesPanel
                column={current}
                prefix={`columns.${selected}`}
                errors={errors}
                onChange={(rules) => setColumn(selected, { rules })}
              />
            </aside>
          )}
        </div>

        {version !== null && (
          <div className="alert info mt">
            Saving creates <strong>version {version + 1}</strong>. Uploads already checked with earlier versions keep their results.
          </div>
        )}
      </main>
    </div>
  );
}
