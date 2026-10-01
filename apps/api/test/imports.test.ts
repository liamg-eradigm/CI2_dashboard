import { beforeAll, describe, expect, it } from "vitest";
import { articleHtml, call, env, json, seedWorld, type World } from "./helpers";

let w: World;
beforeAll(async () => {
  w = await seedWorld();
});

const RANGE = "from=2000-01-01&to=2100-01-01&pageSize=100";
let n = 0;
const rid = (p: string) => `${p}-IMP-${Date.now().toString(36)}-${++n}`;

/** A Primary spreadsheet row keyed by the Primary Tracker's column labels. */
const primaryRow = (row: number, over: Record<string, string> = {}) => ({
  row,
  values: {
    ID: rid("P"),
    Title: `Imported primary ${row}`,
    "Event Date": "45924", // Excel serial for 2025-09-24
    "Source Role": "Oncology KOL",
    "Source Company": "University Hospital",
    Macrotrend: "AI Investment in R&D",
    Subtrend: "Agentic AI Platforms",
    "Growth Intensity": "Stable",
    Impact: "Low",
    "Source Type": "Primary Source",
    Competitors: "Roche, Pfizer",
    Action: "Not Actioned",
    "Key Details": "From an interview.",
    ...over,
  },
});
const secondaryRow = (row: number, over: Record<string, string> = {}) => ({
  row,
  values: {
    ID: rid("S"),
    Macrotrend: "Portfolio Restructuring",
    Subtrend: "Mergers & Acquisitions",
    Title: `Imported secondary ${row}`,
    "Event Date": "24/09/2025",
    Impact: "Medium",
    "Growth Intensity": "Slight Increase",
    "Source Type": "PR",
    Publisher: "Sanofi",
    URL: `https://news.example.com/imported-${row}-${n}`,
    Competitors: "Sanofi",
    Action: "Actioned",
    Header: "Sanofi buys a biotech.",
    ...over,
  },
});

const importRows = (stream: string, rows: unknown[], dryRun = false, who = w.a.analyst) =>
  call(who, "POST", `/api/import?stream=${stream}`, { body: { fileName: "legacy.xlsx", rows, dryRun } });

