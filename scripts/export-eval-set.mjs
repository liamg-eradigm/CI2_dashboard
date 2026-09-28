#!/usr/bin/env node
/**
 * Turns analyst-approved entries into a labelled evaluation set for the
 * optional LLM pre-fill (docs/ENABLING-AUTOFILL.md, step 3).
 *
 * While the prototype runs in manual-entry mode every approved item is a
 * human-labelled example: the captured article text plus the values an analyst
 * entered. This script exports them in the format scripts/eval-extraction.ts
 * reads, so a model can be measured on YOUR articles before it is switched on.
 *
 *   node scripts/export-eval-set.mjs --env staging [--tenant t_demo] [--limit 200] [--local] > eval/labelled.jsonl
 *   LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=... npm run eval -- eval/labelled.jsonl
 *
 * The output contains article text: treat it as confidential, keep it out of
 * git (eval/*.jsonl other than the sample is git-ignored) and delete it after use.
 */
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const env = opt("env", "dev");
const limit = Math.max(1, Math.min(5000, Number(opt("limit", "500"))));
const tenant = opt("tenant", null);
const local = args.includes("--local") || env === "dev";
if (tenant && !/^[\w-]+$/.test(tenant)) throw new Error("Invalid --tenant");

const sql = `SELECT id, tenant_id, headline, body_text, publication_date, draft_json FROM intelligence_items
  WHERE status = 'approved' AND body_text IS NOT NULL AND length(body_text) > 0 ${tenant ? `AND tenant_id = '${tenant}'` : ""}
  ORDER BY approved_at DESC LIMIT ${limit}`;
const out = execFileSync(
  "npx",
  ["wrangler", "d1", "execute", "DB", local ? "--local" : "--remote", "--env", env, "-c", "apps/api/wrangler.jsonc", "--json", "--command", sql, ...(local ? ["--persist-to", ".wrangler/state"] : [])],
  { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
);
const rows = JSON.parse(out)[0]?.results ?? [];
for (const r of rows) {
  const values = JSON.parse(r.draft_json || "{}");
  const expected = {};
  for (const [k, v] of Object.entries(values)) {
    // Analyst-owned fields (e.g. Action) are not inferred by the model; the eval ignores unknown keys.
    if (v != null && v !== "" && k !== "action" && k !== "title" && k !== "date") expected[k] = v;
  }
  process.stdout.write(JSON.stringify({ id: r.id, headline: r.headline ?? "", bodyText: r.body_text, publicationDate: r.publication_date ?? undefined, expected }) + "\n");
}
console.error(`${rows.length} labelled example(s) exported from ${env}${tenant ? ` (${tenant})` : ""}.`);
