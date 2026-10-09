import { beforeAll, describe, expect, it } from "vitest";
import { approveWith, call, json, seedWorld, type World } from "./helpers";

let w: World;
beforeAll(async () => {
  w = await seedWorld();
});

const RANGE = "from=2000-01-01&to=2100-01-01&pageSize=100";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

async function entry(stream: "primary" | "secondary", values: Record<string, unknown>) {
  const { item } = await json(call(w.a.analyst, "POST", "/api/submissions/manual", { body: { stream } }));
  const res = await approveWith(w.a.analyst, item, values);
  expect(res.status, await res.clone().text()).toBe(200);
  return item.id as string;
}
type Row = { id: string; alertId?: string | null };
const database = async (q: string) => json<{ rows: Row[] }>(call(w.a.client, "GET", `/api/database?${RANGE}&${q}`));

/** A part of a .docx (stored uncompressed): its text. */
async function part(res: Response, name: string): Promise<string> {
  const bytes = new Uint8Array(await res.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const dec = new TextDecoder();
  for (let i = 0; i + 30 < bytes.length; i++) {
    if (view.getUint32(i, true) !== 0x04034b50) continue;
    const size = view.getUint32(i + 18, true);
    const nameLen = view.getUint16(i + 26, true);
    const extra = view.getUint16(i + 28, true);
    const n = dec.decode(bytes.subarray(i + 30, i + 30 + nameLen));
    if (n === name) return dec.decode(bytes.subarray(i + 30 + nameLen + extra, i + 30 + nameLen + extra + size));
    i += 29 + nameLen + extra + size;
  }
  throw new Error(`${name} is not in the document`);
}
/** The words of a document part (its runs' text, in order). */
const words = (xml: string) =>
  [...xml.matchAll(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>/g)]
    .map((m) => m[1])
    .join("")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

describe("request 51: alerts and newsletters from the Word templates", () => {
  it("every entry has an alert, written into the alert template from its fields (N/A when missing)", async () => {
    const tag = Math.random().toString(36).slice(2, 8);
    const id = await entry("secondary", {
      title: `Pfizer & partners ${tag}`,
      competitors: ["Pfizer", "Roche"],
      impact: "Low",
      assets: "Ibrance",
      review_date: "2026-09-03",
      publisher: `Reuters ${tag}`,
      url: "https://www.reuters.com/pfizer?a=1&b=2",
      key_details: "Pfizer signed a **five-year** deal.\n- 300 staff\n  - Paris hub",
      ci_perspective: "Raises the bar for peers.",
    });
    const row = (await database(`stream=secondary&t.publisher=${tag}`)).rows.find((r) => r.id === id)!;
    // Low Impact too: every entry.
    expect(row.alertId).toMatch(/^dlv_/);
    const res = () => call(w.a.client, "GET", `/api/deliverables/${row.alertId}/docx`);
    const doc = await part(await res(), "word/document.xml");
    const text = words(doc);
    expect(text).toContain(`Pfizer & partners ${tag}`);
    expect(text).toContain("Company: Pfizer, Roche");
    expect(text).toContain("Drug: Ibrance");
    expect(text).toContain("Date: September 3, 2026");
    expect(text).toContain(`Source(s): Reuters ${tag}`);
    expect(text).toContain("Impact (CI PoV): Low");
    expect(text).toContain("Raises the bar for peers.");
    // No placeholder is left; Tell Me More is missing: N/A.
    expect(text).not.toMatch(/<Insert/);
    expect(text).toContain("Tell me more:N/A");
    // Key Details keeps its structure: a paragraph, then bullets at two levels, bold kept.
    expect(doc).toMatch(/<w:b\/><w:bCs\/>[^]*?<w:t xml:space="preserve">five-year<\/w:t>/);
    expect(doc).toMatch(/<w:ilvl w:val="0"\/><w:numId w:val="\d+"\/><\/w:numPr>[^]*?300 staff/);
    expect(doc).toMatch(/<w:ilvl w:val="1"\/><w:numId w:val="\d+"\/><\/w:numPr>[^]*?Paris hub/);
    // The publisher links to the URL.
    const rels = await part(await res(), "word/_rels/document.xml.rels");
    expect(rels).toContain('Target="https://www.reuters.com/pfizer?a=1&amp;b=2" TargetMode="External"');
    expect(doc).toMatch(/<w:hyperlink r:id="rIdEci\d+"[^>]*>[^]*?Reuters/);
    // An entry with almost nothing: N/A everywhere it is missing.
    const bare = await entry("primary", { title: `Bare ${tag}`, impact: "Low", source_company: `Co ${tag}` });
    const bareRow = (await database(`stream=primary&t.source_company=${tag}`)).rows.find((r) => r.id === bare)!;
    const bareText = words(await part(await call(w.a.client, "GET", `/api/deliverables/${bareRow.alertId}/docx`), "word/document.xml"));
    expect(bareText).toContain("Drug: N/A");
    expect(bareText).toContain("Date: N/A");
    expect(bareText).toContain("Source(s): N/A");
    expect(bareText).toContain("What happened:N/A");
  });

  it("Generate Newsletter puts each entry in its section (Technology, People, Process) of the newsletter template", async () => {
    const tag = Math.random().toString(36).slice(2, 8);
    const a = await entry("secondary", { title: `Tech one ${tag}`, impact: "Low", publisher: `Pub ${tag}`, date: "2026-09-01", macrotrend: "Geopolitics", subtrend: "IRA Pricing/Tariffs", ci_perspective: "Watch it.", key_details: "- First\n- Second" });
    const b = await entry("secondary", { title: `People one ${tag}`, impact: "Low", publisher: `Pub ${tag}`, date: "2026-10-22" });
    const c = await entry("secondary", { title: `Tech two ${tag}`, impact: "Low", publisher: `Pub ${tag}`, date: "2026-08-03" });
    // Every entry needs a section.
    expect((await call(w.a.analyst, "POST", "/api/newsletters/generate", { body: { itemIds: [a, b], sections: { [a]: "technology" } } })).status).toBe(422);
    expect((await call(w.a.analyst, "POST", "/api/newsletters/generate", { body: { itemIds: [a], sections: { [a]: "science" } } })).status).toBe(422);
    const n = await json(call(w.a.analyst, "POST", "/api/newsletters/generate", { body: { itemIds: [a, b, c], sections: { [a]: "technology", [b]: "people", [c]: "technology" } } }));
    const text = words(await part(await call(w.a.client, "GET", `/api/deliverables/${n.id}/docx`), "word/document.xml"));
    const now = new Date();
    expect(text).toContain(`Welcome to the ${MONTHS[now.getUTCMonth()]} edition`);
    expect(text).not.toMatch(/<Month>|<Alert Title>|<Insert/);
    // Technology holds both of its entries, one after the other, before People; Process has none.
    const at = (s: string, from = 0) => text.indexOf(s, from);
    const sections = at("Technology", at("EXECUTIVE SUMMARY") + 40);
    expect(at(`Tech one ${tag} (Pub ${tag}; September 1st, 2026)`)).toBeGreaterThan(-1);
    expect(at(`Tech two ${tag} (Pub ${tag}; August 3rd, 2026)`)).toBeGreaterThan(at(`Tech one ${tag} (`));
    expect(at(`People one ${tag} (Pub ${tag}; October 22nd, 2026)`)).toBeGreaterThan(at(`Tech two ${tag} (`));
    expect(at(`Tech one ${tag} (`)).toBeGreaterThan(sections);
    expect(text).toContain("Trend(s) to watch: Geopolitics (IRA Pricing/Tariffs)");
    expect(text).toContain("CI Perspective – Watch it.");
    expect(text).toContain("Key Details:FirstSecond");
    // Missing fields: N/A.
    expect(text).toContain("CI Perspective – N/A");
    // The Executive Summary lists each section's titles.
    const summary = text.slice(at("EXECUTIVE SUMMARY"), sections);
    expect(summary).toContain(`Tech one ${tag}Tech two ${tag}`);
    expect(summary).toContain(`People one ${tag}`);
    expect(summary).toMatch(/Process\s*N\/A/);
    // The template's review comments are not carried over.
    const comments = await part(await call(w.a.client, "GET", `/api/deliverables/${n.id}/docx`), "word/comments.xml");
    expect(comments).not.toContain("British spellings");
  });
});
