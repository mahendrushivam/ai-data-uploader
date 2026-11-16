import { useEffect, useMemo, useRef, useState } from 'react';
import type { Column, ColumnType, Dataset, Row, Session } from '../types';
import { DELIMITERS, TYPE_DEFS, TYPE_ORDER, detectType, fromText, isEmptyValue, validateCell } from '../lib/columnTypes';
import { parseCsvFile, parseCsvText } from '../lib/csv';
import { buildSampleCsv } from '../lib/sample';
import { saveDataset } from '../lib/storage';
import { uid } from '../lib/id';
import { navigate } from '../router';
import { TopBar } from '../components/TopBar';
import { CellView } from '../components/CellView';

interface Mapping {
  id: string;
  index: number;
  include: boolean;
  name: string;
  type: ColumnType;
  delimiter: string;
  required: boolean;
  detected: ColumnType;
}

interface Parsed {
  fileName: string;
  data: string[][];
  errors: string[];
}

const PREVIEW_ROWS = 30;
const MAX_FILE_MB = 20;

function dedupe(names: string[]) {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const k = n.toLowerCase();
    const count = seen.get(k) ?? 0;
    seen.set(k, count + 1);
    return count ? `${n} (${count + 1})` : n;
  });
}

const toColumn = (m: Mapping, width = 160): Column => ({
  id: m.id,
  name: m.name.trim() || `Column ${m.index + 1}`,
  type: m.type,
  delimiter: m.delimiter,
  width,
  required: m.required,
});

