import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_DISCUSSION_SUMMARY_INSTRUCTIONS } from "@eradigm/shared";
import { app } from "../src/app";
import { approveWith, call, env, json, seedWorld, type World } from "./helpers";

let w: World;
beforeAll(async () => {
  w = await seedWorld();
});

const RANGE = "from=2000-01-01&to=2100-01-01&pageSize=100";

async function entry(stream: "primary" | "secondary", values: Record<string, unknown>) {
  const { item } = await json(call(w.a.analyst, "POST", "/api/submissions/manual", { body: { stream } }));
  const res = await approveWith(w.a.analyst, item, values);
  expect(res.status, await res.clone().text()).toBe(200);
  return item.id as string;
}
type Row = { id: string; values: Record<string, unknown>; phantom?: boolean; alertId?: string | null; alertPending?: boolean; newsletters?: { id: string; name: string }[] };
const database = async (q: string, who = w.a.client) => json<{ rows: Row[]; total: number }>(call(who, "GET", `/api/database?${RANGE}&${q}`));

/** The same request with the AI writer switched to the offline mock adapter. */
const withMock = (method: string, path: string, who: string, body?: unknown) =>
  app.fetch(
    new Request(`https://api.test${path}`, { method, headers: { "x-dev-user": who, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }),
    { ...env, LLM_PROVIDER: "mock" },
  );

describe("request 43: the Database page", () => {
  it("lists a stream's entries with every field, whether each is in Phantoms, its alert and its newsletters", async () => {
    const tag = Math.random().toString(36).slice(2, 8);
    const high = await entry("secondary", { title: `High ${tag}`, impact: "High", publisher: `Pub ${tag}`, review_date: "2026-03-10" });
    const low = await entry("secondary", { title: `Low ${tag}`, impact: "Low", publisher: `Pub ${tag}`, review_date: "2026-06-10" });
    const d = await database(`stream=secondary&t.publisher=${tag}`);
    expect(d.rows.map((r) => r.id).sort()).toEqual([high, low].sort());
    const h = d.rows.find((r) => r.id === high)!;
    const l = d.rows.find((r) => r.id === low)!;
    // Every field, including those in neither table (Publisher, Review Date).
    expect(h.values.publisher).toBe(`Pub ${tag}`);
    expect(h.values.review_date).toBe("2026-03-10");
    // Secondary Phantoms start at Low by default: both are Phantoms; request 51: every entry has an alert.
    expect(h.phantom).toBe(true);
    expect(l.phantom).toBe(true);
    expect(h.alertId).toBeTruthy();
    expect(l.alertId).toBeTruthy();
    expect(h.alertPending).toBe(false);
    // The same alert as Deliverables → Alerts.
    const alerts = (await json(call(w.a.client, "GET", `/api/deliverables/alerts?stream=secondary&${RANGE}`))).rows as Row[];
    expect(alerts.find((r) => r.id === high)?.alertId).toBe(h.alertId);
    expect((await call(w.a.client, "GET", `/api/deliverables/${h.alertId}/docx`)).status).toBe(200);

    // Filters on any field: a dropdown that is not a Tracker column (Source Tier) and another date column (Review Date).
    expect((await database(`stream=secondary&t.publisher=${tag}&df.review_date=2026-05-01`)).rows.map((r) => r.id)).toEqual([low]);
    expect((await database(`stream=secondary&t.publisher=${tag}&dt.review_date=2026-05-01`)).rows.map((r) => r.id)).toEqual([high]);
    expect((await database(`stream=secondary&t.publisher=${tag}&f.impact=High`)).rows.map((r) => r.id)).toEqual([high]);
  });

  it("generates a newsletter from ticked rows of either stream, listing their titles, and attaches it to each", async () => {
    const tag = Math.random().toString(36).slice(2, 8);
    const a = await entry("primary", { title: `Primary one ${tag}`, impact: "Low", source_company: `Co ${tag}` });
    const b = await entry("secondary", { title: `Secondary one ${tag}`, impact: "Low", publisher: `Pub ${tag}` });
    const c = await entry("secondary", { title: `Not used ${tag}`, impact: "Low", publisher: `Pub ${tag}` });
    // Clients cannot generate.
    const sections = { [a]: "technology", [b]: "people" };
    expect((await call(w.a.client, "POST", "/api/newsletters/generate", { body: { itemIds: [a, b], sections } })).status).toBe(403);
    const res = await call(w.a.analyst, "POST", "/api/newsletters/generate", { body: { itemIds: [a, b], sections } });
    expect(res.status, await res.clone().text()).toBe(201);
    const n = await res.json<{ id: string; name: string; items: { id: string; title: string }[] }>();
    expect(n.name).toMatch(/^Newsletter · /);
    expect(n.items.map((i) => i.title)).toEqual([`Primary one ${tag}`, `Secondary one ${tag}`]);
    // The .docx lists the titles.
    const docx = await call(w.a.client, "GET", `/api/deliverables/${n.id}/docx`);
    expect(docx.status).toBe(200);
    const bytes = new Uint8Array(await docx.arrayBuffer());
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain(`Primary one ${tag}`);
    expect(text).toContain(`Secondary one ${tag}`);
    expect(text).not.toContain(`Not used ${tag}`);
    // Attached to each row it was built from (both streams), not to the others; a second one adds to the list, newest first.
    const n2 = await json(call(w.a.analyst, "POST", "/api/newsletters/generate", { body: { itemIds: [b], sections: { [b]: "process" } } }));
    const sec = await database(`stream=secondary&t.publisher=${tag}`);
    expect(sec.rows.find((r) => r.id === b)?.newsletters?.map((x) => x.id)).toEqual([n2.id, n.id]);
    expect(sec.rows.find((r) => r.id === c)?.newsletters).toEqual([]);
    expect((await database(`stream=primary&t.source_company=${tag}`)).rows.find((r) => r.id === a)?.newsletters?.map((x) => x.id)).toEqual([n.id]);
    // It is listed with the other newsletters; another tenant cannot use the entries.
    expect(((await json(call(w.a.client, "GET", "/api/newsletters"))) as { id: string }[]).map((x) => x.id)).toContain(n.id);
    expect((await call(w.b.analyst, "POST", "/api/newsletters/generate", { body: { itemIds: [a], sections: { [a]: "people" } } })).status).toBe(422);
  });

  it("saving one settings section leaves the others as they were", async () => {
    const tiers = { tier1: ["Roche"], tier2: [], tier3: [] };
    expect((await call(w.a.admin, "PATCH", "/api/settings", { body: { competitorTiers: tiers, newSignals: { days: 30 } } })).status).toBe(200);
    const s = await json(call(w.a.admin, "PATCH", "/api/settings", { body: { timezone: "UTC" } }));
    expect(s.competitorTiers).toEqual(tiers);
    expect(s.newSignals).toEqual({ days: 30 });
    expect(s.discussionSummary.instructions).toBe(DEFAULT_DISCUSSION_SUMMARY_INSTRUCTIONS);
  });
});

describe("request 43: the Primary Tracker's AI Summary", () => {
  it("is written by hand by admins only, per discussion, and flagged when the discussion changes", async () => {
    const tag = Math.random().toString(36).slice(2, 8);
    const base = { source_company: `Clinic ${tag}`, source_role: `Lead ${tag}`, insight_topic: "Pricing", impact: "Medium" };
    // One conversation (request 46): the same source on the same Event Date.
    const first = await entry("primary", { ...base, title: `First ${tag}`, date: "2026-04-01", key_intelligence_question: "Will payers cover it?" });
    const latest = await entry("primary", { ...base, title: `Latest ${tag}`, date: "2026-04-01", key_intelligence_question: "Will payers cover it?" });
    // Not connected: nothing written, no error.
    const none = await json(call(w.a.client, "GET", `/api/signals/${latest}/summary`));
    expect(none).toMatchObject({ itemId: latest, mode: "source", text: null, aiConnected: false, stale: false, entries: 2 });
    // Analysts and clients cannot edit it; admins can, per mode.
    expect((await call(w.a.analyst, "PUT", `/api/signals/${latest}/summary`, { body: { mode: "source", text: "Nope" } })).status).toBe(403);
    const put = await json(call(w.a.admin, "PUT", `/api/signals/${latest}/summary`, { body: { mode: "source", text: "Payers are coming round." } }));
    expect(put).toMatchObject({ text: "Payers are coming round.", source: "manual", stale: false, updatedBy: "A Admin" });
    expect((await json(call(w.a.client, "GET", `/api/signals/${latest}/summary`))).text).toBe("Payers are coming round.");
    expect((await json(call(w.a.client, "GET", `/api/signals/${latest}/summary?match=kiq`))).text).toBeNull();
    // Revising an answer of the discussion flags it as out of date (a hand-written summary is kept).
    const sig = await json(call(w.a.analyst, "GET", `/api/signals/${first}`));
    const rev = await call(w.a.analyst, "POST", `/api/signals/${first}/revise`, { body: { values: { ...sig.values, key_details: "Revised." } } });
    expect(rev.status, await rev.clone().text()).toBe(200);
    expect(await json(call(w.a.client, "GET", `/api/signals/${latest}/summary`))).toMatchObject({ text: "Payers are coming round.", stale: true });
    // Empty text removes it; the AI writer cannot be asked while it is not connected.
    expect((await json(call(w.a.admin, "PUT", `/api/signals/${latest}/summary`, { body: { mode: "source", text: "" } }))).text).toBeNull();
    expect((await call(w.a.admin, "POST", `/api/signals/${latest}/summary/generate`, { body: { mode: "kiq" } })).status).toBe(409);
    // Another tenant cannot read it.
    expect((await call(w.b.analyst, "GET", `/api/signals/${latest}/summary`)).status).toBe(404);
  });

  it("is written by the AI writer when connected, again once the discussion changes, never over a hand-written one", async () => {
    const tag = Math.random().toString(36).slice(2, 8);
    // One conversation (request 46): every answer on the same Event Date.
    const base = { source_company: `Clinic ${tag}`, source_role: `Lead ${tag}`, insight_topic: "Access", impact: "Medium" };
    await entry("primary", { ...base, title: `Old ${tag}`, date: "2026-03-01", key_intelligence_question: "Q one" });
    await entry("primary", { ...base, title: `Other ${tag}`, date: "2026-03-01", key_intelligence_question: "Q two" });
    const latest = await entry("primary", { ...base, title: `New ${tag}`, date: "2026-03-01", key_intelligence_question: "Q one" });
    const full = await json(withMock("GET", `/api/signals/${latest}/summary`, w.a.client));
    expect(full, JSON.stringify(full)).toMatchObject({ source: "ai", aiConnected: true, entries: 3, stale: false, model: "mock-heuristic" });
    expect(full.text).toMatch(/^Mock summary of 3 answers in Full Discussion: Lead .*, newest first/);
    // The KIQ Archive is its own summary: the two answers to Q one.
    const kiq = await json(withMock("GET", `/api/signals/${latest}/summary?match=kiq`, w.a.client));
    expect(kiq.text).toMatch(/^Mock summary of 2 answers in KIQ Archive/);
    // Asked again with nothing changed: the same summary (not rewritten).
    expect((await json(withMock("GET", `/api/signals/${latest}/summary`, w.a.client))).updatedAt).toBe(full.updatedAt);
    // A new earlier answer from the source: written again.
    await entry("primary", { ...base, title: `Older ${tag}`, date: "2026-03-01", key_intelligence_question: "Q three" });
    expect((await json(withMock("GET", `/api/signals/${latest}/summary`, w.a.client))).text).toMatch(/^Mock summary of 4 answers/);
    // A hand-written summary stays until an admin asks the AI writer again.
    await call(w.a.admin, "PUT", `/api/signals/${latest}/summary`, { body: { mode: "source", text: "Written by hand." } });
    await entry("primary", { ...base, title: `Oldest ${tag}`, date: "2026-03-01", key_intelligence_question: "Q four" });
    expect(await json(withMock("GET", `/api/signals/${latest}/summary`, w.a.client))).toMatchObject({ text: "Written by hand.", stale: true });
    expect((await withMock("POST", `/api/signals/${latest}/summary/generate`, w.a.analyst, { mode: "source" })).status).toBe(403);
    const again = await json(withMock("POST", `/api/signals/${latest}/summary/generate`, w.a.admin, { mode: "source" }));
    expect(again).toMatchObject({ source: "ai", stale: false });
    expect(again.text).toMatch(/^Mock summary of 5 answers/);
  });
});
