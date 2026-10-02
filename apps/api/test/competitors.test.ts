import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_COMPETITOR_SUMMARIES, competitorRadius, defaultCompetitorName, defaultCompetitorSummary, isPlaceholderCompetitor, normaliseNavOrder } from "@eradigm/shared";
import { app } from "../src/app";
import { competitorEntryScore } from "../src/services/megatrends";
import { approveWith, call, env, json, seedWorld, type World } from "./helpers";

let w: World;
beforeAll(async () => {
  w = await seedWorld();
});

const today = new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

async function entry(stream: "primary" | "secondary", title: string, competitors: string[], date: string, impact = "Medium", extra: Record<string, unknown> = {}) {
  const { item } = await json(call(w.a.analyst, "POST", "/api/submissions/manual", { body: { stream } }));
  const res = await approveWith(w.a.analyst, item, { title, competitors, date, impact, ...extra });
  if (res.status !== 200) throw new Error(`${title}: ${await res.text()}`);
  return item.id as string;
}
const withMock = (path: string, who: string, body: unknown) =>
  app.fetch(new Request(`https://api.test${path}`, { method: "POST", headers: { "x-dev-user": who, "content-type": "application/json" }, body: JSON.stringify(body) }), { ...env, LLM_PROVIDER: "mock" });

type Comp = { name: string; count: number; summary: { text: string; source: string; entries: number | null } | null };
type Data = { aiConnected: boolean; competitors: Comp[]; pairs: { a: string; b: string; count: number }[]; entries: { id: string; title: string; competitors: string[] }[]; truncated: boolean };

describe("default competitor summaries", () => {
  it("ships the summaries and finds them under other spellings", () => {
    expect(Object.keys(DEFAULT_COMPETITOR_SUMMARIES).length).toBeGreaterThanOrEqual(70);
    expect(defaultCompetitorSummary("Eli Lilly")).toContain("LillyDirect");
    for (const [name, want] of [
      ["Lilly", "Eli Lilly"],
      ["BMS", "Bristol Myers Squibb"],
      ["Bristol-Myers Squibb", "Bristol Myers Squibb"],
      ["J&J", "Johnson & Johnson"],
      ["Johnson and Johnson", "Johnson & Johnson"],
      ["Takeda Pharmaceutical Co., Ltd.", "Takeda"],
      ["Boehringer Ingelheim", "Boehringer"],
      ["Novartis AG", "Novartis"],
      ["GlaxoSmithKline", "GSK"],
      ["Merck & Co.", "Merck"],
      ["89bio", "89bio"],
    ] as const)
      expect(defaultCompetitorName(name), name).toBe(want);
    expect(defaultCompetitorName("Acme Unknown Corp")).toBeNull();
  });

  it("treats N/A and the like as no competitor", () => {
    for (const v of ["N/A", "n/a", "NA", "N.A.", "None", "Not applicable", "-", " ", "TBC", "Unknown"]) expect(isPlaceholderCompetitor(v), v).toBe(true);
    for (const v of ["Novartis", "Nanobiotix", "Unknown Pharma", "Pfizer"]) expect(isPlaceholderCompetitor(v), v).toBe(false);
  });

  it("sizes nodes exponentially: one or two entries stay very small", () => {
    const max = 40;
    const r = (n: number) => competitorRadius(n, max);
    expect(r(1)).toBeLessThan(2);
    expect(r(2)).toBeLessThan(2);
    expect(r(max)).toBeCloseTo(26, 5);
    // Convex: the second half of the range adds far more than the first.
    expect(r(40) - r(20)).toBeGreaterThan(3 * (r(20) - r(1)));
  });

  it("puts the Competitors tab after Megatrends in a stored tab order", () => {
    const order = normaliseNavOrder(["megatrends", "dashboard", "tracker", "phantoms", "deliverables", "inbox", "clientinbox", "input", "admin"]);
    expect(order.slice(0, 3)).toEqual(["megatrends", "competitors", "dashboard"]);
  });

  it("weighs entries by impact and recency, keeping old high-impact ones", () => {
    const s = (impact: string, age: number) => competitorEntryScore(impact, daysAgo(age), today, 90);
    expect(s("High", 0)).toBeGreaterThan(s("Medium", 0));
    expect(s("High", 10)).toBeGreaterThan(s("High", 300));
    // An old High still outranks a recent Low.
    expect(s("High", 900)).toBeGreaterThan(s("Low", 0));
  });
});