export function UploadPage({ session, onLogout, sample }: { session: Session; onLogout: () => void; sample: boolean }) {
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [hasHeader, setHasHeader] = useState(true);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (sample) {
      const res = parseCsvText(buildSampleCsv());
      setParsed({ fileName: 'ml-review-sample.csv', data: res.data, errors: res.errors });
      setName('ML review sample');
    }
  }, [sample]);

  const { headers, body } = useMemo(() => {
    if (!parsed) return { headers: [] as string[], body: [] as string[][] };
    const width = parsed.data.reduce((w, r) => Math.max(w, r.length), 0);
    const first = hasHeader ? parsed.data[0] ?? [] : [];
    return {
      headers: dedupe(Array.from({ length: width }, (_, i) => (first[i] ?? '').trim() || `Column ${i + 1}`)),
      body: hasHeader ? parsed.data.slice(1) : parsed.data,
    };
  }, [parsed, hasHeader]);

  // Auto-detect a type for every column whenever the source changes
  useEffect(() => {
    setMappings(
      headers.map((h, i) => {
        const det = detectType(body.map((r) => r[i] ?? ''));
        return {
          id: uid('c_'),
          index: i,
          include: true,
          name: h,
          type: det.type,
          delimiter: det.delimiter,
          required: false,
          detected: det.type,
        };
      }),
    );
  }, [headers, body]);

  const stats = useMemo(
    () =>
      mappings.map((m) => {
        const col = toColumn(m);
        let invalid = 0;
        let empty = 0;
        for (const r of body) {
          const v = fromText(r[m.index] ?? '', col);
          if (isEmptyValue(v)) empty++;
          if (validateCell(v, col)) invalid++;
        }
        return { invalid, empty };
      }),
    [mappings, body],
  );

  const raggedRows = useMemo(() => body.filter((r) => r.length !== headers.length).length, [body, headers]);

  const update = (id: string, patch: Partial<Mapping>) =>
    setMappings((ms) => ms.map((m) => (m.id === id ? { ...m, ...patch } : m)));

  const handleFile = async (file: File) => {
    setError('');
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      setError(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. Browser storage only holds ~5 MB, so keep uploads under ${MAX_FILE_MB} MB for now.`);
      return;
    }
    setBusy(true);
    try {
      const res = await parseCsvFile(file);
      if (!res.data.length) throw new Error('The file appears to be empty.');
      setParsed({ fileName: file.name, data: res.data, errors: res.errors });
      setName(file.name.replace(/\.[^.]+$/, ''));
    } catch (e) {
      setError(`Could not read the file: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const doImport = () => {
    setError('');
    const included = mappings.filter((m) => m.include);
    if (!included.length) {
      setError('Include at least one column.');
      return;
    }
    const columns = included.map((m) => {
      const sampleLen =
        body.slice(0, 50).reduce((n, r) => n + Math.min((r[m.index] ?? '').length, 40), 0) / Math.max(1, Math.min(50, body.length));
      const width = Math.round(Math.min(320, Math.max(100, Math.max(m.name.length + 6, sampleLen) * 7.5 + 32)));
      return toColumn(m, width);
    });
    const rows: Row[] = body.map((r) => ({
      id: uid('r_'),
      values: Object.fromEntries(columns.map((c, k) => [c.id, fromText(r[included[k].index] ?? '', c)])),
    }));
    const now = Date.now();
    const ds: Dataset = {
      id: uid('d_'),
      ownerId: session.userId,
      name: name.trim() || parsed?.fileName || 'Untitled',
      fileName: parsed?.fileName ?? '',
      createdAt: now,
      updatedAt: now,
      rowCount: rows.length,
      columnCount: columns.length,
      columns,
      rows,
    };
    try {
      saveDataset(ds);
      navigate(`/sheet/${ds.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const includedMappings = mappings.filter((m) => m.include);
  const totalInvalid = mappings.reduce((n, m, i) => n + (m.include ? stats[i]?.invalid ?? 0 : 0), 0);

  return (
    <div className="page">
      <TopBar session={session} onLogout={onLogout} />
      <main className="container wide">
        <div className="steps">
          <span className={`step${!parsed ? ' on' : ' done'}`}>1 · Upload</span>
          <span className="step-line" />
          <span className={`step${parsed ? ' on' : ''}`}>2 · Map columns</span>
          <span className="step-line" />
          <span className="step">3 · Review in grid</span>
        </div>

        {!parsed && (
          <>
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
              <h2>{busy ? 'Reading file…' : 'Drop a CSV file here'}</h2>
              <p className="muted">or click to browse · .csv, .tsv and .txt · delimiter is detected automatically</p>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.tsv,.txt,text/csv"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                  e.target.value = '';
                }}
              />
            </div>
            <div className="row center gap mt">
              <button className="btn" onClick={() => navigate('/upload/sample')}>
                Use sample ML review dataset
              </button>
              <button className="btn ghost" onClick={() => navigate('/')}>
                Cancel
              </button>
            </div>
            {error && <div className="alert error mt">{error}</div>}
          </>
        )}

        {parsed && (
          <div className="map-layout">
            <section className="map-panel">
              <div className="panel-head">
                <label className="field compact">
                  <span>Dataset name</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} />
                </label>
                <div className="file-pill">
                  ▦ {parsed.fileName} · {body.length.toLocaleString()} rows · {headers.length} columns
                </div>
                <label className="check">
                  <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />
                  First row contains column names
                </label>
                {(parsed.errors.length > 0 || raggedRows > 0) && (
                  <div className="alert warn">
                    {raggedRows > 0 && <div>{raggedRows} row(s) have a different number of cells than the header — missing cells are left empty.</div>}
                    {parsed.errors.map((e, i) => (
                      <div key={i}>{e}</div>
                    ))}
                  </div>
                )}
              </div>

              <div className="map-list">
                {mappings.map((m, i) => (
                  <div key={m.id} className={`map-card${m.include ? '' : ' off'}`}>
                    <div className="row gap">
                      <input
                        type="checkbox"
                        checked={m.include}
                        onChange={(e) => update(m.id, { include: e.target.checked })}
                        title="Include this column"
                      />
                      <input className="map-name" value={m.name} onChange={(e) => update(m.id, { name: e.target.value })} />
                      <select
                        className="map-type"
                        value={m.type}
                        onChange={(e) => update(m.id, { type: e.target.value as ColumnType })}
                        disabled={!m.include}
                      >
                        {TYPE_ORDER.map((t) => (
                          <option key={t} value={t}>
                            {TYPE_DEFS[t].icon}  {TYPE_DEFS[t].label}
                          </option>
                        ))}
                      </select>
                    </div>
                    {m.include && (
                      <>
                        <div className="map-meta">
                          <span className="tag-soft">detected: {TYPE_DEFS[m.detected].label}</span>
                          {stats[i]?.invalid ? (
                            <span className="tag-bad">{stats[i].invalid} invalid</span>
                          ) : (
                            <span className="tag-good">all valid</span>
                          )}
                          {stats[i]?.empty ? <span className="tag-soft">{stats[i].empty} empty</span> : null}
                        </div>
                        <div className="row gap wrap">
                          {m.type === 'multiselect' && (
                            <label className="inline">
                              Split values by
                              <select value={m.delimiter} onChange={(e) => update(m.id, { delimiter: e.target.value })}>
                                {DELIMITERS.map((d) => (
                                  <option key={d.value} value={d.value}>
                                    {d.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                          )}
                          <label className="inline">
                            <input type="checkbox" checked={m.required} onChange={(e) => update(m.id, { required: e.target.checked })} />
                            Required
                          </label>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>

              <div className="panel-foot">
                {error && <div className="alert error">{error}</div>}
                <div className="row between">
                  <button className="btn ghost" onClick={() => { setParsed(null); navigate('/upload'); }}>
                    ← Choose another file
                  </button>
                  <button className="btn primary" onClick={doImport} disabled={!includedMappings.length}>
                    Import {body.length.toLocaleString()} rows →
                  </button>
                </div>
                {totalInvalid > 0 && (
                  <p className="muted small">
                    {totalInvalid} cell(s) don't match their type. They'll be imported as-is and flagged in red so you can fix them in the grid.
                  </p>
                )}
              </div>
            </section>

            <section className="preview-panel">
              <div className="preview-head">
                Preview <span className="muted">· first {Math.min(PREVIEW_ROWS, body.length)} rows, rendered with the mapped types</span>
              </div>
              <div className="preview-scroll">
                <table className="preview-table">
                  <thead>
                    <tr>
                      <th className="rn-th">#</th>
                      {includedMappings.map((m) => (
                        <th key={m.id}>
                          <span className={`htype t-${m.type}`}>{TYPE_DEFS[m.type].icon}</span> {m.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {body.slice(0, PREVIEW_ROWS).map((r, ri) => (
                      <tr key={ri}>
                        <td className="rn-th">{ri + 1}</td>
                        {includedMappings.map((m) => {
                          const col = toColumn(m);
                          const v = fromText(r[m.index] ?? '', col);
                          const err = validateCell(v, col);
                          return (
                            <td
                              key={m.id}
                              className={`${err ? 'invalid' : ''}${m.type === 'number' || m.type === 'integer' ? ' right' : ''}`}
                              title={err ?? undefined}
                            >
                              <CellView value={v} column={col} />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
