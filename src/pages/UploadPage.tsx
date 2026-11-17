import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '../types';
import type { ColumnType } from '@datadesk/shared/types';
import { COLUMN_TYPES, MULTI_DELIMITERS, RULES_FOR_TYPE, ruleSchema, type TemplateColumn } from '@datadesk/shared/rules';
import {
  LIMITS,
  decodeCsv,
  matchHeaders,
  parseCsv,
  snapshotFromAdhoc,
  snapshotFromTemplate,
  splitRows,
  uploadRequestSchema,
  validateFile,
  type FileIssue,
  type MatchHow,
  type ParsedFile,
  type UploadRequestInput,
  type ValidationResult,
} from '@datadesk/shared/upload';
import { DELIMITERS, TYPE_DEFS, detectType, fromText } from '../lib/columnTypes';
import { ApiError } from '../lib/api';
import { getTemplate, listTemplates, type TemplateDetail, type TemplateSummary } from '../lib/templates';
import { createUpload } from '../lib/uploads';
import { columnHasErrors, newColumn, toColumnsInput, withType, type DraftColumn } from '../lib/templateDraft';
import { buildSampleCsv } from '../lib/sample';
import { navigate } from '../router';
import { TopBar } from '../components/TopBar';
import { CellView } from '../components/CellView';
import { RulesPanel } from '../components/RulesPanel';
import { Field } from '../components/Field';

const PREVIEW_ROWS = 50;
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : mb(n));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface LoadedFile {
  file: File;
  parsed: ParsedFile;
  validUtf8: boolean;
}

/** A file column in an upload without a template: a draft column plus where it is and whether it's used. */
interface AdhocColumn extends DraftColumn {
  include: boolean;
  sourceIndex: number;
  detected: ColumnType;
}

const HOW_LABEL: Record<MatchHow | 'manual', string> = {
  exact: 'same name',
  name: 'similar name',
  alias: 'matched by alias',
  manual: 'chosen by you',
};

