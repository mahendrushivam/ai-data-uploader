import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { last, mockApi } from '../test/mockApi';
import { ID, session, uploadList, uploadSummary } from '../test/data';
import { UploadsPage } from './UploadsPage';
import type { UploadSummary } from '../lib/uploads';

const now = Date.now();
const six = (): UploadSummary[] => [
  uploadSummary({ id: ID(6), name: 'Vendor list', status: 'queued', template: null, totalRows: null, errorCount: 0, warningCount: 0, createdAt: new Date(now - 12_000).toISOString(), validationStartedAt: null }),
  uploadSummary({ id: ID(5), name: 'Q3 contacts', status: 'validating', totalRows: null, errorCount: 0, warningCount: 0, validationStartedAt: new Date(now - 3_000).toISOString() }),
  uploadSummary({ id: ID(4), name: 'October tickets (corrected)', status: 'passed_with_warnings', errorCount: 0 }),
  uploadSummary({ id: ID(3), name: 'October tickets', status: 'failed_validation' }),
  uploadSummary({ id: ID(2), name: 'Leads', status: 'passed', errorCount: 0, warningCount: 0, totalRows: 25 }),
  uploadSummary({ id: ID(1), name: 'Legacy export', status: 'error', statusMessage: 'The file is not valid UTF-8 (byte 0xE9 on line 2).', totalRows: null, errorCount: 0, warningCount: 0, template: null }),
];
const rows = () => screen.getAllByTestId('upload-row');
const renderPage = () => render(<UploadsPage session={session} onLogout={() => {}} />);

