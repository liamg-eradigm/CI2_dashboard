-- Deliverables: .docx Alerts and Newsletters built from Phantoms.
--
-- An alert is generated automatically for each Phantom with the highest
-- Impact (High), one per entry, and regenerated when the entry is revised
-- (source_rev = its published revision). A newsletter is created by an analyst
-- from selected Newsletter entries (High / Medium Impact Phantoms); items_json
-- lists them in order. The .docx is stored as base64 text (small documents;
-- D1 rows are limited to 2 MB), so it needs no R2 bucket on the free plan.
CREATE TABLE deliverables (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL REFERENCES tenants(id),
  kind         TEXT NOT NULL CHECK (kind IN ('alert', 'newsletter')),
  item_id      TEXT REFERENCES intelligence_items(id),
  source_rev   INTEGER,
  name         TEXT NOT NULL,
  items_json   TEXT NOT NULL DEFAULT '[]',
  docx_b64     TEXT NOT NULL,
  bytes        INTEGER NOT NULL,
  created_by   TEXT REFERENCES users(id),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT
);
CREATE UNIQUE INDEX ux_deliverable_alert ON deliverables (tenant_id, item_id) WHERE kind = 'alert' AND deleted_at IS NULL;
CREATE INDEX ix_deliverables_kind ON deliverables (tenant_id, kind, created_at);

-- Phantoms now include every Secondary entry by default (minimum Impact Low
-- instead of Medium). Tenants still on the old default move to the new one
-- (tenants without the setting already get the new default).
UPDATE tenant_settings
   SET settings_json = json_set(settings_json, '$.phantoms.secondaryMinImpact', 'Low')
 WHERE json_extract(settings_json, '$.phantoms.secondaryMinImpact') = 'Medium';
