import { memo } from 'react';
import type { CellValue, Column } from '../types';
import { chipStyle, parseBool, splitMulti } from '../lib/columnTypes';

interface Props {
  value: CellValue | undefined;
  column: Column;
}

function CellViewInner({ value, column }: Props) {
  if (column.type === 'multiselect') {
    const items = Array.isArray(value) ? value : splitMulti(value ?? '', column.delimiter);
    return (
      <div className="chips">
        {items.map((t, i) => (
          <span key={i} className="chip" style={chipStyle(t)}>
            {t}
          </span>
        ))}
      </div>
    );
  }

  const text = Array.isArray(value) ? value.join(', ') : value ?? '';

  switch (column.type) {
    case 'select':
      return text ? (
        <div className="chips">
          <span className="chip" style={chipStyle(text)}>
            {text}
          </span>
        </div>
      ) : null;
    case 'boolean': {
      const b = parseBool(text);
      if (text.trim() && b === null) return <span className="txt">{text}</span>;
      return (
        <span className={`cb${b ? ' on' : ''}`} role="checkbox" aria-checked={!!b}>
          {b ? '✓' : ''}
        </span>
      );
    }
    case 'number':
    case 'integer':
      return <span className="txt num">{text}</span>;
    case 'url':
    case 'email':
      return <span className="txt link">{text}</span>;
    default:
      return <span className="txt">{text}</span>;
  }
}

export const CellView = memo(CellViewInner);