/** New upload: 1) choose template (or none) and file, 2) map and pre-check, then submit (queued for the worker). */
export function UploadPage({ session, onLogout, arg }: { session: Session; onLogout: () => void; arg?: string }) {
  const [templates, setTemplates] = useState<TemplateSummary[] | null>(null);
  const [mode, setMode] = useState<'template' | 'adhoc'>('template');
  const [templateId, setTemplateId] = useState<string>('');
  const [template, setTemplate] = useState<TemplateDetail | null>(null);
  const [loaded, setLoaded] = useState<LoadedFile | null>(null);
  const [name, setName] = useState('');
  const [mapping, setMapping] = useState<Record<string, number | null>>({});
  const [how, setHow] = useState<Record<string, MatchHow | 'manual' | null>>({});
  const [hasHeaderRow, setHasHeaderRow] = useState(true);
  const [columns, setColumns] = useState<AdhocColumn[]>([]);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Templates: preselect the one in the URL (#/upload/<id>), else the user's default, else the first.
  useEffect(() => {
    listTemplates()
      .then((list) => {
        setTemplates(list);
        const wanted = arg && UUID.test(arg) ? list.find((t) => t.id === arg) : undefined;
        const pick = wanted ?? list.find((t) => t.isDefault) ?? list[0];
        if (pick) setTemplateId(pick.id);
        else setMode('adhoc');
      })
      .catch((e) => setError(e.message));
  }, [arg]);

  useEffect(() => {
    setTemplate(null);
    if (templateId) getTemplate(templateId).then(setTemplate).catch((e) => setError(e.message));
  }, [templateId]);

  // #/upload/sample: load the built-in sample file once the templates are known
  useEffect(() => {
    if (arg === 'sample' && templates && !loaded && (mode === 'adhoc' || template)) {
      handleFile(new File([buildSampleCsv()], 'ml-review-sample.csv', { type: 'text/csv' }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arg, templates, template, mode]);

  // ---------- reading the file (limits are checked before anything is uploaded) ----------
  async function handleFile(file: File) {
    setError('');
    if (file.size > LIMITS.maxBytes) {
      setError(`"${file.name}" is ${mb(file.size)}. The limit is ${mb(LIMITS.maxBytes)}: split the file or remove unused columns, and try again.`);
      return;
    }
    if (file.size === 0) {
      setError(`"${file.name}" is empty.`);
      return;
    }
    setBusy(true);
    try {
      const { text, validUtf8 } = decodeCsv(new Uint8Array(await file.arrayBuffer()));
      const parsed = parseCsv(text);
      const header = mode === 'template' ? template?.hasHeaderRow ?? true : hasHeaderRow;
      const { body } = splitRows(parsed.rows, header);
      if (body.length > LIMITS.maxRows) {
        setError(`"${file.name}" has ${body.length.toLocaleString()} rows. The limit is ${LIMITS.maxRows.toLocaleString()}: split the file and upload the parts.`);
        return;
      }
      setLoaded({ file, parsed, validUtf8 });
      setName(file.name.replace(/\.[^.]+$/, ''));
      setAttempted(false);
      setServerErrors({});
    } catch (e) {
      setError(`Could not read the file: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  // Match columns (template) or detect them (no template) once BOTH the file and the template are
  // available, whichever arrives last: the template's columns load asynchronously after it's
  // preselected, and a file dropped in before that must still be matched.
  useEffect(() => {
    if (!loaded) return;
    if (mode === 'template') {
      if (!template) return;
      const { headers } = splitRows(loaded.parsed.rows, template.hasHeaderRow);
      const m = matchHeaders(headers, template.columns);
      setMapping(Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.index])));
      setHow(Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.how])));
    } else {
      setColumns(detectColumns(loaded.parsed, hasHeaderRow));
      setSelected(0);
    }
    // hasHeaderRow changes re-detect explicitly (its checkbox handler); a re-run here would undo user edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, mode, template]);

  const split = useMemo(
    () => (loaded ? splitRows(loaded.parsed.rows, mode === 'template' ? template?.hasHeaderRow ?? true : hasHeaderRow) : null),
    [loaded, mode, template, hasHeaderRow],
  );

  // ---------- the snapshot being checked (same shape the server stores) ----------
  // Memoised: a new array every render would re-run the whole-file check on every render.
  const included = useMemo(() => columns.filter((c) => c.include), [columns]);
  const includedKeys = useMemo(() => toColumnsInput(included).map((c) => c.key), [included]);
  const snapshot = useMemo(() => {
    if (!loaded || !split) return null;
    if (mode === 'template') {
      return template ? snapshotFromTemplate({ ...template, id: template.versionId }, mapping, split.headers) : null;
    }
    // Pre-check with the rules that are already complete; incomplete ones are flagged in the rules panel.
    const inputs = toColumnsInput(included);
    const cols = inputs.map((c, i) => ({
      ...c,
      aliases: [],
      sourceIndex: included[i].sourceIndex,
      rules: c.rules.flatMap((r) => {
        const p = ruleSchema.safeParse(r);
        return p.success && RULES_FOR_TYPE[c.type].includes(p.data.type) ? [p.data] : [];
      }),
    })) as (TemplateColumn & { sourceIndex: number })[];
    return snapshotFromAdhoc(cols, hasHeaderRow, split.headers);
  }, [loaded, split, mode, template, mapping, included, hasHeaderRow]);

  // Re-validating 20,000 rows on every keystroke would make typing lag; React defers it instead.
  const deferredSnapshot = useDeferredValue(snapshot);
  const result: ValidationResult | null = useMemo(
    () => (loaded && deferredSnapshot ? validateFile(loaded.parsed, deferredSnapshot) : null),
    [loaded, deferredSnapshot],
  );
  const stale = snapshot !== deferredSnapshot;

  const cellIssues = useMemo(() => {
    const map = new Map<string, FileIssue>();
    for (const issue of result?.issues ?? []) {
      if (issue.row === null || issue.column === null) continue;
      const k = `${issue.row}:${issue.column}`;
      if (!map.has(k) || (map.get(k)!.severity === 'warning' && issue.severity === 'error')) map.set(k, issue);
    }
    return map;
  }, [result]);
  const countsFor = (key: string) => {
    let errors = 0;
    let warnings = 0;
    for (const s of result?.summary ?? []) if (s.column === key) s.severity === 'error' ? (errors += s.count) : (warnings += s.count);
    return { errors, warnings };
  };

  // ---------- building and checking the request ----------
  const request: UploadRequestInput | null = useMemo(() => {
    if (mode === 'template') {
      return template ? { mode: 'template', name, templateVersionId: template.versionId, mapping } : null;
    }
    const inputs = toColumnsInput(included);
    return { mode: 'adhoc', name, hasHeaderRow, columns: inputs.map((c, i) => ({ ...c, sourceIndex: included[i].sourceIndex })) };
  }, [mode, template, name, mapping, included, hasHeaderRow]);

  const clientErrors = useMemo(() => {
    if (!attempted || !request) return {};
    const r = uploadRequestSchema.safeParse(request);
    if (r.success) return {};
    const errors: Record<string, string> = {};
    for (const i of r.error.issues) errors[i.path.join('.') || '_'] ??= i.message;
    return errors;
  }, [attempted, request]);
  const errors = { ...clientErrors, ...serverErrors };

  async function submit() {
    if (!loaded || !request) return;
    setAttempted(true);
    setServerErrors({});
    setError('');
    const checked = uploadRequestSchema.safeParse(request);
    if (!checked.success) {
      const first = checked.error.issues.find((i) => i.path[0] === 'columns');
      if (first) setSelected(included.indexOf(included[Number(first.path[1])]));
      return;
    }
    setBusy(true);
    try {
      const upload = await createUpload(request, loaded.file);
      navigate(`/uploads/${upload.id}`);
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) setServerErrors(e.fields);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const reset = () => {
    setLoaded(null);
    setError('');
    if (arg === 'sample') navigate('/upload');
  };

  const waitingForTemplate = mode === 'template' && !!loaded && !template;

  // =================================================================== step 1
  if (!loaded || !split || waitingForTemplate) {
    const noTemplates = templates !== null && templates.length === 0;
    return (
      <div className="page">
        <TopBar session={session} onLogout={onLogout} />
        <main className="container">
          <Steps step={1} />
          <h2 className="mb">How should this file be checked?</h2>
          <div className="mode-options mb">
            <label className={`mode-option${mode === 'template' ? ' on' : ''}${noTemplates ? ' disabled' : ''}`}>
              <input type="radio" name="mode" checked={mode === 'template'} disabled={noTemplates} onChange={() => setMode('template')} />
              <div>
                <strong>Use a template</strong>
                <div className="muted small">Columns and rules come from one of your templates.</div>
                {noTemplates ? (
                  <div className="small mt-s">
                    You have no templates yet. <a href="#/templates/new">Create one</a>, or upload without a template.
                  </div>
                ) : (
                  <>
                    <select
                      aria-label="Template"
                      className="mt-s"
                      value={templateId}
                      onChange={(e) => {
                        setTemplateId(e.target.value);
                        setMode('template');
                      }}
                    >
                      {(templates ?? []).map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.isDefault ? '★ ' : ''}
                          {t.name} · v{t.version}
                          {t.isDefault ? ' (your default)' : ''}
                        </option>
                      ))}
                    </select>
                    {template && (
                      <div className="expected">
                        <span className="muted small">
                          Expects {template.columns.length} column{template.columns.length === 1 ? '' : 's'} (<span className="req">*</span> required):
                        </span>
                        <div className="row gap wrap">
                          {template.columns.map((c) => (
                            <span key={c.key} className="col-chip">
                              <span className={`htype t-${c.type}`}>{TYPE_DEFS[c.type].icon}</span>
                              {c.name}
                              {c.required && <span className="req">*</span>}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </label>
            <label className={`mode-option${mode === 'adhoc' ? ' on' : ''}`}>
              <input type="radio" name="mode" checked={mode === 'adhoc'} onChange={() => setMode('adhoc')} />
              <div>
                <strong>No template</strong>
                <div className="muted small">
                  Set up columns and rules just for this file. Types are detected automatically and you can add rules as you go.
                </div>
              </div>
            </label>
          </div>

          <div
            className={`dropzone${dragOver ? ' over' : ''}`}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files[0];
              if (f) handleFile(f);
            }}
          >
            <div className="drop-icon">⇪</div>
            <h2>{busy || waitingForTemplate ? 'Reading file…' : 'Drop a CSV file here, or click to browse'}</h2>
            <p className="muted">
              .csv, .tsv or .txt · up to <strong>5 MB</strong> and <strong>20,000 rows</strong> · the delimiter is detected automatically
            </p>
            <input
              ref={fileRef}
              type="file"
              data-testid="file-input"
              accept=".csv,.tsv,.txt,text/csv"
              hidden
              disabled={mode === 'template' && !template}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
                e.target.value = '';
              }}
            />
          </div>
          {error && <div className="alert error mt">{error}</div>}
          <div className="row between mt">
            <button className="btn ghost" onClick={() => navigate('/')}>
              Cancel
            </button>
            <span className="muted small">
              The file is checked in your browser first. Nothing is uploaded until you press "Upload &amp; validate".{' '}
              <button className="linklike" onClick={() => handleFile(new File([buildSampleCsv()], 'ml-review-sample.csv', { type: 'text/csv' }))}>
                Try the sample file
              </button>
            </span>
          </div>
        </main>
      </div>
    );
  }

  // =================================================================== step 2
  const { headers, body, width } = split;
  const mappedIndexes = new Set(Object.values(mapping).filter((v): v is number => v !== null));
  const previewCols = (snapshot?.columns ?? []).map((c) => ({ ...c, spec: { type: c.type, delimiter: c.delimiter ?? ',', required: c.required } }));
  const fileLevel = (result?.issues ?? []).filter((i) => i.row === null);
  const rowIssues = new Map<number, FileIssue>((result?.issues ?? []).filter((i) => i.rule === 'row_length' || i.rule === 'parse').map((i) => [i.row!, i]));

  return (
    <div className="page">
      <TopBar session={session} onLogout={onLogout} />
      <main className="container wide">
        <Steps step={2} />
        <div className="row gap wrap mb" style={{ alignItems: 'flex-end' }}>
          <Field compact label="Upload name" className="no-margin" style={{ width: 260 }} value={name} onChange={(e) => setName(e.target.value)} error={errors.name} />
          <span className="pill">
            ▦ {loaded.file.name} · {kb(loaded.file.size)} · {body.length.toLocaleString()} rows · {width} columns
          </span>
          <span className={`pill ${mode === 'template' ? 'green' : 'outline'}`}>
            {mode === 'template' && template ? `Template: ${template.name} v${template.version}` : 'No template'}
          </span>
        </div>

        <div className="map-layout">
          <section className="map-panel">
            {mode === 'template' && template ? (
              <>
                <div className="panel-head">
                  <h3>Column matching</h3>
                  <p className="muted small">
                    {template.columns.filter((c) => mapping[c.key] != null).length} of {template.columns.length} template columns found
                    {headers.length > mappedIndexes.size && ` · ${headers.length - mappedIndexes.size} other file column${headers.length - mappedIndexes.size === 1 ? '' : 's'}`}
                  </p>
                </div>
                <div className="map-list">
                  <table className="match-table">
                    <thead>
                      <tr>
                        <th>Template column</th>
                        <th>From file column</th>
                        <th>Check</th>
                      </tr>
                    </thead>
                    <tbody>
                      {template.columns.map((c) => {
                        const n = countsFor(c.key);
                        const missing = mapping[c.key] == null;
                        return (
                          <tr key={c.key} className={missing && c.required ? 'missing' : ''}>
                            <td>
                              <span className={`htype t-${c.type}`}>{TYPE_DEFS[c.type].icon}</span> {c.name}
                              {c.required && <span className="req">*</span>}
                            </td>
                            <td>
                              <select
                                aria-label={`File column for ${c.name}`}
                                value={mapping[c.key] ?? ''}
                                onChange={(e) => {
                                  const v = e.target.value === '' ? null : Number(e.target.value);
                                  // a file column can feed only one template column: take it away from the other one
                                  const next = Object.fromEntries(Object.entries(mapping).map(([k, i]) => [k, i === v && v !== null ? null : i]));
                                  setMapping({ ...next, [c.key]: v });
                                  setHow({ ...how, [c.key]: v === null ? null : 'manual' });
                                }}
                              >
                                <option value="">— not in this file —</option>
                                {headers.map((h, i) => (
                                  <option key={i} value={i}>
                                    {h}
                                  </option>
                                ))}
                              </select>
                              {how[c.key] && <div className="muted small">{HOW_LABEL[how[c.key]!]}</div>}
                            </td>
                            <td className="nowrap">
                              {missing ? (
                                <span className={c.required ? 'tag-bad' : 'tag-soft'}>{c.required ? 'required, missing' : 'not in file'}</span>
                              ) : n.errors || n.warnings ? (
                                <>
                                  {n.errors > 0 && <span className="tag-bad">{n.errors}</span>} {n.warnings > 0 && <span className="tag-warn">{n.warnings}</span>}
                                </>
                              ) : (
                                <span className="tag-good">✓</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {headers.map((h, i) =>
                        mappedIndexes.has(i) ? null : (
                          <tr key={`x${i}`} className="extra">
                            <td className="muted">
                              <i>not in template</i>
                            </td>
                            <td className="muted">{h}</td>
                            <td>
                              {template.allowExtraColumns ? <span className="tag-soft">ignored</span> : <span className="tag-bad">not allowed</span>}
                            </td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <>
                <div className="panel-head">
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={hasHeaderRow}
                      onChange={(e) => {
                        setHasHeaderRow(e.target.checked);
                        setColumns(detectColumns(loaded.parsed, e.target.checked));
                      }}
                    />
                    First row contains column names
                  </label>
                  {errors.columns && <div className="field-error">{errors.columns}</div>}
                </div>
                <div className="map-list">
                  {columns.map((c, ci) => {
                    const ii = included.indexOf(c);
                    const prefix = `columns.${ii}`;
                    const n = countsFor(includedKeys[ii] ?? '');
                    const isSel = ci === selected;
                    return (
                      <div key={c.uid} className={`map-card${c.include ? '' : ' off'}${isSel && c.include ? ' selected' : ''}${ii >= 0 && columnHasErrors(errors, ii) ? ' has-error' : ''}`} onClick={() => setSelected(ci)}>
                        <div className="row gap">
                          <input
                            type="checkbox"
                            aria-label={`Include ${c.name}`}
                            checked={c.include}
                            onChange={(e) => setColumns(columns.map((x, j) => (j === ci ? { ...x, include: e.target.checked } : x)))}
                          />
                          <input
                            className="map-name"
                            aria-label={`Column ${ci + 1} name`}
                            value={c.name}
                            onChange={(e) => setColumns(columns.map((x, j) => (j === ci ? { ...x, name: e.target.value } : x)))}
                          />
                          <select
                            className="map-type"
                            aria-label={`Column ${ci + 1} type`}
                            value={c.type}
                            disabled={!c.include}
                            onChange={(e) => setColumns(columns.map((x, j) => (j === ci ? { ...withType(x, e.target.value as ColumnType) } : x)))}
                          >
                            {COLUMN_TYPES.map((t) => (
                              <option key={t} value={t}>
                                {TYPE_DEFS[t].icon} {TYPE_DEFS[t].label}
                              </option>
                            ))}
                          </select>
                        </div>
                        {c.include && (
                          <>
                            <div className="map-meta">
                              <span className="tag-soft">detected: {TYPE_DEFS[c.detected].label}</span>
                              {n.errors > 0 && <span className="tag-bad">{n.errors} invalid</span>}
                              {n.warnings > 0 && <span className="tag-warn">{n.warnings} warnings</span>}
                              {!n.errors && !n.warnings && <span className="tag-good">all valid</span>}
                              <label className="inline">
                                <input
                                  type="checkbox"
                                  checked={c.required}
                                  onChange={(e) => setColumns(columns.map((x, j) => (j === ci ? { ...x, required: e.target.checked } : x)))}
                                />
                                Required
                              </label>
                              {c.type === 'multiselect' && (
                                <select
                                  aria-label={`Column ${ci + 1} delimiter`}
                                  value={c.delimiter}
                                  onChange={(e) => setColumns(columns.map((x, j) => (j === ci ? { ...x, delimiter: e.target.value } : x)))}
                                >
                                  {DELIMITERS.filter((d) => (MULTI_DELIMITERS as readonly string[]).includes(d.value)).map((d) => (
                                    <option key={d.value} value={d.value}>
                                      split by {d.label}
                                    </option>
                                  ))}
                                </select>
                              )}
                              <button className="chip rules-chip" onClick={() => setSelected(ci)}>
                                {c.rules.length ? `${c.rules.length} rule${c.rules.length === 1 ? '' : 's'}` : '+ Add rule'}
                              </button>
                            </div>
                            {(errors[`${prefix}.name`] ?? errors[`${prefix}.key`]) && (
                              <span className="field-error">{errors[`${prefix}.name`] ?? errors[`${prefix}.key`]}</span>
                            )}
                            {isSel && (
                              <div className="inline-rules" onClick={(e) => e.stopPropagation()}>
                                <RulesPanel
                                  column={c}
                                  prefix={prefix}
                                  errors={errors}
                                  onChange={(rules) => setColumns(columns.map((x, j) => (j === ci ? { ...x, rules } : x)))}
                                />
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </section>

          <section className="preview-panel">
            <div className="preview-head">
              {!loaded.validUtf8 && (
                <div className="alert error mb-s">
                  This file isn't valid UTF-8 (some characters couldn't be read). It will fail after upload. In Excel use File → Save As →
                  "CSV UTF-8", then choose the new file.
                </div>
              )}
              {result && (
                <div className={`alert ${result.errorCount ? 'warn' : result.warningCount ? 'warn' : 'ok'}${stale ? ' stale' : ''}`} data-testid="precheck">
                  <strong>Pre-check of all {result.totalRows.toLocaleString()} rows:</strong>{' '}
                  {result.errorCount === 0 && result.warningCount === 0
                    ? 'no problems found.'
                    : `${result.errorCount.toLocaleString()} error${result.errorCount === 1 ? '' : 's'} in ${result.invalidRowCount.toLocaleString()} row${result.invalidRowCount === 1 ? '' : 's'} · ${result.warningCount.toLocaleString()} warning${result.warningCount === 1 ? '' : 's'}.`}
                  {result.errorCount > 0 && ' You can still upload: the full error report is available after validation.'}
                  {fileLevel.length > 0 && (
                    <ul className="issue-list">
                      {fileLevel.slice(0, 5).map((i, k) => (
                        <li key={k} className={i.severity}>
                          {i.message}
                        </li>
                      ))}
                      {fileLevel.length > 5 && <li>…and {fileLevel.length - 5} more</li>}
                    </ul>
                  )}
                </div>
              )}
              <div className="muted small mt-s">
                Preview · first {Math.min(PREVIEW_ROWS, body.length)} of {body.length.toLocaleString()} rows, shown with the {mode === 'template' ? "template's" : 'chosen'} types.{' '}
                <span className="legend bad">◤</span> error <span className="legend warn">◤</span> warning. Hover a cell for the reason.
              </div>
            </div>
            <div className="preview-scroll">
              <table className="preview-table">
                <thead>
                  <tr>
                    <th className="rn-th">#</th>
                    {previewCols.map((c) => (
                      <th key={c.key} className={c.sourceIndex === null ? 'missing' : ''}>
                        <span className={`htype t-${c.type}`}>{TYPE_DEFS[c.type].icon}</span> {c.name}
                        {c.required && <span className="req">*</span>}
                        {c.sourceIndex === null && <span className="muted small"> (not in file)</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {body.slice(0, PREVIEW_ROWS).map((cells, ri) => {
                    const rowIssue = rowIssues.get(ri + 1);
                    return (
                      <tr key={ri}>
                        <td className={`rn-th${rowIssue ? ` row-${rowIssue.severity}` : ''}`} title={rowIssue?.message}>
                          {ri + 1}
                        </td>
                        {previewCols.map((c) => {
                          const raw = c.sourceIndex === null ? '' : cells[c.sourceIndex] ?? '';
                          const issue = cellIssues.get(`${ri + 1}:${c.key}`);
                          return (
                            <td
                              key={c.key}
                              className={`${issue ? (issue.severity === 'error' ? 'invalid' : 'warn') : ''}${c.type === 'number' || c.type === 'integer' ? ' right' : ''}`}
                              title={issue?.message}
                            >
                              <CellView value={fromText(raw, c.spec)} column={c.spec} />
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <div className="upload-foot">
          <button className="btn ghost" onClick={reset}>
            ← Choose another file
          </button>
          <div className="row gap">
            {error && <span className="alert error slim">{error}</span>}
            {attempted && Object.keys(clientErrors).length > 0 && (
              <span className="alert error slim">Fix the highlighted problems in the column settings first.</span>
            )}
            <button className="btn primary" onClick={submit} disabled={busy || (mode === 'adhoc' && included.length === 0)}>
              {busy ? 'Uploading…' : 'Upload & validate →'}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

/** One draft column per file column, with the detected type (and delimiter for multi-value lists). */
function detectColumns(parsed: ParsedFile, hasHeaderRow: boolean): AdhocColumn[] {
  const { headers, body } = splitRows(parsed.rows, hasHeaderRow);
  return headers.map((h, i) => {
    const det = detectType(body.map((r) => r[i] ?? ''));
    return {
      ...newColumn(h, det.type),
      delimiter: det.delimiter,
      include: true,
      sourceIndex: i,
      detected: det.type,
    };
  });
}

function Steps({ step }: { step: 1 | 2 }) {
  return (
    <div className="steps">
      <span className={`step ${step === 1 ? 'on' : 'done'}`}>{step === 1 ? '1' : '✓'} Template &amp; file</span>
      <span className="step-line" />
      <span className={`step ${step === 2 ? 'on' : ''}`}>2 Map &amp; check</span>
      <span className="step-line" />
      <span className="step">3 Results</span>
    </div>
  );
}