describe("Competitors", () => {
  beforeAll(async () => {
    for (const v of ["Eli Lilly", "Novo Nordisk", "Metsera", "N/A"]) await call(w.a.admin, "POST", "/api/schema/columns/competitors/options?stream=primary", { body: { value: v } });
    await entry("primary", "Pfizer wins the Metsera bidding war", ["Pfizer", "Metsera", "Novo Nordisk"], daysAgo(20), "High");
    await entry("primary", "Lilly and Novo cut DTP prices", ["Eli Lilly", "Novo Nordisk"], daysAgo(5), "Medium");
    await entry("primary", "Lilly opens LillyPod", ["Eli Lilly"], daysAgo(400), "High", { key_details: "An older high-impact move." });
    await entry("primary", "Lilly sponsors a podcast", ["Eli Lilly"], daysAgo(1), "Low");
    await entry("secondary", "Roche scales RocheChat", ["Roche"], daysAgo(3), "Medium");
    await entry("primary", "An entry with no competitor", ["N/A"], daysAgo(2), "Low");
    await entry("primary", "Lilly and N/A", ["Eli Lilly", "N/A"], daysAgo(500), "Low");
  });

  it("counts entries per competitor, pairs named together, and lists the entries", async () => {
    const d = await json<Data>(call(w.a.client, "GET", "/api/competitors"));
    const by = new Map(d.competitors.map((c) => [c.name, c]));
    expect(by.get("Eli Lilly")?.count).toBe(4);
    // N/A is no competitor: no node, no tie, and an entry naming only N/A is not listed.
    expect(by.has("N/A")).toBe(false);
    expect(d.pairs.some((p) => p.a === "N/A" || p.b === "N/A")).toBe(false);
    expect(d.entries.some((e) => e.title === "An entry with no competitor")).toBe(false);
    expect(d.entries.find((e) => e.title === "Lilly and N/A")?.competitors).toEqual(["Eli Lilly"]);
    expect(by.get("Novo Nordisk")?.count).toBe(2);
    expect(by.get("Metsera")?.count).toBe(1);
    // Most-named first.
    expect(d.competitors[0]?.name).toBe("Eli Lilly");
    expect(d.pairs).toEqual(
      expect.arrayContaining([
        { a: "Eli Lilly", b: "Novo Nordisk", count: 1 },
        { a: "Metsera", b: "Novo Nordisk", count: 1 },
        { a: "Metsera", b: "Pfizer", count: 1 },
        { a: "Novo Nordisk", b: "Pfizer", count: 1 },
      ]),
    );
    const bidding = d.entries.find((e) => e.title === "Pfizer wins the Metsera bidding war");
    expect(bidding?.competitors).toEqual(["Metsera", "Novo Nordisk", "Pfizer"]);
    // Default summaries; one stream only; other tenants see none of it.
    expect(by.get("Eli Lilly")?.summary).toMatchObject({ source: "default" });
    expect(by.get("Eli Lilly")?.summary?.text).toContain("LillyDirect");
    const sec = await json<Data>(call(w.a.client, "GET", "/api/competitors?stream=secondary"));
    expect(sec.competitors.map((c) => c.name)).toEqual(["Roche"]);
    expect((await json<Data>(call(w.b.admin, "GET", "/api/competitors"))).competitors).toEqual([]);
    expect((await call(w.a.client, "GET", "/api/competitors?stream=other")).status).toBe(400);
  });

  it("writes a competitor summary by hand, and back to the default", async () => {
    const put = (text: string, who = w.a.analyst) => call(who, "PUT", "/api/megatrends/summaries", { body: { level: "competitor", name: "Eli Lilly", text } });
    expect(await json(put("Lilly is building a consumer brand."))).toMatchObject({ source: "manual", text: "Lilly is building a consumer brand." });
    let d = await json<Data>(call(w.a.client, "GET", "/api/competitors"));
    expect(d.competitors.find((c) => c.name === "Eli Lilly")?.summary).toMatchObject({ source: "manual" });
    expect((await put("Nope", w.a.client)).status).toBe(403);
    await put("");
    d = await json<Data>(call(w.a.client, "GET", "/api/competitors"));
    expect(d.competitors.find((c) => c.name === "Eli Lilly")?.summary).toMatchObject({ source: "default" });
  });

  it("writes it with the AI from high-impact and recent entries (old high-impact ones included)", async () => {
    expect((await call(w.a.analyst, "POST", "/api/megatrends/summaries/generate", { body: { level: "competitor", name: "Eli Lilly" } })).status).toBe(409);
    const r = await withMock("/api/megatrends/summaries/generate", w.a.analyst, { level: "competitor", name: "Eli Lilly" });
    expect(r.status).toBe(200);
    const s = await r.json<{ text: string; source: string; entries: number }>();
    expect(s).toMatchObject({ source: "ai", entries: 4 });
    expect(s.text).toContain("naming Eli Lilly");
    // Oldest first: the 400-day-old High entry is still read.
    expect(s.text).toContain("Lilly opens LillyPod");
    const none = await withMock("/api/megatrends/summaries/generate", w.a.analyst, { level: "competitor", name: "Nobody Pharma" });
    expect(none.status).toBe(409);
  });
});
