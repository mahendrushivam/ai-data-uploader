# DataDesk v0.1.0 (Phase 1)

## What's in it

| Task requirement | Delivered | Proven by |
|---|---|---|
| Log in to the platform | Sign up, sign in, sign out. Passwords hashed with argon2id, at least 8 characters. httpOnly session cookie (only its hash is stored), 14-day sliding expiry, revoked on sign-out. Rate limit of 5 failures per email and 20 per IP in 15 min. Same-origin check on every change. | `e2e/d1-login.spec.ts`, `server/src/auth/auth.test.ts` (23 tests) |
| Create a **default** CSV template and use it for uploads | Template builder: columns, 9 types, required, header aliases, and 7 rule types (min, max, min/max length, regex, allowed values, unique), each an error or a warning, with custom messages. Every save is a new immutable version. One default per user, preselected on upload. | `e2e/d2-default-template.spec.ts`, `templates.test.ts`, `rules.test.ts` |
| Add individual rules | In templates, and live while uploading without a template (cells are re-checked as you type) | `e2e/d3-errors.spec.ts` (no-template test) |
| Upload a file | 5 MB / 20,000-row limits (browser and server). Headers matched by name, similar name or alias, with manual override. Whole-file pre-check in the browser that never blocks an upload. | `e2e/d2…`, `uploads.test.ts` (19 tests) |
| See errors for the selected template or rules, including **parsing** errors | Background worker. Results page with counts, issues by column, and a filterable, paged issue table. Parse errors (quotes, row length, duplicate/missing/extra columns, empty file, row limit). Files that aren't UTF-8 get the exact byte and line. | `e2e/d3-errors.spec.ts`, `worker.test.ts` (13 tests), `upload.test.ts` |
| Download the updated file per the defined schema | **Template format** (template columns, order and names; normalised dates, booleans and numbers; invalid values kept as-is), **file with errors marked** (re-uploadable as-is), **error report**, original | `e2e/d3…` (download → fix → re-upload round trip), `worker.test.ts` |
| View the extracted data when logged in | Data tab: read-only paged table with typed values, error and warning cells marked, reason on hover, "rows with issues" filter | `e2e/d3…`, `listing.test.ts` |
| Listing with statuses | My uploads: status chips with counts, template filter, search, live updates for queued and validating files (banner plus "waiting / checking for" timers), remove with a confirmation dialog | `e2e/listing.spec.ts`, `listing.test.ts` (10 tests) |
| Database schema with templates and rules | PostgreSQL 16 with 4 dbmate migrations (users, sessions, login attempts, templates → versions → columns → rules, uploads, files, rows, issues) | `db/tests/schema_tests.sql` (52 tests) |

**Accessibility:** form hints and errors are linked to their inputs (`aria-describedby`, `aria-invalid`) rather than put inside labels; the confirmation dialog is a focus-trapped `alertdialog`.

**Privacy:** every endpoint returns 404 to other users and 401 without a session (`server/src/security.test.ts`).
Another user opening someone else's upload URL sees "not found" (e2e).

## Test totals at release
| Suite | Count | Command |
|---|---|---|
| Unit: rules engine, parsing, validation, web logic (API client, template drafts, helpers), lockfile check | 142 | `npm test` |
| UI components and pages (React Testing Library in jsdom; every page, component and the app shell) | 92 | `npm test` / `npm run test:ui` |
| API + worker (real PostgreSQL) | 89 | `npm run test:api` |
| Database schema | 52 | `npm run db:test` |
| End-to-end (browser + API + worker + DB) | 8 | `npm run e2e` (installs Playwright's Chromium on first run) |

**Coverage** of the web app and the shared code (`npm run coverage`): **98.4% statements, 93.7% branches**.
Every page and component is at 96.7–100% statements. The build fails below 95% statements / 90% branches.

## Upgrading / first run
- Apply migrations: `npm run db:migrate` (Docker does this automatically through the `migrate` service).
- Demo data (`db:seed` / `docker:seed`): its demo user can't sign in by design (no hard-coded password). Sign up instead.

## Fixed before release
- **`package-lock.json` was missing the macOS, Windows and Alpine binaries of Rollup (used by Vite) and dbmate.**
  This happened when the lockfile was regenerated in the build sandbox, whose registry mirror only has Linux packages.
  It caused `Cannot find module @rollup/rollup-<platform>` on `npm install` / `npm run dev` on macOS and Windows.
  The Docker web build (Alpine) was probably affected too. The 30 missing entries were restored, and `npm test` now fails
  if any platform binary is missing (`scripts/lockfile.mjs`). 26 of the restored entries have no integrity hash yet,
  because the build sandbox can't download them: **run `npm install` once on a normal machine and commit the
  updated lockfile**, which records their hashes.

## Known limits
- **Docker was not run in the build environment.** The images, compose file and nginx config were checked against the Compose schema and by running the same build and install steps outside Docker (compiled server, production-only dependencies, CSP headers in a browser). **Please run `npm run docker:up` once before deploying.**
- Set `COOKIE_SECURE=true` wherever the app is served over HTTPS. The local `.env.example` turns it off for plain `http://localhost`.
- The uploads list shows the newest 100 uploads (no pagination yet). Stored issues are capped at 100,000 per upload (counts stay exact).
- Uploads can't be edited in the app: fix the downloaded file and upload it again (agreed Phase 1 behaviour).
- Expired sessions and old login attempts are not cleaned up yet (planned retention job).

## Deferred
**Phase 1.1:**
- full Excel-style grid on the Data tab;
- create a template from a CSV file;
- duplicate and version history;
- "save as template" from an upload without a template;
- listing pagination;
- CI pipeline, metrics and logging dashboards.

**Phase 2:**
- fix errors in the app and re-validate;
- password reset and email verification;
- SSO;
- learned header aliases;
- bulk fixes;
- team templates;
- sending data to other systems.
