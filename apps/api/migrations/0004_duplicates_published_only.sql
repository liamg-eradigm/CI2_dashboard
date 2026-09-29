-- Duplicates now count only against entries already in the tracker (approved).
--
-- Before: one live item per URL / uploaded file per tenant was enforced by
-- unique indexes, so a failed or rejected capture blocked re-submitting the
-- same source. Now a re-submission always creates a new Inbox item; the Input
-- page warns when the source is already in the tracker, and approval asks the
-- reviewer to confirm before publishing a second entry.
-- Double-click / retry safety is unchanged: it comes from the submission
-- Idempotency-Key (ux_submission_idem).
DROP INDEX IF EXISTS ux_item_url;
DROP INDEX IF EXISTS ux_item_file;
CREATE INDEX IF NOT EXISTS ix_item_url ON intelligence_items (tenant_id, url_key);
CREATE INDEX IF NOT EXISTS ix_item_file ON intelligence_items (tenant_id, file_sha256);

-- Pages with (almost) no extracted text all shared one fingerprint, which made
-- unrelated empty captures look like duplicates. They now have none.
UPDATE intelligence_items SET content_sha256 = NULL
 WHERE length(trim(COALESCE(headline, '') || ' ' || COALESCE(body_text, ''))) < 40;
