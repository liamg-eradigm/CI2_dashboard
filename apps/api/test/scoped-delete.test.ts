import { beforeAll, describe, expect, it } from "vitest";
import { approveWith, call, json, seedWorld, type World } from "./helpers";

let w: World;
beforeAll(async () => {
  w = await seedWorld();
});

const RANGE = "from=2000-01-01&to=2100-01-01&pageSize=100";

const manual = (stream: string, who = w.a.analyst, key?: string) =>
  call(who, "POST", "/api/submissions/manual", { body: { stream }, headers: key ? { "idempotency-key": key } : {} });

/** A blank manual entry, filled in and approved. */
async function entry(stream: "primary" | "secondary", title: string, values: Record<string, unknown> = {}) {
  const { item } = await json(manual(stream));
  const res = await approveWith(w.a.analyst, item, { title, ...values });
  expect(res.status).toBe(200);
  return item.id as string;
}

const ids = async (table: "tracker" | "phantoms", stream: string) => (await json(call(w.a.client, "GET", `/api/${table}?stream=${stream}&${RANGE}`))).rows.map((r: { id: string }) => r.id);
const approvedOnDashboard = async () => (await json(call(w.a.client, "GET", `/api/dashboard?${RANGE}`))).kpis.approved as number;
const del = (id: string, from?: string, who = w.a.analyst) => call(who, "DELETE", `/api/items/${id}`, { body: { ...(from ? { from } : {}), reason: "Test" } });

describe("manual entry", () => {
  it("sends a blank entry to the chosen Inbox, idempotently, for analysts and admins only", async () => {
    const res = await manual("secondary", w.a.analyst, "manual-once");
    expect(res.status).toBe(201);
    const { item } = await json(res);
    expect(item).toMatchObject({ stream: "secondary", status: "needs_review", inputType: "manual", outlet: "Manual entry", hasSnapshot: false, extraction: null });
    // Every field is empty except the automatic Source Tier.
    expect(Object.entries(item.draft).filter(([k, v]) => k !== "source_tier" && v != null && v !== "")).toEqual([]);
    expect(item.draft.source_tier).toBe("Reviewed-Secondary");
    const again = await json(manual("secondary", w.a.analyst, "manual-once"));
    expect(again).toMatchObject({ duplicate: true, item: { id: item.id } });
    expect((await manual("primary", w.a.client)).status).toBe(403);
    expect((await manual("tertiary")).status).toBe(422);
    // Nothing to re-capture; the analyst approves it like any other draft.
    expect((await call(w.a.analyst, "POST", `/api/items/${item.id}/reprocess`, { body: { version: item.version } })).status).toBe(409);
    const inbox = (await json(call(w.a.analyst, "GET", "/api/items?stream=secondary"))) as { id: string }[];
    expect(inbox.map((i) => i.id)).toContain(item.id);
  });

  it("is published to the tracker once filled in and approved", async () => {
    const id = await entry("primary", "Manual primary entry");
    expect(await ids("tracker", "primary")).toContain(id);
    expect(await ids("phantoms", "primary")).toContain(id);
  });
});

