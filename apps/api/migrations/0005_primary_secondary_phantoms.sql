-- Primary / Secondary streams, the 22-column Inbox, Phantoms.
--
-- * Every item belongs to a stream. Existing items become Primary.
-- * Each stream has its own column set (tracker_columns / column_options gain a
--   `stream`). Existing columns become Primary's and are copied to Secondary.
-- * The default columns are renamed/reordered to the new Inbox layout and the
--   13 new fields are added (Tracker/Phantoms tables keep showing only the
--   previous nine via `in_tracker`). Custom columns are kept, after them.
-- * `long` (multi-line text) is a new column type.
-- * `record_id` (the analyst-entered ID) is projected onto intelligence_items
--   and must be unique among tracker entries of a tenant.

-- ---------------------------------------------------------------- items
ALTER TABLE intelligence_items ADD COLUMN stream TEXT NOT NULL DEFAULT 'primary' CHECK (stream IN ('primary', 'secondary'));
ALTER TABLE intelligence_items ADD COLUMN record_id TEXT;
CREATE INDEX ix_item_stream ON intelligence_items (tenant_id, stream, status, pub_date);
CREATE UNIQUE INDEX ux_item_record ON intelligence_items (tenant_id, record_id) WHERE record_id IS NOT NULL AND status = 'approved';

-- Existing entries came from the only (primary) input.
UPDATE intelligence_items SET draft_json = json_set(draft_json, '$."source_tier"', 'Primary'), extra_json = json_set(extra_json, '$."source_tier"', 'Primary');

-- ---------------------------------------------------------------- columns
CREATE TABLE tracker_columns_new (
  tenant_id   TEXT NOT NULL REFERENCES tenants(id),
  stream      TEXT NOT NULL DEFAULT 'primary' CHECK (stream IN ('primary', 'secondary')),
  key         TEXT NOT NULL,
  label       TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('date', 'multi', 'macro', 'sub', 'text', 'long', 'select')),
  core        INTEGER NOT NULL DEFAULT 0,
  required    INTEGER NOT NULL DEFAULT 0,
  ai_assist   INTEGER NOT NULL DEFAULT 1,
  in_tracker  INTEGER NOT NULL DEFAULT 1,
  position    INTEGER NOT NULL,
  deleted_at  TEXT,
  PRIMARY KEY (tenant_id, stream, key)
);
INSERT INTO tracker_columns_new (tenant_id, stream, key, label, type, core, required, ai_assist, in_tracker, position, deleted_at)
  SELECT tenant_id, 'primary', key, label, type, core, required, ai_assist, 1, position, deleted_at FROM tracker_columns;
DROP TABLE tracker_columns;
ALTER TABLE tracker_columns_new RENAME TO tracker_columns;

-- Custom columns keep their relative order, after the 22 defaults.
UPDATE tracker_columns SET position = 100 + position
 WHERE key NOT IN ('date', 'competitors', 'macrotrend', 'subtrend', 'title', 'growth', 'impact', 'source', 'action');

-- The nine existing defaults: new names and Inbox positions (still shown in the Tracker).
UPDATE tracker_columns SET label = 'Macrotrend', position = 1 WHERE key = 'macrotrend';
UPDATE tracker_columns SET label = 'Subtrend', position = 2 WHERE key = 'subtrend';
UPDATE tracker_columns SET label = 'Title', position = 3 WHERE key = 'title';
UPDATE tracker_columns SET label = 'Event Date', position = 4 WHERE key = 'date';
UPDATE tracker_columns SET label = 'Impact', position = 6 WHERE key = 'impact';
UPDATE tracker_columns SET label = 'Growth Intensity', position = 7 WHERE key = 'growth';
UPDATE tracker_columns SET label = 'Source Type', position = 8, core = 1 WHERE key = 'source';
UPDATE tracker_columns SET label = 'Competitors', position = 13 WHERE key = 'competitors';
UPDATE tracker_columns SET label = 'Action', position = 18 WHERE key = 'action';

-- The 13 new fields (Inbox and Phantoms Markdown; not Tracker columns).
INSERT INTO tracker_columns (tenant_id, stream, key, label, type, core, required, ai_assist, in_tracker, position)
  SELECT id, 'primary', 'record_id', 'ID', 'text', 1, 1, 0, 0, 0 FROM tenants t
   WHERE NOT EXISTS (SELECT 1 FROM tracker_columns c WHERE c.tenant_id = t.id AND c.stream = 'primary' AND c.key = 'record_id');
INSERT INTO tracker_columns (tenant_id, stream, key, label, type, core, required, ai_assist, in_tracker, position)
  SELECT id, 'primary', 'review_date', 'Review Date', 'date', 1, 0, 0, 0, 5 FROM tenants t
   WHERE NOT EXISTS (SELECT 1 FROM tracker_columns c WHERE c.tenant_id = t.id AND c.stream = 'primary' AND c.key = 'review_date');
INSERT INTO tracker_columns (tenant_id, stream, key, label, type, core, required, ai_assist, in_tracker, position)
  SELECT id, 'primary', 'publisher', 'Publisher', 'text', 1, 0, 1, 0, 9 FROM tenants t
   WHERE NOT EXISTS (SELECT 1 FROM tracker_columns c WHERE c.tenant_id = t.id AND c.stream = 'primary' AND c.key = 'publisher');
INSERT INTO tracker_columns (tenant_id, stream, key, label, type, core, required, ai_assist, in_tracker, position)
  SELECT id, 'primary', 'url', 'URL', 'text', 1, 0, 1, 0, 10 FROM tenants t
   WHERE NOT EXISTS (SELECT 1 FROM tracker_columns c WHERE c.tenant_id = t.id AND c.stream = 'primary' AND c.key = 'url');
