import { beforeAll, describe, expect, it } from "vitest";
import { approveWith, call, json, seedWorld, type World } from "./helpers";

let w: World;
beforeAll(async () => {
  w = await seedWorld();
});

const para = "Sanofi’s “AI-first” strategy — announced on 24 Sept — covers 12 sites; it's worth €1.2bn (≈ $1.3bn). ✓ 🚀\tTabbed\u00a0text.\n\n";

describe("entries outside the date range", () => {
  it("publishes a long-text Secondary manual entry, in view by default, and says when narrower dates hide it", async () => {
    const { item } = await json(call(w.a.analyst, "POST", "/api/submissions/manual", { body: { stream: "secondary" } }));
    const long = para.repeat(200).slice(0, 19_990);
    const text = para.repeat(20).slice(0, 1_990);
    const res = await approveWith(w.a.analyst, item, {
      date: "2024-01-15",
      title: "An old event with a great deal of text",
      impact: "High",
      publisher: text,
      raw_ref: text,
      other_entities: text,
      therapeutic_area: text,
      assets: text,
      products: text,
      header: long,
      key_details: long,
      ci_perspective: long,
    });
    expect(res.status).toBe(200);
    expect((await json(res)).status).toBe("approved");

    // The default range starts at the oldest entry: it is in view.
    const def = await json(call(w.a.client, "GET", "/api/tracker?stream=secondary&pageSize=100"));
    expect(def.rows.map((r: { id: string }) => r.id)).toContain(item.id);
    expect(def.outsideDates.count).toBe(0);
    // Narrower dates: hidden, but counted.
    const t = await json(call(w.a.client, "GET", "/api/tracker?stream=secondary&from=2026-01-01&to=2026-12-31"));
    expect(t.rows.map((r: { id: string }) => r.id)).not.toContain(item.id);
    expect(t.outsideDates.count).toBeGreaterThanOrEqual(1);
    expect(t.outsideDates.from <= "2024-01-15").toBe(true);
    // "Show all dates" uses the span it returns: the entry is there, long text intact.
    const all = await json(call(w.a.client, "GET", `/api/tracker?stream=secondary&from=${t.outsideDates.from}&to=${t.outsideDates.to}&pageSize=100`));
    const row = all.rows.find((r: { id: string }) => r.id === item.id);
    expect(row.values.key_details).toBe(long.replace(/[ \t\u00a0]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim());
    expect(all.outsideDates.count).toBe(0);
    for (const p of ["/api/phantoms", "/api/deliverables/alerts", "/api/deliverables/newsletter"]) {
      const d = await json(call(w.a.client, "GET", `${p}?stream=secondary&from=2024-01-01&to=2024-01-31`));
      expect(d.rows.map((r: { id: string }) => r.id)).toContain(item.id);
    }
    const dash = await json(call(w.a.client, "GET", "/api/dashboard?from=2026-01-01&to=2026-12-31"));
    expect(dash.outsideDates.count).toBeGreaterThanOrEqual(1);
    expect((await json(call(w.a.client, "GET", "/api/dashboard"))).outsideDates.count).toBe(0);
    // The Markdown and the alert handle the long text too.
    expect((await call(w.a.client, "GET", `/api/signals/${item.id}/markdown`)).status).toBe(200);
  });

  it("counts only entries hidden by the dates (other filters still apply)", async () => {
    const t = await json(call(w.a.client, "GET", "/api/tracker?stream=secondary&f.impact=Low"));
    const all = await json(call(w.a.client, "GET", "/api/tracker?stream=secondary&f.impact=Low&from=2000-01-01&to=2100-01-01"));
    expect(t.total + t.outsideDates.count).toBe(all.total);
  });
});
