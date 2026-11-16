import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CellValue, Column } from '../types';
import { chipStyle, fromText, splitMulti, toText } from '../lib/columnTypes';

export type Move = 'down' | 'up' | 'right' | 'left' | 'none';

interface Props {
  column: Column;
  value: CellValue | undefined;
  /** When editing starts by typing, the typed character replaces the content. */
  initialText?: string;
  suggestions: () => string[];
  onCommit: (value: CellValue, move: Move) => void;
  onCancel: () => void;
}

export function CellEditor(props: Props) {
  return (
    <div
      className="editor-wrap"
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      {props.column.type === 'multiselect' ? <TagEditor {...props} /> : <TextEditor {...props} />}
    </div>
  );
}

function TextEditor({ column, value, initialText, suggestions, onCommit, onCancel }: Props) {
  const [text, setText] = useState(initialText ?? toText(value, column));
  const done = useRef(false);
  const ref = useRef<HTMLInputElement>(null);
  const options = useMemo(() => (column.type === 'select' ? suggestions() : []), [column.type, suggestions]);
  const listId = column.type === 'select' ? `dl-${column.id}` : undefined;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const finish = (move: Move) => {
    if (done.current) return;
    done.current = true;
    onCommit(fromText(text, column), move);
  };

  return (
    <>
      <input
        ref={ref}
        className={`cell-input${column.type === 'number' || column.type === 'integer' ? ' num' : ''}`}
        value={text}
        list={listId}
        placeholder={column.type === 'date' ? 'YYYY-MM-DD' : undefined}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => finish('none')}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            finish(e.shiftKey ? 'up' : 'down');
          } else if (e.key === 'Tab') {
            e.preventDefault();
            finish(e.shiftKey ? 'left' : 'right');
          } else if (e.key === 'Escape') {
            e.preventDefault();
            done.current = true;
            onCancel();
          }
        }}
      />
      {listId && (
        <datalist id={listId}>
          {options.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      )}
    </>
  );
}

function TagEditor({ column, value, initialText, suggestions, onCommit, onCancel }: Props) {
  const [tags, setTags] = useState<string[]>(() =>
    Array.isArray(value) ? value : splitMulti(value ?? '', column.delimiter),
  );
  const [input, setInput] = useState(initialText ?? '');
  const [highlight, setHighlight] = useState(-1);
  const done = useRef(false);
  const ref = useRef<HTMLInputElement>(null);
  const all = useMemo(() => suggestions(), [suggestions]);

  const matches = useMemo(() => {
    const q = input.trim().toLowerCase();
    return all.filter((s) => !tags.includes(s) && (!q || s.toLowerCase().includes(q))).slice(0, 8);
  }, [all, tags, input]);

  useLayoutEffect(() => {
    ref.current?.focus();
  }, []);

  const addTags = (raw: string) => {
    const parts = splitMulti(raw, column.delimiter);
    const next = [...tags];
    for (const p of parts) if (!next.includes(p)) next.push(p);
    setTags(next);
    setInput('');
    setHighlight(-1);
    return next;
  };

  const finish = (move: Move) => {
    if (done.current) return;
    done.current = true;
    const final = [...tags];
    for (const p of splitMulti(input, column.delimiter)) if (!final.includes(p)) final.push(p);
    onCommit(final, move);
  };

  return (
    <div className="tag-editor" onClick={() => ref.current?.focus()}>
      <div className="tag-box">
        {tags.map((t, i) => (
          <span key={t + i} className="chip" style={chipStyle(t)}>
            {t}
            <button
              type="button"
              className="chip-x"
              aria-label={`Remove ${t}`}
              onMouseDown={(e) => {
                e.preventDefault();
                setTags(tags.filter((_, j) => j !== i));
              }}
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={ref}
          className="tag-input"
          value={input}
          placeholder={tags.length ? '' : 'Add value…'}
          onChange={(e) => {
            setInput(e.target.value);
            setHighlight(-1);
          }}
          onBlur={() => finish('none')}
          onKeyDown={(e) => {
            if (e.key === column.delimiter) {
              e.preventDefault();
              addTags(input);
            } else if (e.key === 'Enter') {
              e.preventDefault();
              if (highlight >= 0 && matches[highlight]) addTags(matches[highlight]);
              else if (input.trim()) addTags(input);
              else finish(e.shiftKey ? 'up' : 'down');
            } else if (e.key === 'Backspace' && !input && tags.length) {
              e.preventDefault();
              setTags(tags.slice(0, -1));
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setHighlight((h) => Math.min(matches.length - 1, h + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHighlight((h) => Math.max(-1, h - 1));
            } else if (e.key === 'Tab') {
              e.preventDefault();
              finish(e.shiftKey ? 'left' : 'right');
            } else if (e.key === 'Escape') {
              e.preventDefault();
              done.current = true;
              onCancel();
            }
          }}
        />
      </div>
      {matches.length > 0 && (
        <div className="suggest">
          {matches.map((m, i) => (
            <div
              key={m}
              className={`suggest-item${i === highlight ? ' on' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                addTags(m);
              }}
            >
              <span className="chip" style={chipStyle(m)}>
                {m}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="tag-hint">
        <kbd>Enter</kbd> or <kbd>{column.delimiter}</kbd> adds · <kbd>⌫</kbd> removes · <kbd>Enter</kbd> on empty saves
      </div>
    </div>
  );
}
