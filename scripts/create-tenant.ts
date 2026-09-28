/**
 * Generate SQL that creates a tenant (default columns, taxonomy, settings,
 * counters) and its first admin. Apply it with wrangler:
 *
 *   npx tsx scripts/create-tenant.ts --name "Acme Pharma" --slug acme --admin jane@eradigm.com --admin-name "Jane Doe" \
 *     --origin https://ci.eradigm.com > /tmp/tenant.sql
 *   npx wrangler d1 execute DB --remote --env production -c apps/api/wrangler.jsonc --file /tmp/tenant.sql
 *
 * The script prints the first admin's one-time INVITE LINK (valid 7 days) on
 * the terminal: send it to them; they open it and sign in with their Microsoft
 * work account, which links it to the admin account. Further users are then
 * created in the app (Administration → Users and roles), which shows their
 * invite links.
 */
import { createHash, randomBytes } from "node:crypto";
import { defaultSchema, DEFAULT_TREND_THRESHOLDS } from "@eradigm/shared";

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const name = arg("name");
const slug = arg("slug");
const admin = arg("admin")?.toLowerCase();
const adminName = arg("admin-name") ?? admin;
const origin = arg("origin")?.replace(/\/$/, "");
if (!name || !slug || !admin || !/^[a-z0-9-]{2,40}$/.test(slug) || !origin || !/^https?:\/\/[^/]+$/.test(origin)) {
  console.error('usage: create-tenant.ts --name "Acme Pharma" --slug acme --admin jane@eradigm.com [--admin-name "Jane Doe"] --origin https://ci.eradigm.com');
  console.error("  --origin is the dashboard's web address (the APP_ORIGIN value in apps/api/wrangler.jsonc).");
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
// One-time invite link for the first admin (only its SHA-256 hash is stored).
const token = randomBytes(32).toString("base64url");
const expires = new Date(Date.now() + 7 * 86_400_000).toISOString();
out.push(
  `INSERT INTO user_invites (id, user_id, tenant_id, created_by, created_at, expires_at) SELECT ${q(createHash("sha256").update(token).digest("hex"))}, id, ${q(t)}, NULL, ${q(now)}, ${q(expires)} FROM users WHERE email = ${q(admin)};`,
);
console.log(out.join("\n"));
console.error(`\nFirst admin invite link for ${admin} (works once, expires ${expires.slice(0, 10)}):\n\n  ${origin}/invite/${token}\n`);
console.error("Apply the SQL first, then send the link. Keep it private: whoever opens it first links their Microsoft account to this admin account.");
