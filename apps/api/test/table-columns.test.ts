import { beforeAll, describe, expect, it } from "vitest";
import { approveWith, call, json, seedWorld, type World } from "./helpers";

let w: World;
beforeAll(async () => {
  w = await seedWorld();
});

type Col = { key: string; label: string; inTracker: boolean; trackerPosition: number; inPhantoms: boolean; phantomsPosition: number; options?: string[] };
const schema = async (stream: string) => (await json(call(w.a.analyst, "GET", `/api/schema?stream=${stream}`))) as { columns: Col[] };
const table = (cols: Col[], t: "tracker" | "phantoms") =>
  cols
    .filter((c) => (t === "tracker" ? c.inTracker : c.inPhantoms))
    .sort((a, b) => (t === "tracker" ? a.trackerPosition - b.trackerPosition : a.phantomsPosition - b.phantomsPosition))
    .map((c) => c.label);
const patch = (stream: string, key: string, body: unknown, who = w.a.analyst) => call(who, "PATCH", `/api/schema/columns/${key}?stream=${stream}`, { body });
const order = (stream: string, keys: string[], t?: string) => call(w.a.analyst, "PUT", `/api/schema/columns/order?stream=${stream}`, { body: { keys, ...(t ? { table: t } : {}) } });
const RANGE = "from=2000-01-01&to=2100-01-01";

const TRACKER = ["Title", "Event Date", "Macrotrend", "Subtrend", "Growth Intensity", "Impact", "Source Type", "Competitors", "Action"];

describe("Inbox, Tracker and Phantoms columns", () => {
  it("default to the agreed three tables per stream", async () => {
    const p = await schema("primary");
    const s = await schema("secondary");
    expect(table(p.columns, "tracker")).toEqual(TRACKER);
    expect(table(s.columns, "tracker")).toEqual(TRACKER);
    expect(table(p.columns, "phantoms")).toEqual([
      "ID",
      "Title",
      "Event Date",
      "Source Role",
      "Source Company",
      "Source Location",
      "Source Confidence",
      "Workstream",
      "Source Therapeutic Area",
      "Source Brand or Asset",
      "Insight Topic",
      "Key Intelligence Question",
      "Key Details",
      "Key Metrics",
    ]);
    expect(table(s.columns, "phantoms")).toEqual([
      "ID",
      "Title",
      "Event Date",
      "Source Type",
      "Publisher",
      "URL",
      "Raw Ref",
      "Source Tier",
      "Competitors",
      "Other Entities",
      "Therapeutic Area",
      "Assets",
      "Products",
      "Header",
      "Key Details",
      "CI Perspective",
    ]);
    // The Inbox keeps every column in its own order.
    expect(p.columns.map((c) => c.label).slice(0, 4)).toEqual(["ID", "Title", "Event Date", "Source Role"]);
    expect(s.columns.map((c) => c.label).slice(0, 4)).toEqual(["ID", "Macrotrend", "Subtrend", "Title"]);
  });

  it("reorders each table independently, without touching the others or any dropdown options", async () => {
    const before = await schema("secondary");
    const inbox = before.columns.map((c) => c.key);
    const optionsBefore = before.columns.map((c) => [c.key, c.options]);
    const tracker = table(before.columns, "tracker");
    const trackerKeys = before.columns.filter((c) => c.inTracker).sort((a, b) => a.trackerPosition - b.trackerPosition).map((c) => c.key);
    const phantomKeys = before.columns.filter((c) => c.inPhantoms).sort((a, b) => a.phantomsPosition - b.phantomsPosition).map((c) => c.key);
    const res = await order("secondary", [...phantomKeys].reverse(), "phantoms");
    expect(res.status).toBe(200);
    const after = await schema("secondary");
    expect(table(after.columns, "phantoms")[0]).toBe("CI Perspective");
    expect(table(after.columns, "tracker")).toEqual(tracker);
    expect(after.columns.map((c) => c.key)).toEqual(inbox);
    expect(after.columns.map((c) => [c.key, c.options])).toEqual(optionsBefore);
    // The keys must be exactly that table's columns.
    expect((await order("secondary", trackerKeys, "phantoms")).status).toBe(409);
    expect((await order("secondary", trackerKeys.slice(1), "tracker")).status).toBe(409);
    expect((await order("secondary", phantomKeys, "phantoms")).status).toBe(200);
  });

  it("adds Inbox columns to a table at the end and removes them; new Inbox columns join no table", async () => {
    expect((await patch("primary", "key_metrics", { inTracker: true })).status).toBe(200);
    let p = await schema("primary");
    expect(table(p.columns, "tracker")).toEqual([...TRACKER, "Key Metrics"]);
    expect(table(p.columns, "phantoms")).toContain("Key Metrics");
    await patch("primary", "key_metrics", { inTracker: false });
    await patch("primary", "record_id", { inPhantoms: false });
    p = await schema("primary");
    expect(table(p.columns, "tracker")).toEqual(TRACKER);
    expect(table(p.columns, "phantoms")[0]).toBe("Title");
    await patch("primary", "record_id", { inPhantoms: true });
    p = await schema("primary");
    expect(table(p.columns, "phantoms").at(-1)).toBe("ID");
    expect(p.columns.find((c) => c.key === "record_id")).toBeTruthy();

    const added = await json(call(w.a.analyst, "POST", "/api/schema/columns?stream=primary", { body: { label: "Region", type: "text" } }));
    const region = (added.columns as Col[]).find((c) => c.label === "Region")!;
    expect(region).toMatchObject({ inTracker: false, inPhantoms: false });
    // Clients cannot change the tables.
    expect((await patch("primary", "key_metrics", { inPhantoms: false }, w.a.client)).status).toBe(403);
  });

  it("exports the Tracker with the Tracker columns and Phantoms with the Phantoms columns", async () => {
    const { item } = await json(call(w.a.analyst, "POST", "/api/submissions/manual", { body: { stream: "primary" } }));
    expect((await approveWith(w.a.analyst, item, { title: "Column export entry", key_metrics: "12 sites" })).status).toBe(200);
    const head = async (view: string) => (await (await call(w.a.analyst, "GET", `/api/tracker/export?stream=primary&format=csv&scope=all&view=${view}&${RANGE}`)).text()).replace(/^\uFEFF/, "").split("\r\n")[0] ?? "";
    expect(await head("tracker")).toBe(`Signal ID,${TRACKER.join(",")}`);
    const ph = await head("phantoms");
    expect(ph.startsWith("Signal ID,Title,Event Date,Source Role,")).toBe(true);
    expect(ph.endsWith(",Key Metrics,ID")).toBe(true);
    expect(ph).not.toContain("Macrotrend");
  });
});
