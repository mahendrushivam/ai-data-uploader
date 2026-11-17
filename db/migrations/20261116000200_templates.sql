-- migrate:up
-- Personal CSV templates (phase 1: owned by one user, not shared).
-- Saving a template inserts a NEW version (with its columns and rules) in one transaction.
-- Versions are never updated, so every upload points at the exact definition that validated it.

CREATE TABLE templates (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id            uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name                text        NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
    description         text        CHECK (length(description) <= 1000),
    current_version_id  uuid,       -- FK added below, after template_versions exists
    archived_at         timestamptz,  -- "delete" in the UI archives; old uploads keep their reference
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);
-- Template names are unique per user among active templates (case-insensitive).
CREATE UNIQUE INDEX templates_owner_name_uq ON templates (owner_id, lower(name)) WHERE archived_at IS NULL;
CREATE INDEX templates_owner_idx ON templates (owner_id, updated_at DESC) WHERE archived_at IS NULL;
CREATE TRIGGER templates_updated_at BEFORE UPDATE ON templates
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE template_versions (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id          uuid        NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
    version              integer     NOT NULL CHECK (version > 0),
    has_header_row       boolean     NOT NULL DEFAULT true,
    -- CSV headers that match no template column: ignored (true) or reported as a file error (false)
    allow_extra_columns  boolean     NOT NULL DEFAULT true,
    created_at           timestamptz NOT NULL DEFAULT now(),
    UNIQUE (template_id, version),
    UNIQUE (template_id, id)          -- target of the composite FK below
);

-- current_version_id must be a version of THIS template (composite FK, not just "some version").
ALTER TABLE templates
    ADD CONSTRAINT templates_current_version_fk
    FOREIGN KEY (id, current_version_id) REFERENCES template_versions (template_id, id);

-- Same type list as the existing front end (src/types.ts -> ColumnType).
CREATE TYPE column_data_type AS ENUM
    ('text', 'number', 'integer', 'boolean', 'date', 'email', 'url', 'select', 'multiselect');

CREATE TABLE template_columns (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    template_version_id  uuid             NOT NULL REFERENCES template_versions(id) ON DELETE CASCADE,
    position             integer          NOT NULL CHECK (position >= 0),
    key                  text             NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{0,62}$'),  -- e.g. ticket_id
    display_name         text             NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 100),
    data_type            column_data_type NOT NULL DEFAULT 'text',
    required             boolean          NOT NULL DEFAULT false,
    multi_delimiter      text             CHECK (multi_delimiter IN (',', ';', '|', '/')),
    -- Other header spellings used when auto-matching a file's headers ("Ticket #", "id", ...)
    header_aliases       text[]           NOT NULL DEFAULT '{}',
    UNIQUE (template_version_id, key),
    UNIQUE (template_version_id, position),
    -- A delimiter exists exactly when the column is a multi-value list
    CONSTRAINT template_columns_delimiter_chk CHECK ((data_type = 'multiselect') = (multi_delimiter IS NOT NULL))
);

-- Declarative rules only; no user code is ever run. "required" is a column flag, not a rule.
-- The API validates params with zod. The CHECK below is a safety net on their shape:
--   min / max                  {"value": 0}   numbers; ISO dates for date columns ("2024-01-01")
--   min_length / max_length    {"value": 255}
--   regex                      {"pattern": "^[A-Z]{3}-\\d+$", "flags": "i"}  (run with RE2 on the server)
--   allowed_values             {"values": ["bug", "praise"], "case_sensitive": false}
--   unique                     {}
CREATE TYPE rule_type AS ENUM ('min', 'max', 'min_length', 'max_length', 'regex', 'allowed_values', 'unique');
CREATE TYPE issue_severity AS ENUM ('error', 'warning');

CREATE TABLE column_rules (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    template_column_id  uuid           NOT NULL REFERENCES template_columns(id) ON DELETE CASCADE,
    rule_type           rule_type      NOT NULL,
    params              jsonb          NOT NULL DEFAULT '{}',
    severity            issue_severity NOT NULL DEFAULT 'error',
    message             text           CHECK (length(message) <= 300),  -- optional custom message
    UNIQUE (template_column_id, rule_type),                              -- one rule of each type per column
    -- COALESCE matters: a missing key makes jsonb_typeof() NULL, and a NULL CHECK result counts as a pass.
    CONSTRAINT column_rules_params_chk CHECK (
        jsonb_typeof(params) = 'object' AND
        COALESCE(CASE rule_type
            WHEN 'min'            THEN jsonb_typeof(params->'value') IN ('number', 'string')
            WHEN 'max'            THEN jsonb_typeof(params->'value') IN ('number', 'string')
            WHEN 'min_length'     THEN jsonb_typeof(params->'value') = 'number'
            WHEN 'max_length'     THEN jsonb_typeof(params->'value') = 'number'
            WHEN 'regex'          THEN jsonb_typeof(params->'pattern') = 'string'
            WHEN 'allowed_values' THEN jsonb_typeof(params->'values') = 'array'
                                       AND jsonb_array_length(params->'values') > 0
            WHEN 'unique'         THEN true
        END, false)
    )
);

-- Versions, columns and rules are insert-only. Editing a template means inserting a new version.
CREATE FUNCTION forbid_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION '% rows are immutable; save a new template version instead', TG_TABLE_NAME
        USING ERRCODE = 'restrict_violation';
END $$;
CREATE TRIGGER template_versions_immutable BEFORE UPDATE ON template_versions
    FOR EACH ROW EXECUTE FUNCTION forbid_update();
CREATE TRIGGER template_columns_immutable  BEFORE UPDATE ON template_columns
    FOR EACH ROW EXECUTE FUNCTION forbid_update();
CREATE TRIGGER column_rules_immutable      BEFORE UPDATE ON column_rules
    FOR EACH ROW EXECUTE FUNCTION forbid_update();

-- migrate:down
DROP TABLE column_rules;
DROP TABLE template_columns;
ALTER TABLE templates DROP CONSTRAINT templates_current_version_fk;
DROP TABLE template_versions;
DROP TABLE templates;
DROP FUNCTION forbid_update();
DROP TYPE issue_severity;
DROP TYPE rule_type;
DROP TYPE column_data_type;
