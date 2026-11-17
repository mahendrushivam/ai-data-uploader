import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '../db.js';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
}

/** The cookie holds a random 32-byte token; the database only ever stores its SHA-256. */
export const newToken = () => randomBytes(32).toString('base64url');
const tokenHash = (token: string) => createHash('sha256').update(token).digest();

export async function createSession(
  db: Db,
  userId: string,
  ttlDays: number,
  meta: { ip?: string; userAgent?: string },
): Promise<string> {
  const token = newToken();
  await db.query(
    `INSERT INTO sessions (user_id, token_hash, expires_at, ip, user_agent)
     VALUES ($1, $2, now() + make_interval(days => $3), $4, $5)`,
    [userId, tokenHash(token), ttlDays, meta.ip ?? null, meta.userAgent?.slice(0, 500) ?? null],
  );
  return token;
}

/**
 * Resolves a cookie token to its user, or null when the session is unknown, expired, revoked,
 * or the account is disabled. Sliding expiry: at most once an hour, activity pushes expires_at forward
 * (refreshed = true tells the caller to re-send the cookie with a fresh max-age).
 */
export async function findSession(
  db: Db,
  token: string,
  ttlDays: number,
): Promise<{ sessionId: string; user: SessionUser; refreshed: boolean } | null> {
  const { rows } = await db.query<{ session_id: string; id: string; name: string; email: string; stale: boolean }>(
    `SELECT s.id AS session_id, u.id, u.name, u.email::text AS email,
            s.last_seen_at < now() - interval '1 hour' AS stale
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.status = 'active'`,
    [tokenHash(token)],
  );
  const row = rows[0];
  if (!row) return null;
  if (row.stale) {
    await db.query(
      `UPDATE sessions SET last_seen_at = now(), expires_at = now() + make_interval(days => $2) WHERE id = $1`,
      [row.session_id, ttlDays],
    );
  }
  return { sessionId: row.session_id, user: { id: row.id, name: row.name, email: row.email }, refreshed: row.stale };
}

export async function revokeSession(db: Db, token: string): Promise<void> {
  await db.query('UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [
    tokenHash(token),
  ]);
}
