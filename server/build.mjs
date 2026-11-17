// Production build: compile the API and worker to plain JavaScript in dist/.
// Our own code and the @datadesk/shared workspace package are bundled in; every npm dependency
// stays an import resolved from node_modules at runtime (so native modules keep working).
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const external = Object.keys(pkg.dependencies ?? {}).filter((name) => !name.startsWith('@datadesk/'));

await build({
  entryPoints: ['src/api.ts', 'src/worker.ts'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  external,
  logLevel: 'info',
});
