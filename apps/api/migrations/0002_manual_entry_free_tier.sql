-- Manual-entry prototype on the Workers Free plan.
--
-- Snapshot HTML can now be stored in D1 (no R2 bucket required). Rows are
-- chunked because D1 limits a row to 2 MB; source_snapshots.r2_key holds the
-- storage key ("d1:..." for this table, anything else is an R2 object key).
CREATE TABLE snapshot_blobs (
  storage_key  TEXT NOT NULL,
  seq          INTEGER NOT NULL,
  tenant_id    TEXT NOT NULL REFERENCES tenants(id),
  data         TEXT NOT NULL,
  PRIMARY KEY (storage_key, seq)
);
CREATE INDEX ix_snapshot_blobs_tenant ON snapshot_blobs (tenant_id);
