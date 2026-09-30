-- Separate Tracker and Phantoms tables, chosen from each stream's Inbox columns.
--
-- Every column stays an Inbox column (tracker_columns row, position = Inbox
-- order). in_tracker already marks the Tracker table; tracker_position now
-- gives the Tracker its own order. in_phantoms / phantoms_position add the
-- Phantoms table (it used to show the Tracker columns).
--
-- Dropdown options (column_options) are keyed by (stream, column) and are
-- not touched: all three tables use the same columns and options.
ALTER TABLE tracker_columns ADD COLUMN tracker_position INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tracker_columns ADD COLUMN in_phantoms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tracker_columns ADD COLUMN phantoms_position INTEGER NOT NULL DEFAULT 0;

-- Tracker: keep which columns are shown; the default ones first in the default
-- order (Title, Event Date, Macrotrend, Subtrend, Growth Intensity, Impact,
-- Source Type, Competitors, Action), any others after them in Inbox order.
UPDATE tracker_columns SET tracker_position = 100 + position, phantoms_position = 100 + position;
UPDATE tracker_columns SET tracker_position = 0 WHERE key = 'title';
UPDATE tracker_columns SET tracker_position = 1 WHERE key = 'date';
UPDATE tracker_columns SET tracker_position = 2 WHERE key = 'macrotrend';
UPDATE tracker_columns SET tracker_position = 3 WHERE key = 'subtrend';
UPDATE tracker_columns SET tracker_position = 4 WHERE key = 'growth';
UPDATE tracker_columns SET tracker_position = 5 WHERE key = 'impact';
UPDATE tracker_columns SET tracker_position = 6 WHERE key = 'source';
UPDATE tracker_columns SET tracker_position = 7 WHERE key = 'competitors';
UPDATE tracker_columns SET tracker_position = 8 WHERE key = 'action';

-- Phantoms: the default columns for each stream, in the default order.
UPDATE tracker_columns SET in_phantoms = 1, phantoms_position = 0 WHERE stream = 'primary' AND key = 'record_id';
UPDATE tracker_columns SET in_phantoms = 1, phantoms_position = 1 WHERE stream = 'primary' AND key = 'title';
UPDATE tracker_columns SET in_phantoms = 1, phantoms_position = 2 WHERE stream = 'primary' AND key = 'date';
UPDATE tracker_columns SET in_phantoms = 1, phantoms_position = 3 WHERE stream = 'primary' AND key = 'source_role';
UPDATE tracker_columns SET in_phantoms = 1, phantoms_position = 4 WHERE stream = 'primary' AND key = 'source_company';
UPDATE tracker_columns SET in_phantoms = 1, phantoms_position = 5 WHERE stream = 'primary' AND key = 'source_location';
UPDATE tracker_columns SET in_phantoms = 1, phantoms_position = 6 WHERE stream = 'primary' AND key = 'source_confidence';
UPDATE tracker_columns SET in_phantoms = 1, phantoms_position = 7 WHERE stream = 'primary' AND key = 'workstream';
UPDATE tracker_columns SET in_phantoms = 1, phantoms_position = 8 WHERE stream = 'primary' AND key = 'source_therapeutic_area';
UPDATE tracker_columns SET in_phantoms = 1, phantoms_position = 9 WHERE stream = 'primary' AND key = 'source_brand_asset';
UPDATE tracker_columns SET in_phantoms = 1, phantoms_position = 10 WHERE stream = 'primary' AND key = 'insight_topic';
UPDATE tracker_columns SET in_phantoms = 1, phantoms_position = 11 WHERE stream = 'primary' AND key = 'key_intelligence_question';
UPDATE tracker_columns SET in_phantoms = 1, phantoms_position = 12 WHERE stream = 'primary' AND key = 'key_details';
UPDATE tracker_columns SET in_phantoms = 1, phantoms_position = 13 WHERE stream = 'primary' AND key = 'key_metrics';
UPDATE tracker_columns SET in_phantoms = 1, phantoms_position = 0 WHERE stream = 'secondary' AND key = 'record_id';
UPDATE tracker_columns SET in_phantoms = 1, phantoms_position = 1 WHERE stream = 'secondary' AND key = 'title';
UPDATE tracker_columns SET in_phantoms = 1, phantoms_position = 2 WHERE stream = 'secondary' AND key = 'date';
UPDATE tracker_columns SET in_phantoms = 1, phantoms_position = 3 WHERE stream = 'secondary' AND key = 'source';
UPDATE tracker_columns SET in_phantoms = 1, phantoms_position = 4 WHERE stream = 'secondary' AND key = 'publisher';
UPDATE tracker_columns SET in_phantoms = 1, phantoms_position = 5 WHERE stream = 'secondary' AND key = 'url';
UPDATE tracker_columns SET in_phantoms = 1, phantoms_position = 6 WHERE stream = 'secondary' AND key = 'raw_ref';
UPDATE tracker_columns SET in_phantoms = 1, phantoms_position = 7 WHERE stream = 'secondary' AND key = 'source_tier';
UPDATE tracker_columns SET in_phantoms = 1, phantoms_position = 8 WHERE stream = 'secondary' AND key = 'competitors';
UPDATE tracker_columns SET in_phantoms = 1, phantoms_position = 9 WHERE stream = 'secondary' AND key = 'other_entities';
UPDATE tracker_columns SET in_phantoms = 1, phantoms_position = 10 WHERE stream = 'secondary' AND key = 'therapeutic_area';
UPDATE tracker_columns SET in_phantoms = 1, phantoms_position = 11 WHERE stream = 'secondary' AND key = 'assets';
UPDATE tracker_columns SET in_phantoms = 1, phantoms_position = 12 WHERE stream = 'secondary' AND key = 'products';
UPDATE tracker_columns SET in_phantoms = 1, phantoms_position = 13 WHERE stream = 'secondary' AND key = 'header';
UPDATE tracker_columns SET in_phantoms = 1, phantoms_position = 14 WHERE stream = 'secondary' AND key = 'key_details';
UPDATE tracker_columns SET in_phantoms = 1, phantoms_position = 15 WHERE stream = 'secondary' AND key = 'ci_perspective';

UPDATE schema_meta SET revision = revision + 1;
