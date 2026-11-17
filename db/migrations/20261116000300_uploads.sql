-- migrate:up
-- Every upload is a new, separate entry. Fixing errors means downloading the error report,
-- correcting the file and uploading it again, which creates a new row here (phase 1 decision).
-- Files are at most 5 MB, so the original file is kept in Postgres (upload_files) and no
-- object storage is needed.

CREATE TYPE upload_status AS ENUM (
    'queued',                -- file stored, waiting for the validation worker
    'validating',            -- a worker has claimed it (see locked_at)
    'passed',                -- no issues
    'passed_with_warnings',  -- warning-severity issues only
    'failed_validation',     -- at least one error: show the errors and offer the download
    'error'                  -- system failure (unreadable file, worker gave up): not the user's data
);

CREATE TABLE uploads (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id                uuid          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name                    text          NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    -- NULL = ad-hoc upload: columns and rules were set up in the upload screen, with no saved template
    template_version_id     uuid          REFERENCES template_versions(id),
    -- The schema actually used: columns, CSV-header -> column mapping, rules (from the template
    -- and/or ad-hoc). The worker validates against this, so results can be reproduced later.
    schema_snapshot         jsonb         NOT NULL
                            CHECK (COALESCE(jsonb_typeof(schema_snapshot->'columns') = 'array', false)),
    -- Original file metadata (the bytes are in upload_files)
    original_filename       text          NOT NULL CHECK (length(original_filename) BETWEEN 1 AND 255),
    size_bytes              integer       NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),  -- 5 MB cap
    sha256                  bytea         NOT NULL CHECK (octet_length(sha256) = 32),
    detected_delimiter      text,
    -- Lifecycle
    status                  upload_status NOT NULL DEFAULT 'queued',
    status_message          text,         -- shown for 'error', e.g. "File is not valid UTF-8"
    attempt                 smallint      NOT NULL DEFAULT 0 CHECK (attempt >= 0),
    locked_at               timestamptz,  -- set by the worker when it claims the job
    -- Results, filled in when validation finishes
    total_rows              integer       CHECK (total_rows >= 0),
    error_count             integer       NOT NULL DEFAULT 0 CHECK (error_count >= 0),
    warning_count           integer       NOT NULL DEFAULT 0 CHECK (warning_count >= 0),
    invalid_row_count       integer       NOT NULL DEFAULT 0 CHECK (invalid_row_count >= 0),
    -- Exact counts per column and rule: [{"column_key","rule","severity","count"}].
    -- Stays exact even when stored issues are truncated.
    issue_summary           jsonb         NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(issue_summary) = 'array'),
    issues_truncated        boolean       NOT NULL DEFAULT false,  -- stored-issue cap (100k) was hit
    created_at              timestamptz   NOT NULL DEFAULT now(),
    validation_started_at   timestamptz,
    validation_finished_at  timestamptz,
    updated_at              timestamptz   NOT NULL DEFAULT now(),
    deleted_at              timestamptz,  -- removed from the list by the user; purged later

    -- Status and results must agree with each other:
    CONSTRAINT uploads_finished_chk CHECK (
        (status IN ('passed', 'passed_with_warnings', 'failed_validation', 'error'))
        = (validation_finished_at IS NOT NULL)),
    CONSTRAINT uploads_started_chk CHECK (status = 'queued' OR validation_started_at IS NOT NULL),
    CONSTRAINT uploads_passed_chk CHECK (status <> 'passed' OR (error_count = 0 AND warning_count = 0)),
    CONSTRAINT uploads_warnings_chk CHECK (status <> 'passed_with_warnings' OR (error_count = 0 AND warning_count > 0)),
    CONSTRAINT uploads_failed_chk CHECK (status <> 'failed_validation' OR error_count > 0),
    CONSTRAINT uploads_error_msg_chk CHECK (status <> 'error' OR status_message IS NOT NULL)
);
-- Listing page: "my uploads, newest first", optionally filtered by status
CREATE INDEX uploads_owner_created_idx ON uploads (owner_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX uploads_owner_status_idx  ON uploads (owner_id, status, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX uploads_template_version_idx ON uploads (template_version_id);
-- Worker queue: small partial index over the jobs that still need work
CREATE INDEX uploads_pending_idx ON uploads (created_at) WHERE status IN ('queued', 'validating');
CREATE TRIGGER uploads_updated_at BEFORE UPDATE ON uploads
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Original file bytes, kept out of "uploads" so list queries never read them.
-- Used for "download original" and for re-running validation. Can be purged by a retention job.
CREATE TABLE upload_files (
    upload_id  uuid  PRIMARY KEY REFERENCES uploads(id) ON DELETE CASCADE,
    content    bytea NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 5242880)
);

-- Parsed data, keyed by template column key: {"ticket_id": "1001", "tags": ["ux","web"], ...}
-- Backs the read-only data view and the "file with errors marked" download.
CREATE TABLE upload_rows (
    upload_id   uuid    NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
    row_number  integer NOT NULL CHECK (row_number > 0),  -- 1-based data row, as the user counts it
    data        jsonb   NOT NULL,
    has_errors  boolean NOT NULL DEFAULT false,
    PRIMARY KEY (upload_id, row_number)
);
CREATE INDEX upload_rows_with_errors_idx ON upload_rows (upload_id, row_number) WHERE has_errors;

-- One row per failed check. row_number and column_key are NULL for file-level problems
-- (required column missing from the file, duplicate header, empty file, ...).
CREATE TABLE validation_issues (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    upload_id   uuid           NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
    row_number  integer        CHECK (row_number > 0),
    column_key  text,
    rule        text           NOT NULL,  -- 'type', 'required', 'missing_column', 'duplicate_header' or a rule_type
    severity    issue_severity NOT NULL,
    message     text           NOT NULL,
    raw_value   text           CHECK (length(raw_value) <= 500)  -- the worker truncates longer values
);
CREATE INDEX validation_issues_upload_row_idx ON validation_issues (upload_id, row_number, column_key);
CREATE INDEX validation_issues_upload_col_idx ON validation_issues (upload_id, column_key, rule);

-- migrate:down
DROP TABLE validation_issues;
DROP TABLE upload_rows;
DROP TABLE upload_files;
DROP TABLE uploads;
DROP TYPE upload_status;
