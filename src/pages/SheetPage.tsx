import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CellValue, Column, ColumnType, Dataset, Row, Session } from '../types';
import {
  DELIMITERS,
  TYPE_DEFS,
  TYPE_ORDER,
  compareCells,
  convertValue,
  emptyValue,
  isEmptyValue,
  toText,
  validateCell,
} from '../lib/columnTypes';
import { datasetKey, fullKey, loadDataset, saveDataset } from '../lib/storage';
import { downloadText, toCsv } from '../lib/csv';
import { uid } from '../lib/id';
import { navigate } from '../router';
import { TopBar } from '../components/TopBar';
import { Popover } from '../components/Popover';
import { Grid, selRange, type CellPatch, type Selection, type SortState } from '../components/Grid';

interface Snapshot {
  columns: Column[];
  rows: Row[];
}
interface History {
  past: Snapshot[];
  present: Snapshot;
  future: Snapshot[];
}
type SaveState = 'saved' | 'saving' | 'error';

const HISTORY_LIMIT = 100;

const blankRow = (columns: Column[], values: Record<string, CellValue> = {}): Row => ({
  id: uid('r_'),
  values: Object.fromEntries(columns.map((c) => [c.id, values[c.id] ?? emptyValue(c)])),
});

export function SheetPage({ id, session, onLogout }: { id: string; session: Session; onLogout: () => void }) {
  const [initial] = useState(() => {
    const ds = loadDataset(id);
    return ds && ds.ownerId === session.userId ? ds : null;
  });

  if (!initial) {
    return (
      <div className="page">
        <TopBar session={session} onLogout={onLogout} />
        <main className="container">
          <div className="empty-card">
            <h3>Dataset not found</h3>
            <p className="muted">It may have been deleted, or it belongs to another account.</p>
            <button className="btn primary" onClick={() => navigate('/')}>
              Back to datasets
            </button>
          </div>
        </main>
      </div>
    );
  }
  return <Sheet initial={initial} session={session} onLogout={onLogout} />;
}

