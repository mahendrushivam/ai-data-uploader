// Runs the end-to-end tests after making sure everything they need is in place:
//   1. the @playwright/test package            → installs it (npm install) if missing
//   2. the Chromium browser Playwright drives   → installs it (npx playwright install chromium) if missing
//   3. a .env file with DATABASE_URL            → explains how to create it
//   4. a reachable, migrated database           → applies migrations; explains how to start Postgres if it's down
// Then runs `playwright test`, passing through any extra arguments, e.g.
//   npm run e2e -- e2e/d1-login.spec.ts      npm run e2e -- --headed      npm run e2e -- --ui
// `--screenshots` (npm run e2e:screenshots) also refreshes docs/screenshots/.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const args = process.argv.slice(2);
const screenshots = args.includes('--screenshots');
const passThrough = args.filter((a) => a !== '--screenshots');
const isWindows = process.platform === 'win32';

const step = (msg) => console.log(`\x1b[36m[e2e]\x1b[0m ${msg}`);
const fail = (msg) => {
  console.error(`\x1b[31m[e2e]\x1b[0m ${msg}`);
  process.exit(1);
};
/** Runs a command with its output shown; returns true on success. */
const run = (cmd, cmdArgs, env = process.env) =>
  spawnSync(cmd, cmdArgs, { stdio: 'inherit', shell: isWindows, env }).status === 0;

// 1. The Playwright test runner (a devDependency; missing if `npm install` hasn't been run)
const require = createRequire(import.meta.url);
const hasPlaywright = () => {
  try {
    require.resolve('@playwright/test');
    return true;
  } catch {
    return false;
  }
};
if (!hasPlaywright()) {
  step('@playwright/test is not installed yet: running npm install …');
  if (!run('npm', ['install']) || !hasPlaywright()) fail('npm install failed; fix the error above and run npm run e2e again.');
}

// 2. The browser. Downloaded separately from the npm package, so a fresh checkout doesn't have it.
async function browserWorks() {
  const { chromium } = await import('@playwright/test');
  try {
    const browser = await chromium.launch();
    await browser.close();
    return { ok: true };
  } catch (err) {
    return { ok: false, message: String(err?.message ?? err) };
  }
}
let browser = await browserWorks();
if (!browser.ok && /Executable doesn't exist|playwright install/i.test(browser.message)) {
  step('Chromium for Playwright is not installed yet: running npx playwright install chromium …');
  if (!run('npx', ['playwright', 'install', 'chromium'])) {
    fail('Installing Chromium failed (it is downloaded from the internet). Check your connection or proxy, then run:\n  npx playwright install chromium');
  }
  browser = await browserWorks();
}
if (!browser.ok) {
  const linuxHint =
    process.platform === 'linux' ? '\nOn Linux the browser may need system libraries:\n  sudo npx playwright install-deps chromium' : '';
  fail(`Chromium can't start:\n  ${browser.message.split('\n')[0]}${linuxHint}`);
}
step('Chromium is ready.');

// 3. .env: the API started by the tests reads DATABASE_URL from it
if (!existsSync('.env')) {
  fail('No .env file. Create it first:\n  cp .env.example .env   (then set POSTGRES_PASSWORD and the same password in DATABASE_URL)');
}

// 4. Database: reachable and migrated (dbmate "up" only applies what's missing, so it's safe to repeat)
step('Applying database migrations (if any are pending) …');
if (!run('npx', ['dbmate', '--migrations-dir', 'db/migrations', '--no-dump-schema', '--wait', '--wait-timeout', '10s', 'up'])) {
  fail("Can't reach the database in DATABASE_URL (.env). Start Postgres first:\n  npm run db:up   (Docker), or start your own PostgreSQL 16");
}

// Run the tests
step(`Running end-to-end tests${screenshots ? ' (and refreshing docs/screenshots/)' : ''} …`);
const env = screenshots ? { ...process.env, SCREENSHOTS: '1' } : process.env;
process.exit(run('npx', ['playwright', 'test', ...passThrough], env) ? 0 : 1);
