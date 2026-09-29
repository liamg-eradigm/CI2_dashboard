/**
 * Break-glass / bootstrap: give a person an admin (or other) role in an
 * EXISTING workspace and print a one-time Microsoft sign-in invite link.
 *
 * Use it when nobody can sign in to issue links from the app (e.g. every admin
 * left), or to let yourself into the demo workspace after loading the demo seed
 * on staging. Normal invites are created in the app (Administration → Users).
 *
 *   npx tsx scripts/create-invite.ts --tenant eradigm --email jane.doe@eradigm.com --name "Jane Doe" \
 *     --role admin --origin https://ci.eradigm.com --out invite.sql
 *   npx wrangler d1 execute DB --remote --env production -c apps/api/wrangler.jsonc --file invite.sql
 *
 * --out writes the SQL file itself (UTF-8, any shell); without it the SQL goes to stdout.
 *
 * --tenant is the workspace slug (or its id, e.g. t_demo). The link is printed
 * on the terminal (not in the SQL); it works once and expires after 7 days.
 */
import { createHash, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const tenant = arg("tenant");
const email = arg("email")?.toLowerCase();
const name = arg("name") ?? email;
const role = arg("role") ?? "admin";
const origin = arg("origin")?.replace(/\/$/, "");
const outFile = arg("out");
if (!tenant || !email || !["admin", "analyst", "client"].includes(role) || !origin || !/^https?:\/\/[^/]+$/.test(origin)) {
  console.error('usage: create-invite.ts --tenant <slug|id> --email jane@eradigm.com [--name "Jane Doe"] [--role admin|analyst|client] --origin https://ci.eradigm.com [--out invite.sql]');
  process.exit(1);
}
const q = (v: unknown) => (v == null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const now = new Date().toISOString();
const expires = new Date(Date.now() + 7 * 86_400_000).toISOString();
const token = randomBytes(32).toString("base64url");
const tenantSql = `(SELECT id FROM tenants WHERE slug = ${q(tenant)} OR id = ${q(tenant)} LIMIT 1)`;
const userSql = `(SELECT id FROM users WHERE email = ${q(email)})`;
const out = [
  `INSERT INTO users (id, email, name, created_at) VALUES (${q(`usr_${randomBytes(10).toString("hex")}`)}, ${q(email)}, ${q(name)}, ${q(now)}) ON CONFLICT (email) DO NOTHING;`,
  `INSERT INTO role_assignments (id, tenant_id, user_id, role, assigned_at)
     SELECT ${q(`rol_${randomBytes(10).toString("hex")}`)}, ${tenantSql}, ${userSql}, ${q(role)}, ${q(now)}
      WHERE ${tenantSql} IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM role_assignments WHERE tenant_id = ${tenantSql} AND user_id = ${userSql} AND revoked_at IS NULL);`,
  `UPDATE role_assignments SET active = 1 WHERE tenant_id = ${tenantSql} AND user_id = ${userSql} AND revoked_at IS NULL;`,
  `UPDATE user_invites SET revoked_at = ${q(now)} WHERE user_id = ${userSql} AND used_at IS NULL AND revoked_at IS NULL;`,
  `INSERT INTO user_invites (id, user_id, tenant_id, created_by, created_at, expires_at)
     SELECT ${q(createHash("sha256").update(token).digest("hex"))}, ${userSql}, ${tenantSql}, NULL, ${q(now)}, ${q(expires)} WHERE ${tenantSql} IS NOT NULL;`,
];
if (outFile) {
  writeFileSync(outFile, out.join("\n") + "\n", "utf8");
  console.error(`SQL written to ${resolve(outFile)}`);
} else {
  console.log(out.join("\n"));
}
console.error(`\nInvite link for ${email} (${role} in ${tenant}; works once, expires ${expires.slice(0, 10)}):\n\n  ${origin}/invite/${token}\n`);
console.error("This link does NOT work until the SQL has been applied (wrangler d1 execute ... --file). Each run makes a new link and cancels older unused ones.");
console.error("Apply the SQL first, then open/send the link. If the person already has a different role, change it in the app afterwards.");
