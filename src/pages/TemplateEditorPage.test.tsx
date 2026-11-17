import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { apiError, mockApi } from '../test/mockApi';
import { ID, session, templateDetail } from '../test/data';
import { TemplateEditorPage } from './TemplateEditorPage';

const renderNew = () => render(<TemplateEditorPage session={session} onLogout={() => {}} />);
const renderEdit = () => render(<TemplateEditorPage id={ID(1)} session={session} onLogout={() => {}} />);

describe('TemplateEditorPage: new template', () => {
  it('builds columns and rules and saves the template, then returns to the list', async () => {
    const m = mockApi({ 'POST /api/templates': { status: 201, body: { template: templateDetail() } } });
    renderNew();
    await userEvent.type(screen.getByLabelText('Template name'), 'Support tickets');
    await userEvent.type(screen.getByLabelText('Column 1 name'), 'Ticket ID');
    await userEvent.selectOptions(screen.getByLabelText('Column 1 type'), 'integer');
    await userEvent.click(screen.getByLabelText('Column 1 required'));
    await userEvent.type(screen.getByLabelText('Column 1 aliases'), 'Ticket #, id');
    await userEvent.selectOptions(screen.getByLabelText('Add rule'), 'unique');
    await userEvent.click(screen.getByRole('button', { name: '+ Add column' }));
    await userEvent.type(screen.getByLabelText('Column 2 name'), 'Tags');
    await userEvent.selectOptions(screen.getByLabelText('Column 2 type'), 'multiselect');
    await userEvent.selectOptions(screen.getByLabelText('Column 2 delimiter'), ';');
    await userEvent.click(screen.getByRole('button', { name: 'Create template' }));

    expect(m.to('POST /api/templates')[0].body).toEqual({
      name: 'Support tickets',
      hasHeaderRow: true,
      allowExtraColumns: true,
      columns: [
        { key: 'ticket_id', name: 'Ticket ID', type: 'integer', required: true, delimiter: null, aliases: ['Ticket #', 'id'], rules: [{ type: 'unique', params: {}, severity: 'error' }] },
        { key: 'tags', name: 'Tags', type: 'multiselect', required: false, delimiter: ';', aliases: [], rules: [] },
      ],
    });
    expect(window.location.hash).toBe('#/templates');
  });

  it('catches problems before saving, jumps to the column, and re-checks live as they are fixed', async () => {
    const m = mockApi({});
    renderNew();
    await userEvent.type(screen.getByLabelText('Column 1 name'), 'Amount');
    await userEvent.selectOptions(screen.getByLabelText('Column 1 type'), 'number');
    await userEvent.click(screen.getByRole('button', { name: '+ Add column' }));
    await userEvent.type(screen.getByLabelText('Column 2 name'), 'Note');
    await userEvent.click(screen.getByLabelText('Column 1 name')); // select column 1 again
    await userEvent.selectOptions(screen.getByLabelText('Add rule'), 'min');
    await userEvent.type(screen.getByLabelText('Minimum value'), '5');
    await userEvent.selectOptions(screen.getByLabelText('Add rule'), 'max');
    await userEvent.type(screen.getByLabelText('Maximum value'), '1');
    await userEvent.click(screen.getByLabelText('Column 2 name')); // the rules panel now shows column 2
    await userEvent.click(screen.getByRole('button', { name: 'Create template' }));

    expect(m.calls).toHaveLength(0); // nothing sent
    expect(screen.getByText(/Fix the highlighted problems \(2\)/)).toBeInTheDocument();
    expect(screen.getByLabelText('Template name')).toHaveAccessibleDescription('Template name is required.');
    expect(screen.getByRole('heading', { name: 'Amount' })).toBeInTheDocument(); // jumped to the column with the rule error
    expect(screen.getByText('Minimum is greater than maximum.')).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText('Minimum value'));
    await userEvent.type(screen.getByLabelText('Minimum value'), '0');
    expect(screen.queryByText('Minimum is greater than maximum.')).toBeNull();
    await userEvent.type(screen.getByLabelText('Template name'), 'Amounts');
    expect(screen.queryByText(/Fix the highlighted problem/)).toBeNull();
  });

  it('server-side problems (duplicate name) are shown at the field and cleared on the next edit', async () => {
    mockApi({ 'POST /api/templates': apiError(409, 'name_taken', 'You already have a template with this name.', { name: 'You already have a template with this name.' }) });
    renderNew();
    await userEvent.type(screen.getByLabelText('Template name'), 'Support tickets');
    await userEvent.type(screen.getByLabelText('Column 1 name'), 'A');
    await userEvent.click(screen.getByRole('button', { name: 'Create template' }));
    expect(await screen.findByText('You already have a template with this name.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Template name'), ' 2');
    expect(screen.queryByText('You already have a template with this name.')).toBeNull();
  });

  it('a failure without field details is shown as a message', async () => {
    mockApi({ 'POST /api/templates': apiError(500, 'internal_error', 'Something went wrong. Please try again.') });
    renderNew();
    await userEvent.type(screen.getByLabelText('Template name'), 'T');
    await userEvent.type(screen.getByLabelText('Column 1 name'), 'A');
    await userEvent.click(screen.getByRole('button', { name: 'Create template' }));
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create template' })).toBeEnabled();
  });

  it('columns can be reordered and removed (the last one cannot be removed); type changes drop rules that no longer fit', async () => {
    mockApi({});
    renderNew();
    await userEvent.type(screen.getByLabelText('Column 1 name'), 'First');
    await userEvent.click(screen.getByRole('button', { name: '+ Add column' }));
    await userEvent.type(screen.getByLabelText('Column 2 name'), 'Second');
    expect(screen.getAllByRole('button', { name: 'Move up' })[0]).toBeDisabled();
    await userEvent.click(screen.getAllByRole('button', { name: 'Move down' })[0]);
    expect(screen.getByLabelText('Column 1 name')).toHaveValue('Second');
    await userEvent.click(screen.getAllByRole('button', { name: 'Move up' })[1]);
    expect(screen.getByLabelText('Column 1 name')).toHaveValue('First');
    await userEvent.click(screen.getByRole('button', { name: 'Remove column 2' }));
    expect(screen.queryByLabelText('Column 2 name')).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove column 1' })).toBeDisabled();

    await userEvent.selectOptions(screen.getByLabelText('Add rule'), 'max_length');
    expect(screen.getByRole('button', { name: '1 rule' })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Column 1 type'), 'boolean');
    expect(screen.getByRole('button', { name: 'Add rules' })).toBeInTheDocument();
  });

  it('file settings: header row and what to do with extra columns', async () => {
    const m = mockApi({ 'POST /api/templates': { status: 201, body: { template: templateDetail() } } });
    renderNew();
    await userEvent.type(screen.getByLabelText('Template name'), 'T');
    await userEvent.type(screen.getByLabelText('Column 1 name'), 'A');
    await userEvent.click(screen.getByLabelText('First row contains column names'));
    await userEvent.selectOptions(screen.getByLabelText(/Columns in the file that aren't in this template/), 'reject');
    await userEvent.click(screen.getByRole('button', { name: 'Create template' }));
    expect(m.calls[0].body).toMatchObject({ hasHeaderRow: false, allowExtraColumns: false });
  });

  it('Cancel returns to the list without saving', async () => {
    const m = mockApi({});
    renderNew();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(window.location.hash).toBe('#/templates');
    expect(m.calls).toHaveLength(0);
  });
});

describe('TemplateEditorPage: editing', () => {
  it('loads the saved template and saves the edit as the next version', async () => {
    const m = mockApi({
      'GET /api/templates/:id': { body: { template: templateDetail() } },
      'PUT /api/templates/:id': { body: { template: templateDetail({ version: 3 }) } },
    });
    renderEdit();
    expect(await screen.findByLabelText('Template name')).toHaveValue('Support tickets');
    expect(screen.getByText('Current: v2')).toBeInTheDocument();
    expect(screen.getByText(/Saving creates/)).toHaveTextContent('Saving creates version 3.');
    expect(screen.getByLabelText('Column 1 aliases')).toHaveValue('Ticket #');
    await userEvent.click(screen.getByLabelText('Column 3 name'));
    const panel = screen.getByRole('heading', { name: 'confidence' }).closest('aside')!;
    expect(within(panel).getByLabelText('Minimum value')).toHaveValue(0.6);
    expect(within(panel).getAllByLabelText('Severity')[0]).toHaveValue('warning');

    await userEvent.clear(screen.getByLabelText('Column 2 name'));
    await userEvent.type(screen.getByLabelText('Column 2 name'), 'Category');
    await userEvent.click(screen.getByRole('button', { name: 'Save as v3' }));
    const body = m.to('PUT')[0].body as { columns: { key: string; name: string }[] };
    expect(m.to('PUT')[0].path).toBe(`/api/templates/${ID(1)}`);
    expect(body.columns.map((c) => c.key)).toEqual(['ticket_id', 'category', 'confidence']); // unrenamed keys kept
    expect(window.location.hash).toBe('#/templates');
  });

  it("a template that doesn't exist (or isn't yours) shows a not-found page with a way back", async () => {
    mockApi({ 'GET /api/templates/:id': apiError(404, 'not_found', 'Template not found.') });
    renderEdit();
    expect(await screen.findByRole('heading', { name: 'Template not found.' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '← Back to Templates' })).toHaveAttribute('href', '#/templates');
  });
});
