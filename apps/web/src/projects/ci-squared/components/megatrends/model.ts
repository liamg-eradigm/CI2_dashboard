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

/** High, Medium, Low, then any other Impact, then none. */
const impactRank = (v: string | null) => {
  const i = ["high", "medium", "low"].indexOf((v ?? "").trim().toLowerCase());
  return i < 0 ? (v ? 3 : 4) : i;
};

/** Sources for the right-hand list: High, Medium, Low, then any other or no Impact; newest first within each. */
export function bySourceOrder<E extends { impact: string | null; date: string; title: string }>(list: E[]): E[] {
  return [...list].sort((a, b) => impactRank(a.impact) - impactRank(b.impact) || b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
}

/** Request 58: newest first; signals of the same day by Impact (High first). */
export function byRecency<E extends { impact: string | null; date: string; title: string }>(list: E[]): E[] {
  return [...list].sort((a, b) => b.date.localeCompare(a.date) || impactRank(a.impact) - impactRank(b.impact) || a.title.localeCompare(b.title));
}

/** How a Subtrend's or competitor's signals are listed (request 58: most recent first by default). */
export type SignalOrder = "recent" | "impact";
export const inSignalOrder = <E extends { impact: string | null; date: string; title: string }>(list: E[], order: SignalOrder): E[] => (order === "impact" ? bySourceOrder(list) : byRecency(list));

/** Competitor tier colours (Admin → Competitor tiers): Tier 1 red, 2 orange-yellow, 3 green, 4 (all others) grey. */
export const TIER_COLOUR: Record<1 | 2 | 3 | 4, string> = { 1: "#e5534b", 2: "#e8a33d", 3: "#3fb37f", 4: "#8b9aa6" };

/** Request 62: the space between neighbouring entries in a cluster (an entry's dot is 3 across). */
export const CLUSTER_GAP = 8;

type V3 = [number, number, number];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** How many entries a shell `k` gaps out holds, each a gap from the next (the centre holds one). */
const shellHolds = (k: number) => (k === 0 ? 1 : Math.floor(10 * k * k));

/** The shells (radius in gaps, entries on it) of a cluster of `n`: filled from the centre out. */
function shells(n: number): { k: number; count: number }[] {
  const out: { k: number; count: number }[] = [];
  for (let k = 0, left = n; left > 0; k++) {
    const count = Math.min(left, shellHolds(k));
    out.push({ k, count });
    left -= count;
  }
  return out;
}

/** The radius of a cluster of `n` entries. */
export const clusterRadius = (n: number) => (Math.max(1, shells(n).length) - 1) * CLUSTER_GAP;

/**
 * Request 62: where each grouped entry sits around its hub, so every entry has
 * a bubble of space and can be pointed at on its own. Each group gets its own
 * direction (spreadSlots: the biggest far apart); its entries fill shells
 * around the group's centre, each entry a gap (CLUSTER_GAP) from the next, so
 * the group grows outwards with its size. A group sits just clear of the hub, further out the bigger
 * it is, and is pushed further out still while it would touch another group.
 * Returns, per entry (in the order given), its group's direction and its place
 * relative to the hub; null for an entry with no group.
 */
export function clusterLayout(groups: (string | null)[], base: number): ({ dir: V3; at: V3 } | null)[] {
  const members = new Map<string, number[]>();
  groups.forEach((g, i) => {
    if (g) members.set(g, [...(members.get(g) ?? []), i]);
  });
  const names = [...members.keys()].sort((a, b) => members.get(b)!.length - members.get(a)!.length || a.localeCompare(b));
  const dirs = spreadSlots(names.map((g) => members.get(g)!.length));
  const radius = names.map((g) => clusterRadius(members.get(g)!.length));
  // Each group's distance from the hub: clear of it, then clear of each other.
  const far = radius.map((r) => base + r + CLUSTER_GAP);
  const centre = (k: number) => scale(dirs[k]!, far[k]!);
  for (let pass = 0; pass < 40; pass++) {
    let moved = false;
    for (let a = 0; a < names.length; a++) {
      for (let b = a + 1; b < names.length; b++) {
        const need = radius[a]! + radius[b]! + CLUSTER_GAP * 1.5;
        if (dist(centre(a), centre(b)) >= need) continue;
        // The bigger group moves out (a step at a time, until they are clear).
        const k = radius[a]! >= radius[b]! ? a : b;
        far[k] = far[k]! + CLUSTER_GAP * 0.5;
        moved = true;
      }
    }
    if (!moved) break;
  }
  const out: ({ dir: V3; at: V3 } | null)[] = groups.map(() => null);
  const golden = Math.PI * (3 - Math.sqrt(5));
  names.forEach((g, k) => {
    const idx = members.get(g)!;
    const n = idx.length;
    const c = centre(k);
    // Shell by shell from the centre: each shell's entries spread evenly over it (a golden-angle spiral), a gap apart.
    let at = 0;
    for (const { k: shell, count } of shells(n)) {
      const r = shell * CLUSTER_GAP;
      for (let i = 0; i < count; i++, at++) {
        const y = count === 1 ? 0 : 1 - (2 * (i + 0.5)) / count;
        const ring = Math.sqrt(Math.max(0, 1 - y * y));
        // Each shell turned a little, so the shells' spirals do not line up.
        const a = golden * i + shell * 1.3;
        out[idx[at]!] = { dir: dirs[k]!, at: add(c, [Math.cos(a) * ring * r, y * r, Math.sin(a) * ring * r]) };
      }
    }
  });
  return out;
}
