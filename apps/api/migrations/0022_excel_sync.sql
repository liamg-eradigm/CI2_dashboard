-- Request 55 (contract 2.1): the Test tab. A workspace's test space is a
-- separate workspace (its own row in tenants, with nobody's membership)
-- holding only what the SharePoint workbook says; admins see it on the Test
-- tab, where every page reads it instead of the live workspace. This row
-- links the two and keeps the state of the sync from the workbook:
--   version          the workbook version (Graph cTag) fully applied
--   pending_version  the version being applied (large changes take several runs)
--   lock_until       one run at a time (the every-minute cron and Sync now)
--   report_json      the last run's sheets, columns and the rows it skipped (and why)
CREATE TABLE excel_sync (
  tenant_id        TEXT PRIMARY KEY REFERENCES tenants(id),
  test_tenant_id   TEXT NOT NULL UNIQUE REFERENCES tenants(id),
  created_by       TEXT REFERENCES users(id),
  created_at       TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'never' CHECK (status IN ('never', 'idle', 'syncing', 'error')),
  message          TEXT,
  version          TEXT,
  pending_version  TEXT,
  file_name        TEXT,
  file_url         TEXT,
  file_modified_at TEXT,
  file_modified_by TEXT,
  last_checked_at  TEXT,
  last_synced_at   TEXT,
  last_change_at   TEXT,
  lock_until       TEXT,
  report_json      TEXT
);
