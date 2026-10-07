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
  it("deletes an alert: its entry leaves the Alerts table for good, and its Phantom stays", async () => {
    const id = await entry("primary", "An alert to delete", "High");
    const keep = await entry("primary", "An alert to keep", "High");
    const before = await rows("/api/deliverables/alerts");
    const alertId = before.find((r) => r.id === id)!.alertId!;
    expect(alertId).toBeTruthy();
    // Clients cannot delete; another tenant cannot see it.
    expect((await call(w.a.client, "DELETE", `/api/deliverables/${alertId}`)).status).toBe(403);
    expect((await call(w.b.analyst, "DELETE", `/api/deliverables/${alertId}`)).status).toBe(404);
    expect(await json(call(w.a.analyst, "DELETE", `/api/deliverables/${alertId}`))).toMatchObject({ ok: true, kind: "alert" });
    // Gone from the table (and not made again on the next listings), the .docx no longer served.
    for (let i = 0; i < 2; i++) {
      const after = await rows("/api/deliverables/alerts");
      expect(after.map((r) => r.id)).not.toContain(id);
      expect(after.map((r) => r.id)).toContain(keep);
    }
    expect((await call(w.a.client, "GET", `/api/deliverables/${alertId}/docx`)).status).toBe(404);
    expect((await call(w.a.analyst, "DELETE", `/api/deliverables/${alertId}`)).status).toBe(404);
    // The Phantom and the Newsletter entry stay.
    expect((await rows("/api/phantoms")).map((r) => r.id)).toContain(id);
    expect((await rows("/api/deliverables/newsletter")).map((r) => r.id)).toContain(id);
  });

  it("deletes a newsletter", async () => {
    const id = await entry("primary", "For a newsletter", "Medium");
    const n = await json(call(w.a.analyst, "POST", "/api/newsletters", { body: { name: "October", itemIds: [id] } }));
    expect((await json(call(w.a.client, "GET", "/api/newsletters"))).map((x: { id: string }) => x.id)).toContain(n.id);
    expect(await json(call(w.a.admin, "DELETE", `/api/deliverables/${n.id}`))).toMatchObject({ ok: true, kind: "newsletter", name: "October" });
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
