import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { apiError, mockApi } from '../test/mockApi';
import { ID, session, templateSummary } from '../test/data';
import { TemplatesPage } from './TemplatesPage';

const two = () => [
  templateSummary(),
  templateSummary({ id: ID(2), name: 'Customer contacts', isDefault: false, version: 1, columnCount: 6, ruleCount: 1, uploadCount: 1, description: null }),
];

describe('TemplatesPage', () => {
  it('shows each template as a card: default badge, version, first columns and counts', async () => {
    mockApi({ 'GET /api/templates': { body: { templates: two() } } });
    render(<TemplatesPage session={session} onLogout={() => {}} />);
    const cards = await screen.findAllByTestId('template-card');
    expect(cards).toHaveLength(2);
    expect(within(cards[0]).getByText('★ Default')).toBeInTheDocument();
    expect(within(cards[0]).getByText('v2')).toBeInTheDocument();
    expect(within(cards[0]).getByText(/3 columns · 4 rules · 2 uploads · edited 1 h ago/)).toBeInTheDocument();
    expect(within(cards[1]).queryByText('★ Default')).toBeNull();
    expect(within(cards[1]).getByText('+2 more')).toBeInTheDocument(); // 6 columns, 4 shown
    expect(within(cards[1]).getByText(/1 column|6 columns/)).toHaveTextContent('6 columns · 1 rule · 1 upload');
  });

  it('Use for upload / Edit / New template navigate', async () => {
    mockApi({ 'GET /api/templates': { body: { templates: two() } } });
    render(<TemplatesPage session={session} onLogout={() => {}} />);
    const [first] = await screen.findAllByTestId('template-card');
    await userEvent.click(within(first).getByRole('button', { name: 'Use for upload' }));
    expect(window.location.hash).toBe(`#/upload/${ID(1)}`);
    await userEvent.click(within(first).getByRole('button', { name: 'Edit' }));
    expect(window.location.hash).toBe(`#/templates/${ID(1)}`);
    await userEvent.click(screen.getByRole('button', { name: '+ New template' }));
    expect(window.location.hash).toBe('#/templates/new');
  });

  it('set and remove default call the API and reload the list', async () => {
    let list = two();
    const m = mockApi({
      'GET /api/templates': () => ({ body: { templates: list } }),
      'PUT /api/templates/:id/default': (c, p) => {
        list = list.map((t) => ({ ...t, isDefault: t.id === p.id ? (c.body as { isDefault: boolean }).isDefault : false }));
        return { body: { template: {} } };
      },
    });
    render(<TemplatesPage session={session} onLogout={() => {}} />);
    const cards = await screen.findAllByTestId('template-card');
    await userEvent.click(within(cards[1]).getByRole('button', { name: '★ Set as default' }));
    expect(await within(cards[1]).findByText('★ Default')).toBeInTheDocument();
    expect(m.to('PUT')[0]).toMatchObject({ path: `/api/templates/${ID(2)}/default`, body: { isDefault: true } });
    await userEvent.click(within(cards[1]).getByRole('button', { name: '☆ Remove default' }));
    expect(m.to('PUT')[1].body).toEqual({ isDefault: false });
  });

  it('delete asks in the dialog (with the upload count); cancel does nothing, confirm deletes', async () => {
    let list = two();
    const m = mockApi({
      'GET /api/templates': () => ({ body: { templates: list } }),
      'DELETE /api/templates/:id': (_c, p) => ((list = list.filter((t) => t.id !== p.id)), { status: 204 }),
    });
    render(<TemplatesPage session={session} onLogout={() => {}} />);
    const [first] = await screen.findAllByTestId('template-card');
    await userEvent.click(within(first).getByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('Delete this template?');
    expect(dialog).toHaveTextContent('will stop being your default');
    expect(dialog).toHaveTextContent('The 2 uploads already checked with it keep their results.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(m.to('DELETE')).toHaveLength(0);
    await userEvent.click(within(first).getByRole('button', { name: 'Delete' }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete template' }));
    expect(await screen.findAllByTestId('template-card')).toHaveLength(1);
    expect(m.to('DELETE')[0].path).toBe(`/api/templates/${ID(1)}`);
  });

  it('with no templates there is only the "New template" card; errors are shown', async () => {
    mockApi({ 'GET /api/templates': { body: { templates: [] } } });
    const { unmount } = render(<TemplatesPage session={session} onLogout={() => {}} />);
    expect(await screen.findByRole('button', { name: /New template.*Define columns/ })).toBeInTheDocument();
    expect(screen.queryAllByTestId('template-card')).toHaveLength(0);
    unmount();
    mockApi({ 'GET /api/templates': apiError(500, 'internal_error', 'Something went wrong. Please try again.') });
    render(<TemplatesPage session={session} onLogout={() => {}} />);
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
  });
});
