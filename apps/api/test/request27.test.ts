import { beforeAll, describe, expect, it } from "vitest";
import { PRIOR_PRIMARY_TEXT, primarySourceKey } from "@eradigm/shared";
import { COMPLETE, articleHtml, call, drain, json, seedWorld, upload, type World } from "./helpers";

let w: World;
beforeAll(async () => {
  w = await seedWorld();
});

const RANGE = "from=2000-01-01&to=2100-01-01&pageSize=200";
type Summary = { id: string; version: number; status: string; draft: Record<string, unknown>; duplicateOf: string | null };
type Row = { id: string; code: string; linkedEarlier?: string | null; linkedLater?: string | null };

const manual = async () => (await json(call(w.a.analyst, "POST", "/api/submissions/manual", { body: { stream: "primary" } }))).item as Summary;
/** A Primary entry typed in and pushed to the Tracker. */
async function pushPrimary(title: string, date: string, role: string, company: string) {
  const item = await manual();
  const r = await call(w.a.analyst, "POST", `/api/items/${item.id}/approve`, {
    body: { values: { ...item.draft, ...COMPLETE, title, date, source: "Primary Source", source_role: role, source_company: company }, version: item.version },
  });
  expect(r.status, await r.clone().text()).toBe(200);
  return (await r.json()) as Summary;
}
const rowsOf = async (path: string) => (await json(call(w.a.client, "GET", `${path}?stream=primary&${RANGE}`))).rows as Row[];

