import { beforeAll, describe, expect, it } from "vitest";
import { COMPLETE, approveWith, call, env, ingestTo, json, nextRecordId, seedWorld, type World } from "./helpers";

let w: World;
beforeAll(async () => {
  w = await seedWorld();
});

const RANGE = "from=2000-01-01&to=2100-01-01&pageSize=100";
const body = (s: string) => `${s} across three European sites, the company said on Monday.\nThe roll-out completes in 2027.`;

describe("Primary and Secondary streams", () => {
  it("give each inbox its own 22-column set, edited independently", async () => {
    const p = await json(call(w.a.analyst, "GET", "/api/schema?stream=primary"));
    const s = await json(call(w.a.analyst, "GET", "/api/schema?stream=secondary"));
    const labels = (x: any) => [...x.columns].sort((a: any, b: any) => a.position - b.position).map((c: any) => c.label);
    expect(labels(p)).toEqual([
      "ID", "Macrotrend", "Subtrend", "Title", "Event Date", "Review Date", "Impact", "Growth Intensity", "Source Type", "Publisher", "URL", "Raw Ref",
      "Source Tier", "Competitors", "Other Entities", "Therapeutic Area", "Assets", "Products", "Action", "Header", "Key Details", "CI Perspective",
    ]);
    expect(labels(s)).toEqual(labels(p));
    // The Tracker shows the same nine columns as before.
    expect(p.columns.filter((c: any) => c.inTracker).length).toBe(9);
    expect(p.taxonomy).toEqual(s.taxonomy);
    await call(w.a.analyst, "PATCH", "/api/schema/columns/publisher?stream=secondary", { body: { label: "Publisher (secondary)" } });
    expect((await json(call(w.a.analyst, "GET", "/api/schema?stream=secondary"))).columns.find((c: any) => c.key === "publisher").label).toBe("Publisher (secondary)");
    expect((await json(call(w.a.analyst, "GET", "/api/schema?stream=primary"))).columns.find((c: any) => c.key === "publisher").label).toBe("Publisher");
    await call(w.a.analyst, "PATCH", "/api/schema/columns/publisher?stream=secondary", { body: { label: "Publisher" } });
    // Locked Markdown fields cannot be deleted; unknown streams are refused.
    expect((await call(w.a.analyst, "DELETE", "/api/schema/columns/key_details?stream=secondary")).status).toBe(409);
    expect((await call(w.a.analyst, "GET", "/api/tracker?stream=tertiary")).status).toBe(400);
  });

  it("routes each upload to its inbox, fills Source Tier automatically and counts unprocessed items", async () => {
    const before = await json(call(w.a.analyst, "GET", "/api/items/counts"));
    const sec = await ingestTo("secondary", w.a.analyst, "Secondary routing test", body("Sanofi extends a DTP pilot"));
    expect(sec).toMatchObject({ stream: "secondary", status: "needs_review" });
    expect(sec.draft.source_tier).toBe("Reviewed-Secondary");
    const counts = await json(call(w.a.analyst, "GET", "/api/items/counts"));
    expect(counts.secondary).toBe(before.secondary + 1);
    expect(counts.primary).toBe(before.primary);
    const inPrimary = await json(call(w.a.analyst, "GET", "/api/items?status=needs_review&stream=primary"));
    expect(inPrimary.find((i: any) => i.id === sec.id)).toBeUndefined();
    const inSecondary = await json(call(w.a.analyst, "GET", "/api/items?status=needs_review&stream=secondary"));
    expect(inSecondary.find((i: any) => i.id === sec.id)).toBeTruthy();
    // The client cannot change Source Tier.
    const pub = await json(approveWith(w.a.analyst, sec, { source_tier: "Primary", impact: "High" }));
    expect(pub.draft.source_tier).toBe("Reviewed-Secondary");
    expect((await json(call(w.a.analyst, "GET", "/api/items/counts"))).secondary).toBe(before.secondary);
  });

  it("keeps each tracker to its own stream, while the Dashboard includes both", async () => {
    const p = await ingestTo("primary", w.a.analyst, "Primary tracker test", body("Roche opens a robotics lab"));
    const s = await ingestTo("secondary", w.a.analyst, "Secondary tracker test", body("Pfizer pilots an AI tool"));
    const pp = await json(approveWith(w.a.analyst, p));
    const sp = await json(approveWith(w.a.analyst, s));
    const tp = await json(call(w.a.client, "GET", `/api/tracker?stream=primary&${RANGE}`));
    const ts = await json(call(w.a.client, "GET", `/api/tracker?stream=secondary&${RANGE}`));
    expect(tp.rows.map((r: any) => r.id)).toContain(pp.id);
    expect(tp.rows.map((r: any) => r.id)).not.toContain(sp.id);
    expect(ts.rows.map((r: any) => r.id)).toContain(sp.id);
    expect(ts.rows.every((r: any) => r.stream === "secondary")).toBe(true);
    const dash = await json(call(w.a.client, "GET", `/api/dashboard?${RANGE}`));
    expect(dash.kpis.approved).toBe(tp.total + ts.total);
  });
});

