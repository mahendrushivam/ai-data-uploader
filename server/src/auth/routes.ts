import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { HttpError, parseBody } from '../http.js';
import { burnVerificationTime, hashPassword, verifyPassword } from './passwords.js';
import { createSession, findSession, revokeSession, type SessionUser } from './sessions.js';

export const SESSION_COOKIE = 'dd_session';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set when the request carries a valid session cookie. */
    user: SessionUser | null;
  }
}

const email = z
  .string({ required_error: 'Email is required.' })
  .trim()
  .toLowerCase()
  .max(254, 'Email is too long.')
  .email('Please enter a valid email address.');

const signupSchema = z.object({
  name: z.string({ required_error: 'Name is required.' }).trim().min(1, 'Please enter your name.').max(100, 'Name is too long.'),
  email,
  password: z
    .string({ required_error: 'Password is required.' })
    .min(8, 'Password must be at least 8 characters.')
    .max(128, 'Password must be at most 128 characters.'),
});

const loginSchema = z.object({
  email,
  password: z.string({ required_error: 'Password is required.' }).min(1, 'Password is required.').max(128),
});

const INVALID_LOGIN = new HttpError(401, 'invalid_credentials', 'Incorrect email or password.');

/** Use inside route handlers that need a signed-in user. */
export function requireUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw new HttpError(401, 'unauthenticated', 'Please sign in.');
  return req.user;
}

async function registerAuth(app: FastifyInstance, { config, db }: AppDeps) {
  const maxAge = config.SESSION_TTL_DAYS * 24 * 60 * 60;
  const setSessionCookie = (reply: FastifyReply, token: string) =>
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: config.COOKIE_SECURE,
      sameSite: 'lax',
      path: '/',
      maxAge,
    });
  const startSession = async (req: FastifyRequest, reply: FastifyReply, userId: string) => {
    const token = await createSession(db, userId, config.SESSION_TTL_DAYS, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    setSessionCookie(reply, token);
  };

  app.decorateRequest('user', null);

  app.addHook('onRequest', async (req, reply) => {
    // CSRF defence in depth (on top of SameSite=Lax): a state-changing request sent by a browser
    // must come from our own origin.
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers.origin) {
      let originHost: string | null = null;
      try {
        originHost = new URL(req.headers.origin).host;
      } catch {
        /* unparsable Origin: treated as foreign */
      }
      if (originHost !== req.headers.host) {
        throw new HttpError(403, 'bad_origin', 'Request blocked: it did not come from this site.');
      }
    }

    const token = req.cookies[SESSION_COOKIE];
    if (!token) return;
    const found = await findSession(db, token, config.SESSION_TTL_DAYS);
    if (!found) {
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return;
    }
    req.user = found.user;
    if (found.refreshed) setSessionCookie(reply, token);
  });

  app.post('/api/auth/signup', async (req, reply) => {
    const body = parseBody(signupSchema, req);
    const passwordHash = await hashPassword(body.password);
    let user: SessionUser;
    try {
      const { rows } = await db.query<SessionUser>(
        `INSERT INTO users (name, email, password_hash, last_login_at) VALUES ($1, $2, $3, now())
         RETURNING id, name, email::text AS email`,
        [body.name, body.email, passwordHash],
      );
      user = rows[0];
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new HttpError(409, 'email_taken', 'An account with this email already exists.', {
          email: 'An account with this email already exists.',
        });
      }
      throw err;
    }
    await startSession(req, reply, user.id);
    return reply.code(201).send({ user });
  });

  app.post('/api/auth/login', async (req, reply) => {
    const body = parseBody(loginSchema, req);

    // Rate limit: failures per email since its last successful login, and per IP, in the window.
    const { rows: counts } = await db.query<{ by_email: number; by_ip: number }>(
      `SELECT
         count(*) FILTER (WHERE email = $1 AND created_at > COALESCE(
           (SELECT max(created_at) FROM login_attempts WHERE email = $1 AND succeeded), '-infinity'))::int AS by_email,
         count(*) FILTER (WHERE ip = $2)::int AS by_ip
       FROM login_attempts
       WHERE NOT succeeded AND created_at > now() - make_interval(mins => $3) AND (email = $1 OR ip = $2)`,
      [body.email, req.ip, config.LOGIN_WINDOW_MINUTES],
    );
    if (counts[0].by_email >= config.LOGIN_MAX_FAILURES_PER_EMAIL || counts[0].by_ip >= config.LOGIN_MAX_FAILURES_PER_IP) {
      reply.header('Retry-After', String(config.LOGIN_WINDOW_MINUTES * 60));
      throw new HttpError(
        429,
        'too_many_attempts',
        `Too many failed sign-in attempts. Try again in ${config.LOGIN_WINDOW_MINUTES} minutes.`,
      );
    }

    const { rows } = await db.query<SessionUser & { password_hash: string; status: string }>(
      `SELECT id, name, email::text AS email, password_hash, status FROM users WHERE email = $1`,
      [body.email],
    );
    const found = rows[0];
    let ok = false;
    if (found) ok = (await verifyPassword(found.password_hash, body.password)) && found.status === 'active';
    else await burnVerificationTime(body.password);

    await db.query(
      `INSERT INTO login_attempts (email, user_id, succeeded, ip, user_agent) VALUES ($1, $2, $3, $4, $5)`,
      [body.email, found?.id ?? null, ok, req.ip, req.headers['user-agent']?.slice(0, 500) ?? null],
    );
    if (!ok || !found) throw INVALID_LOGIN;

    await db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [found.id]);
    await startSession(req, reply, found.id);
    return { user: { id: found.id, name: found.name, email: found.email } };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await revokeSession(db, token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.code(204).send();
  });

  app.get('/api/auth/me', async (req) => ({ user: requireUser(req) }));
}

export const authPlugin = fp(registerAuth, { name: 'auth', dependencies: ['@fastify/cookie'] });
