-- Request 27: Primary entries from the same source are linked, not flagged as duplicates.
--
-- source_key: Source Role and Source Company of an approved Primary entry,
-- trimmed, inner spaces collapsed and ASCII letters lower-cased, joined by
-- U+001F (primarySourceKey in packages/shared/src/sourceLink.ts). Set when an
-- entry is pushed to the Tracker, edited or imported; null for Secondary
-- entries and when either value is empty. Entries sharing a key are linked
-- at read time, each to the one just before it by Event Date, so deleting or
-- editing an entry re-links the rest by itself.
ALTER TABLE intelligence_items ADD COLUMN source_key TEXT;
CREATE INDEX ix_item_source_key ON intelligence_items (tenant_id, source_key) WHERE source_key IS NOT NULL;

-- Existing Primary Tracker entries (repeated replace() collapses runs of up to 16 spaces).
UPDATE intelligence_items
   SET source_key =
       lower(trim(replace(replace(replace(replace(json_extract(extra_json, '$.source_role'), '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' ')))
       || char(31) ||
       lower(trim(replace(replace(replace(replace(json_extract(extra_json, '$.source_company'), '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' ')))
 WHERE stream = 'primary'
   AND status = 'approved'
   AND typeof(json_extract(extra_json, '$.source_role')) = 'text'
   AND typeof(json_extract(extra_json, '$.source_company')) = 'text'
   AND trim(json_extract(extra_json, '$.source_role')) <> ''
   AND trim(json_extract(extra_json, '$.source_company')) <> '';