describe("Phantoms", () => {
  it("lists every Primary entry, and Secondary entries at or above the admin-set Impact", async () => {
    const low1 = await ingestTo("primary", w.a.analyst, "Phantom primary low", body("Novartis names a digital lead"));
    const low2 = await ingestTo("secondary", w.a.analyst, "Phantom secondary low", body("AstraZeneca trials a chatbot"));
    const med = await ingestTo("secondary", w.a.analyst, "Phantom secondary medium", body("Sanofi signs an AI licensing deal"));
    const a = await json(approveWith(w.a.analyst, low1, { impact: "Low" }));
    const b = await json(approveWith(w.a.analyst, low2, { impact: "Low" }));
    const c = await json(approveWith(w.a.analyst, med, { impact: "Medium" }));
    const ids = async (stream: string) => (await json(call(w.a.client, "GET", `/api/phantoms?stream=${stream}&${RANGE}`))).rows.map((r: any) => r.id);
    expect(await ids("primary")).toContain(a.id);
    expect(await ids("secondary")).toContain(c.id);
    expect(await ids("secondary")).not.toContain(b.id);
    // Admins raise the threshold to High: Medium drops out. Analysts and clients cannot change it.
    expect((await call(w.a.analyst, "PATCH", "/api/settings", { body: { phantoms: { secondaryMinImpact: "High" } } })).status).toBe(403);
    expect((await call(w.a.admin, "PATCH", "/api/settings", { body: { phantoms: { secondaryMinImpact: "Critical" } } })).status).toBe(422);
    expect((await json(call(w.a.admin, "PATCH", "/api/settings", { body: { phantoms: { secondaryMinImpact: "High" } } }))).phantoms.secondaryMinImpact).toBe("High");
    expect(await ids("secondary")).not.toContain(c.id);
    expect(await ids("primary")).toContain(a.id);
    // Renaming the Secondary Impact option keeps the threshold attached to it.
    await call(w.a.analyst, "PATCH", "/api/schema/columns/impact/options?stream=secondary", { body: { from: "High", to: "Very high" } });
    expect((await json(call(w.a.client, "GET", "/api/settings"))).phantoms.secondaryMinImpact).toBe("Very high");
    await call(w.a.analyst, "PATCH", "/api/schema/columns/impact/options?stream=secondary", { body: { from: "Very high", to: "High" } });
    await call(w.a.admin, "PATCH", "/api/settings", { body: { phantoms: { secondaryMinImpact: "Medium" } } });
    expect(await ids("secondary")).toContain(c.id);
  });

  it("generates the Markdown from the tracker fields only, as valid YAML front matter", async () => {
    const item = await ingestTo("secondary", w.a.analyst, "Markdown source page", body("Roche opens a lab"));
    const rid = `MD-${nextRecordId()}`;
    const pub = await json(
      approveWith(w.a.analyst, item, {
        record_id: rid,
        title: "Roche: new robotics lab #1",
        date: "2026-09-24",
        review_date: "2026-09-29",
        impact: "High",
        source: "PR",
        publisher: "Roche",
        url: "https://www.roche.com/news/lab",
        raw_ref: "RR-0042",
        competitors: ["Roche", "Pfizer"],
        other_entities: "ETH Zurich",
        therapeutic_area: "Oncology",
        assets: "RG-6114",
        products: "true",
        header: "Roche opens its first fully autonomous lab.",
        key_details: "Runs 24/7.\n\nDoubles throughput by 2027.",
        ci_perspective: "Raises the bar for peers.",
      }),
    );
    const res = await call(w.a.client, "GET", `/api/signals/${pub.id}/markdown`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/markdown/);
    expect(await res.text()).toBe(
      [
        "---",
        `id: ${rid}`,
        'title: "Roche: new robotics lab #1"',
        "event_date: 2026-09-24",
        "source_type: PR",
        "Source:",
        "  Publisher: Roche",
        "  URL: https://www.roche.com/news/lab",
        "  Raw_ref: RR-0042",
        "Source_tier: Reviewed-Secondary",
        "Competitors: Pfizer, Roche",
        "Other_entities: ETH Zurich",
        "Therapeutic_area: Oncology",
        "Assets: RG-6114",
        'Products: "true"',
        "QC:",
        "  Reviewed_by: A Analyst",
        "  Review_date: 2026-09-29",
        "  Accurate_as_of: 2026-09-24",
        "---",
        "## Header",
        "Roche opens its first fully autonomous lab.",
        "",
        "## Key Details",
        "Runs 24/7.",
        "",
        "Doubles throughput by 2027.",
        "",
        "## CI Perspective",
        "Raises the bar for peers.",
        "",
      ].join("\n"),
    );
    const dl = await call(w.a.client, "GET", `/api/signals/${pub.id}/markdown?download=1`);
    expect(dl.headers.get("content-disposition")).toBe(`attachment; filename="${rid}.md"`);
    const ev = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'markdown.downloaded' AND target_id = ?1").bind(pub.id).first<{ n: number }>();
    expect(ev?.n).toBe(1);
  });

  it("fills Review Date with the approval day when it is left empty, and names who approved it", async () => {
    const item = await ingestTo("primary", w.a.analyst, "Review date default", body("Pfizer names a new CDO"));
    const pub = await json(approveWith(w.a.admin, item, { review_date: null }));
    expect(pub.draft.review_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const md = await (await call(w.a.client, "GET", `/api/signals/${pub.id}/markdown`)).text();
    expect(md).toContain(`  Review_date: ${pub.draft.review_date}`);
    expect(md).toContain("  Reviewed_by: A Admin");
  });
});

describe("analyst-entered ID", () => {
  it("is required and must be unique among tracker entries (across both streams)", async () => {
    const one = await ingestTo("primary", w.a.analyst, "ID uniqueness one", body("Novartis launches an AI academy"));
    const two = await ingestTo("secondary", w.a.analyst, "ID uniqueness two", body("Sanofi launches an AI academy"));
    const missing = await call(w.a.analyst, "POST", `/api/items/${one.id}/approve`, { body: { values: { ...one.draft, ...COMPLETE, record_id: "" }, version: one.version } });
    expect(missing.status).toBe(422);
    expect((await missing.json<any>()).error.fields.map((f: any) => f.key)).toContain("record_id");
    const rid = `DUP-${nextRecordId()}`;
    const first = await json(approveWith(w.a.analyst, one, { record_id: rid }));
    const clash = await approveWith(w.a.analyst, two, { record_id: rid });
    expect(clash.status).toBe(422);
    const err = (await clash.json<any>()).error;
    expect(err.message).toContain(`“${rid}” is already used by ${first.signalCode}`);
    expect(err.fields[0].key).toBe("record_id");
    // Once the first entry is deleted from the tracker, the ID is free again.
    await call(w.a.analyst, "DELETE", `/api/items/${first.id}`);
    expect((await approveWith(w.a.analyst, two, { record_id: rid })).status).toBe(200);
  });
});
