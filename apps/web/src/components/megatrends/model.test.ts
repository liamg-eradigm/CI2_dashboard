import { describe, expect, it } from "vitest";
import type { MegatrendEntry } from "@eradigm/shared";
import { NEUTRAL, PALETTE, colourMap, paletteOf, shade, spreadSlots, timelineEntries, type Macro } from "./model";

const node = (name: string, count: number, subs: [string, number][] = []): Macro => ({
  name,
  count,
  summary: null,
  subtrends: subs.map(([n, c]) => ({ name: n, count: c, summary: null })),
});
const entry = (id: string, macrotrend: string, subtrend: string | null): MegatrendEntry => ({ id, code: id, recordId: null, stream: "primary", date: "2026-09-01", title: id, macrotrend, subtrend, impact: null });

describe("Megatrends colours", () => {
  it("follow the entity in taxonomy order, never the counts; Others and a 9th hue are neutral", () => {
    const m = colourMap(["A", "Others", "B", "C", "D", "E", "F", "G", "H", "I"]);
    expect(m.get("A")).toBe(PALETTE[0]);
    expect(m.get("Others")).toBe(NEUTRAL);
    expect(m.get("B")).toBe(PALETTE[1]);
    expect(m.get("H")).toBe(PALETTE[7]);
    expect(m.get("I")).toBe(NEUTRAL);
    // A Macrotrend with no entries keeps its slot, so the others do not repaint.
    const p = paletteOf([node("A", 0), node("B", 3, [["b1", 1], ["b2", 2]])]);
    expect(p.macro.get("B")).toBe(PALETTE[1]);
    expect(p.sub.get("B")?.get("b2")).toBe(PALETTE[1]);
  });

  it("colour the timeline by Macrotrend, or by Subtrend within a selected Macrotrend", () => {
    const p = paletteOf([node("A", 2, [["a1", 1], ["a2", 1]]), node("B", 1, [["b1", 1]])]);
    const es = [entry("1", "A", "a1"), entry("2", "A", "a2"), entry("3", "B", "b1")];
    expect(timelineEntries(es, { macro: null, sub: null }, p).map((i) => [i.entry.id, i.colour, i.group])).toEqual([
      ["1", PALETTE[0], "A"],
      ["2", PALETTE[0], "A"],
      ["3", PALETTE[1], "B"],
    ]);
    expect(timelineEntries(es, { macro: "A", sub: null }, p).map((i) => [i.entry.id, i.colour, i.group])).toEqual([
      ["1", PALETTE[0], "a1"],
      ["2", PALETTE[1], "a2"],
    ]);
    expect(timelineEntries(es, { macro: "A", sub: "a2" }, p).map((i) => i.entry.id)).toEqual(["2"]);
  });

  it("shades towards white or black", () => {
    expect(shade("#000000", 1)).toBe("#ffffff");
    expect(shade("#ffffff", -1)).toBe("#000000");
    expect(shade("#808080", 0)).toBe("#808080");
  });
});

describe("spreadSlots", () => {
  const dist = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
  it("gives each hub its own unit direction, in the order given", () => {
    const s = spreadSlots([1, 30, 2, 25, 3]);
    expect(s).toHaveLength(5);
    for (const p of s) expect(Math.hypot(...p)).toBeCloseTo(1, 6);
    expect(new Set(s.map((p) => p.join())).size).toBe(5);
  });
  it("spreads the biggest hubs far apart, whatever order they come in", () => {
    const sizes = [33, 2, 1, 21, 1, 3, 17, 1, 2, 14, 1, 1, 2, 9, 1, 1];
    const s = spreadSlots(sizes);
    const big = [0, 3, 6, 9].map((i) => s[i]!);
    let closest = Infinity;
    for (let a = 0; a < big.length; a++) for (let b = a + 1; b < big.length; b++) closest = Math.min(closest, dist(big[a]!, big[b]!));
    // Evenly spread over 16 places, neighbours are about 0.9 apart; the four biggest are well beyond that.
    expect(closest).toBeGreaterThan(1.2);
  });
  it("handles none and one", () => {
    expect(spreadSlots([])).toEqual([]);
    expect(spreadSlots([5])[0]![1]).toBe(0);
  });
});
