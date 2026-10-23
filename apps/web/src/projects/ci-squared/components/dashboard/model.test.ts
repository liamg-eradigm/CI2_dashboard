import { describe, expect, it } from "vitest";
import type { MegatrendEntry } from "@eradigm/shared";
import { activityChange, activityOf, activitySeries, addMonths, brightness, bucketsOf, defaultPick, focusSplit, macroStyles, quarters, rangeDates, topWithOthers } from "./model";

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
  it("weighs each signal by its impact (Low 1 … High 3) and growth (Stable 1 … Strong Increase 3)", () => {
    expect(activityOf(e("2026-10-01", "High", "Strong Increase"))).toBe(9);
    expect(activityOf(e("2026-10-01", "Medium", "Slight Increase"))).toBe(4);
    expect(activityOf(e("2026-10-01", "low", "stable"))).toBe(1);
    expect(activityOf(e("2026-10-01", null, null))).toBe(1);
  });

  it("sums it by week over three months, by month over longer spans", () => {
    const { from, to } = rangeDates("3m", [], "2026-10-23");
    expect([from, to]).toEqual(["2026-07-23", "2026-10-23"]);
    const weeks = bucketsOf(from, to);
    expect(weeks[0]!.start).toBe("2026-07-20");
    expect(weeks.every((b, i) => i === 0 || b.start === weeks[i - 1]!.end)).toBe(true);
    expect(weeks[weeks.length - 1]!.end > to).toBe(true);
    const months = bucketsOf("2025-10-23", "2026-10-23");
    expect(months[0]).toMatchObject({ start: "2025-10-01", label: "Oct 2025" });
    expect(months).toHaveLength(13);
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
    const s = activitySeries([e("2026-10-20", "High", "Stable"), e("2026-10-21", "Low", "Strong Increase"), e("2026-01-01", "High", "Stable")], weeks, (x) => [x.macrotrend]);
    expect(s.get("AI")!.reduce((a, b) => a + b, 0)).toBe(6);
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
    expect(activityChange(list, today)).toMatchObject({ pct: 200, now: 3, before: 1 });
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
    expect(brightness(10, 10)).toBe(1);
    expect(brightness(1, 100)).toBeLessThan(brightness(50, 100));
  });
});
