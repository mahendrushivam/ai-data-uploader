/** Done when (D1): "User should be able to login to the platform". */
import { expect, test } from '@playwright/test';
import { newEmail, shot } from './support/helpers';

test('D1: sign up, sign out, a wrong password is refused, sign in, the session survives a reload', async ({ page }) => {
  const email = newEmail();
  await page.goto('/');
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Name').fill('Priya Shah');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password123');
  await shot(page, '01-sign-up');
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page.getByRole('heading', { name: 'My uploads' })).toBeVisible();
  await expect(page.getByText('No uploads yet')).toBeVisible();
  await shot(page, '02-home-no-uploads-yet');

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('not my password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Incorrect email or password.')).toBeVisible();
  await shot(page, '03-sign-in-wrong-password');

  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Priya Shah')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'My uploads' })).toBeVisible();
});

test('D1: a password shorter than 8 characters is refused by the server, with the message under the field', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Name').fill('Short');
  await page.getByLabel('Email').fill(newEmail());
  // bypass the browser's own minlength check to prove the server enforces the rule too
  await page.getByLabel('Password').evaluate((el: HTMLInputElement) => el.removeAttribute('minlength'));
  await page.getByLabel('Password').fill('1234567');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Password must be at least 8 characters.')).toBeVisible();
});
