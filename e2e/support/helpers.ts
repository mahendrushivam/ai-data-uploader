import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';

export const FIXTURES = 'fixtures';

/** Saves docs/screenshots/<name>.png when SCREENSHOTS=1 (npm run e2e:screenshots); a no-op otherwise. */
export async function shot(page: Page, name: string, opts: { fullPage?: boolean } = {}) {
  if (process.env.SCREENSHOTS !== '1') return;
  mkdirSync('docs/screenshots', { recursive: true });
  await page.waitForTimeout(150); // let animations settle
  await page.screenshot({ path: `docs/screenshots/${name}.png`, fullPage: opts.fullPage ?? false });
}

export const newEmail = () => `e2e-${randomUUID().slice(0, 8)}@e2e.test`;

/** Signs up through the real form and waits for the signed-in home page. */
export async function signUp(page: Page, name = 'Priya Shah', email = newEmail(), password = 'password123') {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  return { email, password };
}

/** "Support tickets": the reference template the fixture files are checked against. */
export const SUPPORT_TICKETS = {
  name: 'Support tickets',
  description: 'Weekly export of labelled support tickets',
  columns: [
    { key: 'ticket_id', name: 'ticket_id', type: 'integer', required: true, aliases: ['Ticket #'], rules: [{ type: 'unique', params: {} }] },
    { key: 'text', name: 'text', type: 'text', required: true, rules: [{ type: 'max_length', params: { value: 500 } }] },
    { key: 'label', name: 'label', type: 'select', required: true, rules: [{ type: 'allowed_values', params: { values: ['bug', 'praise', 'billing', 'question', 'feature_request'] } }] },
    { key: 'tags', name: 'tags', type: 'multiselect', delimiter: ',' },
    { key: 'confidence', name: 'confidence', type: 'number', rules: [
      { type: 'min', params: { value: 0.6 }, severity: 'warning', message: 'Low confidence: double-check the label' },
      { type: 'max', params: { value: 1 } },
    ] },
    { key: 'needs_review', name: 'needs_review', type: 'boolean' },
    { key: 'created_at', name: 'created_at', type: 'date', required: true },
    { key: 'source_url', name: 'source_url', type: 'url' },
  ],
};

/** Creates a template through the API (for specs where building it in the UI isn't what's being tested). */
export async function createTemplate(page: Page, body: object = SUPPORT_TICKETS, makeDefault = false) {
  const res = await page.request.post('/api/templates', { data: body });
  expect(res.status()).toBe(201);
  const t = (await res.json()).template;
  if (makeDefault) await page.request.put(`/api/templates/${t.id}/default`, { data: { isDefault: true } });
  return t as { id: string; versionId: string; name: string };
}

/** New upload with the preselected/chosen template, up to the results page. */
export async function uploadWithTemplate(page: Page, file: string, name: string) {
  await page.goto('/#/upload');
  await page.getByTestId('file-input').setInputFiles(file);
  await expect(page.getByTestId('precheck')).toBeVisible();
  await page.getByLabel('Upload name').fill(name);
  await page.getByRole('button', { name: 'Upload & validate →' }).click();
  await expect(page.getByTestId('upload-status')).toBeVisible();
}
