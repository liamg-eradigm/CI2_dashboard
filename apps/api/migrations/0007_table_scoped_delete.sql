-- Deleting a tracker entry from one table only.
--
-- An approved entry can be removed from the Tracker (and so the Dashboard,
-- Trend Test and Tracker exports) while it stays in Phantoms, or from Phantoms
-- while it stays in the Tracker. "Delete globally" is the existing soft delete
-- (status 'deleted', deleted_at). An entry hidden from both tables is deleted
-- globally by the API, so these two columns are never both set.
ALTER TABLE intelligence_items ADD COLUMN tracker_hidden_at TEXT;
ALTER TABLE intelligence_items ADD COLUMN phantoms_hidden_at TEXT;
