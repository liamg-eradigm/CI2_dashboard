import { beforeAll, describe, expect, it } from "vitest";
import { approveWith, articleHtml, call, json, seedWorld, type World } from "./helpers";

let w: World;
beforeAll(async () => {
  w = await seedWorld();
});

async function entry(stream: "primary" | "secondary", title: string, values: Record<string, unknown> = {}) {
  const { item } = await json(call(w.a.analyst, "POST", "/api/submissions/manual", { body: { stream } }));
  const res = await approveWith(w.a.analyst, item, { title, ...values });
  if (res.status !== 200) throw new Error(`${title}: ${await res.text()}`);
  return item.id as string;
}
const page = (name: string, text: string) => {
  const f = new FormData();
  f.append("file", new File([articleHtml({ title: name, body: text })], name, { type: "text/html" }));
  return f;
};
const attach = (id: string, name: string, text: string, who = w.a.analyst) => call(who, "POST", `/api/items/${id}/snapshot`, { form: page(name, text) });

describe("default dates: everything in view", () => {
  it("returns the oldest and newest Event Dates, and uses them when a request has no dates", async () => {
    expect(await json(call(w.b.admin, "GET", "/api/tracker/bounds"))).toEqual({ oldest: null, newest: null });
    const old = await entry("primary", "An old entry", { date: "2019-04-02" });
    await entry("secondary", "A recent entry", { date: "2026-09-20" });
    expect(await json(call(w.a.client, "GET", "/api/tracker/bounds"))).toEqual({ oldest: "2019-04-02", newest: "2026-09-20" });
    // No dates given: the old entry is in view (it used to be the last three months only).
    const t = await json(call(w.a.client, "GET", "/api/tracker?stream=primary"));
    expect(t.rows.map((r: { id: string }) => r.id)).toContain(old);
    expect(t.outsideDates.count).toBe(0);
    expect((await json(call(w.a.client, "GET", "/api/dashboard"))).kpis.approved).toBeGreaterThanOrEqual(2);
  });
});

describe("Display all", () => {
  it("returns every row on one page (up to the limit)", async () => {
    for (let i = 0; i < 12; i++) await entry("secondary", `Display all ${i}`, { date: "2026-08-01" });
    const all = await json(call(w.a.client, "GET", "/api/tracker?stream=secondary&from=2000-01-01&to=2100-01-01&pageSize=1000"));
    expect(all.rows.length).toBe(all.total);
    expect(all.total).toBeGreaterThan(12);
    expect(all.pageSize).toBe(1000);
    const paged = await json(call(w.a.client, "GET", "/api/tracker?stream=secondary&from=2000-01-01&to=2100-01-01&pageSize=10"));
    expect(paged.rows.length).toBe(10);
  });
});

describe("several saved pages per entry", () => {
  it("adds pages after the first, lists them first page first, and opens each one", async () => {
    const id = await entry("secondary", "Entry with several pages");
    const row = async () => (await json(call(w.a.client, "GET", "/api/tracker?stream=secondary&from=2000-01-01&to=2100-01-01&pageSize=1000"))).rows.find((r: { id: string }) => r.id === id);
    expect(await row()).toMatchObject({ hasSnapshot: false, pages: 0 });
    expect(await json(attach(id, "press-release.html", "Pfizer announced a deal."))).toMatchObject({ hasSnapshot: true, pages: 1 });
    expect(await json(attach(id, "analyst-note.htm", "Analysts expect more deals."))).toMatchObject({ pages: 2 });
    expect(await json(attach(id, "follow-up.html", "The deal closed."))).toMatchObject({ pages: 3 });
    expect(await row()).toMatchObject({ hasSnapshot: true, pages: 3 });
    // The same file twice is refused; clients cannot attach.
    expect((await attach(id, "analyst-note.htm", "Analysts expect more deals.")).status).toBe(409);
    expect((await attach(id, "x.html", "Another.", w.a.client)).status).toBe(403);

    const list = (await json(call(w.a.client, "GET", `/api/items/${id}/snapshots`))) as { id: string; name: string; first: boolean }[];
    expect(list.map((p) => [p.name, p.first])).toEqual([
      ["press-release", true],
      ["analyst-note", false],
      ["follow-up", false],
    ]);
    expect(await (await call(w.a.client, "GET", `/api/items/${id}/snapshot`)).text()).toContain("Pfizer announced a deal.");
    expect(await (await call(w.a.client, "GET", `/api/items/${id}/snapshot?page=${list[1]!.id}`)).text()).toContain("Analysts expect more deals.");
    // A page of another entry, or another tenant, is not served.
    const other = await entry("secondary", "Other entry");
    expect((await call(w.a.client, "GET", `/api/items/${other}/snapshot?page=${list[1]!.id}`)).status).toBe(404);
    expect((await call(w.b.admin, "GET", `/api/items/${id}/snapshots`)).status).toBe(404);
    // The detail carries the count too.
    expect((await json(call(w.a.client, "GET", `/api/signals/${id}`))).pages).toBe(3);
  });
});

describe("Tell Me More", () => {
  it("is printed under Key Details in the Secondary Markdown, without a heading of its own", async () => {
    const added = await json(call(w.a.analyst, "POST", "/api/schema/columns?stream=secondary", { body: { label: "Tell Me More", type: "long" } }));
    const key = (added.columns as { key: string; label: string }[]).find((c) => c.label === "Tell Me More")!.key;
    const id = await entry("secondary", "Entry with more to tell", { key_details: "Roche opened a lab.", [key]: "The lab has 40 robots." });
    const md = await (await call(w.a.client, "GET", `/api/signals/${id}/markdown`)).text();
    expect(md).toContain("## Key Details\nRoche opened a lab.\n\nThe lab has 40 robots.\n\n## CI Perspective");
    expect(md).not.toMatch(/## Tell Me More/i);
  });
});
