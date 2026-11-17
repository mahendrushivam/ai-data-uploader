-- Development seed: one demo user, two templates (one with 2 versions), and six uploads,
-- one for every upload status. These are the uploads and templates shown in the mockups
-- (docs/mockups: listing, templates and result screens).
-- It can be re-run: the demo user is deleted first, and everything else cascades.
--
-- The demo user CANNOT log in: its password_hash is not a valid argon2 hash, so no credential
-- is hard-coded. Once the API exists (M1), sign up normally to get a working account.

\set ON_ERROR_STOP on
BEGIN;

DELETE FROM users WHERE email = 'demo@example.com';

INSERT INTO users (id, email, name, password_hash, last_login_at) VALUES
    ('00000000-0000-4000-8000-000000000001', 'demo@example.com', 'Demo Analyst', '!no-login', now());

INSERT INTO login_attempts (email, user_id, succeeded, ip, created_at) VALUES
    ('demo@example.com', '00000000-0000-4000-8000-000000000001', false, '203.0.113.7', now() - interval '2 days 1 minute'),
    ('demo@example.com', '00000000-0000-4000-8000-000000000001', true,  '203.0.113.7', now() - interval '2 days');

-- ---------------------------------------------------------------- helpers (session-only)
CREATE FUNCTION pg_temp.csv_field(v text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN v ~ '[",\n]' THEN '"' || replace(v, '"', '""') || '"' ELSE v END
$$;

-- Effective schema for an upload, built from a template version, in the format of
-- uploadSnapshotSchema (shared/src/upload.ts). The API builds the same thing in TypeScript.
-- The seed files use the template's own column names as headers, so column N is found at index N.
CREATE FUNCTION pg_temp.snapshot(p_version uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT jsonb_build_object(
        'templateVersionId', tv.id,
        'hasHeaderRow', tv.has_header_row,
        'allowExtraColumns', tv.allow_extra_columns,
        'columns', (
            SELECT jsonb_agg(jsonb_build_object(
                'key', c.key, 'name', c.display_name, 'type', c.data_type,
                'required', c.required, 'delimiter', c.multi_delimiter, 'aliases', to_jsonb(c.header_aliases),
                'sourceIndex', c.position, 'sourceHeader', c.display_name,
                'rules', COALESCE((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                            'type', r.rule_type, 'params', r.params, 'severity', r.severity, 'message', r.message))
                            ORDER BY r.rule_type)
                         FROM column_rules r WHERE r.template_column_id = c.id), '[]'::jsonb)
            ) ORDER BY c.position)
            FROM template_columns c WHERE c.template_version_id = tv.id))
    FROM template_versions tv WHERE tv.id = p_version
$$;

-- ---------------------------------------------------------------- template 1: Support tickets (v1, v2)
INSERT INTO templates (id, owner_id, name, description, created_at) VALUES
    ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001',
     'Support tickets', 'Weekly export of labelled support tickets for the ML review queue.', now() - interval '20 days');

