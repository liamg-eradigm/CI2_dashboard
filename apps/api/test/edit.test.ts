import { beforeAll, describe, expect, it } from "vitest";
import { approveWith, call, json, seedWorld, type World } from "./helpers";

let w: World;
beforeAll(async () => {
  w = await seedWorld();
});

const RANGE = "from=2000-01-01&to=2100-01-01&pageSize=100";
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

async function entry(stream: "primary" | "secondary", values: Record<string, unknown>) {
  const { item } = await json(call(w.a.analyst, "POST", "/api/submissions/manual", { body: { stream } }));
  expect((await approveWith(w.a.analyst, item, values)).status).toBe(200);
  return item.id as string;
}
const detail = (id: string) => json(call(w.a.client, "GET", `/api/signals/${id}`));
const edit = (id: string, values: Record<string, unknown>, note?: string, who = w.both) => call(who, "POST", `/api/signals/${id}/revise`, { body: { values, ...(note ? { note } : {}) } });
const md = async (id: string) => (await call(w.a.client, "GET", `/api/signals/${id}/markdown`)).text();

describe("editing an approved entry and approving it again", () => {
  it("re-validates and publishes a new revision, re-stamped by the editor today; the Phantom (Markdown) keeps the first version", async () => {
    const id = await entry("secondary", { title: "Pfizer pilots an AI assistant", impact: "High", review_date: "2026-01-05", key_details: "First version." });
    expect(await md(id)).toContain("## Key Details\nFirst version.");
    const before = await detail(id);
    expect(before.approvedBy).toBe("A Analyst");

    // No note needed.
    const res = await edit(id, { ...before.values, title: "Pfizer rolls out its AI assistant", key_details: "Second version,\n\nwith more detail." });
    expect(res.status).toBe(200);
    const after = await json(res);
    expect(after).toMatchObject({ rev: 2, approvedBy: "Both Analyst" });
    expect(after.values.review_date).toBe(today);
    expect(after.revisions[0]).toMatchObject({ kind: "published", rev: 2, note: "Edited and re-approved" });

    // Phantoms are an evergreen snapshot: the Markdown is the entry as first pushed to the Tracker.
    const m = await md(id);
    expect(m).toContain("title: Pfizer pilots an AI assistant");
    expect(m).toContain("## Key Details\nFirst version.");
    expect(m).toContain("  Reviewed_by: A Analyst\n  Review_date: 2026-01-05");
    const ph = await json(call(w.a.client, "GET", `/api/phantoms?stream=secondary&${RANGE}`));
    expect(ph.rows.find((r: { id: string }) => r.id === id).values.title).toBe("Pfizer pilots an AI assistant");
    // The Tracker shows the new version.
    const t = await json(call(w.a.client, "GET", `/api/tracker?stream=secondary&${RANGE}`));
    expect(t.rows.find((r: { id: string }) => r.id === id).values.title).toBe("Pfizer rolls out its AI assistant");
  });

  it("keeps a Review Date the editor sets; Phantoms and Deliverables keep the Impact first pushed", async () => {
    const id = await entry("secondary", { title: "Sanofi signs an AI deal", impact: "High" });
    const alerts = async () => (await json(call(w.a.client, "GET", `/api/deliverables/alerts?stream=secondary&${RANGE}`))).rows.map((r: { id: string }) => r.id);
    expect(await alerts()).toContain(id);
    const d = await detail(id);
    const res = await json(edit(id, { ...d.values, impact: "Medium", review_date: "2026-02-02" }, "Impact downgraded after a client call"));
    expect(res.values.review_date).toBe("2026-02-02");
    expect(res.revisions[0].note).toBe("Impact downgraded after a client call");
    // Still a High-impact Phantom, so still an alert; the Tracker shows Medium.
    expect(await alerts()).toContain(id);
    const t = await json(call(w.a.client, "GET", `/api/tracker?stream=secondary&${RANGE}`));
    expect(t.rows.find((r: { id: string }) => r.id === id).values.impact).toBe("Medium");
  });

  it("applies the approval checks and permissions", async () => {
    const id = await entry("primary", { title: "Roche opens a lab", key_metrics: "3 sites" });
    const d = await detail(id);
    const bad = await edit(id, { ...d.values, title: "", macrotrend: "Not a macrotrend" });
    expect(bad.status).toBe(422);
    const keys = (await json(bad)).error.fields.map((f: { key: string }) => f.key);
    expect(keys).toEqual(expect.arrayContaining(["title", "macrotrend"]));
    expect((await edit(id, d.values)).status).toBe(400);
    expect((await edit(id, { ...d.values, title: "Roche opens a second lab" }, undefined, w.a.client)).status).toBe(403);
    // The ID must stay unique.
    const other = await entry("primary", { title: "Novartis opens a lab" });
    const taken = (await detail(other)).values.record_id;
    const dup = await edit(id, { ...d.values, record_id: taken });
    expect(dup.status).toBe(422);
    expect((await json(dup)).error.fields.map((f: { key: string }) => f.key)).toContain("record_id");
    // The Primary Markdown keeps the first version too.
    await edit(id, { ...d.values, key_metrics: "5 sites" });
    expect(await md(id)).toContain("## Key Metrics\n3 sites");
  });
});
