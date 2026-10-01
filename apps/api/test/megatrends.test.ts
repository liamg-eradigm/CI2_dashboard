import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_MACRO_SUMMARIES, DEFAULT_NAV_ORDER, DEFAULT_SUB_SUMMARIES } from "@eradigm/shared";
import { app } from "../src/app";
import { approveWith, call, env, json, seedWorld, type World } from "./helpers";

let w: World;
beforeAll(async () => {
  w = await seedWorld();
});

const R_AND_D = "AI Investment in R&D";
const DTP = "Direct-to-Patient (DTP) Strategy";

async function entry(stream: "primary" | "secondary", title: string, macrotrend: string, subtrend: string, date: string, extra: Record<string, unknown> = {}) {
  const { item } = await json(call(w.a.analyst, "POST", "/api/submissions/manual", { body: { stream } }));
  const res = await approveWith(w.a.analyst, item, { title, macrotrend, subtrend, date, ...extra });
  if (res.status !== 200) throw new Error(`${title}: ${await res.text()}`);
  return item.id as string;
}

type Node = { name: string; count: number; summary: { text: string; source: string; model: string | null; windowDays: number | null; entries: number | null } | null };
type Macro = Node & { subtrends: Node[] };
const get = async (q = "", who = w.a.client) => json(call(who, "GET", `/api/megatrends${q}`));
const macro = (d: { macrotrends: Macro[] }, name: string) => d.macrotrends.find((m) => m.name === name)!;

/** The same request with the AI writer switched to the offline mock adapter. */
const withMock = (path: string, who: string, body: unknown) =>
  app.fetch(new Request(`https://api.test${path}`, { method: "POST", headers: { "x-dev-user": who, "content-type": "application/json" }, body: JSON.stringify(body) }), { ...env, LLM_PROVIDER: "mock" });

