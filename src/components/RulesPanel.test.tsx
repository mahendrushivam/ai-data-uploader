import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import type { ColumnType } from '../types';
import { newColumn, newRule, type DraftColumn, type DraftRule } from '../lib/templateDraft';
import { RulesPanel } from './RulesPanel';

/** Renders the panel with real state, and exposes the latest rules for assertions. */
let latest: DraftRule[] = [];
function Harness({ type, rules = [], required = false, errors = {} }: { type: ColumnType; rules?: DraftRule[]; required?: boolean; errors?: Record<string, string> }) {
  const [col, setCol] = useState<DraftColumn>({ ...newColumn('Amount', type), required, rules });
  latest = col.rules;
  return <RulesPanel column={col} prefix="columns.3" errors={errors} onChange={(r) => setCol({ ...col, rules: r })} />;
}

describe('RulesPanel', () => {
  it('offers only the rules that fit the column type, and not ones already added', async () => {
    render(<Harness type="number" />);
    const add = screen.getByLabelText('Add rule');
    expect([...add.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['+ Add rule…', 'Minimum', 'Maximum', 'Unique']);
    await userEvent.selectOptions(add, 'min');
    expect(latest.map((r) => r.type)).toEqual(['min']);
    expect([...screen.getByLabelText('Add rule').querySelectorAll('option')].map((o) => o.textContent)).toEqual(['+ Add rule…', 'Maximum', 'Unique']);
  });

  it('describes the built-in checks', () => {
    render(<Harness type="email" required />);
    expect(screen.getByText(/a value is required, and it must be a valid email/)).toBeInTheDocument();
  });

  it('booleans have no extra rules; a column with every rule says so', () => {
    const { unmount } = render(<Harness type="boolean" />);
    expect(screen.getByText('No extra rules apply to this type.')).toBeInTheDocument();
    unmount();
    render(<Harness type="multiselect" rules={[newRule('allowed_values')]} />);
    expect(screen.getByText('All rules for this type are in use.')).toBeInTheDocument();
  });

  it('edits values, severity and message, and removes a rule', async () => {
    render(<Harness type="number" rules={[newRule('min')]} />);
    await userEvent.type(screen.getByLabelText('Minimum value'), '0.6');
    await userEvent.selectOptions(screen.getByLabelText('Severity'), 'warning');
    await userEvent.type(screen.getByLabelText('Custom message'), 'Low');
    expect(latest[0]).toMatchObject({ value: '0.6', severity: 'warning', message: 'Low' });
    expect(document.querySelector('.rule-card')).toHaveClass('warning');
    await userEvent.click(screen.getByRole('button', { name: 'Remove Minimum rule' }));
    expect(latest).toEqual([]);
  });

  it('date columns get date pickers for min/max; text lengths get number inputs', () => {
    const { unmount } = render(<Harness type="date" rules={[newRule('max')]} />);
    expect(screen.getByLabelText('Maximum value')).toHaveAttribute('type', 'date');
    unmount();
    render(<Harness type="text" rules={[newRule('max_length')]} />);
    expect(screen.getByLabelText('Maximum length value')).toHaveAttribute('type', 'number');
  });

  it('pattern rules have an ignore-case option; allowed values take one value per line', async () => {
    render(<Harness type="text" rules={[newRule('regex'), newRule('allowed_values')]} />);
    await userEvent.type(screen.getByLabelText('Pattern', { exact: true }), '^A');
    await userEvent.click(screen.getByLabelText('Ignore upper/lower case'));
    await userEvent.type(screen.getByLabelText('Allowed values', { exact: true }), 'US{Enter}GB');
    await userEvent.click(screen.getByLabelText('Match upper/lower case exactly'));
    expect(latest[0]).toMatchObject({ pattern: '^A', ignoreCase: true });
    expect(latest[1]).toMatchObject({ valuesText: 'US\nGB', caseSensitive: true });
  });

  it("shows validation errors for this column's rules (by path) and marks the card", () => {
    render(
      <Harness
        type="number"
        rules={[newRule('min'), newRule('max')]}
        errors={{ 'columns.3.rules.0.params.value': 'Minimum is greater than maximum.', 'columns.3.rules.1': 'Only one rule.', 'columns.9.rules.0': 'other column' }}
      />,
    );
    expect(screen.getByText('Minimum is greater than maximum.')).toBeInTheDocument();
    expect(screen.getByText('Only one rule.')).toBeInTheDocument();
    expect(screen.queryByText('other column')).toBeNull();
    expect(document.querySelectorAll('.rule-card.invalid')).toHaveLength(2);
  });
});