describe("spreadsheet import", () => {
  it("imports Primary rows straight into the Primary Tracker and Phantoms, converting dates and competitors", async () => {
    const rows = [primaryRow(2), primaryRow(3, { Impact: "High" })];
    const dry = await json(importRows("primary", rows, true));
    expect(dry).toMatchObject({ ok: true, imported: 0, errors: [] });
    const res = await json(importRows("primary", rows));
    expect(res).toMatchObject({ ok: true, imported: 2 });
    expect(res.codes).toHaveLength(2);
    const t = await json(call(w.a.client, "GET", `/api/tracker?stream=primary&${RANGE}`));
    const row = t.rows.find((r: any) => r.code === res.codes[0]);
    expect(row).toMatchObject({ stream: "primary", hasSnapshot: false });
    expect(row.values).toMatchObject({ date: "2025-09-24", competitors: ["Pfizer", "Roche"], macrotrend: "AI Investment in R&D" });
    // Every Primary entry is in Primary Phantoms (Impact does not matter), with the Primary Markdown.
    const ph = await json(call(w.a.client, "GET", `/api/phantoms?stream=primary&${RANGE}`));
    expect(ph.rows.map((r: any) => r.code)).toEqual(expect.arrayContaining(res.codes));
    const md = await (await call(w.a.client, "GET", `/api/signals/${row.id}/markdown`)).text();
    expect(md).toContain(`id: ${rows[0]!.values.ID}\ntitle: Imported primary 2\nevent_date: 2025-09-24\nSource:\n  Role: Oncology KOL\n  Company: University Hospital\n`);
    expect(md).toContain("## Key Details\nFrom an interview.");
    const ev = await env.DB.prepare("SELECT details_json FROM audit_events WHERE action = 'import.completed' ORDER BY seq DESC LIMIT 1").first<{ details_json: string }>();
    expect(JSON.parse(ev!.details_json)).toMatchObject({ stream: "primary", rows: 2 });
  });

  it("imports Secondary rows; they reach Phantoms at or above the admin-set Impact, and Source Tier is automatic", async () => {
    const rows = [secondaryRow(2), secondaryRow(3, { Impact: "Low" }), secondaryRow(4, { "Source Tier": "Primary" })];
    const res = await json(importRows("secondary", rows));
    expect(res.imported).toBe(3);
    const ph = (await json(call(w.a.client, "GET", `/api/phantoms?stream=secondary&${RANGE}`))).rows.map((r: any) => r.code);
    // Default minimum Low: every Secondary row is a Phantom; at Medium the Low one is not.
    expect(ph).toContain(res.codes[0]);
    expect(ph).toContain(res.codes[1]);
    await call(w.a.admin, "PATCH", "/api/settings", { body: { phantoms: { secondaryMinImpact: "Medium" } } });
    const ph2 = (await json(call(w.a.client, "GET", `/api/phantoms?stream=secondary&${RANGE}`))).rows.map((r: any) => r.code);
    expect(ph2).toContain(res.codes[0]);
    expect(ph2).not.toContain(res.codes[1]);
    await call(w.a.admin, "PATCH", "/api/settings", { body: { phantoms: { secondaryMinImpact: "Low" } } });
    const t = await json(call(w.a.client, "GET", `/api/tracker?stream=secondary&${RANGE}`));
    const third = t.rows.find((r: any) => r.code === res.codes[2]);
    expect(third.values.date).toBe("2025-09-24");
    const md = await (await call(w.a.client, "GET", `/api/signals/${third.id}/markdown`)).text();
    expect(md).toContain("Source_tier: Reviewed-Secondary");
    expect(md).toContain("  Reviewed_by: A Analyst");
    expect(md).toMatch(/ {2}Review_date: \d{4}-\d{2}-\d{2}/);
    // Not in the Primary Tracker.
    expect((await json(call(w.a.client, "GET", `/api/tracker?stream=primary&${RANGE}`))).rows.map((r: any) => r.code)).not.toContain(res.codes[0]);
  });

  it("matches dropdown values whatever their capitals, spacing, quotes or dashes", async () => {
    const r = await json(
      importRows("primary", [primaryRow(2, { Macrotrend: "ai investment in r&d", Subtrend: "  agentic   ai platforms ", Impact: "high", "Source Type": "primary source", Competitors: "roche; PFIZER", Action: "not actioned" })]),
    );
    expect(r).toMatchObject({ ok: true, imported: 1 });
    const t = await json(call(w.a.client, "GET", `/api/tracker?stream=primary&${RANGE}`));
    const row = t.rows.find((x: any) => x.code === r.codes[0]);
    expect(row.values).toMatchObject({ macrotrend: "AI Investment in R&D", subtrend: "Agentic AI Platforms", impact: "High", source: "Primary Source", competitors: ["Pfizer", "Roche"], action: "Not Actioned" });
  });

  it("explains option problems with the allowed values, and uses options added since (no new upload needed)", async () => {
    const row = primaryRow(2, { "Source Type": "Analyst Call", Competitors: "Roche, Moderna" });
    const first = await json(importRows("primary", [row], true));
    expect(first.ok).toBe(false);
    const src = first.errors.find((e: any) => e.column === "Source Type");
    expect(src.message).toMatch(/^“Analyst Call” is not a Primary Source Type option\. Options: .*PR.*\. Add or rename options under Inbox → Edit columns \(Primary Inbox\), then check again\.$/);
    expect(first.errors.find((e: any) => e.column === "Competitors").message).toMatch(/^“Moderna” is not a Primary Competitors option\. Options: /);

    // Added to the Secondary Inbox only: the message says so.
    await call(w.a.analyst, "POST", "/api/schema/columns/source/options?stream=secondary", { body: { value: "Analyst Call" } });
    const second = await json(importRows("primary", [row], true));
    expect(second.errors.find((e: any) => e.column === "Source Type").message).toContain("“Analyst Call” is a Secondary option: did you mean to import into the Secondary Tracker?");

    // Added to the Primary Inbox: the same rows now pass.
    await call(w.a.analyst, "POST", "/api/schema/columns/source/options?stream=primary", { body: { value: "Analyst Call" } });
    await call(w.a.analyst, "POST", "/api/schema/columns/competitors/options?stream=primary", { body: { value: "Moderna" } });
    expect(await json(importRows("primary", [row], true))).toMatchObject({ ok: true, errors: [] });
  });

  it("says which macrotrend a subtrend belongs to", async () => {
    const r = await json(importRows("primary", [primaryRow(2, { Macrotrend: "Portfolio Restructuring", Subtrend: "Agentic AI Platforms" })], true));
    expect(r.errors[0].message).toMatch(/^“Agentic AI Platforms” belongs to the Macrotrend “AI Investment in R&D”, not “Portfolio Restructuring”\. Subtrends of “Portfolio Restructuring”: /);
  });

  it("writes nothing when any row is invalid, and explains every problem by row and column", async () => {
    const before = (await json(call(w.a.client, "GET", `/api/tracker?stream=primary&${RANGE}`))).total;
    const bad = [
      primaryRow(2),
      primaryRow(3, { Macrotrend: "Not a macrotrend" }),
      primaryRow(4, { Title: "" }),
      { row: 5, values: { ...primaryRow(5).values, Colour: "blue" } },
    ];
    const r = await json(importRows("primary", bad));
    expect(r.ok).toBe(false);
    expect(r.imported).toBe(0);
    const where = r.errors.map((e: any) => `${e.row}:${e.column}`);
    expect(where).toEqual(expect.arrayContaining(["3:Macrotrend", "4:Title", "1:Colour"]));
    expect((await json(call(w.a.client, "GET", `/api/tracker?stream=primary&${RANGE}`))).total).toBe(before);
  });

  it("rejects IDs used twice in the file or already in the tracker", async () => {
    const id = rid("P");
    expect((await json(importRows("primary", [primaryRow(2, { ID: id })]))).ok).toBe(true);
    const again = await json(importRows("primary", [primaryRow(2, { ID: id })], true));
    expect(again.errors[0].message).toContain(`“${id}” is already used by SIG-`);
    const twice = await json(importRows("primary", [primaryRow(2, { ID: "SAME-1" }), primaryRow(3, { ID: "same-1" })], true));
    expect(twice.errors[0]).toMatchObject({ row: 3, column: "ID" });
  });

  it("is for analysts and admins only, in small batches", async () => {
    expect((await importRows("primary", [primaryRow(2)], true, w.a.client)).status).toBe(403);
    const many = Array.from({ length: 9 }, (_, i) => primaryRow(i + 2));
    expect((await importRows("primary", many)).status).toBe(400);
    expect((await json(importRows("primary", many, true))).ok).toBe(true);
  });
});

