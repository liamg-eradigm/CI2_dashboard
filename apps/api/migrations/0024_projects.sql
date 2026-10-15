-- Request 61: projects. A workspace (tenant) belongs to a project kind:
-- 'ci2' (CI Squared), 'epilepsy', or 'test' (a CI Squared workspace's Test
-- tab space, request 55, never listed as a project of its own). People are
-- global (one account); their access is per workspace (role_assignments).
ALTER TABLE tenants ADD COLUMN kind TEXT NOT NULL DEFAULT 'ci2';

UPDATE tenants SET kind = 'test' WHERE id IN (SELECT test_tenant_id FROM excel_sync);

-- The project built so far is CI SQUARED (its first workspace; later ones keep their names).
UPDATE tenants SET name = 'CI SQUARED'
 WHERE id = (SELECT id FROM tenants WHERE kind = 'ci2' AND active = 1 ORDER BY created_at, id LIMIT 1);

-- The second project, Epilepsy (renamed and opened to people on the Admin page).
INSERT OR IGNORE INTO tenants (id, name, slug, active, created_at, kind)
VALUES ('tnt_epilepsy', 'Epilepsy', 'epilepsy', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'epilepsy');

-- CI SQUARED's admins administer it too (until an admin changes who has access).
INSERT INTO role_assignments (id, tenant_id, user_id, role, active, assigned_at)
SELECT 'ra_epi_' || r.user_id, 'tnt_epilepsy', r.user_id, 'admin', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM role_assignments r
  JOIN tenants t ON t.id = r.tenant_id AND t.kind = 'ci2' AND t.active = 1
 WHERE r.role = 'admin' AND r.active = 1 AND r.revoked_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM role_assignments x WHERE x.tenant_id = 'tnt_epilepsy' AND x.user_id = r.user_id AND x.revoked_at IS NULL)
 GROUP BY r.user_id;
