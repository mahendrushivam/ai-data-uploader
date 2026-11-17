-- Schema tests: they check that the database itself refuses invalid data.
-- Everything runs in one transaction that is rolled back, so the script is safe on any database.
-- Run:  docker compose --profile test run --rm db-test
--   or: psql "$DATABASE_URL" -f db/tests/schema_tests.sql
-- Any failing test stops the script with "FAIL ..." and a non-zero exit code.

\set ON_ERROR_STOP on
\set VERBOSITY terse
SET client_min_messages = notice;
\o /dev/null
BEGIN;

CREATE FUNCTION pg_temp.expect_error(p_label text, p_sql text, p_sqlstate text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    BEGIN
        EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE = p_sqlstate THEN
            RAISE NOTICE 'PASS  %', p_label;
            RETURN;
        END IF;
        RAISE EXCEPTION 'FAIL  %: expected SQLSTATE %, got % (%)', p_label, p_sqlstate, SQLSTATE, SQLERRM;
    END;
    RAISE EXCEPTION 'FAIL  %: statement succeeded but should have been rejected', p_label;
END $$;

CREATE FUNCTION pg_temp.expect_ok(p_label text, p_sql text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    EXECUTE p_sql;
    RAISE NOTICE 'PASS  %', p_label;
EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'FAIL  %: unexpected error % (%)', p_label, SQLSTATE, SQLERRM;
END $$;

CREATE FUNCTION pg_temp.expect_true(p_label text, p_cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_cond IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL  %', p_label; END IF;
    RAISE NOTICE 'PASS  %', p_label;
END $$;

-- ------------------------------------------------------------------ fixtures
INSERT INTO users (id, email, name, password_hash) VALUES
    ('eeeeeeee-0000-4000-8000-000000000001', 'Tester.One@Example.com', 'Tester One', '$argon2id$v=19$m=65536,t=3,p=4$x$y'),
    ('eeeeeeee-0000-4000-8000-000000000002', 'tester.two@example.com', 'Tester Two', '$argon2id$v=19$m=65536,t=3,p=4$x$y');
INSERT INTO templates (id, owner_id, name) VALUES
    ('eeeeeeee-1000-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-000000000001', 'Invoices'),
    ('eeeeeeee-1000-4000-8000-000000000002', 'eeeeeeee-0000-4000-8000-000000000001', 'Payments');
INSERT INTO template_versions (id, template_id, version) VALUES
    ('eeeeeeee-2000-4000-8000-000000000001', 'eeeeeeee-1000-4000-8000-000000000001', 1),
    ('eeeeeeee-2000-4000-8000-000000000002', 'eeeeeeee-1000-4000-8000-000000000002', 1);
INSERT INTO template_columns (id, template_version_id, position, key, display_name, data_type) VALUES
    ('eeeeeeee-3000-4000-8000-000000000001', 'eeeeeeee-2000-4000-8000-000000000001', 0, 'amount', 'Amount', 'number');
INSERT INTO column_rules (template_column_id, rule_type, params) VALUES
    ('eeeeeeee-3000-4000-8000-000000000001', 'min', '{"value": 0}');

-- A valid finished upload used as the starting point for the status tests
INSERT INTO uploads (id, owner_id, name, template_version_id, schema_snapshot, original_filename, size_bytes, sha256,
                     status, total_rows, error_count, created_at, validation_started_at, validation_finished_at)
VALUES ('eeeeeeee-4000-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-000000000001', 'Jan invoices',
        'eeeeeeee-2000-4000-8000-000000000001', '{"columns": []}', 'jan.csv', 100, sha256('x'),
        'failed_validation', 10, 2, now() - interval '1 hour', now() - interval '1 hour', now() - interval '59 minutes');

-- ------------------------------------------------------------------ auth
SELECT pg_temp.expect_error('users: email is unique regardless of case',
    $$INSERT INTO users (email, name, password_hash) VALUES ('tester.one@EXAMPLE.com', 'X', 'h')$$, '23505');
SELECT pg_temp.expect_error('users: malformed email rejected',
    $$INSERT INTO users (email, name, password_hash) VALUES ('not-an-email', 'X', 'h')$$, '23514');
SELECT pg_temp.expect_error('users: blank name rejected',
    $$INSERT INTO users (email, name, password_hash) VALUES ('x@example.com', '   ', 'h')$$, '23514');
SELECT pg_temp.expect_error('users: password hash required',
    $$INSERT INTO users (email, name) VALUES ('x@example.com', 'X')$$, '23502');
SELECT pg_temp.expect_error('sessions: token hash must be 32 bytes (SHA-256)',
    $$INSERT INTO sessions (user_id, token_hash, expires_at)
      VALUES ('eeeeeeee-0000-4000-8000-000000000001', '\x00ff', now() + interval '1 day')$$, '23514');
SELECT pg_temp.expect_error('sessions: expiry must be after creation',
    $$INSERT INTO sessions (user_id, token_hash, expires_at)
      VALUES ('eeeeeeee-0000-4000-8000-000000000001', sha256('t'), now() - interval '1 day')$$, '23514');
SELECT pg_temp.expect_ok('sessions: valid session accepted',
    $$INSERT INTO sessions (user_id, token_hash, expires_at)
      VALUES ('eeeeeeee-0000-4000-8000-000000000001', sha256('t'), now() + interval '14 days')$$);
SELECT pg_temp.expect_error('sessions: the same token cannot be stored twice',
    $$INSERT INTO sessions (user_id, token_hash, expires_at)
      VALUES ('eeeeeeee-0000-4000-8000-000000000002', sha256('t'), now() + interval '14 days')$$, '23505');
SELECT pg_temp.expect_ok('users: update name',
    $$UPDATE users SET name = 'Renamed', updated_at = '2000-01-01' WHERE id = 'eeeeeeee-0000-4000-8000-000000000001'$$);
SELECT pg_temp.expect_true('users: updated_at trigger overrides the supplied value',
    (SELECT updated_at > '2000-01-02' FROM users WHERE id = 'eeeeeeee-0000-4000-8000-000000000001'));

-- ------------------------------------------------------------------ templates
SELECT pg_temp.expect_error('templates: name unique per owner (case-insensitive)',
    $$INSERT INTO templates (owner_id, name) VALUES ('eeeeeeee-0000-4000-8000-000000000001', 'INVOICES')$$, '23505');
SELECT pg_temp.expect_ok('templates: another user may use the same name',
    $$INSERT INTO templates (owner_id, name) VALUES ('eeeeeeee-0000-4000-8000-000000000002', 'Invoices')$$);
SELECT pg_temp.expect_ok('templates: name can be reused after archiving',
    $$UPDATE templates SET archived_at = now() WHERE id = 'eeeeeeee-1000-4000-8000-000000000002';
      INSERT INTO templates (owner_id, name) VALUES ('eeeeeeee-0000-4000-8000-000000000001', 'Payments')$$);
SELECT pg_temp.expect_error('templates: current version must belong to the same template',
    $$UPDATE templates SET current_version_id = 'eeeeeeee-2000-4000-8000-000000000002'
      WHERE id = 'eeeeeeee-1000-4000-8000-000000000001'$$, '23503');
SELECT pg_temp.expect_ok('templates: current version of its own template accepted',
    $$UPDATE templates SET current_version_id = 'eeeeeeee-2000-4000-8000-000000000001'
      WHERE id = 'eeeeeeee-1000-4000-8000-000000000001'$$);
SELECT pg_temp.expect_error('template_versions: version numbers unique per template',
    $$INSERT INTO template_versions (template_id, version) VALUES ('eeeeeeee-1000-4000-8000-000000000001', 1)$$, '23505');
SELECT pg_temp.expect_error('template_columns: multi-value list needs a delimiter',
    $$INSERT INTO template_columns (template_version_id, position, key, display_name, data_type)
      VALUES ('eeeeeeee-2000-4000-8000-000000000001', 1, 'tags', 'Tags', 'multiselect')$$, '23514');
SELECT pg_temp.expect_error('template_columns: delimiter only allowed on multi-value lists',
    $$INSERT INTO template_columns (template_version_id, position, key, display_name, data_type, multi_delimiter)
      VALUES ('eeeeeeee-2000-4000-8000-000000000001', 1, 'note', 'Note', 'text', ',')$$, '23514');
SELECT pg_temp.expect_error('template_columns: key must be snake_case',
    $$INSERT INTO template_columns (template_version_id, position, key, display_name)
      VALUES ('eeeeeeee-2000-4000-8000-000000000001', 1, 'Ticket ID', 'Ticket ID')$$, '23514');
SELECT pg_temp.expect_error('template_columns: key unique within a version',
    $$INSERT INTO template_columns (template_version_id, position, key, display_name)
      VALUES ('eeeeeeee-2000-4000-8000-000000000001', 1, 'amount', 'Amount 2')$$, '23505');
SELECT pg_temp.expect_error('column_rules: allowed_values needs a non-empty list',
    $$INSERT INTO column_rules (template_column_id, rule_type, params)
      VALUES ('eeeeeeee-3000-4000-8000-000000000001', 'allowed_values', '{"values": []}')$$, '23514');
SELECT pg_temp.expect_error('column_rules: max_length value must be a number',
    $$INSERT INTO column_rules (template_column_id, rule_type, params)
      VALUES ('eeeeeeee-3000-4000-8000-000000000001', 'max_length', '{"value": "ten"}')$$, '23514');
SELECT pg_temp.expect_error('column_rules: regex needs a pattern',
    $$INSERT INTO column_rules (template_column_id, rule_type, params)
      VALUES ('eeeeeeee-3000-4000-8000-000000000001', 'regex', '{}')$$, '23514');
SELECT pg_temp.expect_error('column_rules: min needs a value',
    $$INSERT INTO column_rules (template_column_id, rule_type, params)
      VALUES ('eeeeeeee-3000-4000-8000-000000000001', 'max', '{}')$$, '23514');
SELECT pg_temp.expect_error('column_rules: params must be an object',
    $$INSERT INTO column_rules (template_column_id, rule_type, params)
      VALUES ('eeeeeeee-3000-4000-8000-000000000001', 'unique', '[]')$$, '23514');
SELECT pg_temp.expect_error('column_rules: one rule of each type per column',
    $$INSERT INTO column_rules (template_column_id, rule_type, params)
      VALUES ('eeeeeeee-3000-4000-8000-000000000001', 'min', '{"value": 5}')$$, '23505');
SELECT pg_temp.expect_error('immutability: template_versions cannot be updated',
    $$UPDATE template_versions SET has_header_row = false WHERE id = 'eeeeeeee-2000-4000-8000-000000000001'$$, '23001');
SELECT pg_temp.expect_error('immutability: template_columns cannot be updated',
    $$UPDATE template_columns SET required = true WHERE id = 'eeeeeeee-3000-4000-8000-000000000001'$$, '23001');
SELECT pg_temp.expect_error('immutability: column_rules cannot be updated',
    $$UPDATE column_rules SET severity = 'warning'$$, '23001');
SELECT pg_temp.expect_error('templates: a version used by an upload cannot be hard-deleted (archive instead)',
    $$DELETE FROM templates WHERE id = 'eeeeeeee-1000-4000-8000-000000000001'$$, '23503');

SELECT pg_temp.expect_ok('templates: one template can be the default',
    $$UPDATE templates SET is_default = true WHERE id = 'eeeeeeee-1000-4000-8000-000000000001'$$);
SELECT pg_temp.expect_error('templates: at most one default per user',
    $$INSERT INTO templates (owner_id, name, is_default) VALUES ('eeeeeeee-0000-4000-8000-000000000001', 'Second default', true)$$, '23505');
SELECT pg_temp.expect_ok('templates: another user has their own default',
    $$INSERT INTO templates (owner_id, name, is_default) VALUES ('eeeeeeee-0000-4000-8000-000000000002', 'Theirs', true)$$);
SELECT pg_temp.expect_error('templates: an archived template cannot be the default',
    $$UPDATE templates SET archived_at = now() WHERE id = 'eeeeeeee-1000-4000-8000-000000000001'$$, '23514');

-- ------------------------------------------------------------------ uploads
SELECT pg_temp.expect_error('uploads: files over 5 MB rejected',
    $$INSERT INTO uploads (owner_id, name, schema_snapshot, original_filename, size_bytes, sha256)
      VALUES ('eeeeeeee-0000-4000-8000-000000000001', 'Big', '{"columns": []}', 'big.csv', 5242881, sha256('x'))$$, '23514');
SELECT pg_temp.expect_error('uploads: empty files rejected',
    $$INSERT INTO uploads (owner_id, name, schema_snapshot, original_filename, size_bytes, sha256)
      VALUES ('eeeeeeee-0000-4000-8000-000000000001', 'Empty', '{"columns": []}', 'e.csv', 0, sha256('x'))$$, '23514');
SELECT pg_temp.expect_ok('uploads: exactly 5 MB accepted, status defaults to queued',
    $$INSERT INTO uploads (id, owner_id, name, schema_snapshot, original_filename, size_bytes, sha256, created_at)
      VALUES ('eeeeeeee-4000-4000-8000-000000000002', 'eeeeeeee-0000-4000-8000-000000000001', 'Max',
              '{"columns": []}', 'max.csv', 5242880, sha256('x'),
              now() - interval '100 years')$$);  -- backdated so the worker-claim test picks it on any database
SELECT pg_temp.expect_true('uploads: new upload is queued',
    (SELECT status = 'queued' FROM uploads WHERE id = 'eeeeeeee-4000-4000-8000-000000000002'));
SELECT pg_temp.expect_error('upload_files: stored bytes over 5 MB rejected',
    $$INSERT INTO upload_files VALUES ('eeeeeeee-4000-4000-8000-000000000002', convert_to(repeat('a', 5242881), 'UTF8'))$$, '23514');
SELECT pg_temp.expect_error('uploads: snapshot must contain a columns array',
    $$INSERT INTO uploads (owner_id, name, schema_snapshot, original_filename, size_bytes, sha256)
      VALUES ('eeeeeeee-0000-4000-8000-000000000001', 'Bad', '{}', 'b.csv', 10, sha256('x'))$$, '23514');
SELECT pg_temp.expect_error('uploads: passed with errors is contradictory',
    $$UPDATE uploads SET status = 'passed' WHERE id = 'eeeeeeee-4000-4000-8000-000000000001'$$, '23514');
SELECT pg_temp.expect_error('uploads: failed_validation needs at least one error',
    $$UPDATE uploads SET error_count = 0 WHERE id = 'eeeeeeee-4000-4000-8000-000000000001'$$, '23514');
SELECT pg_temp.expect_error('uploads: passed_with_warnings needs warnings and no errors',
    $$UPDATE uploads SET status = 'passed_with_warnings', error_count = 0, warning_count = 0
      WHERE id = 'eeeeeeee-4000-4000-8000-000000000001'$$, '23514');
SELECT pg_temp.expect_error('uploads: finished status needs validation_finished_at',
    $$UPDATE uploads SET validation_finished_at = NULL WHERE id = 'eeeeeeee-4000-4000-8000-000000000001'$$, '23514');
SELECT pg_temp.expect_error('uploads: error status needs a message for the user',
    $$UPDATE uploads SET status = 'error', error_count = 0 WHERE id = 'eeeeeeee-4000-4000-8000-000000000001'$$, '23514');
SELECT pg_temp.expect_error('uploads: validating needs validation_started_at',
    $$UPDATE uploads SET status = 'validating' WHERE id = 'eeeeeeee-4000-4000-8000-000000000002'$$, '23514');
SELECT pg_temp.expect_error('validation_issues: raw value capped at 500 chars',
    $$INSERT INTO validation_issues (upload_id, row_number, column_key, rule, severity, message, raw_value)
      VALUES ('eeeeeeee-4000-4000-8000-000000000001', 1, 'amount', 'type', 'error', 'bad', repeat('x', 501))$$, '23514');
SELECT pg_temp.expect_error('upload_rows: row numbers start at 1',
    $$INSERT INTO upload_rows (upload_id, row_number, data) VALUES ('eeeeeeee-4000-4000-8000-000000000001', 0, '{}')$$, '23514');

-- Worker claim query (the same statement the worker will run)
SELECT pg_temp.expect_ok('worker: claim oldest queued upload',
    $$UPDATE uploads SET status = 'validating', attempt = attempt + 1, locked_at = now(), validation_started_at = now()
      WHERE id = (SELECT id FROM uploads
                  WHERE status = 'queued'
                     OR (status = 'validating' AND locked_at < now() - interval '5 minutes')
                  ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)$$);
SELECT pg_temp.expect_true('worker: claimed upload is validating with attempt 1',
    (SELECT status = 'validating' AND attempt = 1 FROM uploads WHERE id = 'eeeeeeee-4000-4000-8000-000000000002'));

-- ------------------------------------------------------------------ account deletion
SELECT pg_temp.expect_ok('users: deleting an account removes all of its data',
    $$DELETE FROM users WHERE id = 'eeeeeeee-0000-4000-8000-000000000001'$$);
SELECT pg_temp.expect_true('users: nothing left behind after account deletion',
    (SELECT count(*) = 0 FROM templates WHERE owner_id = 'eeeeeeee-0000-4000-8000-000000000001')
    AND (SELECT count(*) = 0 FROM uploads WHERE owner_id = 'eeeeeeee-0000-4000-8000-000000000001')
    AND (SELECT count(*) = 0 FROM sessions WHERE user_id = 'eeeeeeee-0000-4000-8000-000000000001')
    AND (SELECT count(*) = 0 FROM template_versions WHERE template_id = 'eeeeeeee-1000-4000-8000-000000000001'));

ROLLBACK;
\o
\echo 'All schema tests passed.'
