import { describe, expect, it } from "vitest";
import type { MegatrendEntry } from "@eradigm/shared";
import { activityChange, activityOf, macroAbbr, activitySeries, addMonths, bucketsOf, defaultPick, dotSize, focusSplit, macroStyles, quarters, rangeDates, smoothSegments, topWithOthers } from "./model";

const e = (date: string, impact: string | null, growth: string | null, extra: Partial<MegatrendEntry> = {}): MegatrendEntry => ({
  id: `${date}-${impact}-${growth}`,
  code: "S-1",
  recordId: null,
  stream: "secondary",
  date,
  title: "t",
  macrotrend: "AI",
  subtrend: null,
  impact,
  growth,
  ...extra,
});

describe("request 70: Activity = signals × impact × growth", () => {
  it("request 72: weighs each signal by its impact (Low 1, Medium 1.1, High 1.2) and growth (Stable 1, Slight 1.1, Strong 1.2)", () => {
    expect(activityOf(e("2026-10-01", "High", "Strong Increase"))).toBeCloseTo(1.44);
    expect(activityOf(e("2026-10-01", "Medium", "Slight Increase"))).toBeCloseTo(1.21);
    expect(activityOf(e("2026-10-01", "High", "Stable"))).toBeCloseTo(1.2);
    expect(activityOf(e("2026-10-01", "low", "stable"))).toBe(1);
    expect(activityOf(e("2026-10-01", null, null))).toBe(1);
  });

  it("request 71: each point is a month's Activity (the 30 days up to it), a point a week over three months", async () => {
    const { from, to } = rangeDates("3m", [], "2026-10-23");
    expect([from, to]).toEqual(["2026-07-23", "2026-10-23"]);
    const pts = bucketsOf(from, to);
    expect(pts[pts.length - 1]).toMatchObject({ at: "2026-10-23", start: "2026-09-24", end: "2026-10-24", label: "Month to 23 Oct 2026" });
    expect(pts[0]!.at <= from).toBe(true);
    expect(pts.every((p, i) => i === 0 || p.at > pts[i - 1]!.at)).toBe(true);
    expect(pts.length).toBeGreaterThanOrEqual(13);
    // A year: a point a fortnight; longer: a month.
    expect(bucketsOf("2025-10-23", "2026-10-23").length).toBeLessThanOrEqual(28);
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
    // A signal counts in every point whose month holds it.
    const s = activitySeries([e("2026-10-20", "High", "Stable"), e("2026-10-21", "Low", "Strong Increase"), e("2026-01-01", "High", "Stable")], pts, (x) => [x.macrotrend]);
    const row = s.get("AI")!;
    expect(row[row.length - 1]).toBeCloseTo(2.4);
    expect(row.filter((v) => v > 0).length).toBeGreaterThanOrEqual(1);
    // The point before (16 Oct) holds neither: both came later.
    expect(row[row.length - 2]).toBe(0);
  });

  it("keeps the top competitors and sums the rest as Others", () => {
    const series = new Map([
      ["A", [5, 5]],
      ["B", [1, 0]],
      ["C", [3, 3]],
      ["D", [0, 1]],
    ]);
    expect(topWithOthers(series, 2)).toEqual([
      { key: "A", values: [5, 5] },
      { key: "C", values: [3, 3] },
      { key: "Others", values: [1, 1] },
    ]);
  });

  it("measures the last month's change and picks, of the three with most signals, the one that grew most", () => {
    const today = "2026-10-23";
    const list = [e("2026-10-10", "High", "Stable"), e("2026-09-10", "Low", "Stable")];
    expect(activityChange(list, today)).toMatchObject({ pct: 20, now: 1.2, before: 1 });
    expect(activityChange([e("2026-10-10", "High", "Stable")], today)).toMatchObject({ pct: null, isNew: true });
    const change = { a: { pct: 10, isNew: false, now: 1, before: 1 }, b: { pct: 80, isNew: false, now: 1, before: 1 }, c: { pct: -5, isNew: false, now: 1, before: 1 }, d: { pct: 500, isNew: false, now: 1, before: 1 } };
    expect(defaultPick(["a", "b", "c", "d"], (k) => change[k as keyof typeof change])).toBe("b");
  });

  it("puts two or more shares under 5% together as Other", () => {
    expect(focusSplit([["A", 80], ["B", 16], ["C", 2], ["D", 2]]).map((s) => [s.name, Math.round(s.pct)])).toEqual([["A", 80], ["B", 16], ["Other", 4]]);
    expect(focusSplit([["A", 97], ["B", 3]]).map((s) => s.name)).toEqual(["A", "B"]);
    expect(focusSplit([])).toEqual([]);
  });

  it("knows this quarter and the one before", () => {
    expect(quarters("2026-10-23")).toEqual({ current: { start: "2026-10-01", end: "2027-01-01", name: "2026 Q4" }, previous: { start: "2026-07-01", end: "2026-10-01", name: "2026 Q3" } });
    expect(quarters("2026-02-01").previous).toEqual({ start: "2025-10-01", end: "2026-01-01", name: "2025 Q4" });
  });

  it("colours a ninth Macrotrend with the first hue hatched, and Others grey; more signals, brighter", () => {
    const names = ["a", "b", "c", "d", "e", "f", "g", "h", "Manufacturing", "Others"];
    const m = macroStyles(names);
    expect(m.get("Manufacturing")).toEqual({ colour: m.get("a")!.colour, hatch: true });
    expect(m.get("a")!.hatch).toBe(false);
    expect(m.get("Others")!.colour).toBe("#8b9aa6");
  });

  it("request 72: short Macrotrend labels, the full name otherwise on hover", () => {
    expect(
      ["AI Investment in R&D", "Workforce AI Upskilling", "Integrated Digital Pharma Innovation", "Geopolitics", "Portfolio Restructuring", "Direct-to-Patient (DTP) Strategy", "Manufacturing"].map(macroAbbr),
    ).toEqual(["AI R&D", "AI Upskill", "Dig Innov", "Geo", "Portfolio", "DTP", "Manufact"]);
    expect(macroAbbr("Biosimilars")).toBe("Biosimil.");
  });

  it("request 71: a matrix dot grows a little with Growth Intensity; the chart's line is smooth and never overshoots", () => {
    expect([dotSize("Stable"), dotSize("Slight Increase"), dotSize("Strong Increase"), dotSize(null)]).toEqual([5, 6.5, 8, 5]);
    const d = smoothSegments([
      [0, 10],
      [10, 0],
      [20, 0],
      [30, 5],
    ]);
    expect(d.match(/C/g)).toHaveLength(3);
    // Every control point's y stays within its segment's ends (no bump below 0 on the flat stretch).
    const ys = [...d.matchAll(/C[\d.-]+,([\d.-]+) [\d.-]+,([\d.-]+)/g)].flatMap((m) => [Number(m[1]), Number(m[2])]);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ys)).toBeLessThanOrEqual(10);
  });
});
