import { beforeAll, describe, expect, it } from "vitest";
import { newId, nowIso } from "../src/lib/ids";
import { call, env, json, seedWorld, type World } from "./helpers";

let w: World;
const MACROS = ["AI Investment in R&D", "Geopolitics", "Portfolio Restructuring", "Direct-to-Patient (DTP) Strategy"];
const SUBS: Record<string, string[]> = {
  "AI Investment in R&D": ["Agentic AI Platforms", "Computational Infrastructure"],
  Geopolitics: ["IRA Pricing/Tariffs"],
  "Portfolio Restructuring": ["Mergers & Acquisitions", "Licensing & Co-Development Deals"],
  "Direct-to-Patient (DTP) Strategy": ["Global DTP Expansion"],
};
const COMPS = ["Pfizer", "Novartis", "Roche", "Sanofi", "AstraZeneca"];

/** Insert approved items directly (fast fixture for query tests). */
async function fixture(tenantId: string, n: number) {
  const stmts: D1PreparedStatement[] = [];
  const u = await env.DB.prepare("SELECT user_id FROM role_assignments WHERE tenant_id = ?1 LIMIT 1").bind(tenantId).first<{ user_id: string }>();
  let seed = 7;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) {
    const macro = MACROS[Math.floor(r() * MACROS.length)] as string;
    const sub = SUBS[macro]![Math.floor(r() * SUBS[macro]!.length)] as string;
    const comps = [COMPS[Math.floor(r() * 5)] as string];
    if (r() < 0.3) comps.push(COMPS[(COMPS.indexOf(comps[0]!) + 1) % 5] as string);
    const day = String(1 + Math.floor(r() * 28)).padStart(2, "0");
    const month = String(1 + Math.floor(r() * 9)).padStart(2, "0");
    const date = `2026-${month}-${day}`;
    const growth = ["Stable", "Slight Increase", "Strong Increase"][Math.floor(r() * 3)];
    const impact = ["Low", "Medium", "High"][Math.floor(r() * 3)];
    const source = ["LinkedIn", "PR", "Publication"][Math.floor(r() * 3)];
    const id = newId("itm");
    const sid = newId("sub");
    stmts.push(
      env.DB.prepare("INSERT INTO submissions (id, tenant_id, submitted_by, input_type, created_at) VALUES (?1, ?2, ?3, 'url', ?4)").bind(sid, tenantId, u?.user_id, nowIso()),
      env.DB.prepare(
        `INSERT INTO intelligence_items (id, tenant_id, submission_id, code, signal_code, status, input_type, received_at, created_at, updated_at, published_rev, pub_date, title, body_text, macrotrend, subtrend, growth, impact, extra_json, approved_at, draft_json)
         VALUES (?1, ?2, ?3, ?4, ?5, 'approved', 'url', ?6, ?6, ?6, 1, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?6, '{}')`,
      ).bind(id, tenantId, sid, `INB-${i}`, `SIG-${5000 + i}`, nowIso(), date, `${comps.join(" and ")} ${sub} news ${i}`, i % 4 === 0 ? "mentions alliance keyword" : "other text", macro, sub, growth, impact, JSON.stringify({ source, action: i % 2 ? "Actioned" : "Not Actioned" })),
      ...comps.map((c) => env.DB.prepare("INSERT INTO item_competitors (tenant_id, item_id, competitor) VALUES (?1, ?2, ?3)").bind(tenantId, id, c)),
    );
  }
  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
}

beforeAll(async () => {
  w = await seedWorld();
  await fixture(w.a.id, 150);
});

const qs = (o: Record<string, string>) => new URLSearchParams({ from: "2026-01-01", to: "2026-09-30", ...o }).toString();

