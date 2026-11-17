import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    // Pure logic: shared rules package and web helpers. No database needed.
    test: { name: 'unit', include: ['shared/src/**/*.test.ts', 'src/**/*.test.ts', 'scripts/**/*.test.ts'], environment: 'node' },
  },
  {
    // React components and pages (jsdom). The network is faked with src/test/mockApi.ts.
    extends: './vite.config.ts',
    test: { name: 'ui', include: ['src/**/*.test.tsx'], environment: 'jsdom', setupFiles: ['./src/test/setup.ts'] },
  },
  {
    // API tests run against a real, migrated PostgreSQL (DATABASE_URL). Files run one at a time.
    test: { name: 'api', include: ['server/src/**/*.test.ts'], environment: 'node', fileParallelism: false },
  },
]);
