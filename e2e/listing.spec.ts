/** Listing with statuses (T7), live updates of queued files, delete confirmations, and privacy. */
import type { ChildProcess } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { createTemplate, FIXTURES, shot, signUp, uploadWithTemplate } from './support/helpers';
import { startWorker, stopWorker } from './support/worker';

let worker: ChildProcess | undefined;
test.afterAll(async () => stopWorker(worker));

test('queued files are visible and update live; filters; removing asks for confirmation in a dialog', async ({ page }) => {
  await signUp(page);
  const t = await createTemplate(page, undefined, true);

  // With the worker running: three finished uploads
  worker = await startWorker();
  await uploadWithTemplate(page, `${FIXTURES}/tickets_oct.csv`, 'October tickets');
  await expect(page.getByTestId('upload-status')).toHaveText('Failed validation');
  await uploadWithTemplate(page, `${FIXTURES}/tickets_oct_fixed.csv`, 'October tickets (corrected)');
  await expect(page.getByTestId('upload-status')).toHaveText('Passed with warnings');
  await uploadWithTemplate(page, `${FIXTURES}/legacy_latin1.csv`, 'Legacy export');
  await expect(page.getByTestId('upload-status')).toHaveText("Couldn't read file");

  // Worker paused: new uploads stay queued, and the list says so
  await stopWorker(worker);
  await uploadWithTemplate(page, `${FIXTURES}/tickets_oct_fixed.csv`, 'November tickets');
  await expect(page.getByTestId('upload-status')).toHaveText('Queued');
  await page.goto('/#/');
  const rows = page.getByTestId('upload-row');
  await expect(rows).toHaveCount(4);
  await expect(page.getByTestId('progress-banner')).toContainText('1 upload is being checked (1 waiting, 0 in progress)');
  await expect(rows.first()).toHaveAttribute('data-status', 'queued');
  await expect(rows.first()).toContainText('waiting');
  await shot(page, '16-list-with-queued-upload');

  // Worker back: the queued row finishes without a reload
  worker = await startWorker();
  await expect(rows.first()).toHaveAttribute('data-status', 'passed_with_warnings');
  await expect(page.getByTestId('progress-banner')).toHaveCount(0);
  await shot(page, '17-list-all-finished');

  // Filters
  const group = page.getByRole('group', { name: 'Filter by status' });
  await group.getByRole('button', { name: /^Failed validation/ }).click();
  await expect(rows).toHaveCount(1);
  await shot(page, '18-list-filtered-failed');
  await group.getByRole('button', { name: /^All/ }).click();
  await page.getByLabel('Search uploads').fill('corrected');
  await expect(rows).toHaveCount(1);
  await page.getByLabel('Search uploads').fill('');
  await expect(rows).toHaveCount(4);

  // Removing asks in a centred dialog; Escape cancels, the button confirms
  await page.getByRole('button', { name: 'Remove Legacy export' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Remove this upload?');
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await shot(page, '19-remove-upload-dialog');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(rows).toHaveCount(4);
  await page.getByRole('button', { name: 'Remove Legacy export' }).click();
  await dialog.getByRole('button', { name: 'Remove upload' }).click();
  await expect(rows).toHaveCount(3);

  // Template deletion uses the same dialog
  await page.getByRole('link', { name: 'Templates' }).click();
  await page.getByTestId('template-card').filter({ hasText: t.name }).getByRole('button', { name: 'Delete' }).click();
  await expect(dialog).toContainText('Delete this template?');
  await expect(dialog).toContainText('3 uploads already checked with it keep their results');
  await shot(page, '20-delete-template-dialog');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('template-card')).toHaveCount(1);
});

test("another user can't open someone else's upload", async ({ page, browser }) => {
  await signUp(page);
  await createTemplate(page, undefined, true);
  worker ??= await startWorker();
  await uploadWithTemplate(page, `${FIXTURES}/tickets_oct_fixed.csv`, 'Private upload');
  const url = page.url();

  const other = await (await browser.newContext()).newPage();
  await signUp(other, 'Someone Else');
  await other.goto(url);
  await expect(other.getByTestId('not-found')).toContainText('Upload not found.');
  await expect(other.getByRole('link', { name: '← Back to My uploads' })).toBeVisible();
  await shot(other, '21-other-users-upload-not-found');
});
