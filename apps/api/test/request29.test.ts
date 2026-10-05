import { beforeAll, describe, expect, it } from "vitest";
import { TREND_ANALYSIS_COLUMNS as C, trendAnalysisFileName, trendAnalysisMarkdown } from "@eradigm/shared";
import { call, json, seedWorld, type World } from "./helpers";

let w: World;
const R_AND_D = "AI Investment in R&D";
const AGENTIC = "Agentic AI Platforms";

beforeAll(async () => {
  w = await seedWorld();
  // One Tracker entry naming Roche, so Roche is on the Competitors tab.
  const row = {
    row: 2,
    values: {
      ID: "R29-1",
      Title: "Roche entry",
      "Event Date": "2026-09-01",
      Macrotrend: R_AND_D,
      Subtrend: AGENTIC,
      "Growth Intensity": "Stable",
      Impact: "High",
      "Source Type": "PR",
      Competitors: "Roche",
      Action: "Not Actioned",
      Publisher: "Reuters",
      "Key Details": "Details",
    },
  };
  const r = await call(w.a.analyst, "POST", "/api/import?stream=secondary", { body: { fileName: "r29.xlsx", rows: [row] } });
  expect(r.status, await r.clone().text()).toBe(200);
});

const sub = async (who: string) => {
  const d = await json(call(who, "GET", "/api/megatrends?stream=all"));
  const m = d.macrotrends.find((x: { name: string }) => x.name === R_AND_D);
  return { macro: m.summary, sub: m.subtrends.find((s: { name: string }) => s.name === AGENTIC).summary };
};

