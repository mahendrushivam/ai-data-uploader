import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests: real browser → Vite dev server → API → PostgreSQL, with the background worker
 * started by each spec (e2e/support/worker.ts). Needs a migrated database in DATABASE_URL (.env):
 *   npm run db:up   (or npm run db:migrate)   then   npm run e2e
 * `npm run e2e:screenshots` also refreshes docs/screenshots/ from the same runs.
 */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1, // specs start/stop the background worker; keep them in sequence
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5175",
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "npm run dev:api",
      url: "http://localhost:3000/api/health",
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: "npm run dev:ui -- --port 5175 --strictPort",
      url: "http://localhost:5175",
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