describe("request 27: Primary sources", () => {
  it("keys a source by Source Role and Source Company, ignoring case and spacing", () => {
    expect(PRIOR_PRIMARY_TEXT).toBe("This Source Has Prior Primary Information");
    expect(primarySourceKey("  Head of   Oncology ", "ROCHE")).toBe(primarySourceKey("head of oncology", "Roche"));
    expect(primarySourceKey("Head of Oncology", "")).toBeNull();
    expect(primarySourceKey(null, "Roche")).toBeNull();
    expect(primarySourceKey("Head of Oncology", "Roche")).not.toBe(primarySourceKey("Head of Oncology", "Novartis"));
  });

  it("does not flag Primary entries as duplicates (Secondary only)", async () => {
    const html = articleHtml({ title: "Primary interview notes on Roche labs", body: "Notes from an interview with a lab director about Roche robotics programmes and their expansion in Basel next year." });
    const first = await json(upload(w.a.analyst, html, "interview.html", {}, "primary"));
    await drain();
    const a = await json<Summary>(call(w.a.analyst, "GET", `/api/items/${first.item.id}`));
    const pushed = await call(w.a.analyst, "POST", `/api/items/${a.id}/approve`, { body: { values: { ...a.draft, ...COMPLETE, title: "Primary dup A", source: "Primary Source" }, version: a.version } });
    expect(pushed.status).toBe(200);
    // The same file again, to Primary: not a duplicate, and it pushes without any override.
    const second = await json(upload(w.a.analyst, html, "interview.html", {}, "primary"));
    await drain();
    const b = await json<Summary>(call(w.a.analyst, "GET", `/api/items/${second.item.id}`));
    expect(b.duplicateOf).toBeNull();
    const again = await call(w.a.analyst, "POST", `/api/items/${b.id}/approve`, { body: { values: { ...b.draft, ...COMPLETE, title: "Primary dup B", source: "Primary Source" }, version: b.version } });
    expect(again.status, await again.clone().text()).toBe(200);
    // The same file to Secondary twice is still a duplicate once one is in the Tracker.
    const s1 = await json(upload(w.a.analyst, html, "interview.html", {}, "secondary"));
    await drain();
    const s1i = await json<Summary>(call(w.a.analyst, "GET", `/api/items/${s1.item.id}`));
    expect((await call(w.a.analyst, "POST", `/api/items/${s1i.id}/approve`, { body: { values: { ...s1i.draft, ...COMPLETE, title: "Secondary dup A" }, version: s1i.version } })).status).toBe(200);
    const s2 = await json(upload(w.a.analyst, html, "interview.html", {}, "secondary"));
    await drain();
    const s2i = await json<Summary>(call(w.a.analyst, "GET", `/api/items/${s2.item.id}`));
    expect(s2i.duplicateOf).not.toBeNull();
  });

  it("links Primary entries from the same source, each to the one before it by Event Date, in the Tracker and Phantoms", async () => {
    const old = await pushPrimary("KOL interview: first", "2026-07-01", "Head of Oncology", "Lyon University Hospital");
    const mid = await pushPrimary("KOL interview: update", "2026-08-01", "  head of oncology", "LYON  University Hospital ");
    const other = await pushPrimary("KOL interview: someone else", "2026-08-15", "Head of Oncology", "Another Hospital");
    // Entered later, but its Event Date is between the two: it slots in between.
    const between = await pushPrimary("KOL interview: in between", "2026-07-15", "Head of Oncology", "Lyon University Hospital");

    for (const path of ["/api/tracker", "/api/phantoms"]) {
      const rows = await rowsOf(path);
      const by = (id: string) => rows.find((r) => r.id === id)!;
      expect(by(old.id)).toMatchObject({ linkedEarlier: null, linkedLater: between.id });
      expect(by(between.id)).toMatchObject({ linkedEarlier: old.id, linkedLater: mid.id });
      expect(by(mid.id)).toMatchObject({ linkedEarlier: between.id, linkedLater: null });
      expect(by(other.id)).toMatchObject({ linkedEarlier: null, linkedLater: null });
    }
    const detail = await json(call(w.a.client, "GET", `/api/signals/${mid.id}`));
    expect(detail).toMatchObject({ linkedEarlier: between.id, linkedLater: null });

    // The sources list for the Inbox flag (clients can read it too).
    const sources = await json<{ key: string; id: string; title: string }[]>(call(w.a.client, "GET", "/api/primary-sources"));
    const key = primarySourceKey("Head of Oncology", "Lyon University Hospital");
    expect(sources.filter((s) => s.key === key).map((s) => s.id)).toEqual([mid.id, between.id, old.id]);
    // Secondary entries are never in it.
    expect(sources.every((s) => s.key.includes("\u001f"))).toBe(true);

    // Editing the source in the Tracker re-links by itself.
    const values = { ...detail.values, source_company: "Another Hospital" };
    const rev = await call(w.a.analyst, "POST", `/api/signals/${mid.id}/revise`, { body: { values } });
    expect(rev.status, await rev.clone().text()).toBe(200);
    const after = await rowsOf("/api/tracker");
    expect(after.find((r) => r.id === between.id)).toMatchObject({ linkedLater: null });
    // Its Event Date (1 Aug) is before the other hospital's entry (15 Aug).
    expect(after.find((r) => r.id === mid.id)).toMatchObject({ linkedEarlier: null, linkedLater: other.id });
    expect(after.find((r) => r.id === other.id)).toMatchObject({ linkedEarlier: mid.id });

    // Deleting an entry removes it from the chain.
    const del = await call(w.a.analyst, "DELETE", `/api/items/${between.id}`, { body: { from: "global", reason: "test" } });
    expect(del.status, await del.clone().text()).toBe(200);
    const gone = await rowsOf("/api/tracker");
    expect(gone.find((r) => r.id === old.id)).toMatchObject({ linkedLater: null });
  });

  it("links imported Primary rows from the same source", async () => {
    const row = (n: number, date: string) => ({
      row: n,
      values: {
        ID: `P27-${Date.now().toString(36)}-${n}`,
        Title: `Imported KOL ${n}`,
        "Event Date": date,
        "Source Role": "Medical Director",
        "Source Company": "Imported Clinic",
        Macrotrend: "AI Investment in R&D",
        Subtrend: "Agentic AI Platforms",
        "Growth Intensity": "Stable",
        Impact: "Low",
        "Source Type": "Primary Source",
        Competitors: "Roche",
        Action: "Not Actioned",
      },
    });
    const res = await json(call(w.a.analyst, "POST", "/api/import?stream=primary", { body: { fileName: "kol.xlsx", rows: [row(2, "2026-01-10"), row(3, "2026-02-10")] } }));
    expect(res).toMatchObject({ ok: true, imported: 2 });
    const rows = await rowsOf("/api/tracker");
    const [a, b] = res.codes.map((c: string) => rows.find((r) => r.code === c)!);
    expect(a).toMatchObject({ linkedLater: b.id });
    expect(b).toMatchObject({ linkedEarlier: a.id });
  });
});
