import { beforeAll, describe, expect, it } from "vitest";
import { toXlsxSheets } from "@eradigm/shared";
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
});

/** Sheet 3 calls its market cap “Mkt cap (USD bn)”; sheet 4's Current Phase is a dropdown from a list on another sheet. */
const workbook = () =>
  toXlsxSheets([
    {
      name: "3. Platform Competitor Profiles",
      table: [
        ["Company/competitor", "HQ", "Mkt cap (USD bn)", "Q1 2026 Epilepsy Revenue (USD)"],
        ["UCB", "Brussels", "30", "1,200,000,000"],
      ],
    },
    {
      name: "4. Platform Trials & Assets",
      table: [
        ["Company/competitor", "Asset Name", "Current Phase", "RoA"],
        ["UCB", "Fintepla", "Approved", "Oral"],
        ["UCB", "Briviact", "Phase 4", "Oral"],
      ],
      lists: [
        { sqref: "C2:C1000", formula: "Lists!$A$1:$A$4" },
        { sqref: "D2:D1000", formula: '"Oral,IV"' },
      ],
    },
    { name: "Lists", table: [["Phase 1"], ["Phase 2"], ["Phase 3"], ["Approved"]] },
  ]);

describe("request 65: Epilepsy column names and dropdown options", () => {
  it("reads each sheet's dropdowns with the sheet, and serves them with the data", async () => {
    const form = new FormData();
    form.append("file", new File([workbook()], "Epilepsy Dashboard Excel.xlsx"));
    expect((await call(w.a.admin, "POST", "/api/epilepsy/upload", { form, headers: EPI() })).status).toBe(200);
    const d = await json(call(w.a.client, "GET", "/api/epilepsy/data", { headers: EPI() }));
    expect(d.dropdowns.assets).toEqual({ "Current Phase": ["Phase 1", "Phase 2", "Phase 3", "Approved"], RoA: ["Oral", "IV"] });
    expect(d.dropdowns.profiles).toEqual({});
    expect(d.columnNames).toEqual({});
    expect(d.addedOptions).toEqual({});
  });

  it("saves the workbook's column for a page's column (admins only)", async () => {
    const put = (who: string, body: unknown) => call(who, "PUT", "/api/epilepsy/settings", { body, headers: EPI() });
    expect((await put(w.a.analyst, { columnNames: { profiles: { "Market Cap": "Mkt cap (USD bn)" } } })).status).toBe(403);
    expect((await put(w.a.admin, { columnNames: { profiles: { "Market Capitalisation": "Mkt cap (USD bn)" } } })).status).toBe(400);
    expect((await put(w.a.admin, { columnNames: { profiles: { "market cap": "Mkt cap (USD bn)" } } })).status).toBe(200);
    const d = await json(call(w.a.client, "GET", "/api/epilepsy/data", { headers: EPI() }));
    // Kept under the page's own spelling; the sheet itself is served as written.
    expect(d.columnNames).toEqual({ profiles: { "Market Cap": "Mkt cap (USD bn)" } });
    expect(d.sheets.profiles.columns).toContain("Mkt cap (USD bn)");
    // Sent in full: an empty sheet clears its names.
    await put(w.a.admin, { columnNames: {} });
    expect((await json(call(w.a.client, "GET", "/api/epilepsy/data", { headers: EPI() }))).columnNames).toEqual({});
  });

  it("keeps options added in Admin (the platform accepts them; the workbook is not changed)", async () => {
    const put = (who: string, body: unknown) => call(who, "PUT", "/api/epilepsy/settings", { body, headers: EPI() });
    expect((await put(w.a.client, { addedOptions: { assets: { "Current Phase": ["Phase 4"] } } })).status).toBe(403);
    expect((await put(w.a.admin, { addedOptions: { assets: { "Current Phase": [""] } } })).status).toBe(422);
    expect((await put(w.a.admin, { addedOptions: { assets: { "Current Phase": [" Phase 4 ", "phase 4", "Pre-clinical"], RoA: [] } } })).status).toBe(200);
    const d = await json(call(w.a.client, "GET", "/api/epilepsy/data", { headers: EPI() }));
    expect(d.addedOptions).toEqual({ assets: { "Current Phase": ["Phase 4", "Pre-clinical"] } });
    // Reading the workbook again keeps them, and its own options.
    const form = new FormData();
    form.append("file", new File([workbook()], "Epilepsy Dashboard Excel.xlsx"));
    await call(w.a.admin, "POST", "/api/epilepsy/upload", { form, headers: EPI() });
    const again = await json(call(w.a.client, "GET", "/api/epilepsy/data", { headers: EPI() }));
    expect(again.addedOptions.assets["Current Phase"]).toEqual(["Phase 4", "Pre-clinical"]);
    expect(again.dropdowns.assets["Current Phase"]).toHaveLength(4);
  });
});
