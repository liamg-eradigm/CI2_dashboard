-- Request 69 (EPILEPSY): NSO Comparator text formatted by staff (bold, size,
-- bullets) without rewording it: one formatting per company, row (its
-- assets) and field. It shows only while its words are the workbook's.
CREATE TABLE IF NOT EXISTS epilepsy_formats (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  item_key TEXT NOT NULL,
  markup TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  PRIMARY KEY (tenant_id, item_key)
);
