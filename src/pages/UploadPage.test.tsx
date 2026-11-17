import { readFileSync } from 'node:fs';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { TemplateColumn } from '@datadesk/shared/rules';
import { apiError, mockApi } from '../test/mockApi';
import { ID, session, templateDetail, templateSummary } from '../test/data';
import { UploadPage } from './UploadPage';

const fixture = (name: string, as = name) => new File([readFileSync(`fixtures/${name}`)], as, { type: 'text/csv' });
const csvFile = (text: string, name = 'data.csv') => new File([text], name, { type: 'text/csv' });

const col = (c: Partial<TemplateColumn> & Pick<TemplateColumn, 'key' | 'type'>): TemplateColumn => ({
  name: c.key, required: false, delimiter: null, aliases: [], rules: [], ...c,
});
/** "Support tickets" as used by the reference files (4 errors + 7 warnings in tickets_oct.csv). */
const tickets = templateDetail({
  columns: [
    col({ key: 'ticket_id', type: 'integer', required: true, aliases: ['Ticket #'], rules: [{ type: 'unique', params: {}, severity: 'error' }] }),
    col({ key: 'text', type: 'text', required: true }),
    col({ key: 'label', type: 'select', required: true, rules: [{ type: 'allowed_values', params: { values: ['bug', 'praise', 'billing', 'question', 'feature_request'], case_sensitive: false }, severity: 'error' }] }),
    col({ key: 'tags', type: 'multiselect', delimiter: ',' }),
    col({ key: 'confidence', type: 'number', rules: [
      { type: 'min', params: { value: 0.6 }, severity: 'warning', message: 'Low confidence: double-check the label' },
      { type: 'max', params: { value: 1 }, severity: 'error' },
    ] }),
    col({ key: 'needs_review', type: 'boolean' }),
    col({ key: 'created_at', type: 'date', required: true }),
    col({ key: 'source_url', type: 'url' }),
  ],
});
const contacts = templateSummary({ id: ID(2), name: 'Customer contacts', isDefault: false, version: 1 });

function setup({ templates = [templateSummary(), contacts], detailDelayMs = 0, upload = { status: 201, body: { upload: { id: ID(500) } } } as object } = {}) {
  return mockApi({
    'GET /api/templates': { body: { templates } },
    'GET /api/templates/:id': async (_c, p) => {
      if (detailDelayMs) await new Promise((r) => setTimeout(r, detailDelayMs));
      return { body: { template: p.id === ID(1) ? tickets : templateDetail({ id: ID(2), versionId: ID(22), name: 'Customer contacts', version: 1, isDefault: false, columns: [col({ key: 'email', name: 'Email', type: 'email', required: true })] }) } };
    },
    'POST /api/uploads': upload as never,
  });
}
const choose = async (file: File) => {
  await userEvent.upload(screen.getByTestId('file-input'), file);
};
const precheck = () => screen.findByTestId('precheck');

