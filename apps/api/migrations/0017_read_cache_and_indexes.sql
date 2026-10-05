-- Fewer D1 rows read (the Workers Free plan allows 5 million a day).
--
-- 1. Each workspace's data versions: v goes up with every change (any API
--    request that is not a read, every background job step, the nightly
--    retention run); t only with changes that can reach the Tracker, Phantoms,
--    Dashboard, Megatrends or Competitors (not, say, saving an Inbox draft).
--    Reads whose versions have not moved are answered from memory for one row
--    read (apps/api/src/lib/cache.ts).
CREATE TABLE tenant_data_versions (
  tenant_id  TEXT PRIMARY KEY REFERENCES tenants(id),
  v          INTEGER NOT NULL DEFAULT 0,
  t          INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT
);
INSERT INTO tenant_data_versions (tenant_id, v, t, updated_at) SELECT id, 1, 1, NULL FROM tenants;

-- 2. The Inbox and Client Inbox badges count only the entries waiting (not every entry).
CREATE INDEX ix_item_waiting ON intelligence_items (tenant_id, status, with_client_at, stream);

-- 3. Tracker entries by Event Date, read from the index alone where possible
--    (Dashboard counts, date bounds, table pages).
CREATE INDEX ix_item_live ON intelligence_items (tenant_id, pub_date, stream, tracker_hidden_at, impact, macrotrend, subtrend)
  WHERE status = 'approved' AND deleted_at IS NULL;

-- 4. Each audit record links to the previous one in its chain: find it from an
--    index instead of reading the whole chain on every change.
CREATE INDEX ix_audit_chain_seq ON audit_events (chain, seq);
