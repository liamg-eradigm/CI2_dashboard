import { beforeAll, describe, expect, it } from "vitest";
import { approveWith, call, json, seedWorld, type World } from "./helpers";

let w: World;
beforeAll(async () => {
  w = await seedWorld();
});

const RANGE = "from=2000-01-01&to=2100-01-01&pageSize=100";

/** A manual entry, approved with these values; returns its signal id. */
async function entry(stream: "primary" | "secondary", title: string, impact: string) {
  const { item } = await json(call(w.a.analyst, "POST", "/api/submissions/manual", { body: { stream } }));
  const res = await approveWith(w.a.analyst, item, { title, impact });
  expect(res.status).toBe(200);
  return item.id as string;
}

type Row = { id: string; code: string; alertId?: string | null; values: Record<string, unknown> };
const rows = async (path: string, stream: string, who = w.a.client) => (await json(call(who, "GET", `${path}?stream=${stream}&${RANGE}`))).rows as Row[];
/** The .docx is stored uncompressed, so its XML can be read from the bytes. */
const docxText = async (res: Response) => new TextDecoder().decode(new Uint8Array(await res.arrayBuffer()));

describe("Deliverables → Alerts", () => {
  let high: string, medium: string, secHigh: string, secLow: string;
  beforeAll(async () => {
    high = await entry("primary", "Roche launches an AI lab & <pilot>", "High");
    medium = await entry("primary", "Novartis hires an AI lead", "Medium");
    secHigh = await entry("secondary", "Pfizer buys an AI biotech", "High");
    secLow = await entry("secondary", "Sanofi posts an AI job", "Low");
  });

  it("lists the High Impact Phantoms of either stream, each with an automatically stored .docx alert", async () => {
    const p = await rows("/api/deliverables/alerts", "primary");
    expect(p.map((r) => r.id)).toContain(high);
    expect(p.map((r) => r.id)).not.toContain(medium);
    const s = await rows("/api/deliverables/alerts", "secondary");
    expect(s.map((r) => r.id)).toContain(secHigh);
    expect(s.map((r) => r.id)).not.toContain(secLow);
    const row = p.find((r) => r.id === high)!;
    expect(row.alertId).toMatch(/^dlv_/);
    // Stored once: listing again returns the same alert.
    const again = (await rows("/api/deliverables/alerts", "primary")).find((r) => r.id === high)!;
    expect(again.alertId).toBe(row.alertId);

    const res = await call(w.a.client, "GET", `/api/deliverables/${row.alertId}/docx`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(res.headers.get("content-disposition")).toMatch(/^inline; filename="T-[\w-]+-alert\.docx"$/);
    const xml = await docxText(res);
    expect(xml).toContain("word/document.xml");
    // The Title, bold, 32 pt (w:sz is in half-points), XML-escaped.
    expect(xml).toContain('<w:b/><w:bCs/><w:sz w:val="64"/><w:szCs w:val="64"/></w:rPr><w:t xml:space="preserve">Roche launches an AI lab &amp; &lt;pilot&gt;</w:t>');
    const dl = await call(w.a.client, "GET", `/api/deliverables/${row.alertId}/docx?download=1`);
    expect(dl.headers.get("content-disposition")).toMatch(/^attachment; /);
    expect((await call(w.b.admin, "GET", `/api/deliverables/${row.alertId}/docx`)).status).toBe(404);
  });

  it("keeps the alert as first pushed when the Tracker entry is edited, and leaves out entries deleted from Phantoms", async () => {
    const before = (await rows("/api/deliverables/alerts", "primary")).find((r) => r.id === high)!;
    const sig = await json(call(w.a.analyst, "GET", `/api/signals/${high}`));
    const rev = await call(w.a.analyst, "POST", `/api/signals/${high}/revise`, { body: { values: { ...sig.values, title: "Roche expands its AI lab" }, note: "Retitled" } });
    expect(rev.status).toBe(200);
    const after = (await rows("/api/deliverables/alerts", "primary")).find((r) => r.id === high)!;
    expect(after.alertId).toBe(before.alertId);
    // Phantoms (and their alerts) are an evergreen snapshot.
    const text = await docxText(await call(w.a.client, "GET", `/api/deliverables/${after.alertId}/docx`));
    expect(text).toContain("Roche launches an AI lab &amp; &lt;pilot&gt;");
    expect(text).not.toContain("Roche expands its AI lab");

    await call(w.a.analyst, "DELETE", `/api/items/${secHigh}`, { body: { from: "phantoms" } });
    expect((await rows("/api/deliverables/alerts", "secondary")).map((r) => r.id)).not.toContain(secHigh);
  });

  it("exports with the Phantoms columns", async () => {
    const csv = await (await call(w.a.analyst, "GET", `/api/tracker/export?stream=primary&format=csv&scope=all&view=alerts`)).text();
    const [head, ...lines] = csv.replace(/^\uFEFF/, "").split("\r\n");
    expect(head?.startsWith("Signal ID,ID,Title,Event Date,Source Role,")).toBe(true);
    expect(lines.join("\n")).toContain("Roche launches an AI lab & <pilot>");
    expect(lines.join("\n")).not.toContain("Roche expands its AI lab");
    expect(lines.join("\n")).not.toContain("Novartis hires an AI lead");
  });
});

describe("Deliverables → Newsletter", () => {
  let high: string, medium: string, low: string, secMedium: string;
  beforeAll(async () => {
    high = await entry("primary", "Newsletter high", "High");
    medium = await entry("primary", "Newsletter medium", "Medium");
    low = await entry("primary", "Newsletter low", "Low");
    secMedium = await entry("secondary", "Newsletter secondary medium", "Medium");
  });
  const create = (body: unknown, who = w.a.analyst) => call(who, "POST", "/api/newsletters", { body });

  it("lists the High and Medium Impact Phantoms", async () => {
    const p = (await rows("/api/deliverables/newsletter", "primary")).map((r) => r.id);
    expect(p).toEqual(expect.arrayContaining([high, medium]));
    expect(p).not.toContain(low);
    expect((await rows("/api/deliverables/newsletter", "secondary")).map((r) => r.id)).toContain(secMedium);
  });

  it("creates a named newsletter .docx from selected entries (both streams), listed newest first", async () => {
    expect((await create({ name: "Q3 briefing", itemIds: [high] }, w.a.client)).status).toBe(403);
    expect((await create({ name: "  ", itemIds: [high] })).status).toBe(422);
    expect((await create({ name: "Empty", itemIds: [] })).status).toBe(422);
    const bad = await create({ name: "With a Low entry", itemIds: [high, low] });
    expect(bad.status).toBe(422);
    expect((await json(bad)).error.message).toMatch(/is not a Newsletter entry/);

    const res = await create({ name: "  Q3 AI briefing  ", itemIds: [secMedium, high, medium, high] });
    expect(res.status).toBe(201);
    const n = await json(res);
    expect(n).toMatchObject({ name: "Q3 AI briefing", createdBy: "A Analyst" });
    expect(n.items.map((i: { id: string }) => i.id)).toEqual([secMedium, high, medium]);
    expect(n.items[0]).toMatchObject({ stream: "secondary", title: "Newsletter secondary medium", deleted: false });

    await create({ name: "Second issue", itemIds: [medium] });
    const list = await json(call(w.a.client, "GET", "/api/newsletters"));
    expect(list.map((x: { name: string }) => x.name).slice(0, 2)).toEqual(["Second issue", "Q3 AI briefing"]);
    expect(await json(call(w.b.admin, "GET", "/api/newsletters"))).toEqual([]);

    const doc = await call(w.a.client, "GET", `/api/deliverables/${n.id}/docx?download=1`);
    expect(doc.headers.get("content-disposition")).toBe('attachment; filename="Q3-AI-briefing.docx"');
    expect(await docxText(doc)).toContain('<w:sz w:val="64"/><w:szCs w:val="64"/></w:rPr><w:t xml:space="preserve">Q3 AI briefing</w:t>');

    // A later global delete keeps the entry listed, marked deleted.
    await call(w.a.analyst, "DELETE", `/api/items/${medium}`);
    const q3 = (await json(call(w.a.client, "GET", "/api/newsletters"))).find((x: { id: string }) => x.id === n.id);
    expect(q3.items.find((i: { id: string }) => i.id === medium).deleted).toBe(true);
  });
});