INSERT INTO template_versions (id, template_id, version, created_at) VALUES
    ('11000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 1, now() - interval '20 days'),
    ('11000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 2, now() - interval '6 days');

-- Both versions share the same columns. v2 adds a "low confidence" warning and a 500-character limit on text.
INSERT INTO template_columns (template_version_id, position, key, display_name, data_type, required, multi_delimiter, header_aliases)
SELECT v.id, c.pos, c.key, c.display_name,
       c.data_type::column_data_type, c.required, c.delim, c.aliases
FROM (VALUES ('11000000-0000-4000-8000-000000000001'::uuid), ('11000000-0000-4000-8000-000000000002'::uuid)) v(id)
CROSS JOIN (VALUES
    (0, 'ticket_id',    'ticket_id',    'integer',     true,  NULL, '{"Ticket #","ticket id","id"}'::text[]),
    (1, 'text',         'text',         'text',        true,  NULL, '{"message","body"}'),
    (2, 'label',        'label',        'select',      true,  NULL, '{"category"}'),
    (3, 'tags',         'tags',         'multiselect', false, ',',  '{}'),
    (4, 'confidence',   'confidence',   'number',      false, NULL, '{"score"}'),
    (5, 'needs_review', 'needs_review', 'boolean',     false, NULL, '{}'),
    (6, 'created_at',   'created_at',   'date',        true,  NULL, '{"created","date"}'),
    (7, 'source_url',   'source_url',   'url',         false, NULL, '{"url","link"}')
) c(pos, key, display_name, data_type, required, delim, aliases);

INSERT INTO column_rules (template_column_id, rule_type, params, severity, message)
SELECT c.id, r.rule_type::rule_type, r.params::jsonb, r.severity::issue_severity, r.message
FROM template_columns c
JOIN (VALUES
    ('ticket_id',  'unique',         '{}',                                                                  'error',   NULL,                                     'both'),
    ('label',      'allowed_values', '{"values":["bug","praise","billing","question","feature_request"]}', 'error',   NULL,                                     'both'),
    ('confidence', 'max',            '{"value":1}',                                                         'error',   NULL,                                     'both'),
    ('confidence', 'min',            '{"value":0}',                                                         'error',   NULL,                                     'v1'),
    ('confidence', 'min',            '{"value":0.6}',                                                       'warning', 'Low confidence: double-check the label', 'v2'),
    ('text',       'max_length',     '{"value":500}',                                                       'error',   NULL,                                     'v2')
) r(col_key, rule_type, params, severity, message, in_versions) ON r.col_key = c.key
JOIN template_versions tv ON tv.id = c.template_version_id AND tv.template_id = '10000000-0000-4000-8000-000000000001'
WHERE r.in_versions IN ('both', 'v' || tv.version);

UPDATE templates SET current_version_id = '11000000-0000-4000-8000-000000000002'
WHERE id = '10000000-0000-4000-8000-000000000001';

-- ---------------------------------------------------------------- template 2: Customer contacts (v1)
INSERT INTO templates (id, owner_id, name, description, created_at) VALUES
    ('20000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001',
     'Customer contacts', 'CRM lead import. One row per person.', now() - interval '12 days');
INSERT INTO template_versions (id, template_id, version, allow_extra_columns, created_at) VALUES
    ('21000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 1, false, now() - interval '12 days');
INSERT INTO template_columns (id, template_version_id, position, key, display_name, data_type, required, header_aliases) VALUES
    ('21000000-0000-4000-8000-0000000000a0', '21000000-0000-4000-8000-000000000001', 0, 'email',       'Email',       'email', true,  '{"e-mail","email address"}'),
    ('21000000-0000-4000-8000-0000000000a1', '21000000-0000-4000-8000-000000000001', 1, 'full_name',   'Full name',   'text',  true,  '{"name"}'),
    ('21000000-0000-4000-8000-0000000000a2', '21000000-0000-4000-8000-000000000001', 2, 'phone',       'Phone',       'text',  false, '{"mobile","phone number"}'),
    ('21000000-0000-4000-8000-0000000000a3', '21000000-0000-4000-8000-000000000001', 3, 'country',     'Country',     'select', true, '{}'),
    ('21000000-0000-4000-8000-0000000000a4', '21000000-0000-4000-8000-000000000001', 4, 'signup_date', 'Signup date', 'date',  false, '{"signed up"}');
INSERT INTO column_rules (template_column_id, rule_type, params, message) VALUES
    ('21000000-0000-4000-8000-0000000000a0', 'unique',         '{}', NULL),
    ('21000000-0000-4000-8000-0000000000a2', 'regex',          '{"pattern":"^\\+?[0-9 ()-]{7,20}$"}', 'Use digits, spaces, brackets or dashes, e.g. +1 555 0100'),
    ('21000000-0000-4000-8000-0000000000a3', 'allowed_values', '{"values":["US","GB","DE","IN"],"case_sensitive":false}', NULL),
    ('21000000-0000-4000-8000-0000000000a4', 'min',            '{"value":"2020-01-01"}', NULL);
UPDATE templates SET current_version_id = '21000000-0000-4000-8000-000000000001'
WHERE id = '20000000-0000-4000-8000-000000000001';

-- ---------------------------------------------------------------- ticket data (same as src/lib/sample.ts)
CREATE TEMP TABLE t_rows ON COMMIT DROP AS
SELECT i AS n,
       (999 + i)::text AS ticket_id,
       (ARRAY['The checkout page keeps timing out on mobile', 'Love the new dark mode, great work!',
              'Refund still not processed after 2 weeks', 'How do I export my invoices?',
              'App crashes when uploading large photos', 'Customer support was quick and helpful',
              'Pricing page is confusing, which plan has SSO?', 'Search results are irrelevant for exact SKUs',
              'Please add a CSV import for contacts', 'Notifications arrive hours late'])[(i - 1) % 10 + 1] AS text,
       (ARRAY['bug','praise','billing','question','bug','praise','question','bug','feature_request','bug'])[(i - 1) % 10 + 1] AS label,
       (ARRAY['mobile, ux', 'web, performance', 'payments', 'export, web', 'mobile, performance, ux',
              'support', 'ux, onboarding', 'search', 'export, onboarding', 'mobile'])[(i * 3) % 10 + 1] AS tags,
       to_char(0.50 + ((i * 37) % 50) / 100.0, 'FM0.00') AS confidence,
       CASE WHEN i % 3 = 0 THEN 'yes' ELSE 'no' END AS needs_review,
       '2026-10-' || lpad(((i - 1) % 28 + 1)::text, 2, '0') AS created_at,
       'https://support.example.com/tickets/' || (999 + i) AS source_url
FROM generate_series(1, 40) i;

-- The four mistakes the sample file has on purpose (data rows 4, 12, 18, 26)
CREATE TEMP TABLE t_bad ON COMMIT DROP AS SELECT * FROM t_rows;
UPDATE t_bad SET confidence   = 'n/a'        WHERE n = 4;
UPDATE t_bad SET source_url   = 'not-a-link' WHERE n = 12;
UPDATE t_bad SET created_at   = '2026-13-45' WHERE n = 18;
UPDATE t_bad SET needs_review = 'maybe'      WHERE n = 26;

-- ---------------------------------------------------------------- uploads
-- Creates one upload of ticket rows from the given temp table: the file, the parsed rows,
-- and validation issues. It computes what the worker would find and finishes with consistent counts.
CREATE FUNCTION pg_temp.seed_ticket_upload(p_id uuid, p_name text, p_file text, p_src regclass, p_age interval)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    v_csv text;
BEGIN
    EXECUTE format($q$
        SELECT 'ticket_id,text,label,tags,confidence,needs_review,created_at,source_url' || E'\n' ||
               string_agg(concat_ws(',', ticket_id, pg_temp.csv_field(text), label, pg_temp.csv_field(tags),
                                    confidence, needs_review, created_at, source_url), E'\n' ORDER BY n) || E'\n'
        FROM %s $q$, p_src) INTO v_csv;

    INSERT INTO uploads (id, owner_id, name, template_version_id, schema_snapshot, original_filename,
                         size_bytes, sha256, detected_delimiter, status, attempt, locked_at,
                         created_at, validation_started_at)
    VALUES (p_id, '00000000-0000-4000-8000-000000000001', p_name, '11000000-0000-4000-8000-000000000002',
            pg_temp.snapshot('11000000-0000-4000-8000-000000000002'), p_file,
            octet_length(convert_to(v_csv, 'UTF8')), sha256(convert_to(v_csv, 'UTF8')), ',',
            'validating', 1, now() - p_age, now() - p_age, now() - p_age);
    INSERT INTO upload_files VALUES (p_id, convert_to(v_csv, 'UTF8'));

    EXECUTE format($q$
        INSERT INTO upload_rows (upload_id, row_number, data)
        SELECT %L, n, jsonb_build_object(
            'ticket_id', ticket_id, 'text', text, 'label', label,
            'tags', to_jsonb(regexp_split_to_array(tags, '\s*,\s*')),
            'confidence', confidence, 'needs_review', needs_review,
            'created_at', created_at, 'source_url', source_url)
        FROM %s $q$, p_id, p_src);

    -- Type errors: only the four planted mistakes can fail
    INSERT INTO validation_issues (upload_id, row_number, column_key, rule, severity, message, raw_value)
    SELECT p_id, row_number, k, 'type', 'error', msg, data->>k
    FROM upload_rows ur
    CROSS JOIN LATERAL (VALUES
        ('confidence',   data->>'confidence'   !~ '^-?\d+(\.\d+)?$',          '"%s" is not a number'),
        ('source_url',   data->>'source_url'   !~ '^https?://',               '"%s" is not a valid URL'),
        ('created_at',   data->>'created_at'   !~ '^\d{4}-(0[1-9]|1[0-2])-',  '"%s" is not a valid date (use YYYY-MM-DD)'),
        ('needs_review', data->>'needs_review' NOT IN ('yes','no'),           '"%s" is not true/false')
    ) t(k, bad, tmpl)
    CROSS JOIN LATERAL (SELECT format(tmpl, data->>k) AS msg) m
    WHERE ur.upload_id = p_id AND bad;

    -- v2 warning rule: confidence below 0.6
    INSERT INTO validation_issues (upload_id, row_number, column_key, rule, severity, message, raw_value)
    SELECT p_id, row_number, 'confidence', 'min', 'warning', 'Low confidence: double-check the label', data->>'confidence'
    FROM upload_rows
    WHERE upload_id = p_id AND data->>'confidence' ~ '^-?\d+(\.\d+)?$' AND (data->>'confidence')::numeric < 0.6;

    PERFORM pg_temp.finish_upload(p_id, p_age);
END $$;

-- Same final step as the worker: compute the counts and summary from the issues, then set the status.
CREATE FUNCTION pg_temp.finish_upload(p_id uuid, p_age interval) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    UPDATE upload_rows ur SET has_errors = true
    WHERE ur.upload_id = p_id
      AND EXISTS (SELECT 1 FROM validation_issues vi
                  WHERE vi.upload_id = p_id AND vi.row_number = ur.row_number AND vi.severity = 'error');

    UPDATE uploads u SET
        total_rows        = (SELECT count(*) FROM upload_rows WHERE upload_id = p_id),
        error_count       = s.errors,
        warning_count     = s.warnings,
        invalid_row_count = (SELECT count(*) FROM upload_rows WHERE upload_id = p_id AND has_errors),
        issue_summary     = s.summary,
        status = CASE WHEN s.errors > 0 THEN 'failed_validation'
                      WHEN s.warnings > 0 THEN 'passed_with_warnings'
                      ELSE 'passed' END::upload_status,
        locked_at = NULL,
        validation_finished_at = now() - p_age + interval '2 seconds'
    FROM (
        SELECT count(*) FILTER (WHERE severity = 'error')   AS errors,
               count(*) FILTER (WHERE severity = 'warning') AS warnings,
               COALESCE((SELECT jsonb_agg(jsonb_build_object('column_key', column_key, 'rule', rule,
                                                              'severity', severity, 'count', cnt)
                                          ORDER BY severity, cnt DESC)
                         FROM (SELECT column_key, rule, severity, count(*) cnt FROM validation_issues
                               WHERE upload_id = p_id GROUP BY 1, 2, 3) g), '[]') AS summary
        FROM validation_issues WHERE upload_id = p_id
    ) s
    WHERE u.id = p_id;
END $$;

-- 1) failed_validation: the raw file with its 4 mistakes (plus low-confidence warnings)
SELECT pg_temp.seed_ticket_upload('30000000-0000-4000-8000-000000000001', 'October tickets',
                                  'tickets_oct.csv', 't_bad', interval '3 hours');
-- 2) passed_with_warnings: the corrected file, uploaded again as a NEW entry
SELECT pg_temp.seed_ticket_upload('30000000-0000-4000-8000-000000000002', 'October tickets (corrected)',
                                  'tickets_oct_fixed.csv', 't_rows', interval '2 hours');

-- 3) passed: 25 clean contacts
DO $$
DECLARE
    v_id  uuid := '30000000-0000-4000-8000-000000000003';
    v_csv text;
