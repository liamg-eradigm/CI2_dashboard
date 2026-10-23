-- Request 70 (CI SQUARED): a new Macrotrend, Manufacturing, with no
-- Subtrends to begin with (an entry of it needs no Subtrend). Added to each
-- CI SQUARED workspace's Macrotrend options in both trackers, before Others.
INSERT OR IGNORE INTO column_options (id, tenant_id, stream, column_key, value, parent, position, created_at)
SELECT 'opt_' || lower(hex(randomblob(12))), o.tenant_id, o.stream, 'macrotrend', 'Manufacturing', NULL,
       COALESCE((SELECT x.position FROM column_options x WHERE x.tenant_id = o.tenant_id AND x.stream = o.stream AND x.column_key = 'macrotrend' AND x.value = 'Others'), MAX(o.position) + 1),
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM column_options o
  JOIN tenants t ON t.id = o.tenant_id AND t.kind = 'ci2'
 WHERE o.column_key = 'macrotrend'
   AND NOT EXISTS (SELECT 1 FROM column_options m WHERE m.tenant_id = o.tenant_id AND m.stream = o.stream AND m.column_key = 'macrotrend' AND lower(m.value) = 'manufacturing')
 GROUP BY o.tenant_id, o.stream;

-- Others stays last.
UPDATE column_options
   SET position = position + 1
 WHERE column_key = 'macrotrend' AND value = 'Others'
   AND EXISTS (SELECT 1 FROM column_options m WHERE m.tenant_id = column_options.tenant_id AND m.stream = column_options.stream AND m.column_key = 'macrotrend' AND m.value = 'Manufacturing' AND m.position = column_options.position);

-- The schema changed: cached reads of it are refreshed.
UPDATE schema_meta SET revision = revision + 1 WHERE tenant_id IN (SELECT id FROM tenants WHERE kind = 'ci2');
UPDATE tenant_data_versions SET v = v + 1, t = t + 1 WHERE tenant_id IN (SELECT id FROM tenants WHERE kind = 'ci2');