describe("deleting from one table only", () => {
  it("Delete Tracker Entry: leaves the Tracker and Dashboard, stays in Phantoms; then Delete Phantom Entry deletes it globally", async () => {
    const id = await entry("primary", "Scoped delete from tracker");
    const before = await approvedOnDashboard();
    const r = await del(id, "tracker");
    expect(r.status).toBe(200);
    expect((await json(r)).status).toBe("approved");
    expect(await ids("tracker", "primary")).not.toContain(id);
    expect(await ids("phantoms", "primary")).toContain(id);
    expect(await approvedOnDashboard()).toBe(before - 1);
    // Tracker exports leave it out; Phantoms exports keep it.
    const trackerCsv = await (await call(w.a.analyst, "GET", `/api/tracker/export?stream=primary&format=csv&scope=all`)).text();
    const phantomCsv = await (await call(w.a.analyst, "GET", `/api/tracker/export?stream=primary&format=csv&scope=all&view=phantoms`)).text();
    expect(trackerCsv).not.toContain("Scoped delete from tracker");
    expect(phantomCsv).toContain("Scoped delete from tracker");
    // A second tracker delete is a conflict; the record itself still opens (from Phantoms).
    expect((await del(id, "tracker")).status).toBe(409);
    expect((await call(w.a.client, "GET", `/api/signals/${id}`)).status).toBe(200);
    // Now in neither table → deleted globally.
    const g = await json(del(id, "phantoms"));
    expect(g.status).toBe("deleted");
    expect(await ids("phantoms", "primary")).not.toContain(id);
    expect((await call(w.a.client, "GET", `/api/signals/${id}`)).status).toBe(404);
  });

  it("Delete Phantom Entry: leaves Phantoms only, stays in the Tracker and on the Dashboard", async () => {
    const id = await entry("secondary", "Scoped delete from phantoms", { impact: "High" });
    expect(await ids("phantoms", "secondary")).toContain(id);
    const before = await approvedOnDashboard();
    expect((await json(del(id, "phantoms"))).status).toBe("approved");
    expect(await ids("phantoms", "secondary")).not.toContain(id);
    expect(await ids("tracker", "secondary")).toContain(id);
    expect(await approvedOnDashboard()).toBe(before);
    expect((await call(w.a.analyst, "GET", `/api/phantoms?stream=secondary&${RANGE}`)).status).toBe(200);
  });

  it("deletes globally when the entry is not in the other table (Secondary below the Phantoms threshold)", async () => {
    await call(w.a.admin, "PATCH", "/api/settings", { body: { phantoms: { secondaryMinImpact: "Medium" } } });
    const id = await entry("secondary", "Low impact scoped delete", { impact: "Low" });
    expect(await ids("phantoms", "secondary")).not.toContain(id);
    expect((await json(del(id, "tracker"))).status).toBe("deleted");
    await call(w.a.admin, "PATCH", "/api/settings", { body: { phantoms: { secondaryMinImpact: "Low" } } });
  });

  it("Delete Globally (or no choice, as before) removes it everywhere; clients cannot delete", async () => {
    const a = await entry("primary", "Global delete one");
    const b = await entry("primary", "Global delete two");
    expect((await del(a, "tracker", w.a.client)).status).toBe(403);
    expect((await json(del(a, "global"))).status).toBe("deleted");
    expect((await json(call(w.a.analyst, "DELETE", `/api/items/${b}`))).status).toBe("deleted");
    for (const t of ["tracker", "phantoms"] as const) {
      const list = await ids(t, "primary");
      expect(list).not.toContain(a);
      expect(list).not.toContain(b);
    }
    expect((await call(w.a.analyst, "DELETE", `/api/items/${a}`, { body: { from: "sideways" } })).status).toBe(422);
  });

  it("only applies to tracker entries", async () => {
    const { item } = await json(manual("primary"));
    expect((await del(item.id, "tracker")).status).toBe(409);
    expect((await json(del(item.id))).status).toBe("deleted");
  });
});

describe("tracker search", () => {
  it("finds an entry by a long pasted title (over D1's 50-character LIKE limit), case-insensitively", async () => {
    const title = "Roche Unveils A Very Long Headline About Agentic AI Platforms In Early Research Sites";
    const id = await entry("primary", title);
    for (const q of [title, title.toLowerCase(), "agentic ai platforms in early", "50%_off \\ literal"]) {
      const r = await call(w.a.client, "GET", `/api/tracker?stream=primary&${RANGE}&q=${encodeURIComponent(q)}`);
      expect(r.status).toBe(200);
      const rows = (await json(r)).rows.map((x: { id: string }) => x.id);
      if (q.startsWith("50%")) expect(rows).toEqual([]);
      else expect(rows).toContain(id);
    }
  });
});