describe('UploadsPage', () => {
  it('lists every upload with its template, status, counts and the right actions', async () => {
    mockApi({ 'GET /api/uploads': { body: uploadList(six()) } });
    renderPage();
    await screen.findByTestId('uploads-table');
    expect(rows().map((r) => r.dataset.status)).toEqual(['queued', 'validating', 'passed_with_warnings', 'failed_validation', 'passed', 'error']);
    const [queued, validating, warned, failed, passed, error] = rows();
    expect(queued).toHaveTextContent(/No template.*Queued.*waiting 1\d s/);
    expect(validating).toHaveTextContent(/Support tickets v2.*Validating….*checking for \d s/);
    expect(within(warned).getByText('7 warnings')).toBeInTheDocument();
    expect(within(failed).getByText('4 errors')).toBeInTheDocument();
    expect(within(failed).getByRole('button', { name: 'See errors' })).toBeInTheDocument();
    expect(within(failed).getByRole('link', { name: '↓ Errors' })).toHaveAttribute('href', `/api/uploads/${ID(3)}/errors.csv`);
    expect(within(passed).getByText('None')).toBeInTheDocument();
    expect(within(passed).getByRole('link', { name: '↓ CSV' })).toHaveAttribute('href', `/api/uploads/${ID(2)}/export.csv`);
    expect(within(error).getByRole('button', { name: 'Details' })).toBeInTheDocument();
    expect(within(error).getByText(/not valid UTF-8/)).toBeInTheDocument();
    expect(within(queued).getByText('tickets_oct.csv · 5.0 KB')).toBeInTheDocument(); // file name and size
    await userEvent.click(within(failed).getByRole('button', { name: 'See errors' }));
    expect(window.location.hash).toBe(`#/uploads/${ID(3)}`);
  });

  it('shows an in-progress banner and keeps polling until nothing is in progress', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let call = 0;
    const m = mockApi({
      'GET /api/uploads': () => {
        call++;
        const list = six();
        if (call >= 2) list[0] = { ...list[0], status: 'passed', totalRows: 2 };
        if (call >= 3) list[1] = { ...list[1], status: 'passed', totalRows: 1 };
        return { body: uploadList(list) };
      },
    });
    renderPage();
    expect(await screen.findByTestId('progress-banner')).toHaveTextContent('2 uploads are being checked (1 waiting, 1 in progress)');
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(await screen.findByTestId('progress-banner')).toHaveTextContent('1 upload is being checked (0 waiting, 1 in progress)');
    await act(() => vi.advanceTimersByTimeAsync(2000));
    await vi.waitFor(() => expect(screen.queryByTestId('progress-banner')).toBeNull());
    await act(() => vi.advanceTimersByTimeAsync(6000));
    expect(m.calls).toHaveLength(3); // stopped polling once everything had finished
  });

  it('status chips show counts and filter; "Show only these" picks in-progress', async () => {
    const m = mockApi({ 'GET /api/uploads': { body: uploadList(six()) } });
    renderPage();
    const group = await screen.findByRole('group', { name: 'Filter by status' });
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'All6', 'In progress2', 'Failed validation1', 'Passed with warnings1', 'Passed1', "Couldn't read1",
    ]);
    await userEvent.click(within(group).getByRole('button', { name: /^Failed validation/ }));
    expect(within(group).getByRole('button', { name: /^Failed validation/ })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Show only these' }));
    await vi.waitFor(() => expect(last(m.calls).query.get('status')).toBe('in_progress'));
    expect(m.calls.map((c) => c.query.get('status'))).toContain('failed_validation');
  });

  it('template filter and search (debounced) are sent to the server', async () => {
    const m = mockApi({ 'GET /api/uploads': { body: uploadList(six()) } });
    renderPage();
    await screen.findByTestId('uploads-table');
    await userEvent.selectOptions(screen.getByLabelText('Filter by template'), 'none');
    await vi.waitFor(() => expect(last(m.calls).query.get('template')).toBe('none'));
    await userEvent.selectOptions(screen.getByLabelText('Filter by template'), ID(1));
    await userEvent.type(screen.getByLabelText('Search uploads'), 'oct');
    await vi.waitFor(() => expect(last(m.calls).query.toString()).toBe(`template=${ID(1)}&q=oct`));
    expect(m.calls.filter((c) => c.query.get('q') === 'o')).toHaveLength(0); // debounced: not one request per keystroke
  });

  it('remove asks in the dialog; Cancel keeps it, confirming deletes and reloads', async () => {
    let list = six();
    const m = mockApi({
      'GET /api/uploads': () => ({ body: uploadList(list) }),
      'DELETE /api/uploads/:id': (_c, p) => ((list = list.filter((u) => u.id !== p.id)), { status: 204 }),
    });
    renderPage();
    await screen.findByTestId('uploads-table');
    await userEvent.click(screen.getByRole('button', { name: 'Remove Legacy export' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Legacy export (tickets_oct.csv) will be removed from your list');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(m.to('DELETE')).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Remove Legacy export' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove upload' }));
    await vi.waitFor(() => expect(rows()).toHaveLength(5));
    expect(m.to('DELETE')[0].path).toBe(`/api/uploads/${ID(1)}`);
  });

  it('empty states: no uploads at all, and no matches for the filters (with "Clear filters")', async () => {
    const m = mockApi({ 'GET /api/uploads': { body: uploadList([]) } });
    renderPage();
    expect(await screen.findByText('No uploads yet')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Search uploads'), 'zzz');
    expect(await screen.findByText('No uploads match these filters.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByText('No uploads yet')).toBeInTheDocument();
    expect(screen.getByLabelText('Search uploads')).toHaveValue('');
    await userEvent.click(screen.getByText('No uploads yet'));
    expect(window.location.hash).toBe('#/upload');
    expect(m.calls.length).toBeGreaterThan(1);
  });

  it('says when only the newest uploads are shown, and shows load errors', async () => {
    mockApi({ 'GET /api/uploads': { body: uploadList(six().slice(0, 2), { truncated: true }) } });
    const { unmount } = renderPage();
    expect(await screen.findByText('Showing 2 newest (of more than 2) uploads')).toBeInTheDocument();
    unmount();
    mockApi({ 'GET /api/uploads': { status: 500, body: { error: { code: 'x', message: 'Database unavailable' } } } });
    renderPage();
    expect(await screen.findByText('Database unavailable')).toBeInTheDocument();
  });

  it('New upload opens the upload page', async () => {
    mockApi({ 'GET /api/uploads': { body: uploadList([]) } });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: '⇪ New upload' }));
    expect(window.location.hash).toBe('#/upload');
  });
});
