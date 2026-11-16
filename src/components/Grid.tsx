import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CellValue, Column, Row } from '../types';
import {
  TYPE_DEFS,
  emptyValue,
  fromText,
  isEmptyValue,
  parseBool,
  parseNumber,
  sameValue,
  toText,
  validateCell,
} from '../lib/columnTypes';
import { CellView } from './CellView';
import { CellEditor, type Move } from './CellEditor';

export const ROW_H = 30;
export const HEAD_H = 34;
export const RN_W = 56;
const OVERSCAN = 8;

export interface Pos {
  r: number;
  c: number;
}
export interface Selection {
  anchor: Pos;
  focus: Pos;
}
export interface CellPatch {
  rowId: string;
  colId: string;
  value: CellValue;
}
export interface SortState {
  colId: string;
  dir: 'asc' | 'desc';
}

export function selRange(sel: Selection) {
  return {
    r0: Math.min(sel.anchor.r, sel.focus.r),
    r1: Math.max(sel.anchor.r, sel.focus.r),
    c0: Math.min(sel.anchor.c, sel.focus.c),
    c1: Math.max(sel.anchor.c, sel.focus.c),
  };
}

export function colLetter(i: number): string {
  let s = '';
  let n = i + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

interface Props {
  columns: Column[];
  rows: Row[];
  totalRows: number;
  issueCount: number;
  selection: Selection;
  onSelectionChange: (sel: Selection) => void;
  sort: SortState | null;
  onSetCells: (patches: CellPatch[], appendRows?: Record<string, CellValue>[]) => void;
  onColumnMenu: (colIndex: number, x: number, y: number) => void;
  onContextMenu: (x: number, y: number) => void;
  onResizeColumn: (colId: string, width: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  getSuggestions: (colId: string) => string[];
}

export function Grid(props: Props) {
  const { columns, rows, selection, onSelectionChange, onSetCells, sort } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [vp, setVp] = useState({ top: 0, height: 800 });
  const [editing, setEditing] = useState<{ r: number; c: number; initialText?: string } | null>(null);
  const dragging = useRef(false);

  const nRows = rows.length;
  const nCols = columns.length;
  const { r0, r1, c0, c1 } = selRange(selection);
  const focus = selection.focus;
  const multi = r0 !== r1 || c0 !== c1;

  const layout = useMemo(() => {
    const lefts: number[] = [];
    let x = 0;
    for (const c of columns) {
      lefts.push(x);
      x += c.width;
    }
    return { lefts, total: x };
  }, [columns]);

  // ----- viewport tracking (virtualised rows) -----
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setVp({ top: el.scrollTop, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    scrollRef.current?.focus({ preventScroll: true });
    const up = () => (dragging.current = false);
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  // Close editor if the underlying row disappears (filter/undo/remote sync)
  useEffect(() => {
    if (editing && (editing.r >= nRows || editing.c >= nCols)) setEditing(null);
  }, [editing, nRows, nCols]);

  // ----- keep the active cell visible -----
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !nRows || !nCols) return;
    const { r, c } = focus;
    const y = HEAD_H + r * ROW_H;
    if (y < el.scrollTop + HEAD_H) el.scrollTop = r * ROW_H;
    else if (y + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = y + ROW_H - el.clientHeight;
    const left = layout.lefts[c] ?? 0;
    const w = columns[c]?.width ?? 0;
    if (RN_W + left < el.scrollLeft + RN_W) el.scrollLeft = left;
    else if (RN_W + left + w > el.scrollLeft + el.clientWidth) el.scrollLeft = RN_W + left + w - el.clientWidth;
  }, [focus.r, focus.c]); // eslint-disable-line react-hooks/exhaustive-deps

  const focusGrid = useCallback(() => scrollRef.current?.focus({ preventScroll: true }), []);

  const clamp = useCallback(
    (p: Pos): Pos => ({
      r: Math.max(0, Math.min(nRows - 1, p.r)),
      c: Math.max(0, Math.min(nCols - 1, p.c)),
    }),
    [nRows, nCols],
  );

  const select = (anchor: Pos, focusPos: Pos = anchor) =>
    onSelectionChange({ anchor: clamp(anchor), focus: clamp(focusPos) });

  // ----- edits -----
  const rangePatches = (fn: (row: Row, col: Column) => CellValue | null) => {
    const patches: CellPatch[] = [];
    for (let r = r0; r <= r1; r++) {
      const row = rows[r];
      if (!row) continue;
      for (let c = c0; c <= c1; c++) {
        const col = columns[c];
        if (!col) continue;
        const next = fn(row, col);
        if (next !== null && !sameValue(row.values[col.id], next)) patches.push({ rowId: row.id, colId: col.id, value: next });
      }
    }
    return patches;
  };

  const clearRange = () => onSetCells(rangePatches((_, col) => emptyValue(col)));

  const toggleBooleans = () => {
    const first = rows[focus.r]?.values[columns[focus.c]?.id];
    const target = parseBool(typeof first === 'string' ? first : '') === true ? 'false' : 'true';
    onSetCells(rangePatches((_, col) => (col.type === 'boolean' ? target : null)));
  };

  const toggleCell = (r: number, c: number) => {
    const row = rows[r];
    const col = columns[c];
    if (!row || !col) return;
    const cur = row.values[col.id];
    const next = parseBool(typeof cur === 'string' ? cur : '') === true ? 'false' : 'true';
    onSetCells([{ rowId: row.id, colId: col.id, value: next }]);
  };

  const startEdit = (r: number, c: number, initialText?: string) => {
    const col = columns[c];
    if (!rows[r] || !col) return;
    if (col.type === 'boolean') {
      toggleCell(r, c);
      return;
    }
    setEditing({ r, c, initialText });
  };

  const commitEdit = (value: CellValue, move: Move) => {
    if (!editing) return;
    const row = rows[editing.r];
    const col = columns[editing.c];
    if (row && col && !sameValue(row.values[col.id], value)) {
      onSetCells([{ rowId: row.id, colId: col.id, value }]);
    }
    const { r, c } = editing;
    setEditing(null);
    if (move === 'down') select({ r: r + 1, c });
    else if (move === 'up') select({ r: r - 1, c });
    else if (move === 'right') select({ r, c: c + 1 });
    else if (move === 'left') select({ r, c: c - 1 });
    if (move !== 'none') focusGrid();
  };

  const cancelEdit = () => {
    setEditing(null);
    focusGrid();
  };

  // ----- clipboard (TSV, compatible with Excel / Google Sheets) -----
  const copyText = () => {
    const lines: string[] = [];
    for (let r = r0; r <= r1; r++) {
      const row = rows[r];
      if (!row) continue;
      const cells: string[] = [];
      for (let c = c0; c <= c1; c++) {
        const col = columns[c];
        if (col) cells.push(toText(row.values[col.id], col).replace(/[\t\n\r]+/g, ' '));
      }
      lines.push(cells.join('\t'));
    }
    return lines.join('\n');
  };

  const paste = (text: string) => {
    if (!nCols) return;
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    const matrix = lines.map((l) => l.split('\t'));
    const single = matrix.length === 1 && matrix[0].length === 1;

    if (single && multi) {
      onSetCells(rangePatches((_, col) => fromText(matrix[0][0], col)));
      return;
    }
    const patches: CellPatch[] = [];
    const append: Record<string, CellValue>[] = [];
    let maxW = 0;
    matrix.forEach((cells, i) => {
      maxW = Math.max(maxW, cells.length);
      cells.forEach((raw, j) => {
        const col = columns[c0 + j];
        if (!col) return;
        const value = fromText(raw, col);
        const r = r0 + i;
        if (r < nRows) patches.push({ rowId: rows[r].id, colId: col.id, value });
        else (append[r - nRows] ??= {})[col.id] = value;
      });
    });
    onSetCells(patches, append.length ? append : undefined);
    onSelectionChange({
      anchor: { r: r0, c: c0 },
      focus: { r: r0 + matrix.length - 1, c: Math.min(nCols - 1, c0 + maxW - 1) },
    });
  };

  const handlers = useRef({ copyText, paste, clearRange });
  handlers.current = { copyText, paste, clearRange };

  useEffect(() => {
    const active = () => document.activeElement === scrollRef.current;
    const onCopy = (e: ClipboardEvent) => {
      if (!active()) return;
      e.preventDefault();
      e.clipboardData?.setData('text/plain', handlers.current.copyText());
    };
    const onCut = (e: ClipboardEvent) => {
      if (!active()) return;
      onCopy(e);
      handlers.current.clearRange();
    };
    const onPaste = (e: ClipboardEvent) => {
      if (!active()) return;
      e.preventDefault();
      const text = e.clipboardData?.getData('text/plain');
      if (text) handlers.current.paste(text);
    };
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCut);
    document.addEventListener('paste', onPaste);
    return () => {
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCut);
      document.removeEventListener('paste', onPaste);
    };
  }, []);

  // ----- keyboard -----
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editing || e.target !== scrollRef.current) return;
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key;

    if (mod && key.toLowerCase() === 'z') {
      e.preventDefault();
      e.shiftKey ? props.onRedo() : props.onUndo();
      return;
    }
    if (mod && key.toLowerCase() === 'y') {
      e.preventDefault();
      props.onRedo();
      return;
    }
    if (mod && key.toLowerCase() === 'a') {
      e.preventDefault();
      select({ r: 0, c: 0 }, { r: nRows - 1, c: nCols - 1 });
      return;
    }
    if (!nRows || !nCols) return;

    const go = (target: Pos) => {
      e.preventDefault();
      if (e.shiftKey) select(selection.anchor, target);
      else select(target);
    };
    const page = Math.max(1, Math.floor((vp.height - HEAD_H) / ROW_H) - 1);

    switch (key) {
      case 'ArrowUp':
        return go({ r: mod ? 0 : focus.r - 1, c: focus.c });
      case 'ArrowDown':
        return go({ r: mod ? nRows - 1 : focus.r + 1, c: focus.c });
      case 'ArrowLeft':
        return go({ r: focus.r, c: mod ? 0 : focus.c - 1 });
      case 'ArrowRight':
        return go({ r: focus.r, c: mod ? nCols - 1 : focus.c + 1 });
      case 'PageUp':
        return go({ r: focus.r - page, c: focus.c });
      case 'PageDown':
        return go({ r: focus.r + page, c: focus.c });
      case 'Home':
        return go({ r: mod ? 0 : focus.r, c: 0 });
      case 'End':
        return go({ r: mod ? nRows - 1 : focus.r, c: nCols - 1 });
      case 'Tab':
        e.preventDefault();
        select({ r: focus.r, c: focus.c + (e.shiftKey ? -1 : 1) });
        return;
      case 'Enter':
      case 'F2':
        e.preventDefault();
        startEdit(focus.r, focus.c);
        return;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        clearRange();
        return;
      case 'Escape':
        select(focus);
        return;
      case ' ':
        if (columns[focus.c]?.type === 'boolean') {
          e.preventDefault();
          toggleBooleans();
          return;
        }
    }
    if (!mod && !e.altKey && key.length === 1 && columns[focus.c]?.type !== 'boolean') {
      e.preventDefault();
      startEdit(focus.r, focus.c, key);
    }
  };

  // ----- mouse -----
  const onCellMouseDown = (e: React.MouseEvent, r: number, c: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    if (e.shiftKey) select(selection.anchor, { r, c });
    else select({ r, c });
    dragging.current = true;
    focusGrid();
    if ((e.target as HTMLElement).closest('.cb') && !e.shiftKey) toggleCell(r, c);
  };

  const onCellMouseEnter = (r: number, c: number) => {
    if (dragging.current) onSelectionChange({ anchor: selection.anchor, focus: clamp({ r, c }) });
  };

  const onCellContextMenu = (e: React.MouseEvent, r: number, c: number) => {
    e.preventDefault();
    if (r < r0 || r > r1 || c < c0 || c > c1) select({ r, c });
    focusGrid();
    props.onContextMenu(e.clientX, e.clientY);
  };

  const onHeaderMouseDown = (e: React.MouseEvent, c: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    if (e.shiftKey) select({ r: 0, c: selection.anchor.c }, { r: nRows - 1, c });
    else select({ r: 0, c }, { r: nRows - 1, c });
    focusGrid();
  };

  const onRowNumMouseDown = (e: React.MouseEvent, r: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    if (e.shiftKey) select({ r: selection.anchor.r, c: 0 }, { r, c: nCols - 1 });
    else select({ r, c: 0 }, { r, c: nCols - 1 });
    dragging.current = true;
    focusGrid();
  };

  const onRowNumContextMenu = (e: React.MouseEvent, r: number) => {
    e.preventDefault();
    if (r < r0 || r > r1) select({ r, c: 0 }, { r, c: nCols - 1 });
    focusGrid();
    props.onContextMenu(e.clientX, e.clientY);
  };

  const startResize = (e: React.MouseEvent, col: Column) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = col.width;
    const move = (ev: MouseEvent) => props.onResizeColumn(col.id, Math.max(60, Math.round(startW + ev.clientX - startX)));
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.classList.remove('resizing');
    };
    document.body.classList.add('resizing');
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  // ----- formula bar -----
  const activeRow = rows[focus.r];
  const activeCol = columns[focus.c];
  const activeText = activeRow && activeCol ? toText(activeRow.values[activeCol.id], activeCol) : '';
  const activeError = activeRow && activeCol ? validateCell(activeRow.values[activeCol.id], activeCol) : null;
  const [fx, setFx] = useState(activeText);
  const [fxFocused, setFxFocused] = useState(false);
  useEffect(() => {
    if (!fxFocused) setFx(activeText);
  }, [activeText, fxFocused]);

  const commitFx = () => {
    if (activeRow && activeCol && fx !== activeText) {
      onSetCells([{ rowId: activeRow.id, colId: activeCol.id, value: fromText(fx, activeCol) }]);
    }
  };

  const address = !nRows || !nCols
    ? ''
    : multi
      ? `${colLetter(c0)}${r0 + 1}:${colLetter(c1)}${r1 + 1}`
      : `${colLetter(focus.c)}${focus.r + 1}`;

  // ----- status bar (Excel-style aggregates) -----
  const stats = useMemo(() => {
    let count = 0;
    let numeric = 0;
    let sum = 0;
    const cells = (r1 - r0 + 1) * (c1 - c0 + 1);
    if (cells > 200_000) return { count: -1, numeric: 0, sum: 0, cells };
    for (let r = r0; r <= r1; r++) {
      const row = rows[r];
      if (!row) continue;
      for (let c = c0; c <= c1; c++) {
        const col = columns[c];
        if (!col) continue;
        const v = row.values[col.id];
        if (isEmptyValue(v)) continue;
        count++;
        if ((col.type === 'number' || col.type === 'integer') && typeof v === 'string') {
          const n = parseNumber(v);
          if (n !== null) {
            numeric++;
            sum += n;
          }
        }
      }
    }
    return { count, numeric, sum, cells };
  }, [rows, columns, r0, r1, c0, c1]);

  // ----- render -----
  const start = Math.max(0, Math.floor(vp.top / ROW_H) - OVERSCAN);
  const end = Math.min(nRows, Math.ceil((vp.top + vp.height) / ROW_H) + OVERSCAN);
  const visible: number[] = [];
  for (let i = start; i < end; i++) visible.push(i);
  if (editing && (editing.r < start || editing.r >= end) && editing.r < nRows) visible.push(editing.r);

  const width = RN_W + layout.total;
  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 4 });

  return (
    <div className="grid-wrap">
      <div className="formula-bar">
        <div className="fx-address">{address}</div>
        <div className="fx-label">fx</div>
        <input
          className="fx-input"
          value={fx}
          disabled={!activeRow || !activeCol}
          placeholder={activeCol ? `${activeCol.name} · ${TYPE_DEFS[activeCol.type].label}` : ''}
          onFocus={() => setFxFocused(true)}
          onBlur={() => {
            commitFx();
            setFxFocused(false);
          }}
          onChange={(e) => setFx(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitFx();
              setFxFocused(false);
              focusGrid();
            } else if (e.key === 'Escape') {
              setFx(activeText);
              setFxFocused(false);
              focusGrid();
            }
          }}
        />
        {activeError && (
          <div className="fx-error" title={activeError}>
            ⚠ {activeError}
          </div>
        )}
      </div>

      <div
        ref={scrollRef}
        className="grid-scroll"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onScroll={(e) => setVp({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight })}
      >
        <div className="grid-head" style={{ width }}>
          <div
            className="corner"
            title="Select all"
            onMouseDown={(e) => {
              e.preventDefault();
              select({ r: 0, c: 0 }, { r: nRows - 1, c: nCols - 1 });
              focusGrid();
            }}
          />
          {columns.map((col, c) => {
            const def = TYPE_DEFS[col.type];
            const sorted = sort?.colId === col.id ? sort.dir : null;
            return (
              <div
                key={col.id}
                className={`hcell${c >= c0 && c <= c1 && nRows ? ' hl' : ''}`}
                style={{ width: col.width }}
                onMouseDown={(e) => onHeaderMouseDown(e, c)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  props.onColumnMenu(c, e.clientX, e.clientY);
                }}
                title={`${col.name} — ${def.label}${col.type === 'multiselect' ? ` (split by "${col.delimiter}")` : ''}`}
              >
                <span className="hletter">{colLetter(c)}</span>
                <span className={`htype t-${col.type}`}>{def.icon}</span>
                <span className="hname">
                  {col.name}
                  {col.required && <span className="req">*</span>}
                </span>
                {sorted && <span className="hsort">{sorted === 'asc' ? '↑' : '↓'}</span>}
                <button
                  className="hmenu"
                  aria-label={`Column options for ${col.name}`}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    const r = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
                    props.onColumnMenu(c, r.left, r.bottom + 2);
                  }}
                >
                  ▾
                </button>
                <div className="resize" onMouseDown={(e) => startResize(e, col)} />
              </div>
            );
          })}
        </div>

        <div className="grid-body" style={{ width, height: Math.max(nRows * ROW_H, 1) }}>
          {visible.map((i) => {
            const row = rows[i];
            const rowSelected = i >= r0 && i <= r1;
            return (
              <div
                key={row.id}
                className={`grow${editing?.r === i ? ' has-editor' : ''}`}
                style={{ top: i * ROW_H, width }}
              >
                <div
                  className={`rn${rowSelected ? ' hl' : ''}`}
                  onMouseDown={(e) => onRowNumMouseDown(e, i)}
                  onMouseEnter={() => dragging.current && onSelectionChange({ anchor: selection.anchor, focus: clamp({ r: i, c: nCols - 1 }) })}
                  onContextMenu={(e) => onRowNumContextMenu(e, i)}
                >
                  {i + 1}
                </div>
                {columns.map((col, c) => {
                  const value = row.values[col.id];
                  const err = validateCell(value, col);
                  const isActive = i === focus.r && c === focus.c;
                  const inRange = multi && rowSelected && c >= c0 && c <= c1;
                  const isEditing = editing?.r === i && editing.c === c;
                  const cls =
                    'cell' +
                    (inRange ? ' sel' : '') +
                    (isActive ? ' active' : '') +
                    (err ? ' invalid' : '') +
                    (isEditing ? ' editing' : '') +
                    (col.type === 'number' || col.type === 'integer' ? ' right' : '') +
                    (col.type === 'boolean' ? ' center' : '');
                  return (
                    <div
                      key={col.id}
                      className={cls}
                      style={{ width: col.width }}
                      title={err ?? undefined}
                      onMouseDown={(e) => onCellMouseDown(e, i, c)}
                      onMouseEnter={() => onCellMouseEnter(i, c)}
                      onDoubleClick={() => col.type !== 'boolean' && startEdit(i, c)}
                      onContextMenu={(e) => onCellContextMenu(e, i, c)}
                    >
                      {isEditing ? (
                        <CellEditor
                          column={col}
                          value={value}
                          initialText={editing?.initialText}
                          suggestions={() => props.getSuggestions(col.id)}
                          onCommit={commitEdit}
                          onCancel={cancelEdit}
                        />
                      ) : (
                        <CellView value={value} column={col} />
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
        {!nRows && (
          <div className="grid-empty">
            {props.totalRows ? 'No rows match the current filter.' : 'No rows yet — click “+ Row” or paste data from Excel.'}
          </div>
        )}
      </div>

      <div className="statusbar">
        <span>
          {rows.length === props.totalRows
            ? `${props.totalRows.toLocaleString()} rows`
            : `${rows.length.toLocaleString()} of ${props.totalRows.toLocaleString()} rows`}{' '}
          · {nCols} columns
        </span>
        <span className={props.issueCount ? 'status-issues' : 'status-ok'}>
          {props.issueCount ? `⚠ ${props.issueCount.toLocaleString()} invalid cells` : '✓ No validation issues'}
        </span>
        <span className="status-spacer" />
        {multi && stats.count >= 0 && (
          <span className="status-agg">
            Count: {stats.count.toLocaleString()}
            {stats.numeric > 0 && (
              <>
                {'  '}Sum: {fmt(stats.sum)}
                {'  '}Average: {fmt(stats.sum / stats.numeric)}
              </>
            )}
          </span>
        )}
        <span className="status-hint">Enter edit · ⌘C/⌘V copy-paste · ⌘Z undo · right-click for more</span>
      </div>
    </div>
  );
}
