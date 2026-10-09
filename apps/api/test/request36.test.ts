import { beforeAll, describe, expect, it } from "vitest";
import { approveWith, call, json, seedWorld, type World } from "./helpers";

let w: World;
beforeAll(async () => {
  w = await seedWorld();
});

const RANGE = "from=2000-01-01&to=2100-01-01&pageSize=100";

async function entry(stream: "primary" | "secondary", title: string, impact: string) {
  const { item } = await json(call(w.a.analyst, "POST", "/api/submissions/manual", { body: { stream } }));
  const res = await approveWith(w.a.analyst, item, { title, impact });
  expect(res.status).toBe(200);
  return item.id as string;
}
type Row = { id: string; alertId?: string | null };
const rows = async (path: string, who = w.a.client) => (await json(call(who, "GET", `${path}?stream=primary&${RANGE}`))).rows as Row[];

describe("request 36: deleting deliverables", () => {
  it("deletes an alert: its entry keeps no alert for good, and its Phantom stays", async () => {
    const id = await entry("primary", "An alert to delete", "High");
    const keep = await entry("primary", "An alert to keep", "High");
    // Request 52: alerts are on the Database page (Admin → Deliverables is gone).
    const before = await rows("/api/database");
    const alertId = before.find((r) => r.id === id)!.alertId!;
    expect(alertId).toBeTruthy();
    // Clients cannot delete; another tenant cannot see it.
    expect((await call(w.a.client, "DELETE", `/api/deliverables/${alertId}`)).status).toBe(403);
    expect((await call(w.b.analyst, "DELETE", `/api/deliverables/${alertId}`)).status).toBe(404);
    expect(await json(call(w.a.analyst, "DELETE", `/api/deliverables/${alertId}`))).toMatchObject({ ok: true, kind: "alert" });
    // No alert any more (and none made again on the next listings), the .docx no longer served.
    for (let i = 0; i < 2; i++) {
      const after = await rows("/api/database");
      expect(after.find((r) => r.id === id)?.alertId).toBeNull();
      expect(after.find((r) => r.id === keep)?.alertId).toBeTruthy();
    }
    expect((await call(w.a.client, "GET", `/api/deliverables/${alertId}/docx`)).status).toBe(404);
    expect((await call(w.a.analyst, "DELETE", `/api/deliverables/${alertId}`)).status).toBe(404);
    // The Phantom stays.
    expect((await rows("/api/phantoms")).map((r) => r.id)).toContain(id);
  });

  it("deletes a newsletter", async () => {
    const id = await entry("primary", "For a newsletter", "Medium");
    const n = await json(call(w.a.analyst, "POST", "/api/newsletters/generate", { body: { itemIds: [id], sections: { [id]: "technology" } } }));
    expect((await json(call(w.a.client, "GET", "/api/newsletters"))).map((x: { id: string }) => x.id)).toContain(n.id);
    expect(await json(call(w.a.admin, "DELETE", `/api/deliverables/${n.id}`))).toMatchObject({ ok: true, kind: "newsletter", name: n.name });
    expect((await json(call(w.a.client, "GET", "/api/newsletters"))).map((x: { id: string }) => x.id)).not.toContain(n.id);
    expect((await call(w.a.client, "GET", `/api/deliverables/${n.id}/docx`)).status).toBe(404);
  });
});

describe("request 40: the new-signal cutoff", () => {
  it("defaults to 14 days and admins change it", async () => {
    expect((await json(call(w.a.client, "GET", "/api/settings"))).newSignals).toEqual({ days: 14 });
    expect((await call(w.a.analyst, "PATCH", "/api/settings", { body: { newSignals: { days: 30 } } })).status).toBe(403);
    expect((await call(w.a.admin, "PATCH", "/api/settings", { body: { newSignals: { days: 0 } } })).status).toBe(422);
    expect((await json(call(w.a.admin, "PATCH", "/api/settings", { body: { newSignals: { days: 30 } } }))).newSignals).toEqual({ days: 30 });
    expect((await json(call(w.a.client, "GET", "/api/settings"))).newSignals).toEqual({ days: 30 });
    // Other settings are kept.
    expect((await json(call(w.a.client, "GET", "/api/settings"))).megatrends.summaryDays).toBe(90);
  });
});

