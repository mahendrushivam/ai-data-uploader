import { z } from 'zod';

/** "true"/"false" from the environment. (z.coerce.boolean would turn the string "false" into true.) */
const envBool = z.enum(['true', 'false']).transform((v) => v === 'true');

/** All runtime configuration comes from environment variables, validated once at start-up. */
const schema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  /** Phase 1 limits (agreed): 5 MB and 20,000 rows per file. */
  MAX_FILE_BYTES: z.coerce.number().int().positive().default(5 * 1024 * 1024),
  MAX_ROWS: z.coerce.number().int().positive().default(20_000),
  /** How often the worker looks for queued uploads. */
  WORKER_POLL_MS: z.coerce.number().int().positive().default(1000),

  /** Session cookie. Secure defaults to true in production; local Docker over plain http sets it false. */
  COOKIE_SECURE: envBool.optional(),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(14),
  /** Behind nginx: take the client IP from X-Forwarded-For (only enable behind a trusted proxy). */
  TRUST_PROXY: envBool.default('false'),
  /** Login rate limiting: failed attempts allowed per email (since its last success) and per IP. */
  LOGIN_MAX_FAILURES_PER_EMAIL: z.coerce.number().int().positive().default(5),
  LOGIN_MAX_FAILURES_PER_IP: z.coerce.number().int().positive().default(20),
  LOGIN_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),
});

export type Config = Omit<z.infer<typeof schema>, 'COOKIE_SECURE'> & { COOKIE_SECURE: boolean };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${problems}`);
  }
  const data = parsed.data;
  return { ...data, COOKIE_SECURE: data.COOKIE_SECURE ?? data.NODE_ENV === 'production' };
}
