-- Primary stream: its own column set for primary sources.
--
-- Primary Inbox / Tracker columns become: ID, Title, Event Date, Source Role,
-- Source Company, Source Location, Source Confidence, Macrotrend, Subtrend,
-- Growth Intensity, Impact, Source Type, Competitors, Action, Workstream,
-- Source Therapeutic Area, Source Brand or Asset, Insight Topic, Key
-- Intelligence Question, Key Details, Key Metrics.
-- The nine Tracker/Dashboard columns are unchanged (same keys, labels, options).
-- Secondary is not changed. Values already entered in the removed Primary
-- fields stay stored with each entry (hidden), so nothing is lost.
-- Custom columns are kept, after these.

-- Secondary-only fields leave the Primary column set.
UPDATE tracker_columns SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE stream = 'primary' AND deleted_at IS NULL AND key IN ('review_date', 'publisher', 'url', 'raw_ref', 'source_tier', 'other_entities', 'therapeutic_area', 'assets', 'products', 'header', 'ci_perspective');
DELETE FROM column_options WHERE stream = 'primary' AND column_key IN ('review_date', 'publisher', 'url', 'raw_ref', 'source_tier', 'other_entities', 'therapeutic_area', 'assets', 'products', 'header', 'ci_perspective');

-- The new Primary fields (locked: the Primary Markdown is built from them).
INSERT OR IGNORE INTO tracker_columns (tenant_id, stream, key, label, type, core, required, ai_assist, in_tracker, position)
  SELECT id, 'primary', 'source_role', 'Source Role', 'text', 1, 0, 1, 0, 3 FROM tenants;
UPDATE tracker_columns SET deleted_at = NULL, core = 1, position = 3 WHERE stream = 'primary' AND key = 'source_role';
INSERT OR IGNORE INTO tracker_columns (tenant_id, stream, key, label, type, core, required, ai_assist, in_tracker, position)
  SELECT id, 'primary', 'source_company', 'Source Company', 'text', 1, 0, 1, 0, 4 FROM tenants;
UPDATE tracker_columns SET deleted_at = NULL, core = 1, position = 4 WHERE stream = 'primary' AND key = 'source_company';
INSERT OR IGNORE INTO tracker_columns (tenant_id, stream, key, label, type, core, required, ai_assist, in_tracker, position)
  SELECT id, 'primary', 'source_location', 'Source Location', 'text', 1, 0, 1, 0, 5 FROM tenants;
UPDATE tracker_columns SET deleted_at = NULL, core = 1, position = 5 WHERE stream = 'primary' AND key = 'source_location';
INSERT OR IGNORE INTO tracker_columns (tenant_id, stream, key, label, type, core, required, ai_assist, in_tracker, position)
  SELECT id, 'primary', 'source_confidence', 'Source Confidence', 'text', 1, 0, 1, 0, 6 FROM tenants;
UPDATE tracker_columns SET deleted_at = NULL, core = 1, position = 6 WHERE stream = 'primary' AND key = 'source_confidence';
INSERT OR IGNORE INTO tracker_columns (tenant_id, stream, key, label, type, core, required, ai_assist, in_tracker, position)
  SELECT id, 'primary', 'workstream', 'Workstream', 'text', 1, 0, 1, 0, 14 FROM tenants;
UPDATE tracker_columns SET deleted_at = NULL, core = 1, position = 14 WHERE stream = 'primary' AND key = 'workstream';
INSERT OR IGNORE INTO tracker_columns (tenant_id, stream, key, label, type, core, required, ai_assist, in_tracker, position)
  SELECT id, 'primary', 'source_therapeutic_area', 'Source Therapeutic Area', 'text', 1, 0, 1, 0, 15 FROM tenants;
UPDATE tracker_columns SET deleted_at = NULL, core = 1, position = 15 WHERE stream = 'primary' AND key = 'source_therapeutic_area';
INSERT OR IGNORE INTO tracker_columns (tenant_id, stream, key, label, type, core, required, ai_assist, in_tracker, position)
  SELECT id, 'primary', 'source_brand_asset', 'Source Brand or Asset', 'text', 1, 0, 1, 0, 16 FROM tenants;
UPDATE tracker_columns SET deleted_at = NULL, core = 1, position = 16 WHERE stream = 'primary' AND key = 'source_brand_asset';
INSERT OR IGNORE INTO tracker_columns (tenant_id, stream, key, label, type, core, required, ai_assist, in_tracker, position)
  SELECT id, 'primary', 'insight_topic', 'Insight Topic', 'text', 1, 0, 1, 0, 17 FROM tenants;
UPDATE tracker_columns SET deleted_at = NULL, core = 1, position = 17 WHERE stream = 'primary' AND key = 'insight_topic';
INSERT OR IGNORE INTO tracker_columns (tenant_id, stream, key, label, type, core, required, ai_assist, in_tracker, position)
  SELECT id, 'primary', 'key_intelligence_question', 'Key Intelligence Question', 'long', 1, 0, 1, 0, 18 FROM tenants;
UPDATE tracker_columns SET deleted_at = NULL, core = 1, position = 18 WHERE stream = 'primary' AND key = 'key_intelligence_question';
INSERT OR IGNORE INTO tracker_columns (tenant_id, stream, key, label, type, core, required, ai_assist, in_tracker, position)
  SELECT id, 'primary', 'key_metrics', 'Key Metrics', 'long', 1, 0, 1, 0, 20 FROM tenants;
UPDATE tracker_columns SET deleted_at = NULL, core = 1, position = 20 WHERE stream = 'primary' AND key = 'key_metrics';

-- Inbox order for the columns Primary keeps. Action is part of the Primary Markdown, so it is locked there.
UPDATE tracker_columns SET position = 0 WHERE stream = 'primary' AND key = 'record_id';
UPDATE tracker_columns SET position = 1 WHERE stream = 'primary' AND key = 'title';
UPDATE tracker_columns SET position = 2 WHERE stream = 'primary' AND key = 'date';
UPDATE tracker_columns SET position = 7 WHERE stream = 'primary' AND key = 'macrotrend';
UPDATE tracker_columns SET position = 8 WHERE stream = 'primary' AND key = 'subtrend';
UPDATE tracker_columns SET position = 9 WHERE stream = 'primary' AND key = 'growth';
UPDATE tracker_columns SET position = 10 WHERE stream = 'primary' AND key = 'impact';
UPDATE tracker_columns SET position = 11 WHERE stream = 'primary' AND key = 'source';
UPDATE tracker_columns SET position = 12 WHERE stream = 'primary' AND key = 'competitors';
UPDATE tracker_columns SET position = 13, core = 1 WHERE stream = 'primary' AND key = 'action';
UPDATE tracker_columns SET position = 19 WHERE stream = 'primary' AND key = 'key_details';

UPDATE schema_meta SET revision = revision + 1;
