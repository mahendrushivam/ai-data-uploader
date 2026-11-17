import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { apiError, last, mockApi } from '../test/mockApi';
import { ID, session, uploadDetail } from '../test/data';
import { UploadResultPage } from './UploadResultPage';

const issues = [
  { row: null, column: null, rule: 'missing_column', severity: 'warning', message: 'Column "x" was not found in the file; it will be empty.', value: null },
  { row: 3, column: null, rule: 'row_length', severity: 'warning', message: 'This row has 2 cells but the header has 3.', value: null },
  { row: 4, column: 'confidence', rule: 'type', severity: 'error', message: '"n/a" is not a number', value: 'n/a' },
  { row: 7, column: 'confidence', rule: 'min', severity: 'warning', message: 'Low confidence', value: '0.59' },
];
const renderPage = (id = ID(100)) => render(<UploadResultPage id={id} session={session} onLogout={() => {}} />);
const routes = (over = {}) => ({
  'GET /api/uploads/:id': { body: { upload: uploadDetail() } },
  'GET /api/uploads/:id/issues': { body: { issues, total: issues.length } },
  'GET /api/uploads/:id/rows': { body: { rows: [], total: 40 } },
  ...over,
});

describe('UploadResultPage', () => {
  it('failed validation: status, counts, the fix-and-upload-again banner and download links', async () => {
    mockApi(routes());
    renderPage();
    expect(await screen.findByTestId('upload-status')).toHaveTextContent('Failed validation');
    expect(screen.getByTestId('error-count')).toHaveTextContent('4');
    expect(screen.getByTestId('warning-count')).toHaveTextContent('7');
    expect(screen.getByText(/tickets_oct\.csv · 5\.0 KB · Support tickets/)).toHaveTextContent('v2');
    expect(screen.getByText(/checked in 1\.5 s/)).toBeInTheDocument();
    const banner = screen.getByTestId('fix-banner');
    expect(within(banner).getByRole('link', { name: '↓ File with errors marked' })).toHaveAttribute('href', `/api/uploads/${ID(100)}/export.csv?errors=1`);
    expect(within(banner).getByRole('link', { name: '↓ Error report' })).toHaveAttribute('href', `/api/uploads/${ID(100)}/errors.csv`);
    expect(screen.getByRole('link', { name: '↓ Download in template format' })).toHaveAttribute('href', `/api/uploads/${ID(100)}/export.csv`);
    expect(screen.getByRole('link', { name: '↓ Original' })).toHaveAttribute('href', `/api/uploads/${ID(100)}/original`);
    await userEvent.click(within(banner).getByRole('button', { name: '⇪ Upload corrected file' }));
    expect(window.location.hash).toBe(`#/upload/${ID(1)}`); // same template preselected
  });

  it('opens on Issues when there are errors: issues by column, and the issue table with "whole file" / "whole row" labels', async () => {
    mockApi(routes());
    renderPage();
    const table = await screen.findByTestId('issue-table');
    expect(screen.getByRole('tab', { name: /Issues/ })).toHaveAttribute('aria-selected', 'true');
    const bodyRows = within(table).getAllByRole('row').slice(1);
    expect(bodyRows.map((r) => within(r).getAllByRole('cell')[1].textContent)).toEqual(['whole file', 'whole row', 'confidence', 'confidence']);
    expect(bodyRows[2]).toHaveTextContent(/4confidencen\/a"n\/a" is not a numberError/);
    expect(screen.getByRole('button', { name: /confidence.*wrong type \(1\) · below minimum, warning \(7\)/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /label.*value not allowed \(3\)/ })).toBeInTheDocument();
  });

  it('severity chips, the column list and the column select filter the issues on the server; paging', async () => {
    const m = mockApi(routes({ 'GET /api/uploads/:id/issues': { body: { issues, total: 120 } } }));
    renderPage();
    await screen.findByTestId('issue-table');
    await userEvent.click(screen.getByRole('button', { name: /^Errors/ }));
    await userEvent.click(screen.getByRole('button', { name: /^confidence/ }));
    await userEvent.click(screen.getByRole('button', { name: /Next/ }));
    await vi.waitFor(() => expect(screen.getByText(/51–100 of 120/)).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByLabelText('Filter by column'), 'label');
    await vi.waitFor(() => expect(last(m.to('GET /api/uploads/' + ID(100) + '/issues')).query.toString()).toBe('severity=error&column=label&offset=0&limit=50'));
    const queries = m.to(`GET /api/uploads/${ID(100)}/issues`).map((c) => c.query.toString());
    expect(queries).toEqual(expect.arrayContaining(['offset=0&limit=50', 'severity=error&offset=0&limit=50', 'severity=error&column=confidence&offset=0&limit=50', 'severity=error&column=confidence&offset=50&limit=50']));
  });

  it('the Data tab shows the extracted rows', async () => {
    mockApi(routes());
    renderPage();
    await screen.findByTestId('issue-table');
    await userEvent.click(screen.getByRole('tab', { name: /Data/ }));
    expect(await screen.findByTestId('data-table')).toBeInTheDocument();
  });

  it('passed: opens on the data, offers the template-format download, and says there are no issues', async () => {
    mockApi(routes({ 'GET /api/uploads/:id': { body: { upload: uploadDetail({ status: 'passed', errorCount: 0, warningCount: 0, invalidRowCount: 0, summary: [], rowsWithIssues: 0 }) } } }));
    renderPage();
    expect(await screen.findByTestId('data-table')).toBeInTheDocument();
    expect(screen.getByText('All rows passed.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '↓ Download in template format' })).toHaveClass('primary');
    expect(screen.queryByTestId('fix-banner')).toBeNull();
    await userEvent.click(screen.getByRole('tab', { name: /Issues/ }));
    expect(screen.getByText('No issues: every row passed every check.')).toBeInTheDocument();
  });

  it('passed with warnings links the warnings report', async () => {
    mockApi(routes({ 'GET /api/uploads/:id': { body: { upload: uploadDetail({ status: 'passed_with_warnings', errorCount: 0 }) } } }));
    renderPage();
    expect(await screen.findByText('Passed: no errors, only warnings.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download the warnings report' })).toHaveAttribute('href', `/api/uploads/${ID(100)}/errors.csv`);
  });

  it('queued → validating → result, polling every 2 seconds, then stops', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const states = [
      uploadDetail({ status: 'queued', totalRows: null, validationStartedAt: null, validationFinishedAt: null }),
      uploadDetail({ status: 'validating', totalRows: null, validationFinishedAt: null }),
      uploadDetail({ status: 'passed_with_warnings', errorCount: 0 }),
    ];
    let n = 0;
    const m = mockApi(routes({ 'GET /api/uploads/:id': () => ({ body: { upload: states[Math.min(n++, 2)] } }) }));
    renderPage();
    expect(await screen.findByTestId('upload-status')).toHaveTextContent('Queued');
    expect(screen.getByText(/Checking every row against the template/)).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(await screen.findByTestId('upload-status')).toHaveTextContent('Validating…');
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(await screen.findByTestId('upload-status')).toHaveTextContent('Passed with warnings');
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(m.to(`GET /api/uploads/${ID(100)}`).filter((c) => c.path === `/api/uploads/${ID(100)}`)).toHaveLength(3);
  });

  it("couldn't read the file: the reason, and a way to upload a new one (no data downloads)", async () => {
    mockApi(routes({
      'GET /api/uploads/:id': { body: { upload: uploadDetail({ status: 'error', template: null, totalRows: null, statusMessage: 'The file is not valid UTF-8 (byte 0xE9 on line 2).', sizeBytes: 24, summary: [] }) } },
    }));
    renderPage();
    const box = await screen.findByTestId('error-box');
    expect(box).toHaveTextContent('The file is not valid UTF-8 (byte 0xE9 on line 2).');
    expect(screen.getByText(/24 B · No template/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /template format/ })).toBeNull();
    await userEvent.click(within(box).getByRole('button', { name: '⇪ Upload a new file' }));
    expect(window.location.hash).toBe('#/upload');
  });

  it('not found (removed, or another user\'s): a clear page with a way back', async () => {
    mockApi({ 'GET /api/uploads/:id': apiError(404, 'not_found', 'Upload not found.') });
    renderPage();
    expect(await screen.findByTestId('not-found')).toHaveTextContent('Upload not found.');
    expect(screen.getByRole('link', { name: '← Back to My uploads' })).toHaveAttribute('href', '#/');
  });

  it('mentions when only part of a very large issue list is stored', async () => {
    mockApi(routes({ 'GET /api/uploads/:id': { body: { upload: uploadDetail({ issuesTruncated: true }) } } }));
    renderPage();
    expect(await screen.findByText(/only the first 100,000 issues are listed/)).toBeInTheDocument();
  });
});