describe("attaching the saved page to a tracker entry", () => {
  it("adds the HTML to an imported row once; clients cannot attach", async () => {
    const res = await json(importRows("secondary", [secondaryRow(2)]));
    const t = await json(call(w.a.client, "GET", `/api/tracker?stream=secondary&${RANGE}`));
    const row = t.rows.find((r: any) => r.code === res.codes[0]);
    expect(row.hasSnapshot).toBe(false);
    const form = () => {
      const f = new FormData();
      f.append("file", new File([articleHtml({ title: "Sanofi buys a biotech", body: "Sanofi agreed to buy a biotech for $2bn, the company said.\nThe deal closes in 2027." })], "sanofi.html", { type: "text/html" }));
      return f;
    };
    expect((await call(w.a.client, "POST", `/api/items/${row.id}/snapshot`, { form: form() })).status).toBe(403);
    const up = await call(w.a.analyst, "POST", `/api/items/${row.id}/snapshot`, { form: form() });
    expect(up.status).toBe(200);
    expect(await up.json()).toMatchObject({ id: row.id, hasSnapshot: true });
    const after = (await json(call(w.a.client, "GET", `/api/tracker?stream=secondary&${RANGE}`))).rows.find((r: any) => r.id === row.id);
    expect(after.hasSnapshot).toBe(true);
    // The page is sanitised (scripts removed) and clients can read it.
    const html = await (await call(w.a.client, "GET", `/api/items/${row.id}/snapshot`)).text();
    expect(html).toContain("Sanofi agreed to buy a biotech");
    expect(html).not.toContain("evil()");
    // A second page cannot replace it; non-HTML files are refused.
    expect((await call(w.a.analyst, "POST", `/api/items/${row.id}/snapshot`, { form: form() })).status).toBe(409);
    const txt = new FormData();
    txt.append("file", new File(["hello"], "notes.txt", { type: "text/plain" }));
    const other = await json(importRows("secondary", [secondaryRow(3)]));
    const otherRow = (await json(call(w.a.client, "GET", `/api/tracker?stream=secondary&${RANGE}`))).rows.find((r: any) => r.code === other.codes[0]);
    expect((await call(w.a.analyst, "POST", `/api/items/${otherRow.id}/snapshot`, { form: txt })).status).toBe(415);
  });
});
