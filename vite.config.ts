import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // In development the API runs separately (npm run dev:api); in Docker, nginx does this proxying.
    // changeOrigin must stay false: the API's CSRF check compares the Host header with the browser's Origin.
    proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: false, xfwd: true } },
  },
  test: {
    // `npm run coverage`: web app (pages, components, client libs) and the shared rules/validation code.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}', 'shared/src/**/*.ts'],
      exclude: ['**/*.test.{ts,tsx}', 'src/test/**', 'src/main.tsx', 'src/vite-env.d.ts'],
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: 'coverage',
      // Fail `npm run coverage` if coverage drops below these (current: ~98% statements, ~94% branches).
      thresholds: { statements: 95, branches: 90, functions: 90, lines: 95 },
    },
  },
});
