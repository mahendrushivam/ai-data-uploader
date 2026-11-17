import { RE2 } from 're2-wasm';
import type { RegexCompiler } from '@datadesk/shared/rules';

/**
 * Regex rules run on RE2 on the server: matching time is linear in the input, so a user's pattern
 * can't hang the worker (no catastrophic backtracking). re2-wasm always needs the "u" flag.
 */
export const re2Compiler: RegexCompiler = (pattern, flags) => new RE2(pattern, `${flags}u`);
