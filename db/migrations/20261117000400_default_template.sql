-- migrate:up
-- "Default CSV template" (task requirement): one template per user can be the default, and it is
-- preselected when the user starts a new upload. Archived templates can't be the default.
ALTER TABLE templates ADD COLUMN is_default boolean NOT NULL DEFAULT false;
ALTER TABLE templates ADD CONSTRAINT templates_default_not_archived_chk
    CHECK (NOT (is_default AND archived_at IS NOT NULL));
CREATE UNIQUE INDEX templates_one_default_per_owner_uq ON templates (owner_id) WHERE is_default;

-- migrate:down
DROP INDEX templates_one_default_per_owner_uq;
ALTER TABLE templates DROP CONSTRAINT templates_default_not_archived_chk;
ALTER TABLE templates DROP COLUMN is_default;