describe("request 29: trend analyses", () => {
  it("submits an analysis from the Input page: it becomes the trend's analysis and is kept in Trend Analyses", async () => {
    const a = await json(
      call(w.a.analyst, "POST", "/api/trend-analyses", { body: { level: "sub", name: "agentic ai platforms", text: "Agents are moving into R&D workflows.\n\nSecond paragraph." } }),
    );
    // Spelt as the taxonomy spells it, with its Macrotrend worked out.
    expect(a).toMatchObject({ category: "macrotrend", level: "sub", name: AGENTIC, parent: R_AND_D, source: "form", fileName: null });
    expect((await sub(w.a.client)).sub).toMatchObject({ text: "Agents are moving into R&D workflows.\n\nSecond paragraph.", source: "manual" });
    const list = await json(call(w.a.client, "GET", "/api/trend-analyses"));
    expect(list[0]).toMatchObject({ id: a.id, name: AGENTIC, submittedBy: expect.any(String) });
    // Another workspace sees none of it.
    expect(await json(call(w.b.analyst, "GET", "/api/trend-analyses"))).toEqual([]);
    expect((await call(w.b.analyst, "GET", `/api/trend-analyses/${a.id}/markdown`)).status).toBe(404);
  });

  it("refuses clients, unknown trends and empty text", async () => {
    expect((await call(w.a.client, "POST", "/api/trend-analyses", { body: { level: "macro", name: R_AND_D, text: "x" } })).status).toBe(403);
    const bad = await call(w.a.analyst, "POST", "/api/trend-analyses", { body: { level: "macro", name: "Not a trend", text: "x" } });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: { message: string } }).error.message).toContain("no Macrotrend named");
    expect((await call(w.a.analyst, "POST", "/api/trend-analyses", { body: { level: "competitor", name: "N/A", text: "x" } })).status).toBe(400);
    expect((await call(w.a.analyst, "POST", "/api/trend-analyses", { body: { level: "macro", name: R_AND_D, text: "   " } })).status).toBe(422);
  });

  it("writes each submission as Markdown: one row per column and the date of submission", async () => {
    const a = await json(call(w.a.analyst, "POST", "/api/trend-analyses", { body: { level: "competitor", name: "roche", text: "Roche: doubling down on AI." } }));
    expect(a).toMatchObject({ category: "competitor", level: "competitor", name: "Roche" });
    const res = await call(w.a.client, "GET", `/api/trend-analyses/${a.id}/markdown?download=1`);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    const day = a.submittedAt.slice(0, 10);
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename="Trend_analysis_Competitor_Roche_${day}.md"`);
    const md = await res.text();
    expect(md).toContain("Macrotrend_or_Competitor: Competitor\nCompetitor_Macrotrend_or_Subtrend: Competitor\nName: Roche\n");
    expect(md).toContain(`Date_of_submission: ${day}\n`);
    expect(md).toContain("## Trend analysis\nRoche: doubling down on AI.\n");
    const comps = await json(call(w.a.client, "GET", "/api/competitors?stream=all"));
    expect(comps.competitors.find((c: { name: string }) => c.name === "Roche").summary).toMatchObject({ text: "Roche: doubling down on AI.", source: "manual" });
  });

  it("imports a spreadsheet: checks every row first, then saves them (later rows win)", async () => {
    const rows = [
      { row: 2, values: { [C.category]: "Macrotrend", [C.level]: "Macrotrend", [C.name]: R_AND_D, [C.text]: "First." } },
      { row: 3, values: { [C.category]: "macrotrends", [C.level]: "subtrend", [C.name]: AGENTIC, [C.text]: "Sub from sheet." } },
      { row: 4, values: { [C.category]: "Macrotrend", [C.level]: "Macrotrend", [C.name]: R_AND_D, [C.text]: "Second." } },
    ];
    const bad = [
      { row: 5, values: { [C.category]: "Competitor", [C.level]: "Subtrend", [C.name]: "Roche", [C.text]: "x" } },
      { row: 6, values: { [C.category]: "Trend", [C.level]: "Macrotrend", [C.name]: "Nope", [C.text]: "" } },
    ];
    const check = await json(call(w.a.analyst, "POST", "/api/trend-analyses/import", { body: { fileName: "ta.xlsx", rows: [...rows, ...bad], dryRun: true } }));
    expect(check.ok).toBe(false);
    expect(check.errors.map((e: { row: number; column: string }) => `${e.row}:${e.column}`)).toEqual([`5:${C.level}`, `6:${C.category}`, `6:${C.text}`, `6:${C.name}`]);
    // A failing batch writes nothing.
    const before = (await json(call(w.a.analyst, "GET", "/api/trend-analyses"))).length;
    expect((await json(call(w.a.analyst, "POST", "/api/trend-analyses/import", { body: { fileName: "ta.xlsx", rows: [rows[0], bad[0]] } }))).imported).toBe(0);
    expect((await json(call(w.a.analyst, "GET", "/api/trend-analyses"))).length).toBe(before);
    // More than 8 rows only as a dry run.
    const many = Array.from({ length: 9 }, (_, i) => ({ ...rows[0]!, row: i + 2 }));
    expect((await call(w.a.analyst, "POST", "/api/trend-analyses/import", { body: { fileName: "ta.xlsx", rows: many } })).status).toBe(400);
    const done = await json(call(w.a.analyst, "POST", "/api/trend-analyses/import", { body: { fileName: "ta.xlsx", rows } }));
    expect(done).toEqual({ ok: true, imported: 3, errors: [] });
    const s = await sub(w.a.analyst);
    expect(s.macro.text).toBe("Second.");
    expect(s.sub.text).toBe("Sub from sheet.");
    const list = await json(call(w.a.analyst, "GET", "/api/trend-analyses"));
    expect(list.length).toBe(before + 3);
    expect(list.filter((a: { source: string }) => a.source === "import").every((a: { fileName: string }) => a.fileName === "ta.xlsx")).toBe(true);
    expect((await call(w.a.client, "POST", "/api/trend-analyses/import", { body: { fileName: "ta.xlsx", rows, dryRun: true } })).status).toBe(403);
  });

  it("removes a submission from the tracker, keeping the trend's analysis", async () => {
    const a = await json(call(w.a.analyst, "POST", "/api/trend-analyses", { body: { level: "macro", name: R_AND_D, text: "Kept." } }));
    expect((await call(w.a.client, "DELETE", `/api/trend-analyses/${a.id}`)).status).toBe(403);
    expect((await call(w.a.analyst, "DELETE", `/api/trend-analyses/${a.id}`)).status).toBe(200);
    expect((await json(call(w.a.analyst, "GET", "/api/trend-analyses"))).some((x: { id: string }) => x.id === a.id)).toBe(false);
    expect((await sub(w.a.analyst)).macro.text).toBe("Kept.");
    expect((await call(w.a.analyst, "DELETE", `/api/trend-analyses/${a.id}`)).status).toBe(404);
  });

  it("names Markdown files safely and keeps a Subtrend's Macrotrend", () => {
    const doc = { level: "sub" as const, name: "R&D: next/steps", parent: R_AND_D, text: "  Text  ", submittedAt: "2026-10-05T09:00:00.000Z", submittedBy: "Ana" };
    expect(trendAnalysisFileName(doc)).toBe("Trend_analysis_Subtrend_R_D_next_steps_2026-10-05.md");
    expect(trendAnalysisMarkdown(doc)).toBe(
      `---\nMacrotrend_or_Competitor: Macrotrend\nCompetitor_Macrotrend_or_Subtrend: Subtrend\nName: "R&D: next/steps"\nMacrotrend: ${R_AND_D}\nDate_of_submission: 2026-10-05\nSubmitted_by: Ana\n---\n## Trend analysis\nText\n`,
    );
  });
});