describe("Megatrends", () => {
  let a: string, b: string, c: string, gone: string;
  beforeAll(async () => {
    const today = new Date().toISOString().slice(0, 10);
    a = await entry("primary", "BMS builds an NVIDIA AI factory", R_AND_D, "Computational Infrastructure", today, { competitors: ["Roche"] });
    b = await entry("secondary", "Regeneron signs a TriNetX data deal", R_AND_D, "External Partnerships to Accelerate AI", "2026-03-02");
    c = await entry("primary", "Novo relaunches NovoCare", DTP, "DTP Platformization & Infrastructure Building", "2026-03-02");
    gone = await entry("primary", "Deleted from the tracker only", DTP, "New DTP Program Launch", "2026-03-03");
    await call(w.a.analyst, "DELETE", `/api/items/${gone}`, { body: { from: "tracker" } });
  });

  it("counts Tracker entries per Macrotrend and Subtrend across both trackers, in taxonomy order, with the default summaries", async () => {
    const d = await get();
    expect(d).toMatchObject({ stream: "all", from: null, to: null, aiConnected: false, truncated: false });
    expect(d.macrotrends.map((m: Macro) => m.name).slice(0, 4)).toEqual([R_AND_D, "Workforce AI Upskilling", "Integrated Digital Pharma Innovation", DTP]);
    const rd = macro(d, R_AND_D);
    expect(rd.count).toBe(2);
    expect(rd.summary).toMatchObject({ text: DEFAULT_MACRO_SUMMARIES[R_AND_D], source: "default" });
    expect(rd.subtrends.find((s) => s.name === "Computational Infrastructure")).toMatchObject({ count: 1, summary: { text: DEFAULT_SUB_SUMMARIES["Computational Infrastructure"], source: "default" } });
    expect(rd.subtrends.find((s) => s.name === "Agentic AI Platforms")).toMatchObject({ count: 0, summary: null });
    // Deleted from the Tracker only: not counted.
    expect(macro(d, DTP).count).toBe(1);
    expect(macro(d, "Others")).toMatchObject({ count: 0, summary: null });
    // Timeline: oldest first, with what the hover and the slide-up row need.
    const ids = d.entries.map((e: { id: string }) => e.id);
    expect(ids).toEqual(expect.arrayContaining([a, b, c]));
    expect(ids).not.toContain(gone);
    expect(ids.indexOf(a)).toBeGreaterThan(ids.indexOf(b));
    expect(d.entries.find((e: { id: string }) => e.id === b)).toMatchObject({ stream: "secondary", date: "2026-03-02", title: "Regeneron signs a TriNetX data deal", macrotrend: R_AND_D, subtrend: "External Partnerships to Accelerate AI" });
    // Other tenants see none of it.
    expect(macro(await get("", w.b.admin), R_AND_D).count).toBe(0);
  });

  it("filters by tracker and by Event Date", async () => {
    expect(macro(await get("?stream=primary"), R_AND_D).count).toBe(1);
    expect(macro(await get("?stream=secondary"), R_AND_D).count).toBe(1);
    const march = await get("?from=2026-03-01&to=2026-03-31");
    expect(macro(march, R_AND_D).count).toBe(1);
    expect(march.entries.map((e: { id: string }) => e.id)).not.toContain(a);
    expect((await call(w.a.client, "GET", "/api/megatrends?stream=tertiary")).status).toBe(400);
    expect((await call(w.a.client, "GET", "/api/megatrends?from=March")).status).toBe(400);
  });

  it("lets analysts write a summary by hand (empty = back to the default); clients cannot", async () => {
    const put = (body: unknown, who = w.a.analyst) => call(who, "PUT", "/api/megatrends/summaries", { body });
    expect((await put({ level: "macro", name: R_AND_D, text: "x" }, w.a.client)).status).toBe(403);
    const s = await json(put({ level: "macro", name: R_AND_D, text: "  Hand-written R&D summary.  " }));
    expect(s).toMatchObject({ text: "Hand-written R&D summary.", source: "manual", updatedBy: "A Analyst", model: null });
    expect(macro(await get(), R_AND_D).summary).toMatchObject({ text: "Hand-written R&D summary.", source: "manual" });
    // A summary for a Subtrend with none by default.
    await put({ level: "sub", name: "Agentic AI Platforms", parent: R_AND_D, text: "Agents everywhere." });
    expect(macro(await get(), R_AND_D).subtrends.find((x) => x.name === "Agentic AI Platforms")?.summary?.text).toBe("Agents everywhere.");
    // Not visible to another tenant.
    expect(macro(await get("", w.b.admin), R_AND_D).summary?.source).toBe("default");
    const back = await json(put({ level: "macro", name: R_AND_D, text: "" }));
    expect(back).toMatchObject({ text: DEFAULT_MACRO_SUMMARIES[R_AND_D], source: "default" });
    expect((await put({ level: "galaxy", name: R_AND_D, text: "x" })).status).toBe(422);
  });

  it("refuses AI summaries while the AI writer is not connected", async () => {
    const r = await call(w.a.analyst, "POST", "/api/megatrends/summaries/generate", { body: { level: "macro", name: R_AND_D } });
    expect(r.status).toBe(409);
    expect((await json(r)).error.message).toMatch(/not connected/);
  });

  it("writes AI summaries from the entries of the configured time frame, recording the model and window", async () => {
    await call(w.a.admin, "PATCH", "/api/settings", { body: { megatrends: { summaryDays: 30, summarySentences: 3, model: "claude-haiku-4-5" } } });
    const r = await withMock("/api/megatrends/summaries/generate", w.a.analyst, { level: "macro", name: R_AND_D });
    expect(r.status).toBe(200);
    const s = await r.json<{ text: string; source: string; model: string; windowDays: number; entries: number }>();
    // Only the entry dated today is within the last 30 days.
    expect(s).toMatchObject({ source: "ai", model: "mock-heuristic", windowDays: 30, entries: 1 });
    expect(s.text).toContain("BMS builds an NVIDIA AI factory");
    expect(s.text).not.toContain("Regeneron");
    expect(macro(await get(), R_AND_D).summary?.source).toBe("ai");
    // Nothing recent: a clear conflict, nothing stored.
    const none = await withMock("/api/megatrends/summaries/generate", w.a.analyst, { level: "macro", name: DTP });
    expect(none.status).toBe(409);
    expect(macro(await get(), DTP).summary?.source).toBe("default");
    expect((await withMock("/api/megatrends/summaries/generate", w.a.client, { level: "macro", name: R_AND_D })).status).toBe(403);
  });

  it("keeps a summary when its Subtrend is renamed", async () => {
    const r = await call(w.a.analyst, "PATCH", "/api/schema/columns/subtrend/options?stream=primary", { body: { from: "Computational Infrastructure", to: "Compute Infrastructure" } });
    expect(r.status).toBe(200);
    const d = await get("?stream=primary");
    expect(macro(d, R_AND_D).subtrends.find((s) => s.name === "Compute Infrastructure")).toMatchObject({ count: 1, summary: { text: DEFAULT_SUB_SUMMARIES["Computational Infrastructure"] } });
  });
});

describe("Settings: tab order and the AI writer", () => {
  it("defaults to every tab, accepts a new order from admins only, and checks the AI settings", async () => {
    const s = await json(call(w.a.client, "GET", "/api/settings"));
    expect(s.navOrder).toEqual(DEFAULT_NAV_ORDER);
    expect(s.megatrends).toMatchObject({ summaryDays: expect.any(Number), summarySentences: expect.any(Number), perspective: "AbbVie" });
    const order = ["megatrends", "dashboard", "tracker", "phantoms", "deliverables", "inbox", "input", "admin"];
    expect((await call(w.a.analyst, "PATCH", "/api/settings", { body: { navOrder: order } })).status).toBe(403);
    expect((await json(call(w.a.admin, "PATCH", "/api/settings", { body: { navOrder: order } }))).navOrder).toEqual(order);
    // A partial order keeps the missing tabs (at the end).
    expect((await json(call(w.a.admin, "PATCH", "/api/settings", { body: { navOrder: ["admin", "dashboard"] } }))).navOrder).toEqual([
      "admin",
      "dashboard",
      "tracker",
      "phantoms",
      "deliverables",
      "megatrends",
      "inbox",
      "input",
    ]);
    for (const bad of [{ navOrder: ["dashboard", "dashboard"] }, { navOrder: ["galaxy"] }, { megatrends: { summarySentences: 0 } }, { megatrends: { model: "gpt-5" } }, { megatrends: { summaryDays: 5000 } }]) {
      expect((await call(w.a.admin, "PATCH", "/api/settings", { body: bad })).status).toBe(422);
    }
    // The tab order is per tenant.
    expect((await json(call(w.b.admin, "GET", "/api/settings"))).navOrder).toEqual(DEFAULT_NAV_ORDER);
  });
});