describe("dashboard totals reconcile with the filtered tracker", () => {
  const filters: Record<string, string>[] = [
    {},
    { "f.macrotrend": "Geopolitics" },
    { "f.competitors": "Roche" },
    { "f.impact": "High", "f.growth": "Strong Increase" },
    { "f.macrotrend": "Portfolio Restructuring", "f.subtrend": "Mergers & Acquisitions" },
    { "f.source": "PR", "f.action": "Actioned" },
    { q: "alliance" },
    { from: "2026-03-01", to: "2026-05-31", "f.competitors": "Pfizer" },
  ];

  it.each(filters)("reconciles for %o", async (f) => {
    const [dash, tracker] = await Promise.all([json(call(w.a.client, "GET", `/api/dashboard?${qs(f)}`)), json(call(w.a.client, "GET", `/api/tracker?${qs(f)}&pageSize=100`))]);
    // KPI count == tracker total == timeline points (below the timeline cap).
    expect(dash.kpis.approved).toBe(tracker.total);
    expect(dash.timeline.length).toBe(tracker.total);
    // High/Low KPIs match the tracker rows.
    const rows = tracker.rows as any[];
    if (tracker.total <= 100) {
      expect(dash.kpis.high).toBe(rows.filter((r) => r.values.impact === "High").length);
      expect(dash.kpis.low).toBe(rows.filter((r) => r.values.impact === "Low").length);
    }
    // Each chart ignores its own dimension; with that filter removed, bars sum to the tracker total.
    const noMacro = { ...f };
    delete noMacro["f.macrotrend"];
    delete noMacro["f.subtrend"];
    const t2 = await json(call(w.a.client, "GET", `/api/tracker?${qs(noMacro)}&pageSize=1`));
    expect(dash.macroBars.reduce((a: number, b: any) => a + b.n, 0)).toBe(t2.total);
    for (const b of dash.macroBars) expect(b.high + b.medium + b.low).toBe(b.n);
    const noComp = { ...f };
    delete noComp["f.competitors"];
    const t3 = await json(call(w.a.client, "GET", `/api/tracker?${qs(noComp)}&pageSize=1`));
    expect(dash.compItems).toBe(t3.total);
    expect(dash.compSum).toBeGreaterThanOrEqual(dash.compItems);
  });

  it("limits subtrend bars to the selected macrotrend", async () => {
    const dash = await json(call(w.a.client, "GET", `/api/dashboard?${qs({ "f.macrotrend": "Portfolio Restructuring" })}`));
    expect(dash.subBars.map((b: any) => b.label).sort()).toEqual(["Licensing & Co-Development Deals", "Mergers & Acquisitions"]);
  });

  it("defaults to everything in view (oldest entry to today) when no dates are given", async () => {
    const t = await json(call(w.a.client, "GET", "/api/tracker?pageSize=100"));
    const all = await json(call(w.a.client, "GET", "/api/tracker?pageSize=100&from=1900-01-01&to=2999-12-31"));
    expect(t.total).toBe(all.total);
    expect(t.outsideDates.count).toBe(0);
  });

  it("sorts by dropdown order and paginates", async () => {
    const asc = await json(call(w.a.client, "GET", `/api/tracker?${qs({})}&sort=impact&dir=asc&pageSize=100`));
    const order = ["Low", "Medium", "High"];
    const idx = asc.rows.map((r: any) => order.indexOf(r.values.impact));
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    const p0 = await json(call(w.a.client, "GET", `/api/tracker?${qs({})}&page=0&pageSize=10`));
    const p1 = await json(call(w.a.client, "GET", `/api/tracker?${qs({})}&page=1&pageSize=10`));
    expect(p0.rows.length).toBe(10);
    expect(p0.rows[0].id).not.toBe(p1.rows[0].id);
  });
});

describe("exports", () => {
  it("exports filtered rows with every column, audited", async () => {
    const t = await json(call(w.a.client, "GET", `/api/tracker?${qs({ "f.macrotrend": "Geopolitics" })}&pageSize=1`));
    const res = await call(w.a.client, "GET", `/api/tracker/export?${qs({ "f.macrotrend": "Geopolitics" })}&format=csv&scope=filtered`);
    expect(res.headers.get("content-disposition")).toMatch(/eradigm-tracker-filtered-\d{4}-\d{2}-\d{2}\.csv/);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM for Excel
    const lines = new TextDecoder().decode(bytes).trim().split("\r\n");
    expect(lines[0]).toBe("Signal ID,Title,Event Date,Macrotrend,Subtrend,Growth Intensity,Impact,Source Type,Competitors,Action");
    expect(lines.length - 1).toBe(t.total);
    const xlsx = await call(w.a.client, "GET", "/api/tracker/export?format=xlsx&scope=all");
    expect(new Uint8Array(await xlsx.arrayBuffer()).slice(0, 2)).toEqual(new Uint8Array([0x50, 0x4b]));
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE chain = ?1 AND action = 'export.created'").bind(w.a.id).first<{ n: number }>();
    expect(n?.n).toBe(2);
  });
});

