# DataDesk: Phase 1 release plan (4-hour time box)

Companion documents:
- [`DATABASE.md`](./DATABASE.md): schema, Docker setup, worker protocol
- [`COMPETITOR_ANALYSIS.md`](./COMPETITOR_ANALYSIS.md): market comparison and Phase 2 ideas
- [`mockups/mockups.html`](./mockups/mockups.html): 11 screens; PNGs in `mockups/png/`

## 1. Requirements traceability

### Task description → plan
"CV uploader" is read as **CSV uploader**, matching everything else in the brief.

| # | Requirement (task description) | Covered by | Mockup |
|---|---|---|---|
| T1 | Add individual rules | M2: per-column rules in templates (7 types, error or warning). M3: rules added live during an upload without a template | 04, 07 |
| T2 | Default CSV templates | M2: the user creates templates and can **mark one as default**. M3: the default is **preselected** on upload. (Starter templates dropped by decision.) | 03, 05 |
| T3 | Database schema for CSV templates and rules | Done: `templates → template_versions → template_columns → column_rules`. M2 adds `templates.is_default` (migration 004) | ERD |
| T4 | Upload a file | M3: with a template or without one; 5 MB and 20,000-row limits | 05–07 |
| T5 | **Download the updated file as per the defined schema** | M4: **"Download in template format"**: template columns in template order with template names, extra columns dropped, values normalised (see §3). Optional `__errors` column for files with errors. Plus the error report and the original. | 09–11 |
| T6 | **Auto-extracted text viewable on the logged-in screen** | M3: live preview of the parsed file before upload. M5: **Data tab**, a read-only paged table of the extracted rows with invalid cells highlighted. | 06, 11 |
| T7 | Listing page with statuses | M5: status badges, **the template used for each upload (name and version)**, and **filters**: status chips with counts, template filter, search by name or file. The Templates page (M2) shows templates visually as cards. | 02, 03 |

### "Done when" → acceptance test
Each criterion is checked by an automated test in M6.

| # | Done when | Verified by |
|---|---|---|
| D1 | User can log in | M1 API tests, plus the M6 browser end-to-end run |
| D2 | User can create a default CSV template and use it for an upload | M6 end-to-end: create template → mark as default → new upload has it preselected → upload succeeds |
| D3 | User sees errors from parsing the file against the selected template or rules | M4 automated test: sample file → exactly **4 errors + 7 warnings**, plus a malformed file → parse errors (see §3), plus a Latin-1 file → readable `error` |

### Earlier requirements from this conversation (still covered)
Users create and use their own templates (M2, M3). Manual upload with real-time custom rules (M3).
Errors shown and downloadable after validation, and a corrected file becomes a new upload (M4).
Listing with statuses (M5). Login DB schema (done). Personal templates, 5 MB, 20,000 rows, 8-character
passwords, validation as a background worker job (all built in).

## 2. Budget and how we work
- **Total capacity: 4 hours (240 min):** 7 milestones = 230 min, plus a **10-minute buffer**.
- We work **one milestone at a time**. Each ends with a report: what was built, what was verified, and
  the actual time taken. The next starts after your OK. Review pauses count against the buffer.
- **Time boxes are hard.** If a milestone runs over, its *optional* items are dropped, not the next milestone.
- To make room for T5–T7, everything the task doesn't ask for has been made optional (§6).

## 3. Agreed decisions and definitions

| Topic | Decision |
|---|---|
| Templates | Personal only. **One default template per user** (none until the user picks one), preselected on upload. No starter templates (decision). |
| Listing | Status chips with counts, template filter (including "No template"), search by upload or file name, newest first, live status updates. |
| After errors | Show errors → download → fix outside the app → upload again as a **new entry** |
| Limits | 5 MB and 20,000 rows per file. Passwords of at least 8 characters. |
| Validation | The browser pre-check never blocks an upload. The API stores the file and **creates a worker job**. The worker validates in the background. |
| **"Updated file as per schema"** | Template columns in template order, named by the template. Extra file columns dropped. Valid values **normalised**: dates → `YYYY-MM-DD`, booleans → `true`/`false`, numbers without currency signs or thousands separators, multi-values joined with the template's delimiter, surrounding spaces trimmed. **Invalid values are exported unchanged**, never dropped or guessed. Optional `__errors` column. Formula-escaped. |
| **Parsing errors reported** | File-level: unreadable encoding (not UTF-8), empty file, unclosed quote, duplicate headers, required template column missing, more than 20,000 rows. Row-level: row has more or fewer cells than the header. Cell-level: type and rule violations. |
| Stack | Node 22 + Fastify + `pg` · PostgreSQL 16 · dbmate · existing React + Vite · Docker Compose |

## 4. Code layout (set up in M0)
```
src/                  existing React app (pages rewired to the API milestone by milestone)
shared/rules/         types, parsing, rules, normalisation, snapshot schema (used by browser AND worker)
server/               Node API + worker (one package, two entry points: api.ts, worker.ts)
db/                   migrations, seed, schema tests
docker-compose.yml    db + migrate (done) + api + worker + web (added in M0)
```

