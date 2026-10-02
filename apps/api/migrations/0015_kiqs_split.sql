-- Request 24: Primary entries as one Tracker entry per Key Intelligence Question.
--
-- kiq_json: the Insight Topics and their Key Intelligence Questions (with Key
-- Details and Key Metrics) entered in the Inbox, as JSON
-- [{ "topic": "...", "kiqs": [{ "question": "...", "details": "...", "metrics": "..." }] }].
-- Pushing an entry with several questions first splits it: the entry keeps
-- the first question and new Inbox entries take the others; split_from is the
-- entry they came from. Entries' IDs are filled in automatically (no column).
ALTER TABLE intelligence_items ADD COLUMN kiq_json TEXT;
ALTER TABLE intelligence_items ADD COLUMN split_from TEXT;
