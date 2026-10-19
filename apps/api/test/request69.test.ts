import { beforeAll, describe, expect, it } from "vitest";
import { nsoFormatKey, toXlsxSheets } from "@eradigm/shared";
import { newId, nowIso } from "../src/lib/ids";
import { call, env, json, seedWorld, type World } from "./helpers";

let w: World;
let epi: { id: string; slug: string };
const EPI = () => ({ "x-project": epi.slug });

beforeAll(async () => {
  w = await seedWorld();
  const r = Math.random().toString(36).slice(2, 8);
  epi = { id: `te_${r}`, slug: `epi-${r}` };
  const users = await env.DB.prepare("SELECT id, email FROM users WHERE email IN (?1, ?2, ?3)").bind(w.a.admin, w.a.analyst, w.a.client).all<{ id: string; email: string }>();
  const id = (email: string) => users.results!.find((u) => u.email === email)!.id;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO tenants (id, name, slug, created_at, kind) VALUES (?1, 'Epilepsy', ?2, ?3, 'epilepsy')").bind(epi.id, epi.slug, nowIso()),
    ...(["admin", "analyst", "client"] as const).map((role) =>
      env.DB.prepare("INSERT INTO role_assignments (id, tenant_id, user_id, role, assigned_at) VALUES (?1, ?2, ?3, ?4, ?5)").bind(newId("rol"), epi.id, id(w.a[role]), role, nowIso()),
    ),
  ]);
  const form = new FormData();
  const book = toXlsxSheets([
    {
      name: "3. Platform Competitor Profiles",
      table: [
        ["Company/competitor", "Epilepsy Assets", "NSO Focus", "Evidence", "x-axis name"],
        ["UCB", "Fintepla", "Cognition and attention. Memory too.", "Phase 3 sub-study", "Domain"],
        ["", "Briviact", "Sleep", "", ""],
      ],
    },
  ]);
  form.append("file", new File([book], "Epilepsy Dashboard Excel.xlsx"));
  expect((await call(w.a.admin, "POST", "/api/epilepsy/upload", { form, headers: EPI() })).status).toBe(200);
});

describe("request 69: NSO Comparator text formatted, not reworded", () => {
  const put = (who: string, body: unknown) => call(who, "PUT", "/api/epilepsy/formats", { body, headers: EPI() });

  it("keeps bold, size and bullets when the words are the workbook's (staff only)", async () => {
    const markup = "- **Cognition** and attention.\n- <span style=\"font-size:1.3em\">Memory</span> too.";
    expect((await put(w.a.client, { company: "UCB", assets: ["Fintepla"], field: "NSO Focus", markup })).status).toBe(403);
    expect((await put(w.a.analyst, { company: "ucb", assets: ["Fintepla"], field: "NSO Focus", markup })).status).toBe(200);
    const d = await json(call(w.a.client, "GET", "/api/epilepsy/data", { headers: EPI() }));
    expect(d.formats[nsoFormatKey("UCB", ["Fintepla"], "NSO Focus")]).toBe(markup);
  });

  it("refuses any change to the words, a field the page does not format, and text the workbook does not have", async () => {
    expect((await put(w.a.admin, { company: "UCB", assets: ["Fintepla"], field: "NSO Focus", markup: "**Cognition** and focus. Memory too." })).status).toBe(422);
    expect((await put(w.a.admin, { company: "UCB", assets: ["Fintepla"], field: "x-axis name", markup: "**Domain**" })).status).toBe(422);
    expect((await put(w.a.admin, { company: "UCB", assets: ["Briviact"], field: "Evidence", markup: "**x**" })).status).toBe(404);
    expect((await put(w.a.admin, { company: "Xenon", assets: [], field: "NSO Focus", markup: "**Sleep**" })).status).toBe(404);
  });

  it("goes back to the workbook's text when the formatting is cleared", async () => {
    expect((await json(put(w.a.admin, { company: "UCB", assets: ["Briviact"], field: "NSO Focus", markup: "**Sleep**" }))).markup).toBe("**Sleep**");
    expect((await json(put(w.a.admin, { company: "UCB", assets: ["Briviact"], field: "NSO Focus", markup: "" }))).markup).toBeNull();
    const d = await json(call(w.a.client, "GET", "/api/epilepsy/data", { headers: EPI() }));
    expect(d.formats[nsoFormatKey("UCB", ["Briviact"], "NSO Focus")]).toBeUndefined();
  });
});