BEGIN
    SELECT 'Email,Full name,Phone,Country,Signup date' || E'\n' || string_agg(
               format('lead%s@acme-corp.com,%s,+1 555 01%s,%s,2026-0%s-1%s',
                      i, (ARRAY['Ana Silva','Ben Carter','Chloe Martin','Dev Patel','Emma Wright'])[i % 5 + 1],
                      lpad(i::text, 2, '0'), (ARRAY['US','GB','DE','IN'])[i % 4 + 1], i % 9 + 1, i % 9),
               E'\n' ORDER BY i) || E'\n'
    INTO v_csv FROM generate_series(1, 25) i;

    INSERT INTO uploads (id, owner_id, name, template_version_id, schema_snapshot, original_filename,
                         size_bytes, sha256, detected_delimiter, status, attempt, created_at, validation_started_at)
    VALUES (v_id, '00000000-0000-4000-8000-000000000001', 'Leads – November',
            '21000000-0000-4000-8000-000000000001', pg_temp.snapshot('21000000-0000-4000-8000-000000000001'),
            'leads_nov.csv', octet_length(convert_to(v_csv, 'UTF8')), sha256(convert_to(v_csv, 'UTF8')), ',',
            'validating', 1, now() - interval '1 day', now() - interval '1 day');
    INSERT INTO upload_files VALUES (v_id, convert_to(v_csv, 'UTF8'));
    INSERT INTO upload_rows (upload_id, row_number, data)
    SELECT v_id, ln - 1, jsonb_build_object('email', f[1], 'full_name', f[2], 'phone', f[3], 'country', f[4], 'signup_date', f[5])
    FROM regexp_split_to_table(rtrim(v_csv, E'\n'), E'\n') WITH ORDINALITY AS l(line, ln)
    CROSS JOIN LATERAL string_to_array(line, ',') f
    WHERE ln > 1;
    PERFORM pg_temp.finish_upload(v_id, interval '1 day');
