-- Several saved HTML pages per Tracker entry.
--
-- An entry's first page stays intelligence_items.current_snapshot_id (the
-- captured or first attached page; it also supplies the entry's text). Pages
-- attached after it are source_snapshots rows with extra = 1. file_name is the
-- attached file's name (shown in the page list); older rows have none.
ALTER TABLE source_snapshots ADD COLUMN file_name TEXT;
ALTER TABLE source_snapshots ADD COLUMN extra INTEGER NOT NULL DEFAULT 0;
CREATE INDEX ix_snapshot_extra ON source_snapshots (tenant_id, item_id) WHERE extra = 1;