## 5. Milestones

| # | Milestone | Time box | Running total | Covers |
|---|---|---|---|---|
| M0 | Foundation | 20 min | 0:20 | n/a |
| M1 | Login | 25 min | 0:45 | D1 |
| M2 | Templates, rules and default template | 45 min | 1:30 | T1, T2, T3 |
| M3 | Upload flow | 35 min | 2:05 | T1, T2, T4, T6 (preview) |
| M4 | Background validation, errors and downloads | 50 min | 2:55 | T5, D3 |
| M5 | Listing with filters and extracted data view | 35 min | 3:30 | T6, T7 |
| M6 | Release and acceptance tests | 20 min | 3:50 | D1–D3 |
| | Buffer | 10 min | **4:00** | |

### M0: Foundation (20 min)
- Regenerate `package-lock.json`. The current one can't be installed here; with a fresh lockfile the prototype builds, which I've checked.
- `server/`: Fastify + `pg` + `GET /api/health`, and a Vite dev proxy for `/api`.
- `shared/rules/`: extract the type checks from `src/lib/columnTypes.ts`, with the first Vitest tests. App behaviour stays the same.
- Dockerfiles (API/worker image and web image with nginx) and the matching services in `docker-compose.yml`.

**Done when:** build and tests pass, and `/api/health` answers against the migrated DB.

### M1: Login (25 min), D1, mockup 01
- Signup, login, logout and "me". argon2id, at least 8 characters, generic error message, httpOnly session cookie (14-day sliding expiry, only the token hash stored), and 5 failures per 15 min rate limit.
- The existing login page calls the API. The localStorage auth and the demo button are removed.

**Done when:** API tests cover signup, duplicate email, short password, wrong password, rate limit, logout and an expired session.

### M2: Templates, rules and default template (45 min), T1–T3, mockups 03–04
- Rules engine in `shared/rules` (7 rule types, error or warning, custom message) and value normalisation (§3), each with unit tests. Regex runs on RE2 in the worker.
- Migration 004: `templates.is_default`, with a unique index allowing **at most one default per user**. Schema tests are extended to cover it.
- API: list, get, create (v1), save (inserts the next version), set default. Every query is filtered by owner.
- Web: Templates page as cards (★ Default badge, "Set as default") and a builder whose column/rule editor component is reused in M3.

**Optional:** archive, duplicate, "Try it", editing header aliases.
**Done when:** create → edit (v2) → set default all work, and an invalid rule is rejected by the API (test).

### M3: Upload flow (35 min), T1, T2, T4, T6, mockups 05–07
- Step 1: the **default template is preselected**, or the user picks another template or none. The browser checks the 5 MB and 20,000-row limits.
- Step 2 with a template: automatic header matching (exact, then ignoring case and spaces). **Live preview of the extracted data** with the whole file pre-checked, including parse problems.
- Step 2 without a template: detected types plus the M2 rule editor, with live counts.
- Submit: multipart to `POST /api/uploads`. The API re-checks the limits, then saves `uploads` and `upload_files` in one transaction with status `queued` (the worker job).

**Optional:** manually overriding a header match, "Save as template" from an upload without a template, and alias-based matching.
**Done when:** both paths create a queued upload (API test plus a browser smoke test).

### M4: Background validation, errors and downloads (50 min), T5, D3, mockups 08–10
- Worker: claim → parse → parsing checks (§3) → validate → write rows, issues, counts and status in one transaction. Stale jobs are reclaimed; after 3 failures the status becomes `error`.
- API: detail, paged issues, **`export.csv` (file in template format, `?errors=1` adds `__errors`)**, `errors.csv` (error report), original file.
- Web: results page (polls while in progress): counts, issues by column, issue table, and buttons **Download in template format**, **Download with errors marked**, **Error report**, **Upload corrected file**.

**Optional:** errors/warnings and column filters on the issue table.
**Done when (automated):** sample file → `failed_validation` with **4 errors + 7 warnings**. Corrected file → `passed_with_warnings`, and its export has template headers, order and normalised values. A malformed file gives the expected parse errors. Latin-1 → `error`.

### M5: Listing with filters and extracted data view (35 min), T6, T7, mockups 02 and 11
- Listing: `GET /api/uploads?status=&template=&q=` (newest first, all filters server-side). Columns: name and file, **template (name and version, or "No template")**, status badge, rows, issue counts, uploaded time, actions (view, download). **Status chips with counts, template dropdown, search box.** Polls while anything is queued or validating. Remove from list.
- **Data tab** on the results page: paged read-only table of the extracted rows (`upload_rows`, 50 per page), typed display (chips, checkboxes), invalid cells marked with their reason on hover, and a "rows with issues" toggle.

**Optional:** listing pagination (the list shows the newest 100), and the full Excel-style grid instead of a simple table.
**Done when:** all 6 demo statuses display correctly, each filter (status, template, search) narrows the list correctly (API test), an in-progress row updates without a reload, and the Data tab shows the 40 sample rows with the 4 errors highlighted.