END $$;

-- 4) queued: an ad-hoc upload (no template) with one rule added in the upload screen
DO $$
DECLARE
    v_id  uuid := '30000000-0000-4000-8000-000000000004';
    v_csv bytea := convert_to(E'vendor,contact_email,annual_spend\nAcme Ltd,ap@acme.test,120000\nGlobex,billing@globex.test,87000\n', 'UTF8');
BEGIN
    INSERT INTO uploads (id, owner_id, name, schema_snapshot, original_filename, size_bytes, sha256, detected_delimiter, created_at)
    VALUES (v_id, '00000000-0000-4000-8000-000000000001', 'Vendor list', jsonb_build_object(
            'templateVersionId', NULL, 'hasHeaderRow', true, 'allowExtraColumns', true,
            'columns', jsonb_build_array(
                jsonb_build_object('key','vendor','name','vendor','type','text','required',true,'delimiter',NULL,
                                   'aliases','[]'::jsonb,'sourceIndex',0,'sourceHeader','vendor','rules','[]'::jsonb),
                jsonb_build_object('key','contact_email','name','contact_email','type','email','required',false,'delimiter',NULL,
                                   'aliases','[]'::jsonb,'sourceIndex',1,'sourceHeader','contact_email','rules','[]'::jsonb),
                jsonb_build_object('key','annual_spend','name','annual_spend','type','number','required',false,'delimiter',NULL,
                                   'aliases','[]'::jsonb,'sourceIndex',2,'sourceHeader','annual_spend',
                                   'rules', jsonb_build_array(jsonb_build_object('type','min','params',jsonb_build_object('value',0),
                                                                                 'severity','error'))))),
            'vendors.csv', octet_length(v_csv), sha256(v_csv), ',', now() - interval '20 seconds');
    INSERT INTO upload_files VALUES (v_id, v_csv);
