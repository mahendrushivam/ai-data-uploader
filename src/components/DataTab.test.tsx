import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockApi } from '../test/mockApi';
import { uploadDetail } from '../test/data';
import { DataTab } from './DataTab';

const row = (n: number, issues: { column: string | null; severity: 'error' | 'warning'; message: string }[] = []) => ({
  row: n,
  data: { ticket_id: String(999 + n), label: 'bug', tags: ['ux', 'web'], confidence: n === 4 ? 'n/a' : '0.9' },
  issues,
});

describe('DataTab', () => {
  it('shows the extracted rows with typed cells; error and warning cells are marked with the reason', async () => {
    mockApi({
      'GET /api/uploads/:id/rows': {
        body: {
          total: 3,
          rows: [
            row(3),
            row(4, [{ column: 'confidence', severity: 'error', message: '"n/a" is not a number' }]),
            row(7, [
              { column: 'confidence', severity: 'warning', message: 'Low confidence' },
              { column: null, severity: 'warning', message: 'This row has 3 cells' },
            ]),
          ],
        },
      },
    });
    render(<DataTab upload={uploadDetail()} />);
    const table = await screen.findByTestId('data-table');
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['#', '123 ticket_id*', '◉ label*', '≡ tags', '# confidence']);
    expect(within(table).getByTitle('"n/a" is not a number')).toHaveClass('invalid');
    expect(within(table).getByTitle('Low confidence')).toHaveClass('warn');
    expect(within(table).getByTitle('This row has 3 cells')).toHaveClass('row-warning');
    expect(table.querySelectorAll('tbody tr')[0].querySelectorAll('.chip')).toHaveLength(3); // 'bug' + 2 tags
    expect(screen.getByText(/rows 1–3 of 3/)).toBeInTheDocument();
    expect(screen.getByText(/Read-only/)).toBeInTheDocument();
  });

  it('"Rows with issues" asks the server for only those rows, and paging asks for the next page', async () => {
    const m = mockApi({ 'GET /api/uploads/:id/rows': (c) => ({ body: { total: 120, rows: [row(Number(c.query.get('offset')) + 1)] } }) });
    render(<DataTab upload={uploadDetail()} />);
    await screen.findByText(/rows 1–50 of 120/);
    await userEvent.click(screen.getByRole('button', { name: /Next/ }));
    await screen.findByText(/rows 51–100 of 120/);
    await userEvent.click(screen.getByRole('button', { name: /Prev/ }));
    await userEvent.click(screen.getByRole('button', { name: /Rows with issues/ }));
    await screen.findByText(/rows 1–50/);
    expect(m.calls.map((c) => c.query.toString())).toEqual([
      'offset=0&limit=50&onlyIssues=0',
      'offset=50&limit=50&onlyIssues=0',
      'offset=0&limit=50&onlyIssues=0',
      'offset=0&limit=50&onlyIssues=1',
    ]);
    expect(screen.getByRole('button', { name: /Rows with issues/ })).toHaveTextContent('11');
  });

  it('columns that were not in the file are labelled, and a load failure is shown', async () => {
    mockApi({ 'GET /api/uploads/:id/rows': { status: 500, body: { error: { code: 'x', message: 'Database unavailable' } } } });
    const u = uploadDetail();
    u.columns[2] = { ...u.columns[2], sourceHeader: null };
    render(<DataTab upload={u} />);
    expect(await screen.findByText('Database unavailable')).toBeInTheDocument();
    expect(screen.getByText('(not in file)')).toBeInTheDocument();
  });
});
