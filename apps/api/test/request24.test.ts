import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_COMPETITOR_TIERS, autoRecordId, flattenKiqs, tierOf } from "@eradigm/shared";
import { COMPLETE, call, json, seedWorld, type World } from "./helpers";

let w: World;
beforeAll(async () => {
  w = await seedWorld();
});

type Summary = { id: string; code: string; version: number; status: string; draft: Record<string, unknown>; kiqs: { topic: string; kiqs: { question: string; details: string; metrics: string }[] }[] | null; splitFrom: string | null; withClient: boolean };
const manual = async (stream: "primary" | "secondary") => (await json(call(w.a.analyst, "POST", "/api/submissions/manual", { body: { stream } }))).item as Summary;
const BASE = { ...COMPLETE, title: "KOL interview: Roche oncology", date: "2026-09-10", competitors: ["Roche"], source: "Primary Source" };
const KIQS = [
  {
    topic: "Launch sequencing",
    kiqs: [
      { question: "When will Roche launch in the US?", details: "- Q3 2027\n  - pending FDA", metrics: "40% of KOLs aware" },
      { question: "Which markets follow?", details: "EU5 in 2028.", metrics: "" },
    ],
  },
  { topic: "Pricing", kiqs: [{ question: "Will Roche price at parity?", details: "Parity with SoC.", metrics: "" }] },
];

describe("automatic IDs (shared)", () => {
  it("builds Date_Competitor_Title (Secondary) and Date_Competitor_KIQ (Primary)", () => {
    expect(autoRecordId("secondary", { date: "2026-09-10", competitors: ["Pfizer", "Roche"], title: "A deal" })).toBe("2026-09-10_Pfizer & Roche_A deal");
    expect(autoRecordId("primary", { date: "2026-09-10", competitors: ["Roche"], title: "Interview", key_intelligence_question: "When?" })).toBe("2026-09-10_Roche_When?");
    expect(autoRecordId("primary", { date: "2026-09-10", competitors: ["Roche"], title: "Interview" })).toBe("2026-09-10_Roche_Interview");
    expect(autoRecordId("secondary", { date: "2026-09-10", competitors: [], title: "x" })).toBeNull();
    expect(flattenKiqs(KIQS).map((r) => r.topic)).toEqual(["Launch sequencing", "Launch sequencing", "Pricing"]);
  });
});

describe("Primary entries: one Tracker entry per Key Intelligence Question", () => {
  it("saves the topics and questions with the draft (the first fills the entry's own fields, and its ID)", async () => {
    const item = await manual("primary");
    const saved = await json<Summary>(call(w.a.analyst, "PATCH", `/api/items/${item.id}/draft`, { body: { values: { ...item.draft, ...BASE }, version: item.version, kiqs: KIQS } }));
    expect(saved.kiqs).toEqual(KIQS);
    expect(saved.draft).toMatchObject({ insight_topic: "Launch sequencing", key_intelligence_question: "When will Roche launch in the US?", key_metrics: "40% of KOLs aware" });
    expect(saved.draft.record_id).toBe("2026-09-10_Roche_When will Roche launch in the US?");
    // Saving only the list (same values) still saves.
    const again = await json<Summary>(call(w.a.analyst, "PATCH", `/api/items/${item.id}/draft`, { body: { values: saved.draft, version: saved.version, kiqs: [KIQS[1]] } }));
    expect(again.kiqs).toEqual([KIQS[1]]);
    expect(again.draft.insight_topic).toBe("Pricing");
  });

  it("splits into one Inbox entry per question, then each is pushed to the Tracker with its own ID and Phantom", async () => {
    const item = await manual("primary");
    const saved = await json<Summary>(call(w.a.analyst, "PATCH", `/api/items/${item.id}/draft`, { body: { values: { ...item.draft, ...BASE }, version: item.version, kiqs: KIQS } }));
    // Clients cannot split an entry in the Eradigm Inbox.
    expect((await call(w.a.client, "POST", `/api/items/${item.id}/split`, { body: { version: saved.version, kiqs: KIQS } })).status).toBe(403);
    const parts = await json<Summary[]>(call(w.a.analyst, "POST", `/api/items/${item.id}/split`, { body: { version: saved.version, kiqs: KIQS } }));
    expect(parts).toHaveLength(3);
    expect(parts[0]!.id).toBe(item.id);
    expect(parts.slice(1).every((p) => p.splitFrom === item.id && p.status === "needs_review" && p.code !== item.code)).toBe(true);
    expect(parts.map((p) => p.draft.key_intelligence_question)).toEqual(["When will Roche launch in the US?", "Which markets follow?", "Will Roche price at parity?"]);
    expect(parts.map((p) => p.draft.insight_topic)).toEqual(["Launch sequencing", "Launch sequencing", "Pricing"]);
    expect(parts[1]!.draft.title).toBe(BASE.title);
    expect(parts[2]!.kiqs).toEqual([{ topic: "Pricing", kiqs: [KIQS[1]!.kiqs[0]] }]);
    // A stale version is refused.
    expect((await call(w.a.analyst, "POST", `/api/items/${item.id}/split`, { body: { version: saved.version, kiqs: KIQS } })).status).toBe(409);

    // Push each: none is a duplicate of another; IDs are their own.
    const pushed = [];
    for (const p of parts) {
      const r = await call(w.a.analyst, "POST", `/api/items/${p.id}/approve`, { body: { values: p.draft, version: p.version } });
      expect(r.status, await r.clone().text()).toBe(200);
      pushed.push(await json(r));
    }
    expect(pushed.map((p) => p.draft.record_id)).toEqual(["2026-09-10_Roche_When will Roche launch in the US?", "2026-09-10_Roche_Which markets follow?", "2026-09-10_Roche_Will Roche price at parity?"]);
    const phantoms = await json(call(w.a.client, "GET", "/api/phantoms?stream=primary&from=2000-01-01&to=2100-01-01&pageSize=100"));
    for (const p of pushed) expect(phantoms.rows.map((r: { id: string }) => r.id)).toContain(p.id);
  });

  it("lets the client split and push an entry in their inbox", async () => {
    const item = await manual("primary");
    const saved = await json<Summary>(call(w.a.analyst, "PATCH", `/api/items/${item.id}/draft`, { body: { values: { ...item.draft, ...BASE, title: "Client split" }, version: item.version, kiqs: KIQS } }));
    const sent = await json<Summary>(call(w.a.analyst, "POST", `/api/items/${item.id}/send-to-client`, { body: { version: saved.version } }));
    const parts = await json<Summary[]>(call(w.a.client, "POST", `/api/items/${item.id}/split`, { body: { version: sent.version, kiqs: KIQS } }));
    expect(parts).toHaveLength(3);
    expect(parts.every((p) => p.withClient)).toBe(true);
    for (const p of parts) expect((await call(w.a.client, "POST", `/api/client-inbox/${p.id}/push`, { body: { version: p.version } })).status).toBe(200);
  });

  it("refuses a split with no question, and Secondary entries", async () => {
    const item = await manual("primary");
    expect((await call(w.a.analyst, "POST", `/api/items/${item.id}/split`, { body: { version: item.version, kiqs: [{ topic: "x", kiqs: [] }] } })).status).toBe(422);
    const sec = await manual("secondary");
    expect((await call(w.a.analyst, "POST", `/api/items/${sec.id}/split`, { body: { version: sec.version, kiqs: KIQS } })).status).toBe(400);
  });
});