INSERT INTO tracker_columns (tenant_id, stream, key, label, type, core, required, ai_assist, in_tracker, position)
  SELECT id, 'primary', 'raw_ref', 'Raw Ref', 'text', 1, 0, 0, 0, 11 FROM tenants t
   WHERE NOT EXISTS (SELECT 1 FROM tracker_columns c WHERE c.tenant_id = t.id AND c.stream = 'primary' AND c.key = 'raw_ref');
INSERT INTO tracker_columns (tenant_id, stream, key, label, type, core, required, ai_assist, in_tracker, position)
  SELECT id, 'primary', 'source_tier', 'Source Tier', 'select', 1, 0, 0, 0, 12 FROM tenants t
   WHERE NOT EXISTS (SELECT 1 FROM tracker_columns c WHERE c.tenant_id = t.id AND c.stream = 'primary' AND c.key = 'source_tier');
INSERT INTO tracker_columns (tenant_id, stream, key, label, type, core, required, ai_assist, in_tracker, position)
  SELECT id, 'primary', 'other_entities', 'Other Entities', 'text', 1, 0, 1, 0, 14 FROM tenants t
   WHERE NOT EXISTS (SELECT 1 FROM tracker_columns c WHERE c.tenant_id = t.id AND c.stream = 'primary' AND c.key = 'other_entities');
INSERT INTO tracker_columns (tenant_id, stream, key, label, type, core, required, ai_assist, in_tracker, position)
  SELECT id, 'primary', 'therapeutic_area', 'Therapeutic Area', 'text', 1, 0, 1, 0, 15 FROM tenants t
   WHERE NOT EXISTS (SELECT 1 FROM tracker_columns c WHERE c.tenant_id = t.id AND c.stream = 'primary' AND c.key = 'therapeutic_area');
INSERT INTO tracker_columns (tenant_id, stream, key, label, type, core, required, ai_assist, in_tracker, position)
  SELECT id, 'primary', 'assets', 'Assets', 'text', 1, 0, 1, 0, 16 FROM tenants t
   WHERE NOT EXISTS (SELECT 1 FROM tracker_columns c WHERE c.tenant_id = t.id AND c.stream = 'primary' AND c.key = 'assets');
INSERT INTO tracker_columns (tenant_id, stream, key, label, type, core, required, ai_assist, in_tracker, position)
  SELECT id, 'primary', 'products', 'Products', 'text', 1, 0, 1, 0, 17 FROM tenants t
   WHERE NOT EXISTS (SELECT 1 FROM tracker_columns c WHERE c.tenant_id = t.id AND c.stream = 'primary' AND c.key = 'products');
INSERT INTO tracker_columns (tenant_id, stream, key, label, type, core, required, ai_assist, in_tracker, position)
  SELECT id, 'primary', 'header', 'Header', 'long', 1, 0, 1, 0, 19 FROM tenants t
   WHERE NOT EXISTS (SELECT 1 FROM tracker_columns c WHERE c.tenant_id = t.id AND c.stream = 'primary' AND c.key = 'header');
INSERT INTO tracker_columns (tenant_id, stream, key, label, type, core, required, ai_assist, in_tracker, position)
  SELECT id, 'primary', 'key_details', 'Key Details', 'long', 1, 0, 1, 0, 20 FROM tenants t
   WHERE NOT EXISTS (SELECT 1 FROM tracker_columns c WHERE c.tenant_id = t.id AND c.stream = 'primary' AND c.key = 'key_details');
INSERT INTO tracker_columns (tenant_id, stream, key, label, type, core, required, ai_assist, in_tracker, position)
  SELECT id, 'primary', 'ci_perspective', 'CI Perspective', 'long', 1, 0, 1, 0, 21 FROM tenants t
   WHERE NOT EXISTS (SELECT 1 FROM tracker_columns c WHERE c.tenant_id = t.id AND c.stream = 'primary' AND c.key = 'ci_perspective');

-- ---------------------------------------------------------------- options
ALTER TABLE column_options ADD COLUMN stream TEXT NOT NULL DEFAULT 'primary' CHECK (stream IN ('primary', 'secondary'));
DROP INDEX IF EXISTS ux_option;
CREATE UNIQUE INDEX ux_option ON column_options (tenant_id, stream, column_key, value);

INSERT INTO column_options (id, tenant_id, stream, column_key, value, parent, position, created_at)
  SELECT 'opt_tier_p_' || t.id, t.id, 'primary', 'source_tier', 'Primary', NULL, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM tenants t;
INSERT INTO column_options (id, tenant_id, stream, column_key, value, parent, position, created_at)
  SELECT 'opt_tier_s_' || t.id, t.id, 'primary', 'source_tier', 'Reviewed-Secondary', NULL, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM tenants t;

-- ---------------------------------------------------------------- Secondary = copy of Primary
INSERT INTO tracker_columns (tenant_id, stream, key, label, type, core, required, ai_assist, in_tracker, position, deleted_at)
  SELECT tenant_id, 'secondary', key, label, type, core, required, ai_assist, in_tracker, position, deleted_at FROM tracker_columns WHERE stream = 'primary';
INSERT INTO column_options (id, tenant_id, stream, column_key, value, parent, position, created_at)
  SELECT id || '_s', tenant_id, 'secondary', column_key, value, parent, position, created_at FROM column_options WHERE stream = 'primary';

UPDATE schema_meta SET revision = revision + 1;

-- ---------------------------------------------------------------- saved views
-- (Tracker saved views keep working for both streams; Phantoms reuses them.)