END $$;

-- 5) validating: claimed by a worker a moment ago
DO $$
DECLARE
    v_id  uuid := '30000000-0000-4000-8000-000000000005';
    v_csv bytea := convert_to(E'Email,Full name,Phone,Country,Signup date\nq3-1@acme-corp.com,Fay Ng,+44 20 7946 0000,GB,2026-07-02\n', 'UTF8');
BEGIN
    INSERT INTO uploads (id, owner_id, name, template_version_id, schema_snapshot, original_filename, size_bytes, sha256,
                         detected_delimiter, status, attempt, locked_at, created_at, validation_started_at)
    VALUES (v_id, '00000000-0000-4000-8000-000000000001', 'Q3 contacts', '21000000-0000-4000-8000-000000000001',
            pg_temp.snapshot('21000000-0000-4000-8000-000000000001'), 'q3_contacts.csv', octet_length(v_csv), sha256(v_csv),
            ',', 'validating', 1, now() - interval '5 seconds', now() - interval '40 seconds', now() - interval '5 seconds');
    INSERT INTO upload_files VALUES (v_id, v_csv);
END $$;

-- 6) error: the file could not be read (Latin-1 bytes), so it never reached row validation
DO $$
DECLARE
    v_id  uuid := '30000000-0000-4000-8000-000000000006';
    v_csv bytea := '\x6e616d652c636974790a4a6f73e92c4d6f6e7472e9616c0a'::bytea;  -- "name,city\nJos\xe9,Montr\xe9al\n" in Latin-1
