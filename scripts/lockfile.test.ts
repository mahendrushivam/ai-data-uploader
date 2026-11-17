import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script without type declarations
import { missingOptionalDependencies } from './lockfile.mjs';

describe('package-lock.json', () => {
  it('lists every platform-specific binary (rollup, esbuild, argon2, ...) so npm ci works on macOS, Windows and Alpine/Docker', () => {
    const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
    expect(missingOptionalDependencies(lock)).toEqual([]);
  });

  it('the check catches the problem (a lockfile with a platform binary missing)', () => {
    const lock = {
      packages: {
        '': {},
        'node_modules/rollup': { optionalDependencies: { '@rollup/rollup-darwin-arm64': '4.68.2', '@rollup/rollup-linux-x64-gnu': '4.68.2' } },
        'node_modules/@rollup/rollup-linux-x64-gnu': {},
        'node_modules/a/node_modules/b': { optionalDependencies: { c: '1' } },
        'node_modules/a/node_modules/c': {}, // found next to its parent: fine
      },
    };
    expect(missingOptionalDependencies(lock)).toEqual(['rollup → @rollup/rollup-darwin-arm64']);
  });
});