describe("Trend Test", () => {
  it("compares the current period with an equal-length baseline", async () => {
    const r = await json(
      call(w.a.client, "POST", "/api/trend-test", {
        body: { macrotrend: "All", subtrend: "All", competitors: [], growth: "All", from: "2026-07-01", to: "2026-09-28", thresholds: { minSampleSize: 1, signalCountChangePct: 0, distinctCompetitorsChange: 0, impactScoreChangePct: 0, growthScoreChange: 0 } },
      }),
    );
    expect(r.baseline).toEqual({ from: "2026-04-02", to: "2026-06-30", days: 90 });
    expect(r.metrics.map((m: any) => m.key)).toEqual(["sample", "count", "competitors", "impact", "growth"]);
    expect(r.counts.current).toBe(r.metrics[0].current);
    expect(["Trend confirmed", "No trend detected"]).toContain(r.verdict);
  });

  it("validates the request", async () => {
    expect((await call(w.a.client, "POST", "/api/trend-test", { body: { from: "x" } })).status).toBe(422);
  });
});

describe("schema editing", () => {
  it("renames options everywhere and blocks deleting options in use", async () => {
    const r = await call(w.a.analyst, "PATCH", "/api/schema/columns/macrotrend/options", { body: { from: "Geopolitics", to: "Geopolitics & Pricing" } });
    expect(r.status).toBe(200);
    const s = await r.json<any>();
    expect(s.taxonomy.map((g: any) => g.name)).toContain("Geopolitics & Pricing");
    const t = await json(call(w.a.client, "GET", `/api/tracker?${qs({ "f.macrotrend": "Geopolitics & Pricing" })}&pageSize=1`));
    expect(t.total).toBeGreaterThan(0);
    const del = await call(w.a.analyst, "DELETE", "/api/schema/columns/macrotrend/options", { body: { value: "Geopolitics & Pricing" } });
    expect(del.status).toBe(409);
    expect((await del.json<any>()).error.message).toMatch(/In use by \d+ published signal/);
    // Renaming competitors updates the multi-valued associations.
    await call(w.a.analyst, "PATCH", "/api/schema/columns/competitors/options", { body: { from: "Roche", to: "Roche Group" } });
    const rc = await json(call(w.a.client, "GET", `/api/tracker?${qs({ "f.competitors": "Roche Group" })}&pageSize=1`));
    expect(rc.total).toBeGreaterThan(0);
  });

  it("rejects duplicates, reserved names and deleting core columns", async () => {
    expect((await call(w.a.analyst, "POST", "/api/schema/columns", { body: { label: "impact", type: "text" } })).status).toBe(409);
    expect((await call(w.a.analyst, "POST", "/api/schema/columns/impact/options", { body: { value: "All" } })).status).toBe(409);
    expect((await call(w.a.analyst, "DELETE", "/api/schema/columns/impact")).status).toBe(409);
  });

  it("adds, renames and deletes custom columns", async () => {
    const s = await json(call(w.a.analyst, "POST", "/api/schema/columns", { body: { label: "Region", type: "select" } }));
    const col = s.columns.find((c: any) => c.label === "Region");
    expect(col.required).toBe(false);
    await call(w.a.analyst, "POST", `/api/schema/columns/${col.key}/options`, { body: { value: "EMEA" } });
    const renamed = await json(call(w.a.analyst, "PATCH", `/api/schema/columns/${col.key}`, { body: { label: "Geography", required: true } }));
    expect(renamed.columns.find((c: any) => c.key === col.key)).toMatchObject({ label: "Geography", required: true, options: ["EMEA"] });
    const del = await json(call(w.a.analyst, "DELETE", `/api/schema/columns/${col.key}`));
    expect(del.columns.find((c: any) => c.key === col.key)).toBeUndefined();
  });
});

describe("column order", () => {
  it("reorders all columns (A–Z, Z–A or dragged) and rejects stale or partial orders", async () => {
    const before = await json(call(w.a.analyst, "GET", "/api/schema"));
    const keys = [...before.columns].sort((a: any, b: any) => a.position - b.position).map((c: any) => c.key);
    const reversed = [...keys].reverse();
    const after = await json(call(w.a.analyst, "PUT", "/api/schema/columns/order", { body: { keys: reversed } }));
    expect([...after.columns].sort((a: any, b: any) => a.position - b.position).map((c: any) => c.key)).toEqual(reversed);
    expect(after.revision).toBeGreaterThan(before.revision);
    // Missing a column, or naming one twice: refused, nothing changes.
    expect((await call(w.a.analyst, "PUT", "/api/schema/columns/order", { body: { keys: keys.slice(1) } })).status).toBe(409);
    expect((await call(w.a.analyst, "PUT", "/api/schema/columns/order", { body: { keys: [keys[0], ...keys.slice(0, -1)] } })).status).toBe(409);
    // Clients cannot edit the schema.
    expect((await call(w.a.client, "PUT", "/api/schema/columns/order", { body: { keys } })).status).toBe(403);
    await call(w.a.analyst, "PUT", "/api/schema/columns/order", { body: { keys } });
  });
});