describe("spreadsheet import: a blank ID is filled in", () => {
  it("names imported rows Date_Competitor_Title, with _2 for a repeat", async () => {
    const row = (n: number) => ({
      row: n,
      values: {
        ID: "",
        Macrotrend: "Portfolio Restructuring",
        Subtrend: "Mergers & Acquisitions",
        Title: "Sanofi buys a biotech",
        "Event Date": "2025-09-24",
        Impact: "Medium",
        "Growth Intensity": "Stable",
        "Source Type": "PR",
        Competitors: "Sanofi",
        Action: "Actioned",
      },
    });
    const r = await json(call(w.a.analyst, "POST", "/api/import?stream=secondary", { body: { fileName: "ids.csv", rows: [row(2), row(3)] } }));
    expect(r).toMatchObject({ ok: true, imported: 2 });
    const t = await json(call(w.a.client, "GET", "/api/tracker?stream=secondary&from=2000-01-01&to=2100-01-01&pageSize=100&q=Sanofi%20buys%20a%20biotech"));
    const ids = t.rows.map((x: { values: Record<string, unknown> }) => x.values.record_id).sort();
    expect(ids).toEqual(["2025-09-24_Sanofi_Sanofi buys a biotech", "2025-09-24_Sanofi_Sanofi buys a biotech_2"]);
  });
});

describe("competitor tiers", () => {
  it("matches names however they are written, and admins change the tiers", async () => {
    expect(tierOf("J&J", DEFAULT_COMPETITOR_TIERS)).toBe(1);
    expect(tierOf("Bristol-Myers Squibb", DEFAULT_COMPETITOR_TIERS)).toBe(1);
    expect(tierOf("Veeva", DEFAULT_COMPETITOR_TIERS)).toBe(2);
    expect(tierOf("BeiGene", DEFAULT_COMPETITOR_TIERS)).toBe(2);
    expect(tierOf("GoodRx", DEFAULT_COMPETITOR_TIERS)).toBe(3);
    expect(tierOf("Novo", DEFAULT_COMPETITOR_TIERS)).toBe(3);
    expect(tierOf("Moderna", DEFAULT_COMPETITOR_TIERS)).toBe(4);

    const s = await json(call(w.a.client, "GET", "/api/settings"));
    expect(s.competitorTiers.tier1).toContain("Pfizer");
    let d = await json(call(w.a.client, "GET", "/api/competitors"));
    expect(d.competitors.find((c: { name: string }) => c.name === "Roche")?.tier).toBe(1);
    expect((await call(w.a.analyst, "PATCH", "/api/settings", { body: { competitorTiers: { tier1: [], tier2: [], tier3: ["Roche"] } } })).status).toBe(403);
    expect((await json(call(w.a.admin, "PATCH", "/api/settings", { body: { competitorTiers: { tier1: ["Pfizer"], tier2: [], tier3: ["Roche"] } } }))).competitorTiers.tier3).toEqual(["Roche"]);
    d = await json(call(w.a.client, "GET", "/api/competitors"));
    expect(d.competitors.find((c: { name: string }) => c.name === "Roche")?.tier).toBe(3);
  });
});
