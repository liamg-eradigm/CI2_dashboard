import type { MegatrendEntry, Megatrends } from "@eradigm/shared";

/**
 * Categorical hues for the dark Megatrends surface, in fixed order (checked
 * for lightness, chroma, colour-vision separation and contrast on #081a2b).
 * Colour follows the entity: the n-th Macrotrend of the taxonomy (or the n-th
 * Subtrend of a Macrotrend) always gets the n-th hue, whatever the counts or
 * filters. "Others", and anything past the 8th, is neutral grey. Names are
 * always shown beside the colour (labels, legend), never colour alone.
 */
export const PALETTE = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"] as const;
export const NEUTRAL = "#8b9aa6";
const isOther = (name: string) => /^others?$/i.test(name.trim());

export function colourMap(names: string[]): Map<string, string> {
  const m = new Map<string, string>();
  let i = 0;
  for (const n of names) {
    if (isOther(n)) m.set(n, NEUTRAL);
    else m.set(n, PALETTE[i++] ?? NEUTRAL);
  }
  return m;
}

export type Macro = Megatrends["macrotrends"][number];
export type Sub = Macro["subtrends"][number];

/** What is selected: nothing (all Macrotrends), a Macrotrend, or one of its Subtrends. */
export interface Selection {
  macro: string | null;
  sub: string | null;
}

export interface Palette {
  macro: Map<string, string>;
  /** Per Macrotrend: its Subtrends' colours. */
  sub: Map<string, Map<string, string>>;
}

export function paletteOf(macros: Macro[]): Palette {
  return {
    macro: colourMap(macros.map((m) => m.name)),
    sub: new Map(macros.map((m) => [m.name, colourMap(m.subtrends.map((s) => s.name))])),
  };
}

/** The entries the timeline shows for a selection, and the colour of each. */
export function timelineEntries(entries: MegatrendEntry[], sel: Selection, pal: Palette): { entry: MegatrendEntry; colour: string; group: string }[] {
  return entries
    .filter((e) => (!sel.macro || e.macrotrend === sel.macro) && (!sel.sub || e.subtrend === sel.sub))
    .map((e) =>
      sel.macro
        ? { entry: e, colour: pal.sub.get(e.macrotrend)?.get(e.subtrend ?? "") ?? NEUTRAL, group: e.subtrend ?? "No Subtrend" }
        : { entry: e, colour: pal.macro.get(e.macrotrend) ?? NEUTRAL, group: e.macrotrend },
    );
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "#3987e5" → [r, g, b] */
export function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Mix a colour with white (t > 0) or black (t < 0). */
export function shade(hex: string, t: number): string {
  const [r, g, b] = rgb(hex);
  const f = (c: number) => Math.round(t >= 0 ? c + (255 - c) * t : c * (1 + t));
  return `#${[f(r), f(g), f(b)].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}
