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

/** Impact colours on the dark surface (always with their names in legends and tooltips, never colour alone). */
export const IMPACT_COLOURS: Readonly<Record<string, string>> = { low: "#3fb37f", medium: "#e8a33d", high: "#e5534b" };
export function impactColour(impact: string | null | undefined): string {
  return IMPACT_COLOURS[(impact ?? "").trim().toLowerCase()] ?? NEUTRAL;
}
/** Impacts present, Low → High first, then any others A → Z, then entries without one. */
export function impactOrder(values: (string | null)[]): string[] {
  const rank = (v: string) => ["low", "medium", "high"].indexOf(v.toLowerCase());
  const named = [...new Set(values.filter((v): v is string => !!v))].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    return ra >= 0 && rb >= 0 ? ra - rb : ra >= 0 ? -1 : rb >= 0 ? 1 : a.localeCompare(b);
  });
  return values.some((v) => !v) ? [...named, "No Impact"] : named;
}

/**
 * Even places around the centre for `sizes.length` hubs: unit directions on a
 * Fibonacci sphere (evenly spread over it). The biggest hub takes the first,
 * and each next-biggest takes the free place farthest from those already
 * taken, so the large hubs spread around the whole orbit instead of bunching
 * up, and the small ones fill the gaps. Returned in the order of `sizes`.
 */
export function spreadSlots(sizes: number[]): [number, number, number][] {
  const n = sizes.length;
  const points: [number, number, number][] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    // Squashed towards the equator (y × 0.6), so few hubs hide at the poles behind one another.
    const y = n === 1 ? 0 : (1 - (2 * (i + 0.5)) / n) * 0.6;
    const ring = Math.sqrt(1 - y * y);
    const a = golden * i;
    points.push([Math.cos(a) * ring, y, Math.sin(a) * ring]);
  }
  const order = sizes.map((s, i) => [s, i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  const free = new Set(points.keys());
  const taken: [number, number, number][] = [];
  const out: [number, number, number][] = new Array(n);
  for (const [, i] of order) {
    let best = -1;
    let bestD = -1;
    for (const p of free) {
      const d = taken.length ? Math.min(...taken.map((t) => Math.hypot(t[0] - points[p]![0], t[1] - points[p]![1], t[2] - points[p]![2]))) : 0;
      if (d > bestD) {
        bestD = d;
        best = p;
      }
    }
    free.delete(best);
    taken.push(points[best]!);
    out[i] = points[best]!;
  }
  return out;
}

/** Sources for the right-hand list: High, Medium, Low, then any other or no Impact; newest first within each. */
export function bySourceOrder<E extends { impact: string | null; date: string; title: string }>(list: E[]): E[] {
  const rank = (v: string | null) => {
    const i = ["high", "medium", "low"].indexOf((v ?? "").trim().toLowerCase());
    return i < 0 ? (v ? 3 : 4) : i;
  };
  return [...list].sort((a, b) => rank(a.impact) - rank(b.impact) || b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
}

/** Competitor tier colours (Administration → Competitor tiers): Tier 1 red, 2 orange-yellow, 3 green, 4 (all others) grey. */
export const TIER_COLOUR: Record<1 | 2 | 3 | 4, string> = { 1: "#e5534b", 2: "#e8a33d", 3: "#3fb37f", 4: "#8b9aa6" };
