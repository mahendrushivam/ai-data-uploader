-- migrate:up
-- Phase 1 login: email + password, server-side sessions, login rate limiting.
-- Phase 2 (not here): password reset / email verification tokens, OAuth accounts.

CREATE EXTENSION IF NOT EXISTS citext;  -- case-insensitive email

-- Shared trigger: keep updated_at current on every UPDATE.
CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END $$;

CREATE TYPE user_status AS ENUM ('active', 'disabled');

CREATE TABLE users (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email          citext      NOT NULL UNIQUE
                   CHECK (length(email) <= 254 AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
    name           text        NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
    -- argon2id encoded string: algorithm, parameters and salt are inside it, so there is no salt column.
    password_hash  text        NOT NULL,
    status         user_status NOT NULL DEFAULT 'active',
    last_login_at  timestamptz,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Server-side sessions. The browser holds a random token in an httpOnly, Secure, SameSite=Lax cookie.
-- Only SHA-256(token) is stored, so a database leak does not expose live sessions.
CREATE TABLE sessions (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash    bytea       NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    created_at    timestamptz NOT NULL DEFAULT now(),
    last_seen_at  timestamptz NOT NULL DEFAULT now(),
    expires_at    timestamptz NOT NULL,     -- sliding expiry, e.g. now() + 14 days on activity
    revoked_at    timestamptz,              -- set on logout
    ip            inet,
    user_agent    text,
    CHECK (expires_at > created_at)
);
CREATE INDEX sessions_user_active_idx ON sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX sessions_expires_idx     ON sessions (expires_at);   -- nightly cleanup of expired rows

-- Every login attempt. Used for rate limiting (e.g. at most 5 failures per email or per IP in 15 min)
-- and as an audit trail. The email is kept even when no such user exists.
CREATE TABLE login_attempts (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email       citext      NOT NULL,
    user_id     uuid        REFERENCES users(id) ON DELETE SET NULL,
    succeeded   boolean     NOT NULL,
    ip          inet,
    user_agent  text,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_attempts_email_time_idx ON login_attempts (email, created_at DESC);
CREATE INDEX login_attempts_ip_time_idx    ON login_attempts (ip, created_at DESC);

-- migrate:down
DROP TABLE login_attempts;
DROP TABLE sessions;
DROP TABLE users;
DROP TYPE user_status;
DROP FUNCTION set_updated_at();
-- citext is left installed on purpose: other objects in the database may use it.