function Sheet({ initial, session, onLogout }: { initial: Dataset; session: Session; onLogout: () => void }) {
  const [hist, setHist] = useState<History>({
    past: [],
    present: { columns: initial.columns, rows: initial.rows },
    future: [],
  });
  const [name, setName] = useState(initial.name);
  const [rev, setRev] = useState(0); // bumps on every *local* change -> triggers autosave
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [selection, setSelection] = useState<Selection>({ anchor: { r: 0, c: 0 }, focus: { r: 0, c: 0 } });
  const [sort, setSort] = useState<SortState | null>(null);
  const [query, setQuery] = useState('');
  const [issuesOnly, setIssuesOnly] = useState(false);
  const [colMenu, setColMenu] = useState<{ colId: string; x: number; y: number } | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [toast, setToast] = useState('');

  const { columns, rows } = hist.present;

  // ---------- state transitions ----------
  const apply = useCallback((fn: (s: Snapshot) => Snapshot) => {
    setHist((h) => {
      const next = fn(h.present);
      if (next === h.present) return h;
      return { past: [...h.past.slice(-(HISTORY_LIMIT - 1)), h.present], present: next, future: [] };
    });
    setRev((r) => r + 1);
  }, []);

  /** Changes that shouldn't clutter undo history (e.g. column widths). */
  const applySilently = useCallback((fn: (s: Snapshot) => Snapshot) => {
    setHist((h) => ({ ...h, present: fn(h.present) }));
    setRev((r) => r + 1);
  }, []);

  const undo = useCallback(() => {
    setHist((h) =>
      h.past.length
        ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] }
        : h,
    );
    setRev((r) => r + 1);
  }, []);

  const redo = useCallback(() => {
    setHist((h) =>
      h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h,
    );
    setRev((r) => r + 1);
  }, []);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? '' : t)), 2600);
  }, []);

  // ---------- persistence (debounced autosave to localStorage) ----------
  const latest = useRef({ hist, name });
  latest.current = { hist, name };
  const dirty = useRef(false);

  const persist = useCallback(() => {
    const { hist: h, name: n } = latest.current;
    try {
      saveDataset({
        ...initial,
        name: n.trim() || 'Untitled',
        updatedAt: Date.now(),
        columns: h.present.columns,
        rows: h.present.rows,
      });
      dirty.current = false;
      setSaveState('saved');
    } catch (e) {
      setSaveState('error');
      flash(e instanceof Error ? e.message : 'Could not save');
    }
  }, [initial, flash]);

  useEffect(() => {
    if (rev === 0) return;
    dirty.current = true;
    setSaveState('saving');
    const t = window.setTimeout(persist, 300);
    return () => window.clearTimeout(t);
  }, [rev, persist]);

  useEffect(() => {
    const flush = () => dirty.current && persist();
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      flush();
    };
  }, [persist]);

  // ---------- real-time sync with other tabs ----------
  useEffect(() => {
    const key = fullKey(datasetKey(initial.id));
    const onStorage = (e: StorageEvent) => {
      if (e.key !== key) return;
      if (!e.newValue) {
        alert('This dataset was deleted in another tab.');
        navigate('/');
        return;
      }
      try {
        const remote = JSON.parse(e.newValue) as Dataset;
        setHist((h) => ({ ...h, present: { columns: remote.columns, rows: remote.rows } }));
        setName(remote.name);
        flash('Synced changes from another tab');
      } catch {
        /* ignore malformed */
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [initial.id, flash]);

  // ---------- derived view (search / issues filter / sort) ----------
  const issueCount = useMemo(() => {
    let n = 0;
    for (const r of rows) for (const c of columns) if (validateCell(r.values[c.id], c)) n++;
    return n;
  }, [rows, columns]);

  const viewRows = useMemo(() => {
    let list = rows;
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((r) => columns.some((c) => toText(r.values[c.id], c).toLowerCase().includes(q)));
    if (issuesOnly) list = list.filter((r) => columns.some((c) => validateCell(r.values[c.id], c)));
    if (sort) {
      const col = columns.find((c) => c.id === sort.colId);
      if (col) {
        const dir = sort.dir === 'asc' ? 1 : -1;
        list = [...list].sort((a, b) => {
          const ea = isEmptyValue(a.values[col.id]);
          const eb = isEmptyValue(b.values[col.id]);
          if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1; // blanks always last
          return dir * compareCells(a.values[col.id], b.values[col.id], col);
        });
      }
    }
    return list;
  }, [rows, columns, query, issuesOnly, sort]);

  // Keep the selection inside the grid when rows/columns shrink
  useEffect(() => {
    const maxR = Math.max(0, viewRows.length - 1);
    const maxC = Math.max(0, columns.length - 1);
    setSelection((s) => {
      const fix = (p: { r: number; c: number }) => ({ r: Math.min(p.r, maxR), c: Math.min(p.c, maxC) });
      const a = fix(s.anchor);
      const f = fix(s.focus);
      return a.r === s.anchor.r && a.c === s.anchor.c && f.r === s.focus.r && f.c === s.focus.c ? s : { anchor: a, focus: f };
    });
  }, [viewRows.length, columns.length]);

  const { r0, r1 } = selRange(selection);
  const selectedRowIds = viewRows.slice(r0, r1 + 1).map((r) => r.id);

  // ---------- operations ----------
  const setCells = useCallback(
    (patches: CellPatch[], append?: Record<string, CellValue>[]) => {
      if (!patches.length && !append?.length) return;
      apply((s) => {
        const byRow = new Map<string, CellPatch[]>();
        for (const p of patches) byRow.set(p.rowId, [...(byRow.get(p.rowId) ?? []), p]);
        let next = s.rows.map((r) => {
          const ps = byRow.get(r.id);
          if (!ps) return r;
          const values = { ...r.values };
          for (const p of ps) values[p.colId] = p.value;
          return { ...r, values };
        });
        if (append?.length) next = [...next, ...append.map((v) => blankRow(s.columns, v ?? {}))];
        return { ...s, rows: next };
      });
    },
    [apply],
  );

  const insertRows = (where: 'above' | 'below' | 'end', count = 1) => {
    const anchorId = where === 'above' ? selectedRowIds[0] : selectedRowIds[selectedRowIds.length - 1];
    apply((s) => {
      const fresh = Array.from({ length: count }, () => blankRow(s.columns));
      if (where === 'end' || !anchorId) return { ...s, rows: [...s.rows, ...fresh] };
      const idx = s.rows.findIndex((r) => r.id === anchorId);
      const at = where === 'above' ? idx : idx + 1;
      return { ...s, rows: [...s.rows.slice(0, at), ...fresh, ...s.rows.slice(at)] };
    });
    if (where === 'end') {
      const r = viewRows.length;
      setSelection({ anchor: { r, c: 0 }, focus: { r, c: 0 } });
    }
  };

  const duplicateRows = () => {
    const ids = new Set(selectedRowIds);
    apply((s) => {
      const out: Row[] = [];
      for (const r of s.rows) {
        out.push(r);
        if (ids.has(r.id)) out.push({ id: uid('r_'), values: { ...r.values } });
      }
      return { ...s, rows: out };
    });
  };

  const deleteRows = () => {
    if (!selectedRowIds.length) return;
    const ids = new Set(selectedRowIds);
    apply((s) => ({ ...s, rows: s.rows.filter((r) => !ids.has(r.id)) }));
    flash(`Deleted ${ids.size} row${ids.size > 1 ? 's' : ''} · ⌘Z to undo`);
  };

  const insertColumn = (at: number) => {
    const col: Column = {
      id: uid('c_'),
      name: `Column ${columns.length + 1}`,
      type: 'text',
      delimiter: ',',
      width: 160,
      required: false,
    };
    apply((s) => ({
      columns: [...s.columns.slice(0, at), col, ...s.columns.slice(at)],
      rows: s.rows.map((r) => ({ ...r, values: { ...r.values, [col.id]: '' } })),
    }));
    setSelection({ anchor: { r: 0, c: at }, focus: { r: 0, c: at } });
  };

  const deleteColumn = (colId: string) => {
    apply((s) => ({
      columns: s.columns.filter((c) => c.id !== colId),
      rows: s.rows.map((r) => {
        const { [colId]: _drop, ...rest } = r.values;
        return { ...r, values: rest };
      }),
    }));
    if (sort?.colId === colId) setSort(null);
  };

  const updateColumn = (colId: string, patch: Partial<Column>) => {
    apply((s) => {
      const old = s.columns.find((c) => c.id === colId);
      if (!old) return s;
      const next = { ...old, ...patch };
      const reshape = old.type !== next.type || old.delimiter !== next.delimiter;
      return {
        columns: s.columns.map((c) => (c.id === colId ? next : c)),
        rows: reshape
          ? s.rows.map((r) => ({ ...r, values: { ...r.values, [colId]: convertValue(r.values[colId] ?? '', old, next) } }))
          : s.rows,
      };
    });
  };

  const resizeColumn = useCallback(
    (colId: string, width: number) =>
      applySilently((s) => ({ ...s, columns: s.columns.map((c) => (c.id === colId ? { ...c, width } : c)) })),
    [applySilently],
  );

  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const getSuggestions = useCallback((colId: string) => {
    const freq = new Map<string, number>();
    for (const r of rowsRef.current) {
      const v = r.values[colId];
      const items = Array.isArray(v) ? v : v ? [v] : [];
      for (const t of items) freq.set(t, (freq.get(t) ?? 0) + 1);
    }
    return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 300).map(([k]) => k);
  }, []);

  const exportCsv = () => downloadText(`${name.trim() || 'dataset'}.csv`, toCsv(columns, rows));

  const menuCol = colMenu ? columns.find((c) => c.id === colMenu.colId) : undefined;
  const menuColIndex = menuCol ? columns.indexOf(menuCol) : -1;

  return (
    <div className="sheet-page">
      <TopBar session={session} onLogout={onLogout}>
        <input
          className="title-input"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setRev((r) => r + 1);
          }}
          aria-label="Dataset name"
        />
        <span className={`save-state ${saveState}`}>
          {saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Not saved' : 'All changes saved'}
        </span>
      </TopBar>

      <div className="ribbon">
        <button className="btn ghost sm" onClick={() => navigate('/')}>
          ← Datasets
        </button>
        <span className="sep" />
        <button className="btn icon" onClick={undo} disabled={!hist.past.length} title="Undo (⌘Z)">
          ↶
        </button>
        <button className="btn icon" onClick={redo} disabled={!hist.future.length} title="Redo (⌘⇧Z)">
          ↷
        </button>
        <span className="sep" />
        <button className="btn sm" onClick={() => insertRows('end')}>
          + Row
        </button>
        <button className="btn sm" onClick={() => insertColumn(columns.length)}>
          + Column
        </button>
        <button className="btn sm" onClick={deleteRows} disabled={!viewRows.length} title="Delete selected rows">
          Delete {selectedRowIds.length > 1 ? `${selectedRowIds.length} rows` : 'row'}
        </button>
        <span className="sep" />
        <div className="search">
          <span>⌕</span>
          <input placeholder="Search all cells…" value={query} onChange={(e) => setQuery(e.target.value)} />
          {query && (
            <button className="linklike" onClick={() => setQuery('')} aria-label="Clear search">
              ×
            </button>
          )}
        </div>
        <button
          className={`btn sm${issuesOnly ? ' toggled' : ''}${issueCount ? ' warn' : ''}`}
          onClick={() => setIssuesOnly(!issuesOnly)}
          title="Show only rows with invalid cells"
        >
          ⚠ {issueCount} issue{issueCount === 1 ? '' : 's'}
        </button>
        {sort && (
          <button className="btn sm toggled" onClick={() => setSort(null)}>
            Sorted by {columns.find((c) => c.id === sort.colId)?.name} {sort.dir === 'asc' ? '↑' : '↓'} ×
          </button>
        )}
        <span className="grow-space" />
        <button className="btn sm primary" onClick={exportCsv}>
          ⇩ Export CSV
        </button>
      </div>

      <Grid
        columns={columns}
        rows={viewRows}
        totalRows={rows.length}
        issueCount={issueCount}
        selection={selection}
        onSelectionChange={setSelection}
        sort={sort}
        onSetCells={setCells}
        onColumnMenu={(c, x, y) => columns[c] && setColMenu({ colId: columns[c].id, x, y })}
        onContextMenu={(x, y) => setCtxMenu({ x, y })}
        onResizeColumn={resizeColumn}
        onUndo={undo}
        onRedo={redo}
        getSuggestions={getSuggestions}
      />

      {colMenu && menuCol && (
        <Popover x={colMenu.x} y={colMenu.y} onClose={() => setColMenu(null)}>
          <div className="menu col-menu">
            <label className="field compact">
              <span>Column name</span>
              <input
                key={menuCol.id}
                defaultValue={menuCol.name}
                autoFocus
                onBlur={(e) => e.target.value.trim() && e.target.value !== menuCol.name && updateColumn(menuCol.id, { name: e.target.value.trim() })}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
            </label>
            <label className="field compact">
              <span>Type</span>
              <select value={menuCol.type} onChange={(e) => updateColumn(menuCol.id, { type: e.target.value as ColumnType })}>
                {TYPE_ORDER.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_DEFS[t].icon}  {TYPE_DEFS[t].label}
                  </option>
                ))}
              </select>
            </label>
            {menuCol.type === 'multiselect' && (
              <label className="field compact">
                <span>Split values by</span>
                <select value={menuCol.delimiter} onChange={(e) => updateColumn(menuCol.id, { delimiter: e.target.value })}>
                  {DELIMITERS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="check">
              <input type="checkbox" checked={menuCol.required} onChange={(e) => updateColumn(menuCol.id, { required: e.target.checked })} />
              Required (flag empty cells)
            </label>
            <div className="menu-sep" />
            <button className="menu-item" onClick={() => { setSort({ colId: menuCol.id, dir: 'asc' }); setColMenu(null); }}>
              ↑ Sort A → Z
            </button>
            <button className="menu-item" onClick={() => { setSort({ colId: menuCol.id, dir: 'desc' }); setColMenu(null); }}>
              ↓ Sort Z → A
            </button>
            <div className="menu-sep" />
            <button className="menu-item" onClick={() => { insertColumn(menuColIndex); setColMenu(null); }}>
              ⇤ Insert column left
            </button>
            <button className="menu-item" onClick={() => { insertColumn(menuColIndex + 1); setColMenu(null); }}>
              ⇥ Insert column right
            </button>
            <button
              className="menu-item danger"
              onClick={() => {
                deleteColumn(menuCol.id);
                setColMenu(null);
                flash(`Deleted column "${menuCol.name}" · ⌘Z to undo`);
              }}
            >
              🗑 Delete column
            </button>
          </div>
        </Popover>
      )}

      {ctxMenu && (
        <Popover x={ctxMenu.x} y={ctxMenu.y} onClose={() => setCtxMenu(null)}>
          <div className="menu">
            {[
              ['Insert row above', () => insertRows('above')],
              ['Insert row below', () => insertRows('below')],
              [`Duplicate ${selectedRowIds.length > 1 ? `${selectedRowIds.length} rows` : 'row'}`, duplicateRows],
              ['Clear selected cells', () => {
                const { c0, c1 } = selRange(selection);
                const patches: CellPatch[] = [];
                for (const rowId of selectedRowIds)
                  for (const col of columns.slice(c0, c1 + 1)) patches.push({ rowId, colId: col.id, value: emptyValue(col) });
                setCells(patches);
              }],
            ].map(([label, fn]) => (
              <button
                key={label as string}
                className="menu-item"
                onClick={() => {
                  (fn as () => void)();
                  setCtxMenu(null);
                }}
              >
                {label as string}
              </button>
            ))}
            <div className="menu-sep" />
            <button
              className="menu-item danger"
              onClick={() => {
                deleteRows();
                setCtxMenu(null);
              }}
            >
              Delete {selectedRowIds.length > 1 ? `${selectedRowIds.length} rows` : 'row'}
            </button>
          </div>
        </Popover>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
