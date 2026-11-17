# DataDesk: CSV uploader with templates and rules

Define CSV templates (columns, types, rules), upload files against them (or set up columns and rules on
the fly), and get every problem back: on screen, in an error report, and in a corrected file in your
template's format. Files are validated in the background, and the uploads list shows each file's status live.

**Release:** v0.1.0 (Phase 1). See [`RELEASE_NOTES.md`](RELEASE_NOTES.md) · [screenshots of every tested flow](docs/screenshots/README.md)

## Run it (Docker, production build)
```bash
cp .env.example .env            # set POSTGRES_PASSWORD, and the same password in DATABASE_URL
npm run docker:up               # Postgres, migrations, API, background worker, web
open http://localhost:8000      # sign up, create a template, upload a CSV
```
Optional: `npm run docker:seed` loads demo data (its demo user has no usable password; sign up instead).

## Develop
```bash
cp .env.example .env
npm install
npm run db:up                   # Postgres in Docker + migrations (or any PostgreSQL 16, then npm run db:migrate)
npm run dev:all                 # API :3000, worker, UI :5173 (proxies /api), all with live reload
```

| Area | Command | What it does |
|---|---|---|
| Dev | `npm run dev:all` | API, worker and UI together (or `dev:api`, `dev:worker`, `dev:ui`) |
| Database | `npm run db:up` / `db:down` | start Postgres in Docker and apply migrations / stop it (data kept) |
| | `npm run db:migrate` / `db:rollback` / `db:status` | apply / undo the last / list migrations (dbmate) |
| | `npm run db:seed` / `db:test` | load the demo data / run the database schema tests |
| | `npm run db:reset` | **dev only:** drop, recreate, migrate, seed (refuses production and non-local hosts) |
| Docker | `npm run docker:up` / `docker:down` / `docker:logs` | start / stop / follow the full stack |
| | `npm run docker:reset` | **deletes all Docker data**, then rebuilds |
| Quality | `npm test` | unit + UI component tests (rules, parsing, validation, every page and component in jsdom) |
| | `npm run coverage` | the same, with a coverage report in `coverage/` (fails below 95% statements / 90% branches) |
| | `npm run test:api` | API + worker tests against the database in `DATABASE_URL` |
| | `npm run e2e` | end-to-end browser tests; **installs Playwright's browser on first run** (see below) |
| | `npm run e2e:screenshots` | same, and refreshes `docs/screenshots/` |
| | `npm run typecheck` / `build` | type checks (web, server, e2e) / production build of web and server |
| | `npm run check:lockfile` | verifies `package-lock.json` lists every platform-specific binary (also part of `npm test`) |

**About `package-lock.json`:** Vite (via Rollup), esbuild, argon2 and dbmate download a native binary for
your OS as an *optional* dependency. Only regenerate the lockfile with access to the public npm registry;
otherwise npm silently drops the other platforms and `npm ci` fails elsewhere with
`Cannot find module @rollup/rollup-<platform>`. `npm test` checks for this.

## End-to-end tests
Real browser (Playwright + Chromium) → UI → API → PostgreSQL, with the real background worker.

**Prerequisites:** a `.env` file and a running PostgreSQL (`npm run db:up`). That's all: `npm run e2e` takes care of the rest.

**Playwright's browser is not installed by `npm install`.** The `@playwright/test` package is a normal dev
dependency, but Chromium itself is a separate ~150 MB download (`npx playwright install chromium`). Run
directly, `npx playwright test` fails on a fresh machine with *"Executable doesn't exist … run npx playwright
install"*. `npm run e2e` (`scripts/e2e.mjs`) checks first and fixes what it can:

| Check | If it's missing |
|---|---|
| `@playwright/test` package | runs `npm install` |
| Chromium for Playwright | runs `npx playwright install chromium` (needs internet; once per machine and Playwright version) |
| `.env` file | stops and shows how to create it |
| Database reachable and migrated | applies pending migrations; if Postgres isn't running, stops and says `npm run db:up` |

Then it runs the tests. Extra arguments go straight to Playwright:
```bash
npm run e2e                              # all specs (the API and UI dev servers are started for you)
npm run e2e -- e2e/d1-login.spec.ts      # one spec
npm run e2e -- --headed                  # watch the browser
npm run e2e -- --ui                      # Playwright's interactive runner
npm run e2e:screenshots                  # also refresh docs/screenshots/
```
Behind a proxy, or on Linux without the browser's system libraries: `npx playwright install chromium`
(with `HTTPS_PROXY` set) or `sudo npx playwright install-deps chromium`. In CI, `npx playwright install --with-deps chromium`.

## How it works
```
browser ──(pre-check: shared/ rules)──► POST /api/uploads ──► uploads row "queued" + file (one transaction)
                                                                    │
               results page / list poll ◄── status + issues ◄── worker: claim (SKIP LOCKED) → validate (same shared/ code) → save
```
- `shared/` holds the rules engine and file validation, used by **both** the browser pre-check and the worker, so they always agree.
- The queue is the `uploads` table. Workers claim jobs with `FOR UPDATE SKIP LOCKED`, so any number can run, and results are written in one transaction.
- Templates are versioned: every save creates an immutable version, and each upload records the exact version and column mapping it was checked with.

## Repository layout
```
src/        React web app                  shared/   rules, parsing, validation (web + worker)
server/     Fastify API + worker           db/       migrations, seed, schema tests
e2e/        Playwright end-to-end tests    fixtures/ reference CSV files used by the tests
docker/     Dockerfiles, nginx config      docs/     plan, database design, mockups, screenshots
```

## Documentation
- [`docs/PLAN.md`](docs/PLAN.md): scope, decisions, milestones and the progress log
- [`docs/DATABASE.md`](docs/DATABASE.md): schema, ERD, worker protocol, limits
- [`docs/COMPETITOR_ANALYSIS.md`](docs/COMPETITOR_ANALYSIS.md) · [`docs/mockups/`](docs/mockups/mockups.html) · [`docs/screenshots/`](docs/screenshots/README.md)
