-- Request 61: the Epilepsy project's SharePoint workbook and the rows of its
-- four sheets (as the workbook has them, in chunks of rows as JSON).
CREATE TABLE epilepsy_workbook (
  tenant_id        TEXT PRIMARY KEY REFERENCES tenants(id),
  link             TEXT,
  file_name        TEXT NOT NULL DEFAULT 'Epilepsy Dashboard Excel.xlsx',
  drive_id         TEXT,
  item_id          TEXT,
  status           TEXT NOT NULL DEFAULT 'never' CHECK (status IN ('never', 'idle', 'syncing', 'error')),
  message          TEXT,
  problem_json     TEXT,
  version          TEXT,
  file_url         TEXT,
  file_label       TEXT,
  file_modified_at TEXT,
  file_modified_by TEXT,
  counts_json      TEXT,
  colours_json     TEXT,
  last_checked_at  TEXT,
  last_synced_at   TEXT,
  lock_until       TEXT,
  updated_at       TEXT,
  updated_by       TEXT REFERENCES users(id)
);

CREATE TABLE epilepsy_rows (
  tenant_id    TEXT NOT NULL REFERENCES tenants(id),
  sheet        TEXT NOT NULL CHECK (sheet IN ('secondary', 'primary', 'profiles', 'assets')),
  chunk        INTEGER NOT NULL,
  name         TEXT NOT NULL,
  columns_json TEXT NOT NULL,
  rows_json    TEXT NOT NULL,
  PRIMARY KEY (tenant_id, sheet, chunk)
);