BEGIN
    INSERT INTO uploads (id, owner_id, name, schema_snapshot, original_filename, size_bytes, sha256, status, status_message,
                         attempt, created_at, validation_started_at, validation_finished_at)
    VALUES (v_id, '00000000-0000-4000-8000-000000000001', 'Legacy export',
            '{"templateVersionId":null,"hasHeaderRow":true,"allowExtraColumns":true,"columns":[{"key":"name","name":"name","type":"text","required":false,"delimiter":null,"aliases":[],"rules":[],"sourceIndex":0,"sourceHeader":"name"},{"key":"city","name":"city","type":"text","required":false,"delimiter":null,"aliases":[],"rules":[],"sourceIndex":1,"sourceHeader":"city"}]}',
            'legacy_export.csv', octet_length(v_csv), sha256(v_csv), 'error',
            'The file is not valid UTF-8 (byte 0xE9 on line 2). Save it as "CSV UTF-8" and upload it again.',
            1, now() - interval '3 days', now() - interval '3 days', now() - interval '3 days' + interval '1 second');
    INSERT INTO upload_files VALUES (v_id, v_csv);
END $$;

COMMIT;

-- Summary shown after seeding
SELECT u.name, u.status, u.total_rows AS rows, u.error_count AS errors, u.warning_count AS warnings,
       COALESCE(t.name || ' v' || tv.version, 'ad-hoc') AS template
FROM uploads u
LEFT JOIN template_versions tv ON tv.id = u.template_version_id
LEFT JOIN templates t ON t.id = tv.template_id
WHERE u.owner_id = '00000000-0000-4000-8000-000000000001'
ORDER BY u.created_at DESC;
