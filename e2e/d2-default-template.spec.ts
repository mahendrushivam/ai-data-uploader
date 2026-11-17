/** Done when (D2): "User should be able to create default csv template and use it for file upload". */
import type { ChildProcess } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { FIXTURES, shot, signUp } from './support/helpers';
import { startWorker, stopWorker } from './support/worker';

let worker: ChildProcess;
test.beforeAll(async () => {
  worker = await startWorker();
});
test.afterAll(async () => stopWorker(worker));

test('D2: build a template in the builder, make it the default, and upload a file with it', async ({ page }) => {
  await signUp(page);
  await page.getByRole('link', { name: 'Templates' }).click();
  await page.getByRole('button', { name: '+ New template' }).click();

  await page.getByLabel('Template name').fill('Support tickets');
  await page.getByLabel('Description (optional)').fill('Weekly export of labelled support tickets');
  const col = (n: number, name: string, type: string) => async () => {
    if (n > 1) await page.getByRole('button', { name: '+ Add column' }).click();
    await page.getByLabel(`Column ${n} name`).fill(name);
    await page.getByLabel(`Column ${n} type`).selectOption(type);
  };
  await col(1, 'ticket_id', 'integer')();
  await page.getByLabel('Column 1 required').check();
  await page.getByLabel('Column 1 aliases').fill('Ticket #, id');
  await page.getByLabel('Add rule').selectOption('unique');
  await col(2, 'label', 'select')();
  await page.getByLabel('Column 2 required').check();
  await page.getByLabel('Add rule').selectOption('allowed_values');
  await page.getByLabel('Allowed values', { exact: true }).fill('bug\npraise\nbilling\nquestion\nfeature_request');
  await col(3, 'confidence', 'number')();
  await page.getByLabel('Add rule').selectOption('min');
  await page.getByLabel('Minimum value').fill('5');
  await page.getByLabel('Add rule').selectOption('max');
  await page.getByLabel('Maximum value').fill('1');
  await col(4, 'needs_review', 'boolean')();
  await col(5, 'created_at', 'date')();
  await page.getByLabel('Column 5 required').check();
  await col(6, 'source_url', 'url')();

  // A mistake in the rules is caught before saving, next to the field
  await page.getByRole('button', { name: 'Create template' }).click();
  await expect(page.getByText('Minimum is greater than maximum.')).toBeVisible();
  await shot(page, '04-template-builder-validation');
  await page.getByLabel('Minimum value').fill('0.6');
  await page.locator('.rule-card').first().getByLabel('Severity').selectOption('warning');
  await page.locator('.rule-card').first().getByLabel('Custom message').fill('Low confidence: double-check the label');
  await expect(page.getByText('Minimum is greater than maximum.')).toHaveCount(0);
  await shot(page, '05-template-builder');
  await page.getByRole('button', { name: 'Create template' }).click();

  const card = page.getByTestId('template-card').filter({ hasText: 'Support tickets' });
  await expect(card).toContainText('6 columns · 4 rules');
  await card.getByRole('button', { name: '★ Set as default' }).click();
  await expect(card.getByText('★ Default')).toBeVisible();
  await shot(page, '06-templates-with-default');

  // The default is preselected on a new upload
  await page.getByRole('link', { name: 'Uploads' }).click();
  await page.getByRole('button', { name: '⇪ New upload' }).click();
  await expect(page.getByText('Expects 6 columns')).toBeVisible();
  await expect(page.getByLabel('Template', { exact: true }).locator('option:checked')).toContainText('★ Support tickets · v1 (your default)');
  await shot(page, '07-upload-step1-default-preselected');

  await page.getByTestId('file-input').setInputFiles(`${FIXTURES}/tickets_oct.csv`);
  await expect(page.getByText('matched by alias').or(page.getByText('same name')).first()).toBeVisible();
  await expect(page.getByTestId('precheck')).toContainText('4 errors in 4 rows · 7 warnings');
  await page.getByLabel('Upload name').fill('October tickets');
  await shot(page, '08-upload-step2-mapping-and-precheck');
  await page.getByRole('button', { name: 'Upload & validate →' }).click();

  await expect(page.getByTestId('upload-status')).toHaveText('Failed validation');
  await expect(page.getByText('Support tickets v1')).toBeVisible(); // the upload is linked to the template version it used
});
