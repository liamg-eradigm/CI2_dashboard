-- Request 61: an alert reworded in its viewer. edits_json holds only the parts
-- an analyst changed (title, key details, CI perspective, ...); every other
-- part is still written from the entry each time the alert is opened.
ALTER TABLE deliverables ADD COLUMN edits_json TEXT;
ALTER TABLE deliverables ADD COLUMN edited_at TEXT;
ALTER TABLE deliverables ADD COLUMN edited_by TEXT REFERENCES users(id);
