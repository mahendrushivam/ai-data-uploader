/** Done when (D3): "User should be able to see errors, if any, from parsing the file for the selected template or rules". */
import { readFileSync } from 'node:fs';
import type { ChildProcess } from 'node:child_process';
import { expect, test, type Download } from '@playwright/test';
import { createTemplate, FIXTURES, shot, signUp, uploadWithTemplate } from './support/helpers';
import { startWorker, stopWorker } from './support/worker';

let worker: ChildProcess;
test.beforeAll(async () => {
  worker = await startWorker();
});
test.afterAll(async () => stopWorker(worker));

const text = async (d: Download) => readFileSync((await d.path())!, 'utf8').replace(/^\uFEFF/, '');

test('D3 (template): errors and warnings on the results page, the Data tab, the downloads and the fix-and-reupload loop', async ({ page }) => {
  await signUp(page);
  await createTemplate(page, undefined, true);
  await uploadWithTemplate(page, `${FIXTURES}/tickets_oct.csv`, 'October tickets');

  await expect(page.getByTestId('upload-status')).toHaveText('Failed validation');
  await expect(page.getByTestId('error-count')).toHaveText('4');
  await expect(page.getByTestId('warning-count')).toHaveText('7');
  await page.getByRole('button', { name: /^Errors/ }).click();
  const issues = page.getByTestId('issue-table').locator('tbody tr');
  await expect(issues).toHaveCount(4);
  await expect(issues.nth(0)).toContainText('"n/a" is not a number');
  await expect(issues.nth(1)).toContainText('"not-a-link" is not a valid URL');
  await expect(issues.nth(2)).toContainText('"2026-13-45" is not a valid date');
  await expect(issues.nth(3)).toContainText('"maybe" is not true/false');
  await shot(page, '09-result-failed-validation');

  await page.getByRole('tab', { name: /Data/ }).click();
  const data = page.getByTestId('data-table');
  await expect(data.locator('td.invalid')).toHaveCount(4);
  await expect(data.locator('td.warn')).toHaveCount(7);
  await page.getByRole('button', { name: /Rows with issues/ }).click();
  await expect(data.locator('tbody tr')).toHaveCount(11);
  await shot(page, '10-result-data-tab');

  const [report] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: '↓ Error report' }).click()]);
  expect(report.suggestedFilename()).toBe('October tickets_errors.csv');
  const lines = (await text(report)).trim().split(/\r?\n/);
  expect(lines[0]).toBe('row,column,value,severity,problem');
  expect(lines.slice(1, 5).map((l) => l.split(',').slice(0, 2).join(' '))).toEqual(['4 confidence', '12 source_url', '18 created_at', '26 needs_review']);

  const [marked] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: '↓ File with errors marked' }).click()]);
  const markedCsv = await text(marked);
  expect(markedCsv.split(/\r?\n/)[0].endsWith(',__errors')).toBe(true);

  // Fix the four cells in the downloaded file (as in Excel) and upload it again as a new entry
  const fixed = markedCsv
    .replace(',n/a,', ',0.98,')
    .replace('not-a-link', 'https://support.example.com/tickets/1011')
    .replace('2026-13-45', '2026-10-18')
    .replace(',maybe,', ',no,');
  await page.getByRole('button', { name: '⇪ Upload corrected file' }).click();
  await page.getByTestId('file-input').setInputFiles({ name: 'October tickets_fixed.csv', mimeType: 'text/csv', buffer: Buffer.from(fixed) });
  await expect(page.getByTestId('precheck')).toContainText('0 errors in 0 rows · 7 warnings');
  await page.getByLabel('Upload name').fill('October tickets (corrected)');
  await page.getByRole('button', { name: 'Upload & validate →' }).click();
  await expect(page.getByTestId('upload-status')).toHaveText('Passed with warnings');
  await expect(page.getByTestId('data-table')).toBeVisible(); // a passed upload opens on its data
  await shot(page, '11-result-passed-with-warnings');

  const [tf] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: '↓ Download in template format' }).click()]);
  expect((await text(tf)).split(/\r?\n/)[0]).toBe('ticket_id,text,label,tags,confidence,needs_review,created_at,source_url');
});

test('D3 (rules added during upload, no template): the new rule flags cells live, and the worker reports them', async ({ page }) => {
  await signUp(page);
  await page.goto('/#/upload');
  await page.getByText('No template', { exact: true }).first().click();
  await page.getByTestId('file-input').setInputFiles({
    name: 'vendors.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('vendor,contact_email,country,annual_spend\nAcme Ltd,ap@acme.test,US,120000\nGlobex,billing@globex.test,Germany,87000\nInitech,ops@initech,GB,43500\nUmbrella,finance@umbrella.test,U.K.,61000\n'),
  });
  // Only 3 of 4 values look like emails (75% < the 90% detection threshold), so the column is detected as
  // text. The user sets it to Email, and the pre-check immediately flags the bad address.
  await expect(page.getByLabel('Column 2 type')).toHaveValue('text');
  await page.getByLabel('Column 2 type').selectOption('email');
  await expect(page.getByTestId('precheck')).toContainText('1 error in 1 row');
  await page.getByLabel('Column 3 name').click();
  await page.getByLabel('Add rule').selectOption('allowed_values');
  await page.getByLabel('Allowed values', { exact: true }).fill('US\nGB\nDE\nIN');
  await expect(page.getByTestId('precheck')).toContainText('3 errors in 3 rows');
  await shot(page, '12-upload-no-template-live-rule');
  await page.getByLabel('Upload name').fill('Vendor list');
  await page.getByRole('button', { name: 'Upload & validate →' }).click();
  await expect(page.getByTestId('upload-status')).toHaveText('Failed validation');
  await expect(page.getByTestId('issue-table')).toContainText('"Germany" is not allowed (allowed: US, GB, DE, IN).');
  await expect(page.getByTestId('issue-table')).toContainText('"ops@initech" is not a valid email');
  await shot(page, '13-result-no-template-rule-errors');
});

test('D3 (parsing): malformed CSV and a missing required column are reported; a non-UTF-8 file can\'t be read', async ({ page }) => {
  await signUp(page);
  await createTemplate(page, undefined, true);
  await uploadWithTemplate(
    page,
    { name: 'broken.csv', mimeType: 'text/csv', buffer: Buffer.from('ticket_id,text,label\n1,"unclosed,bug\n2,ok,bug,extra\n') } as never,
    'Broken export',
  );
  await expect(page.getByTestId('upload-status')).toHaveText('Failed validation');
  await expect(page.getByText('unreadable CSV')).toBeVisible();
  await expect(page.locator('button.by-col', { hasText: 'created_at' })).toContainText('column not in file (1)'); // required
  await shot(page, '14-result-parse-errors');

  await uploadWithTemplate(page, `${FIXTURES}/legacy_latin1.csv`, 'Legacy export');
  await expect(page.getByTestId('upload-status')).toHaveText("Couldn't read file");
  await expect(page.getByTestId('error-box')).toContainText('The file is not valid UTF-8 (byte 0xE9 on line 2).');
  await shot(page, '15-result-couldnt-read-file');
});