describe("option order", () => {
  it("reorders a column's options, macrotrends and one macrotrend's subtrends", async () => {
    const before = await json(call(w.a.analyst, "GET", "/api/schema"));
    const source = before.columns.find((c: any) => c.key === "source");
    const rev = [...source.options].reverse();
    const s1 = await json(call(w.a.analyst, "PUT", "/api/schema/columns/source/options/order", { body: { values: rev } }));
    expect(s1.columns.find((c: any) => c.key === "source").options).toEqual(rev);

    const macros = before.taxonomy.map((g: any) => g.name);
    const s2 = await json(call(w.a.analyst, "PUT", "/api/schema/columns/macrotrend/options/order", { body: { values: [...macros].reverse() } }));
    expect(s2.taxonomy.map((g: any) => g.name)).toEqual([...macros].reverse());
    // Subtrends stay attached to their macrotrend when macrotrends move.
    expect(s2.taxonomy.find((g: any) => g.name === macros[0]).subtrends).toEqual(before.taxonomy[0].subtrends);

    const g = before.taxonomy.find((x: any) => x.subtrends.length > 1);
    const subs = [...g.subtrends].reverse();
    const s3 = await json(call(w.a.analyst, "PUT", "/api/schema/columns/subtrend/options/order", { body: { values: subs, parent: g.name } }));
    expect(s3.taxonomy.find((x: any) => x.name === g.name).subtrends).toEqual(subs);

    // Partial, duplicated or foreign lists are refused; subtrends need their macrotrend; clients cannot reorder.
    expect((await call(w.a.analyst, "PUT", "/api/schema/columns/source/options/order", { body: { values: rev.slice(1) } })).status).toBe(409);
    expect((await call(w.a.analyst, "PUT", "/api/schema/columns/source/options/order", { body: { values: [rev[0], ...rev.slice(0, -1)] } })).status).toBe(409);
    expect((await call(w.a.analyst, "PUT", "/api/schema/columns/subtrend/options/order", { body: { values: subs } })).status).toBe(400);
    expect((await call(w.a.analyst, "PUT", "/api/schema/columns/title/options/order", { body: { values: ["x"] } })).status).toBe(400);
    expect((await call(w.a.client, "PUT", "/api/schema/columns/source/options/order", { body: { values: source.options } })).status).toBe(403);
    await call(w.a.analyst, "PUT", "/api/schema/columns/source/options/order", { body: { values: source.options } });
    await call(w.a.analyst, "PUT", "/api/schema/columns/macrotrend/options/order", { body: { values: macros } });
  });
});

describe("saved views and settings", () => {
  it("preserves filters and trend thresholds in saved views", async () => {
    const state = { filters: { q: "", from: "2026-01-01", to: "2026-03-31", values: { macrotrend: "Geopolitics & Pricing" } }, trend: { macrotrend: "All", subtrend: "All", competitors: [], growth: "All", from: "2026-01-01", to: "2026-03-31", thresholds: { minSampleSize: 3, signalCountChangePct: 10, distinctCompetitorsChange: 1, impactScoreChangePct: 10, growthScoreChange: 0.1 } } };
    const v = await json(call(w.a.client, "POST", "/api/views", { body: { name: "Q1 geopolitics", kind: "trend", state } }));
    const list = await json(call(w.a.client, "GET", "/api/views"));
    expect(list.find((x: any) => x.id === v.id).state).toEqual(state);
    expect((await json(call(w.a.analyst, "GET", "/api/views"))).find((x: any) => x.id === v.id)).toBeUndefined();
  });

  it("lets admins set trend defaults that everyone can see", async () => {
    await call(w.a.admin, "PATCH", "/api/settings", { body: { trendDefaults: { minSampleSize: 8, signalCountChangePct: 30, distinctCompetitorsChange: 2, impactScoreChangePct: 30, growthScoreChange: 0.3 } } });
    const s = await json(call(w.a.client, "GET", "/api/settings"));
    expect(s.trendDefaults.minSampleSize).toBe(8);
  });
});
