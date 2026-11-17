# End-to-end tests

Run them with **`npm run e2e`**, not `npx playwright test`. The npm script (`scripts/e2e.mjs`) first makes sure
Playwright's Chromium is installed (it isn't part of `npm install`), that `.env` exists and that the database is
reachable and migrated, and then runs Playwright. See [End-to-end tests in the README](../README.md#end-to-end-tests).

| Spec | Covers |
|---|---|
| `d1-login.spec.ts` | Done-when D1: sign up, sign in, wrong password, 8-character minimum |
| `d2-default-template.spec.ts` | D2: build a template, make it the default, upload with it |
| `d3-errors.spec.ts` | D3: errors for a template, for rules added during upload, and for unreadable/malformed files |
| `listing.spec.ts` | uploads list with live queued → finished updates, filters, delete dialogs, privacy |

Each spec starts the real background worker itself (`support/worker.ts`); `support/helpers.ts` has the shared
steps and the screenshot helper (`npm run e2e:screenshots` writes `docs/screenshots/`).