describe('UploadPage, step 1', () => {
  it('preselects the default template and lists the columns it expects', async () => {
    setup();
    render(<UploadPage session={session} onLogout={() => {}} />);
    const select = await screen.findByLabelText('Template');
    await vi.waitFor(() => expect(select).toHaveValue(ID(1)));
    expect(within(select).getByRole('option', { name: '★ Support tickets · v2 (your default)' })).toBeInTheDocument();
    expect(await screen.findByText(/Expects 8 columns/)).toBeInTheDocument();
  });

  it('a template in the link (from "Use for upload") wins over the default', async () => {
    setup();
    render(<UploadPage session={session} onLogout={() => {}} arg={ID(2)} />);
    await vi.waitFor(() => expect(screen.getByLabelText('Template')).toHaveValue(ID(2)));
    expect(await screen.findByText(/Expects 1 column/)).toBeInTheDocument();
  });

  it('without templates it switches to "No template" and links to the builder', async () => {
    setup({ templates: [] });
    render(<UploadPage session={session} onLogout={() => {}} />);
    expect(await screen.findByText(/You have no templates yet/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create one' })).toHaveAttribute('href', '#/templates/new');
    expect(screen.getByRole('radio', { name: /No template/ })).toBeChecked();
  });

  it('stops files over 5 MB, empty files and files over 20,000 rows before anything is uploaded', async () => {
    const m = setup();
    render(<UploadPage session={session} onLogout={() => {}} />);
    await screen.findByText(/Expects 8 columns/);
    await choose(csvFile('x'.repeat(5 * 1024 * 1024 + 1), 'huge.csv'));
    expect(await screen.findByText(/"huge\.csv" is 5\.0 MB\. The limit is 5\.0 MB/)).toBeInTheDocument();
    await choose(csvFile('', 'empty.csv'));
    expect(await screen.findByText('"empty.csv" is empty.')).toBeInTheDocument();
    await choose(csvFile('a\n' + '1\n'.repeat(20_001), 'big.csv'));
    expect(await screen.findByText(/"big\.csv" has 20,001 rows\. The limit is 20,000/)).toBeInTheDocument();
    expect(m.to('POST')).toHaveLength(0);
  });

  it('a file can also be dropped on the drop zone', async () => {
    setup();
    render(<UploadPage session={session} onLogout={() => {}} />);
    await screen.findByText(/Expects 8 columns/);
    const zone = screen.getByText(/Drop a CSV file here/).closest('.dropzone')!;
    fireEvent.dragOver(zone, { dataTransfer: { files: [] } });
    expect(zone).toHaveClass('over');
    fireEvent.drop(zone, { dataTransfer: { files: [fixture('tickets_oct.csv')] } });
    expect(await precheck()).toHaveTextContent('4 errors in 4 rows · 7 warnings');
  });
});

describe('UploadPage, step 2 with a template', () => {
  it('matches headers (here by alias), pre-checks every row, and marks cells in the preview', async () => {
    setup();
    render(<UploadPage session={session} onLogout={() => {}} />);
    await screen.findByText(/Expects 8 columns/);
    // The reference file with its first header renamed to an alias and an extra "agent" column on every line
    const lines = readFileSync('fixtures/tickets_oct.csv', 'utf8').trim().split('\n');
    lines[0] = lines[0].replace(/^ticket_id,/, 'Ticket #,');
    const text = lines.map((l, i) => `${l},${i === 0 ? 'agent' : 'alice'}`).join('\n') + '\n';
    await choose(csvFile(text, 'tickets.csv'));
    expect(await precheck()).toHaveTextContent('Pre-check of all 40 rows: 4 errors in 4 rows · 7 warnings');
    expect(screen.getByLabelText('File column for ticket_id')).toHaveValue('0');
    expect(screen.getByText('matched by alias')).toBeInTheDocument();
    expect(document.querySelector('.match-table tr.extra')).toHaveTextContent(/not in template.*agent.*ignored/); // extra file column
    expect(screen.getByTitle('"n/a" is not a number')).toHaveClass('invalid');
    expect(screen.getAllByTitle('Low confidence: double-check the label')).toHaveLength(7);
    expect(screen.getByLabelText('Upload name')).toHaveValue('tickets');
  });

  it('changing a match re-checks live; one file column can only feed one template column', async () => {
    setup();
    render(<UploadPage session={session} onLogout={() => {}} />);
    await screen.findByText(/Expects 8 columns/);
    await choose(fixture('tickets_oct.csv'));
    await precheck();
    await userEvent.selectOptions(screen.getByLabelText('File column for confidence'), '');
    expect(await precheck()).toHaveTextContent('3 errors in 3 rows · 1 warning');
    expect(screen.getByText('Column "confidence" was not found in the file; it will be empty.')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('File column for text'), '4'); // "confidence" now feeds "text"
    expect(screen.getByText('chosen by you')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('File column for confidence'), '4'); // take it back
    expect(screen.getByLabelText('File column for text')).toHaveValue(''); // released from "text"
  });

  it('uploads the file with the mapping and opens the results page', async () => {
    const m = setup();
    render(<UploadPage session={session} onLogout={() => {}} />);
    await screen.findByText(/Expects 8 columns/);
    await choose(fixture('tickets_oct.csv'));
    await precheck();
    await userEvent.clear(screen.getByLabelText('Upload name'));
    await userEvent.type(screen.getByLabelText('Upload name'), 'October tickets');
    await userEvent.click(screen.getByRole('button', { name: 'Upload & validate →' }));
    await vi.waitFor(() => expect(window.location.hash).toBe(`#/uploads/${ID(500)}`));
    const form = m.to('POST /api/uploads')[0].form!;
    expect(JSON.parse(String(form.get('meta')))).toEqual({
      mode: 'template',
      name: 'October tickets',
      templateVersionId: tickets.versionId,
      mapping: { ticket_id: 0, text: 1, label: 2, tags: 3, confidence: 4, needs_review: 5, created_at: 6, source_url: 7 },
    });
    expect((form.get('file') as File).name).toBe('tickets_oct.csv');
  });

  it('shows server errors, and a missing upload name at the field', async () => {
    setup({ upload: apiError(400, 'validation_failed', 'This file has 25,000 rows. The limit is 20,000.') });
    render(<UploadPage session={session} onLogout={() => {}} />);
    await screen.findByText(/Expects 8 columns/);
    await choose(fixture('tickets_oct.csv'));
    await precheck();
    await userEvent.clear(screen.getByLabelText('Upload name'));
    await userEvent.click(screen.getByRole('button', { name: 'Upload & validate →' }));
    expect(screen.getByLabelText('Upload name')).toHaveAccessibleDescription('Give this upload a name.');
    await userEvent.type(screen.getByLabelText('Upload name'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Upload & validate →' }));
    expect(await screen.findByText('This file has 25,000 rows. The limit is 20,000.')).toBeInTheDocument();
    expect(window.location.hash).toBe('');
  });

  it('regression: a file chosen before the template finished loading is still matched', async () => {
    setup({ detailDelayMs: 300 });
    render(<UploadPage session={session} onLogout={() => {}} />);
    await vi.waitFor(() => expect(screen.getByLabelText('Template')).toHaveValue(ID(1)));
    fireEvent.drop(screen.getByText(/Drop a CSV file here/).closest('.dropzone')!, { dataTransfer: { files: [fixture('tickets_oct.csv')] } });
    expect(await precheck()).toHaveTextContent('4 errors in 4 rows · 7 warnings');
    expect(screen.getByLabelText('File column for ticket_id')).toHaveValue('0');
  });

  it('warns before upload when a file is not UTF-8', async () => {
    setup();
    render(<UploadPage session={session} onLogout={() => {}} />);
    await screen.findByText(/Expects 8 columns/);
    await choose(fixture('legacy_latin1.csv'));
    expect(await screen.findByText(/This file isn't valid UTF-8/)).toBeInTheDocument();
  });

  it('"Choose another file" goes back to step 1', async () => {
    setup();
    render(<UploadPage session={session} onLogout={() => {}} />);
    await screen.findByText(/Expects 8 columns/);
    await choose(fixture('tickets_oct.csv'));
    await precheck();
    await userEvent.click(screen.getByRole('button', { name: '← Choose another file' }));
    expect(screen.getByRole('heading', { name: 'How should this file be checked?' })).toBeInTheDocument();
  });
});

describe('UploadPage, step 2 without a template', () => {
  const vendors = 'vendor,contact_email,country,annual_spend\nAcme,ap@acme.test,US,120000\nGlobex,billing@globex.test,Germany,87000\nInitech,ops@initech.test,GB,43500\n';

  async function start() {
    const m = setup();
    render(<UploadPage session={session} onLogout={() => {}} />);
    await screen.findByText(/Expects 8 columns/);
    await userEvent.click(screen.getByRole('radio', { name: /No template/ }));
    await choose(csvFile(vendors, 'vendors.csv'));
    await precheck();
    return m;
  }

  it('detects each column type; rules added to a column re-check the file live', async () => {
    await start();
    expect(screen.getByLabelText('Column 2 type')).toHaveValue('email');
    expect(screen.getByLabelText('Column 4 type')).toHaveValue('integer');
    expect(await precheck()).toHaveTextContent('no problems found');
    await userEvent.click(screen.getByLabelText('Column 3 name'));
    await userEvent.selectOptions(screen.getByLabelText('Add rule'), 'allowed_values');
    await userEvent.type(screen.getByLabelText('Allowed values', { exact: true }), 'US{Enter}GB');
    expect(await precheck()).toHaveTextContent('1 error in 1 row');
    expect(screen.getByTitle(/"Germany" is not allowed/)).toHaveClass('invalid');
  });

  it('excluded columns leave the preview; required makes empty cells errors; an incomplete rule blocks upload', async () => {
    const m = await start();
    await userEvent.click(screen.getByLabelText('Include annual_spend'));
    expect(screen.queryByRole('columnheader', { name: /annual_spend/ })).toBeNull();
    await userEvent.click(screen.getByLabelText('Column 3 name'));
    await userEvent.selectOptions(screen.getByLabelText('Add rule'), 'allowed_values');
    await userEvent.click(screen.getByRole('button', { name: 'Upload & validate →' }));
    expect(screen.getByText('Add at least one value.')).toBeInTheDocument();
    expect(screen.getByText('Fix the highlighted problems in the column settings first.')).toBeInTheDocument();
    expect(m.to('POST')).toHaveLength(0);
  });

  it('uploads the chosen columns with their rules and positions in the file', async () => {
    const m = await start();
    await userEvent.click(screen.getByLabelText('Include contact_email'));
    await userEvent.selectOptions(screen.getByLabelText('Column 4 type'), 'number');
    await userEvent.click(screen.getByRole('button', { name: 'Upload & validate →' }));
    await vi.waitFor(() => expect(m.to('POST')).toHaveLength(1));
    const meta = JSON.parse(String(m.to('POST')[0].form!.get('meta')));
    expect(meta).toMatchObject({ mode: 'adhoc', name: 'vendors', hasHeaderRow: true });
    expect(meta.columns.map((c: { key: string; type: string; sourceIndex: number }) => `${c.key}:${c.type}@${c.sourceIndex}`)).toEqual([
      'vendor:text@0', 'country:text@2', 'annual_spend:number@3',
    ]);
  });

  it('without a header row, columns are named "Column N" and the first line is data', async () => {
    await start();
    await userEvent.click(screen.getByLabelText('First row contains column names'));
    expect(screen.getByLabelText('Column 1 name')).toHaveValue('Column 1');
    expect(await precheck()).toHaveTextContent('Pre-check of all 4 rows');
  });

  it('multi-value columns can change their delimiter', async () => {
    setup();
    render(<UploadPage session={session} onLogout={() => {}} />);
    await screen.findByText(/Expects 8 columns/);
    await userEvent.click(screen.getByRole('radio', { name: /No template/ }));
    await choose(csvFile('tags\n' + Array(12).fill('"ux, web"\nmobile\n"web, payments"').join('\n'), 'tags.csv'));
    await precheck();
    expect(screen.getByLabelText('Column 1 type')).toHaveValue('multiselect');
    await userEvent.selectOptions(screen.getByLabelText('Column 1 delimiter'), ';');
    expect(screen.getByLabelText('Column 1 delimiter')).toHaveValue(';');
  });
});

describe('UploadPage: sample file', () => {
  it('"Try the sample file" loads the built-in example', async () => {
    setup();
    render(<UploadPage session={session} onLogout={() => {}} />);
    await screen.findByText(/Expects 8 columns/);
    await userEvent.click(screen.getByRole('button', { name: 'Try the sample file' }));
    expect(await precheck()).toHaveTextContent('Pre-check of all 40 rows');
    expect(screen.getByText(/ml-review-sample\.csv/)).toBeInTheDocument();
  });

  it('#/upload/sample opens with the sample already loaded', async () => {
    setup();
    render(<UploadPage session={session} onLogout={() => {}} arg="sample" />);
    expect(await precheck()).toHaveTextContent('Pre-check of all 40 rows');
  });
});