describe("request 41: text filters and column values", () => {
  it("filters on text a column contains (any case) and lists a stream's values of text columns", async () => {
    const make = async (company: string, details: string) => {
      const { item } = await json(call(w.a.analyst, "POST", "/api/submissions/manual", { body: { stream: "primary" } }));
      const res = await approveWith(w.a.analyst, item, { title: `Answer from ${company}`, impact: "Medium", source_company: company, key_details: details });
      expect(res.status).toBe(200);
      return item.id as string;
    };
    const a = await make("Hospital Alpha 41", "Payers push back on price.");
    const b = await make("Clinic Beta 41", "Uptake is growing fast.");
    const list = async (q: string) => ((await json(call(w.a.client, "GET", `/api/tracker?stream=primary&${RANGE}&${q}`))).rows as Row[]).map((r) => r.id);
    expect(await list("t.source_company=alpha%2041")).toEqual([a]);
    expect(await list("t.key_details=GROWING")).toEqual([b]);
    expect(await list("t.source_company=41&t.key_details=payers")).toEqual([a]);
    // Unknown or non-text columns are ignored.
    expect((await list("t.nope=x")).length).toBeGreaterThan(1);
    const v = await json(call(w.a.client, "GET", "/api/tracker/values?stream=primary&key=source_company&key=key_details&key=impact"));
    expect(v.source_company).toEqual(expect.arrayContaining(["Clinic Beta 41", "Hospital Alpha 41"]));
    // Only one-line text columns: not long text or dropdowns.
    expect(Object.keys(v)).toEqual(["source_company"]);
    expect(await json(call(w.b.analyst, "GET", "/api/tracker/values?stream=primary&key=source_company"))).toEqual({ source_company: [] });
  });
});

describe("request 42: KIQ Archive", () => {
  it("links earlier entries from the same source with the same Insight Topic and KIQ (trimmed, any case)", async () => {
    const tag = Math.random().toString(36).slice(2, 8);
    const make = async (title: string, date: string, topic: string, kiq: string, role = `Lead ${tag}`) => {
      const { item } = await json(call(w.a.analyst, "POST", "/api/submissions/manual", { body: { stream: "primary" } }));
      const res = await approveWith(w.a.analyst, item, { title, date, impact: "Medium", source_company: `Clinic ${tag}`, source_role: role, insight_topic: topic, key_intelligence_question: kiq });
      expect(res.status, await res.clone().text()).toBe(200);
      return item.id as string;
    };
    const first = await make(`First ${tag}`, "2026-02-01", "Pricing", "Will payers cover it?");
    const other = await make(`Other KIQ ${tag}`, "2026-03-01", "Pricing", "Is uptake growing?");
    const otherSource = await make(`Other source ${tag}`, "2026-03-15", "Pricing", "Will payers cover it?", `Someone else ${tag}`);
    const latest = await make(`Latest ${tag}`, "2026-04-01", " pricing ", "WILL PAYERS COVER IT?");
    const rows = (await json(call(w.a.client, "GET", `/api/tracker?stream=primary&${RANGE}&t.source_company=${tag}`))).rows as (Row & { kiqEarlier?: string | null; linkedEarlier?: string | null })[];
    const by = new Map(rows.map((r) => [r.id, r]));
    expect(by.get(latest)?.kiqEarlier).toBe(first);
    expect(by.get(latest)?.linkedEarlier).toBe(other);
    expect(by.get(first)?.kiqEarlier).toBeNull();
    expect(by.get(other)?.kiqEarlier).toBeNull();
    expect(by.get(otherSource)?.kiqEarlier).toBeNull();
    const kiq = (await json(call(w.a.client, "GET", `/api/signals/${latest}/archived?match=kiq`))).rows as Row[];
    expect(kiq.map((r) => r.id)).toEqual([first]);
    const all = (await json(call(w.a.client, "GET", `/api/signals/${latest}/archived`))).rows as Row[];
    // Full Discussion (request 46) is one conversation: the same source on the same Event Date only.
    expect(all.map((r) => r.id)).toEqual([]);
  });
});
