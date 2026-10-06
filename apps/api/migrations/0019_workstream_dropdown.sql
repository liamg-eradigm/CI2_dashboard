-- Request 31: the Primary "Workstream" column becomes a dropdown with nine
-- options. Values already entered that match an option in any case are
-- respelt to match it; any other value already in use is kept as an extra
-- option (after the nine) so no entry loses its Workstream. Admins can rename
-- or delete those extras under Eradigm Inbox → Edit columns → Primary.
UPDATE tracker_columns SET type = 'select' WHERE stream = 'primary' AND key = 'workstream';

-- One statement per option (D1 limits compound SELECTs).
INSERT OR IGNORE INTO column_options (id, tenant_id, stream, column_key, value, parent, position, created_at)
  SELECT 'opt_ws_0_' || id, id, 'primary', 'workstream', 'Digital and Data Platforms', NULL, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM tenants;
INSERT OR IGNORE INTO column_options (id, tenant_id, stream, column_key, value, parent, position, created_at)
  SELECT 'opt_ws_1_' || id, id, 'primary', 'workstream', 'Salesforce Tools Effectiveness', NULL, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM tenants;
INSERT OR IGNORE INTO column_options (id, tenant_id, stream, column_key, value, parent, position, created_at)
  SELECT 'opt_ws_2_' || id, id, 'primary', 'workstream', 'DTP and Hub-adjacent tech', NULL, 2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM tenants;
INSERT OR IGNORE INTO column_options (id, tenant_id, stream, column_key, value, parent, position, created_at)
  SELECT 'opt_ws_3_' || id, id, 'primary', 'workstream', 'AI Upskilling', NULL, 3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM tenants;
INSERT OR IGNORE INTO column_options (id, tenant_id, stream, column_key, value, parent, position, created_at)
  SELECT 'opt_ws_4_' || id, id, 'primary', 'workstream', 'Omni-channel and Engagement Platforms', NULL, 4, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM tenants;
INSERT OR IGNORE INTO column_options (id, tenant_id, stream, column_key, value, parent, position, created_at)
  SELECT 'opt_ws_5_' || id, id, 'primary', 'workstream', 'Commercial Excellence', NULL, 5, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM tenants;
INSERT OR IGNORE INTO column_options (id, tenant_id, stream, column_key, value, parent, position, created_at)
  SELECT 'opt_ws_6_' || id, id, 'primary', 'workstream', 'Digital and GenAI training', NULL, 6, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM tenants;
INSERT OR IGNORE INTO column_options (id, tenant_id, stream, column_key, value, parent, position, created_at)
  SELECT 'opt_ws_7_' || id, id, 'primary', 'workstream', 'Digital and GenAI Platforms, Agents, and Implementation', NULL, 7, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM tenants;
INSERT OR IGNORE INTO column_options (id, tenant_id, stream, column_key, value, parent, position, created_at)
  SELECT 'opt_ws_8_' || id, id, 'primary', 'workstream', 'EHR Integrations', NULL, 8, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM tenants;

-- Same option in another case or with stray spaces: use the option's spelling.
UPDATE intelligence_items
   SET extra_json = json_set(extra_json, '$."workstream"', (
         SELECT o.value FROM column_options o
          WHERE o.tenant_id = intelligence_items.tenant_id AND o.stream = 'primary' AND o.column_key = 'workstream'
            AND lower(o.value) = lower(trim(json_extract(intelligence_items.extra_json, '$."workstream"')))))
 WHERE stream = 'primary'
   AND EXISTS (SELECT 1 FROM column_options o
                WHERE o.tenant_id = intelligence_items.tenant_id AND o.stream = 'primary' AND o.column_key = 'workstream'
                  AND lower(o.value) = lower(trim(json_extract(intelligence_items.extra_json, '$."workstream"')))
                  AND o.value <> json_extract(intelligence_items.extra_json, '$."workstream"'));
UPDATE intelligence_items
   SET draft_json = json_set(draft_json, '$."workstream"', (
         SELECT o.value FROM column_options o
          WHERE o.tenant_id = intelligence_items.tenant_id AND o.stream = 'primary' AND o.column_key = 'workstream'
            AND lower(o.value) = lower(trim(json_extract(intelligence_items.draft_json, '$."workstream"')))))
 WHERE stream = 'primary'
   AND EXISTS (SELECT 1 FROM column_options o
                WHERE o.tenant_id = intelligence_items.tenant_id AND o.stream = 'primary' AND o.column_key = 'workstream'
                  AND lower(o.value) = lower(trim(json_extract(intelligence_items.draft_json, '$."workstream"')))
                  AND o.value <> json_extract(intelligence_items.draft_json, '$."workstream"'));

-- Any other value already used (published or in a draft) stays, as an extra option.
INSERT OR IGNORE INTO column_options (id, tenant_id, stream, column_key, value, parent, position, created_at)
  SELECT 'opt_ws_x_' || lower(hex(randomblob(8))), v.tenant_id, 'primary', 'workstream', v.value, NULL, 100, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    FROM (
      SELECT DISTINCT tenant_id, json_extract(extra_json, '$."workstream"') AS value FROM intelligence_items WHERE stream = 'primary'
      UNION
      SELECT DISTINCT tenant_id, json_extract(draft_json, '$."workstream"') FROM intelligence_items WHERE stream = 'primary'
    ) v
   WHERE typeof(v.value) = 'text' AND trim(v.value) <> ''
     AND NOT EXISTS (SELECT 1 FROM column_options o WHERE o.tenant_id = v.tenant_id AND o.stream = 'primary' AND o.column_key = 'workstream' AND lower(o.value) = lower(trim(v.value)));

-- Column sets changed: cached ones are read again.
UPDATE schema_meta SET revision = revision + 1;
UPDATE tenant_data_versions SET v = v + 1, t = t + 1;
