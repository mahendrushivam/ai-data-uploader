// Checks that package-lock.json lists every optional dependency its packages declare.
//
// Why: packages like rollup (used by Vite), esbuild and @node-rs/argon2 ship a separate native binary per
// platform as optional dependencies. If the lockfile is generated somewhere that can't see all of them
// (e.g. a registry mirror with only Linux packages), npm silently omits the missing platforms, and
// `npm ci` on macOS/Windows/Alpine later fails with "Cannot find module @rollup/rollup-<platform>"
// (npm bug https://github.com/npm/cli/issues/4828). Usage: node scripts/lockfile.mjs [path]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Returns "package → missing optional dependency" problems (empty when the lockfile is complete). */
export function missingOptionalDependencies(lock) {
  const packages = lock.packages ?? {};
  const problems = [];
  for (const [path, meta] of Object.entries(packages)) {
    for (const dep of Object.keys(meta.optionalDependencies ?? {})) {
      // npm resolves a dependency from the package's own node_modules, then each parent's, up to the root
      const segments = path.split('node_modules/');
      let found = false;
      for (let i = segments.length; i >= 1 && !found; i--) {
        const prefix = segments.slice(0, i).join('node_modules/');
        const candidate = `${prefix}${prefix && !prefix.endsWith('/') ? '/' : ''}node_modules/${dep}`;
        found = candidate in packages;
      }
      if (!found) problems.push(`${path.replace(/^node_modules\//, '') || '(root)'} → ${dep}`);
    }
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2] ?? 'package-lock.json';
  const problems = missingOptionalDependencies(JSON.parse(readFileSync(file, 'utf8')));
  if (problems.length) {
    console.error(`${file}: ${problems.length} optional dependencies are missing, e.g.\n  ${problems.slice(0, 8).join('\n  ')}`);
    console.error('Regenerate the lockfile on a machine with access to the public npm registry:\n  rm -rf node_modules package-lock.json && npm install');
    process.exit(1);
  }
  console.log(`${file}: all optional (platform-specific) dependencies are listed.`);
}
