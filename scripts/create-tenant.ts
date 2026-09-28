/**
 * Generate SQL that creates a tenant (default columns, taxonomy, settings,
 * counters) and its first admin. Apply it with wrangler:
 *
 *   npx tsx scripts/create-tenant.ts --name "Acme Pharma" --slug acme --admin jane@eradigm.com --admin-name "Jane Doe" > /tmp/tenant.sql
 *   npx wrangler d1 execute DB --remote --env production -c apps/api/wrangler.jsonc --file /tmp/tenant.sql
 *
 * Further users are then created in the app (Administration → Users and roles).
 */
import { randomBytes } from "node:crypto";
import { defaultSchema, DEFAULT_TREND_THRESHOLDS } from "@eradigm/shared";

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const name = arg("name");
const slug = arg("slug");
const admin = arg("admin")?.toLowerCase();
const adminName = arg("admin-name") ?? admin;
if (!name || !slug || !admin || !/^[a-z0-9-]{2,40}$/.test(slug)) {
  console.error('usage: create-tenant.ts --name "Acme Pharma" --slug acme --admin jane@eradigm.com [--admin-name "Jane Doe"]');
  process.exit(1);
}
const id = (p: string) => `${p}_${randomBytes(10).toString("hex")}`;
const q = (v: unknown) => (v == null ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const now = new Date().toISOString();
const t = `t_${slug.replace(/-/g, "_")}`;
const out: string[] = [];
const settings = {
  timezone: "Europe/London",
  trendDefaults: DEFAULT_TREND_THRESHOLDS,
  retention: { snapshotDays: 730, rejectedDays: 90, deletedDays: 30 },
  redaction: { redactEmails: true, redactPhones: true, quarantineMarkers: [] },
};
out.push(`INSERT INTO tenants (id, name, slug, created_at) VALUES (${q(t)}, ${q(name)}, ${q(slug)}, ${q(now)});`);
out.push(`INSERT INTO schema_meta (tenant_id, revision) VALUES (${q(t)}, 1);`);
out.push(`INSERT INTO tenant_settings (tenant_id, settings_json, updated_at) VALUES (${q(t)}, ${q(JSON.stringify(settings))}, ${q(now)});`);
out.push(`INSERT INTO counters (tenant_id, name, value) VALUES (${q(t)}, 'inbox', 2200), (${q(t)}, 'signal', 1100);`);
const s = defaultSchema();
for (const c of s.columns) {
  out.push(`INSERT INTO tracker_columns (tenant_id, key, label, type, core, required, ai_assist, position) VALUES (${q(t)}, ${q(c.key)}, ${q(c.label)}, ${q(c.type)}, ${c.core ? 1 : 0}, ${c.required ? 1 : 0}, ${c.aiAssist ? 1 : 0}, ${c.position});`);
  (c.options ?? []).forEach((o, i) => out.push(`INSERT INTO column_options (id, tenant_id, column_key, value, parent, position, created_at) VALUES (${q(id("opt"))}, ${q(t)}, ${q(c.key)}, ${q(o)}, NULL, ${i}, ${q(now)});`));
}
s.taxonomy.forEach((g, i) => {
  out.push(`INSERT INTO column_options (id, tenant_id, column_key, value, parent, position, created_at) VALUES (${q(id("opt"))}, ${q(t)}, 'macrotrend', ${q(g.name)}, NULL, ${i}, ${q(now)});`);
  g.subtrends.forEach((sub, j) => out.push(`INSERT INTO column_options (id, tenant_id, column_key, value, parent, position, created_at) VALUES (${q(id("opt"))}, ${q(t)}, 'subtrend', ${q(sub)}, ${q(g.name)}, ${j}, ${q(now)});`));
});
out.push(`INSERT INTO users (id, email, name, created_at) VALUES (${q(id("usr"))}, ${q(admin)}, ${q(adminName)}, ${q(now)}) ON CONFLICT (email) DO NOTHING;`);
out.push(`INSERT INTO role_assignments (id, tenant_id, user_id, role, assigned_at) SELECT ${q(id("rol"))}, ${q(t)}, id, 'admin', ${q(now)} FROM users WHERE email = ${q(admin)};`);
console.log(out.join("\n"));
