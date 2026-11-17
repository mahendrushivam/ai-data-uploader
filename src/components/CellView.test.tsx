import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CellView } from './CellView';
import type { ColumnType } from '../types';

const spec = (type: ColumnType, delimiter = ',') => ({ type, delimiter, required: false });

describe('CellView', () => {
  it('multi-value cells become one chip per item (from an array or from text)', () => {
    const { container, rerender } = render(<CellView value={['ux', 'web']} column={spec('multiselect')} />);
    expect([...container.querySelectorAll('.chip')].map((c) => c.textContent)).toEqual(['ux', 'web']);
    rerender(<CellView value="a; b" column={spec('multiselect', ';')} />);
    expect([...container.querySelectorAll('.chip')].map((c) => c.textContent)).toEqual(['a', 'b']);
  });

  it('single select is one chip, and nothing when empty', () => {
    const { container, rerender } = render(<CellView value="bug" column={spec('select')} />);
    expect(container.querySelector('.chip')).toHaveTextContent('bug');
    rerender(<CellView value="" column={spec('select')} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('booleans are checkboxes; text that is not true/false is shown as-is', () => {
    const { rerender } = render(<CellView value="yes" column={spec('boolean')} />);
    expect(screen.getByRole('checkbox')).toHaveAttribute('aria-checked', 'true');
    rerender(<CellView value="no" column={spec('boolean')} />);
    expect(screen.getByRole('checkbox')).toHaveAttribute('aria-checked', 'false');
    rerender(<CellView value="maybe" column={spec('boolean')} />);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByText('maybe')).toBeInTheDocument();
  });

  it.each<[ColumnType, string]>([
    ['number', 'num'],
    ['integer', 'num'],
    ['url', 'link'],
    ['email', 'link'],
    ['text', 'txt'],
  ])('%s values get the %s style', (type, cls) => {
    const { container } = render(<CellView value="42" column={spec(type)} />);
    expect(container.querySelector('span')).toHaveClass(cls);
  });

  it('shows nothing for a missing value, and joins arrays in a non-list column', () => {
    const { container, rerender } = render(<CellView value={undefined} column={spec('text')} />);
    expect(container.textContent).toBe('');
    rerender(<CellView value={['a', 'b']} column={spec('text')} />);
    expect(container.textContent).toBe('a, b');
  });
});
