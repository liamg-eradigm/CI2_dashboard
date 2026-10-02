-- Request 20.
--
-- 1. "Delete All" in the Eradigm Inbox's "Pushed & Rejected" view. Rejected
--    entries are deleted; pushed entries only leave the Inbox (they stay in
--    the Tracker and Phantoms), so they need their own marker.
ALTER TABLE intelligence_items ADD COLUMN inbox_cleared_at TEXT;

-- 2. "Tell Me More" (added from the Inbox as a short Text column) becomes Long
--    text, like Header, Key Details and CI Perspective: the same size of box,
--    with bullet indenting. Long text accepts everything short text did.
UPDATE tracker_columns SET type = 'long'
 WHERE type = 'text' AND deleted_at IS NULL
   AND lower(replace(replace(replace(replace(replace(replace(replace(replace(label, ' ', ''), '-', ''), '''', ''), '_', ''), '?', ''), '.', ''), ':', ''), '!', '')) = 'tellmemore';
UPDATE schema_meta SET revision = revision + 1;