### M6: Release and acceptance tests (20 min), D1–D3
- A browser end-to-end run of **D1 → D2 → D3**: sign up → create template → set as default → upload a bad file → see errors → download the error report and the template-format file → upload the corrected file → listing shows both with their statuses.
- Ownership test (user B gets 404 for user A's data). Remove the leftover localStorage code. README (`docker compose up`, dev setup), `RELEASE_NOTES.md`, tag `v0.1.0`.

**Done when:** all test suites and the end-to-end run pass.

## 6. Made optional to fit the 4 hours (not in the task description)

| Item | Mockup | Status |
|---|---|---|
| Template archive, duplicate, "Try it", editing header aliases | 03, 04 | optional in M2, otherwise Phase 1.1 |
| "Save as template" from an upload without a template, manual header-match override | 06, 07 | optional in M3, otherwise Phase 1.1 |
| Issue table filters | 09 | optional in M4 |
| Listing pagination (filters and search are in scope) | 02 | optional in M5 |
| Full Excel-style grid (M5 ships a simpler table) | 11 | Phase 1.1 |
| CI pipeline, metrics and logging dashboards | n/a | Phase 1.1 |

**If we fall behind after the optional items are gone**, cut in this order:
1. the issues-by-column summary (the issue table stays)
2. "rows with issues" toggle on the Data tab
3. the status-chip counts (the status filter stays)

Login security, the background worker, the error display, both downloads, the Data tab, the default template and the listing filters are **never cut**: they are the task.

Phase 2 (unchanged): fixing errors in the app, password reset and verification, SSO, learned aliases, bulk fixes, team templates, data destinations.

## 7. Risks

| Risk | Mitigation |
|---|---|
| **Docker can't run in this environment.** Dockerfiles and compose are written but not run here. | Everything is verified against a real PostgreSQL 16 with the same migrations. **Please run `docker compose up` after M0 and after M6 (about 5 min each).** |
| Only a 10-minute buffer | Hard time boxes, an explicit cut order, and actual time reported per milestone |
| Browser pre-check and worker disagree | Both use `shared/rules`. The M4 test checks exact counts. |


## 8. Progress log

| Milestone | Started (UTC) | Finished (UTC) | Took | Box | Notes |
|---|---|---|---|---|---|
| M0 Foundation | 06:26:21 | 06:33:19 | ~7 min* | 20 min | Scope change recorded (starter templates dropped). Lockfile regenerated. Docker files written but not run (no Docker here). |
| M0.1 Production Docker + dev commands (your request) | 06:39:22 | 06:42:12 | ~3 min* | buffer | Multi-stage images, compiled server, hardened nginx, db:/docker:/dev: commands |
| M1 Login | 06:42:35 | 06:46:01 | ~3 min* | 25 min | 29 API tests + 10-step browser smoke test. Found and fixed: Host/Origin mismatch behind the Vite and nginx proxies. Per-IP limit set to 20 (per-email stays 5). |
| M2 Templates, rules, default | 07:28:10 | 07:36:44 | ~9 min* | 45 min | 38 rule unit tests, 12 template API tests, 4 schema tests, 12-step browser test. Fixed: set-default race (proved by test), stale errors in builder, deep link lost at sign-in. Archive (optional) included. |
| M3 Upload flow (+ builder width fix) | 08:05:31 | 08:15:45 | ~10 min* | 35 min | Shared validateFile gives exactly 4 errors + 7 warnings on the reference file. 17 unit + 19 API tests, 12-step browser test. Fixed: preview re-validating on every render, upload button pushed below the fold. Manual header override included. |
| M4 Worker, results, downloads | 08:35:01 | 08:47:50 | ~13 min* | 50 min | All acceptance criteria automated (4 errors + 7 warnings; corrected → passed_with_warnings; Latin-1 → error with byte and line; download → fix → re-upload round trip). 13 worker/API tests, 12-step browser test. Found and fixed: race where a file chosen before the template loaded got an empty column mapping (reproduced 2/2 before the fix, 0/2 after). |
| M5 Listing + Data tab | 09:07:01 | 09:12:06 | ~5 min* | 35 min | All 6 demo statuses shown; status/template/search filters (10 API tests); in-progress rows update live (banner, waiting/checking timers); Data tab with 4 error + 7 warning cells marked. 10-step browser test on the seeded demo data. |
| M6 Release (+ confirm dialog, screenshots) | 09:32:30 | 09:44:25 | ~12 min* | 20 min | 8 end-to-end tests (D1–D3, listing, privacy) with the real worker; ownership test over every endpoint; prototype code removed; confirmation dialog; 21 screenshots generated by the tests; README, release notes, tag v0.1.0. |
| UI test coverage (your request) | 10:00:38 | 10:12:55 | ~12 min* | buffer | 92 component/page tests + 22 web-logic tests; coverage 98.4% statements (every UI file ≥96.7%), thresholds enforced. Found and fixed: form hints/errors inside labels (accessibility). |

\* Times come from the build sandbox clock, which may not include time spent between commands. Treat them as a lower bound; your own clock is the real budget.
