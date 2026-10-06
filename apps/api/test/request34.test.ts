import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_MENU, MACRO_SECTIONS_COLUMNS, trendAnalysisMarkdown, visibleMenu } from "@eradigm/shared";
import { COMPLETE, call, json, seedWorld, type World } from "./helpers";

let w: World;
const R_AND_D = "AI Investment in R&D";
beforeAll(async () => {
  w = await seedWorld();
});

type Summary = { id: string; version: number; draft: Record<string, unknown> };
async function push(stream: "primary" | "secondary", values: Record<string, unknown>) {
  const { item } = (await json(call(w.a.analyst, "POST", "/api/submissions/manual", { body: { stream } }))) as { item: Summary };
  const r = await call(w.a.analyst, "POST", `/api/items/${item.id}/approve`, { body: { values: { ...item.draft, ...COMPLETE, ...values }, version: item.version } });
  expect(r.status, await r.clone().text()).toBe(200);
  return item.id;
}
const sections = async (who = w.a.client) => (await json(call(who, "GET", "/api/macrotrends/sections"))) as { macrotrend: string; section: string; text: string; updatedBy: string }[];

describe("request 34", () => {
  it("renames the menu: Databases (Signals Database, Phantoms Database, CI analyses), Megatrends Dashboard, and adds Analytics → Primary Tracker", () => {
    expect(visibleMenu(DEFAULT_MENU, "client").map((g) => `${g.key}:${g.items.map((i) => i.key).join(",")}`)).toEqual([
      "inputs:clientinbox",
      "analytics:dashboard,knowledge-graph,primary-tracker",
      "trackers:tracker,phantoms,trend-analyses",
    ]);
  });

  it("submits a Macrotrend's analysis by section: only the sections with text change, each kept in CI analyses", async () => {
    const first = await json(call(w.a.analyst, "POST", "/api/trend-analyses/macrotrend", { body: { macrotrend: "ai investment in r&d", sections: { overview: "What it is.", why: "Why it matters.", current: "   " } } }));
    expect(first).toMatchObject({ category: "macrotrend", level: "macro", name: R_AND_D, sections: { overview: "What it is.", why: "Why it matters." } });
    let s = await sections();
    expect(s.filter((x) => x.macrotrend === R_AND_D).map((x) => `${x.section}=${x.text}`).sort()).toEqual(["overview=What it is.", "why=Why it matters."]);
    // A second submission with one section changes only that one.
    await json(call(w.a.analyst, "POST", "/api/trend-analyses/macrotrend", { body: { macrotrend: R_AND_D, sections: { why: "It matters more now.", next: "Agents next." } } }));
    s = await sections();
    expect(s.filter((x) => x.macrotrend === R_AND_D).map((x) => `${x.section}=${x.text}`).sort()).toEqual(["next=Agents next.", "overview=What it is.", "why=It matters more now."]);
    // Its Markdown has a section per filled box.
    const md = await (await call(w.a.client, "GET", `/api/trend-analyses/${first.id}/markdown`)).text();
    expect(md).toContain("Name: AI Investment in R&D");
    expect(md).toContain("## Macrotrend overview\nWhat it is.\n\n## Why does it matter?\nWhy it matters.\n");
    expect(md).not.toContain("## Current Landscape");
    // Nothing filled in, an unknown Macrotrend, or a client: refused.
    expect((await call(w.a.analyst, "POST", "/api/trend-analyses/macrotrend", { body: { macrotrend: R_AND_D, sections: { overview: "  " } } })).status).toBe(400);
    expect((await call(w.a.analyst, "POST", "/api/trend-analyses/macrotrend", { body: { macrotrend: "Nope", sections: { overview: "x" } } })).status).toBe(400);
    expect((await call(w.a.client, "POST", "/api/trend-analyses/macrotrend", { body: { macrotrend: R_AND_D, sections: { overview: "x" } } })).status).toBe(403);
    expect(await json(call(w.b.analyst, "GET", "/api/macrotrends/sections"))).toEqual([]);
  });

  it("lets admins edit or clear a section in place (analysts and clients cannot)", async () => {
    expect((await call(w.a.analyst, "PUT", "/api/macrotrends/sections", { body: { macrotrend: R_AND_D, section: "abbvie", text: "x" } })).status).toBe(403);
    expect((await call(w.a.client, "PUT", "/api/macrotrends/sections", { body: { macrotrend: R_AND_D, section: "abbvie", text: "x" } })).status).toBe(403);
    const after = await json(call(w.a.admin, "PUT", "/api/macrotrends/sections", { body: { macrotrend: R_AND_D, section: "abbvie", text: "Direct impact." } }));
    expect(after.find((x: { section: string }) => x.section === "abbvie")).toMatchObject({ text: "Direct impact.", macrotrend: R_AND_D });
    const cleared = await json(call(w.a.admin, "PUT", "/api/macrotrends/sections", { body: { macrotrend: R_AND_D, section: "abbvie", text: "" } }));
    expect(cleared.some((x: { section: string }) => x.section === "abbvie")).toBe(false);
  });

  it("imports Macrotrend sections from a spreadsheet: Macrotrend required, empty cells change nothing", async () => {
    expect(MACRO_SECTIONS_COLUMNS).toEqual(["Macrotrend", "Macrotrend overview", "Why does it matter?", "Current Landscape", "Long-Term Landscape", "What's Next?", "Impact on AbbVie"]);
    const rows = [
      { row: 2, values: { Macrotrend: "Geopolitics", "Current Landscape": "Tariffs." } },
      { row: 3, values: { Macrotrend: "Nowhere", "Current Landscape": "x" } },
      { row: 4, values: { Macrotrend: "Geopolitics" } },
    ];
    const check = await json(call(w.a.analyst, "POST", "/api/trend-analyses/macrotrend/import", { body: { fileName: "m.xlsx", rows, dryRun: true } }));
    expect(check.ok).toBe(false);
    expect(check.errors.map((e: { row: number }) => e.row)).toEqual([3, 4]);
    const done = await json(call(w.a.analyst, "POST", "/api/trend-analyses/macrotrend/import", { body: { fileName: "m.xlsx", rows: [rows[0]] } }));
    expect(done).toEqual({ ok: true, imported: 1, errors: [] });
    expect((await sections()).find((x) => x.macrotrend === "Geopolitics" && x.section === "current")?.text).toBe("Tariffs.");
    const list = await json(call(w.a.analyst, "GET", "/api/trend-analyses"));
    expect(list[0]).toMatchObject({ name: "Geopolitics", source: "import", fileName: "m.xlsx", sections: { current: "Tariffs." } });
  });

  it("Archived Responses: the earlier Primary entries from the same source, newest first", async () => {
    const role = `Head of Access ${Date.now()}`;
    const old1 = await push("primary", { title: "First answer", date: "2026-01-10", source: "Primary Source", source_role: role, source_company: "Lyon CHU", key_details: "Early view." });
    const old2 = await push("primary", { title: "Second answer", date: "2026-04-10", source: "Primary Source", source_role: role, source_company: "lyon chu" });
    const now = await push("primary", { title: "Latest answer", date: "2026-08-10", source: "Primary Source", source_role: role, source_company: "Lyon CHU" });
    const a = await json(call(w.a.client, "GET", `/api/signals/${now}/archived`));
    expect(a.rows.map((r: { id: string }) => r.id)).toEqual([old2, old1]);
    expect(a.rows[1].values.key_details).toBe("Early view.");
    expect((await json(call(w.a.client, "GET", `/api/signals/${old1}/archived`))).rows).toEqual([]);
    expect((await json(call(w.b.analyst, "GET", `/api/signals/${now}/archived`))).rows).toEqual([]);
  });

  it("flags graph entries whose Phantom has a CI Perspective, and gives its text with the entry", async () => {
    const id = await push("secondary", { title: "With a perspective", ci_perspective: "Watch this closely.", macrotrend: "Geopolitics", subtrend: "IRA Pricing/Tariffs" });
    const without = await push("secondary", { title: "Without a perspective", macrotrend: "Geopolitics", subtrend: "IRA Pricing/Tariffs" });
    const m = await json(call(w.a.client, "GET", "/api/megatrends?stream=all"));
    const byId = new Map(m.entries.map((e: { id: string; ci?: boolean }) => [e.id, e.ci]));
    expect(byId.get(id)).toBe(true);
    expect(byId.get(without)).toBe(false);
    const c = await json(call(w.a.client, "GET", "/api/competitors?stream=all"));
    expect(c.entries.find((e: { id: string }) => e.id === id).ci).toBe(true);
    expect((await json(call(w.a.client, "GET", `/api/signals/${id}`))).ciPerspective).toBe("Watch this closely.");
    expect((await json(call(w.a.client, "GET", `/api/signals/${without}`))).ciPerspective).toBeNull();
  });

  it("writes a sections submission's Markdown with only its filled sections", () => {
    const md = trendAnalysisMarkdown({ level: "macro", name: "Geopolitics", parent: null, text: "", sections: { next: "Then.", overview: "Now." }, submittedAt: "2026-10-06T10:00:00Z", submittedBy: "Ana" });
    expect(md).toContain("---\n## Macrotrend overview\nNow.\n\n## What's Next?\nThen.\n");
  });
});
