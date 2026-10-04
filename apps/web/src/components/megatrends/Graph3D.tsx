/**
 * The knowledge graph of the Megatrends and Competitors tabs: hubs (sized by
 * their number of Tracker entries) around a central core, floating in a field
 * of stars. Drag to rotate, scroll to zoom, drag a node to move it.
 *
 * Megatrends: Macrotrends around the core; an open Macrotrend shows its
 * Subtrends; a selected Subtrend has its entries in orbit. Competitors: every
 * competitor named by an entry, on the same orbit around the core, spread
 * evenly over it with the biggest ones far apart (`spreadSlots`); a selected
 * competitor has its entries in orbit and lights its ties. Hubs are linked to the core, so dragging the core
 * brings them along.
 *
 * Each hub is a translucent sphere holding one small dot per entry, coloured
 * by Impact: a visual sense of the hub's impact mix. The entries in orbit are
 * the clickable ones.
 *
 * three.js and 3d-force-graph are loaded on first use, so only these pages
 * carry them. Everything is also reachable without the canvas (the page's
 * list, summary panel and timeline).
 */
import { useEffect, useRef, useState } from "react";
import type { ForceGraph3DInstance } from "3d-force-graph";
import type ForceGraph3DClass from "3d-force-graph";
import type * as ThreeNS from "three";
import { plural, shade, spreadSlots } from "./model";

type Three = typeof ThreeNS;

export interface GraphHub {
  id: string;
  /** 1: linked to the core (a Macrotrend, a competitor); 2: linked to its parent hub (a Subtrend). */
  level: 1 | 2;
  parent?: string;
  name: string;
  count: number;
  r: number;
  colour: string;
  /** One colour per entry, drawn inside the sphere (by Impact). */
  dots: string[];
  /** Size of the name label (1 = a Macrotrend's). */
  labelScale: number;
}
export interface GraphEntry {
  id: string;
  title: string;
  date: string;
  colour: string;
}
export interface GraphSpec {
  layout: "trends" | "competitors";
  total: number;
  hubs: GraphHub[];
  /** Pairs of level-1 hubs pulled together (competitors named by the same entries). */
  ties: { a: string; b: string; weight: number }[];
  /** The open level-1 hub: it (and its Subtrends, or tied competitors) stays lit, the rest recedes. */
  open: string | null;
  /** The selected hub: ringed, and the camera flies to it. */
  selected: string | null;
  /** Entries in orbit around a hub. */
  orbit: { hub: string; entries: GraphEntry[] } | null;
}

interface GNode {
  id: string;
  kind: "core" | "hub" | "entry";
  level: 0 | 1 | 2;
  root: string;
  name: string;
  count: number;
  colour: string;
  r: number;
  dots: string[];
  dotsKey: string;
  labelScale: number;
  vx?: number;
  vy?: number;
  vz?: number;
  title?: string;
  date?: string;
  x?: number;
  y?: number;
  z?: number;
  fx?: number;
  fy?: number;
  fz?: number;
  /** Held in place while selected (so the camera can settle on it). */
  pinned?: boolean;
  /** Competitors: the direction from the core of this hub's place on the orbit. */
  slot?: [number, number, number];
}
interface GLink {
  source: string | GNode;
  target: string | GNode;
  kind: "core" | "sub" | "entry" | "tie";
  weight: number;
}

/** The Three.js pieces of a node whose look changes with the selection. */
interface Parts {
  group: ThreeNS.Group;
  materials: { m: ThreeNS.Material & { opacity: number }; base: number }[];
  ring: ThreeNS.Mesh | null;
}

const ENTRIES_SHOWN = 80;
/** Dots drawn inside one sphere at most (enough to read the mix). */
const DOTS_MAX = 240;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const endId = (e: string | GNode) => (typeof e === "string" ? e : e.id);

export function Graph3D({
  spec,
  reducedMotion,
  onHub,
  onCore,
  onFocus,
  onEntry,
  onUnavailable,
  rightPanel = false,
}: {
  spec: GraphSpec;
  reducedMotion: boolean;
  onHub: (id: string) => void;
  onCore: () => void;
  /** The hub the view zoomed in on (or none). */
  onFocus: (id: string | null) => void;
  onEntry: (id: string) => void;
  onUnavailable: () => void;
  /** The drawer is open over the stage's right edge: the graph moves left to stay in the space between. */
  rightPanel?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const graph = useRef<ForceGraph3DInstance | null>(null);
  const three = useRef<Three | null>(null);
  const nodes = useRef(new Map<string, GNode>());
  const parts = useRef(new Map<string, Parts>());
  const [ready, setReady] = useState(false);
  // Latest callbacks and spec, for the long-lived graph handlers.
  const live = useRef({ onHub, onCore, onFocus, onEntry, spec, rightPanel });
  live.current = { onHub, onCore, onFocus, onEntry, spec, rightPanel };
  const refit = useRef<() => void>(() => undefined);
  const layout = spec.layout;

  // Create the scene once.
  useEffect(() => {
    let gone = false;
    let cleanup = () => undefined as void;
    void (async () => {
      let T: Three, ForceGraph3D: typeof ForceGraph3DClass;
      try {
        [T, { default: ForceGraph3D }] = await Promise.all([import("three"), import("3d-force-graph")]);
      } catch {
        if (!gone) onUnavailable();
        return;
      }
      if (gone || !host.current) return;
      if (!webglAvailable()) return onUnavailable();
      three.current = T;
      const el = host.current;
      let g: ForceGraph3DInstance;
      try {
        g = new ForceGraph3D(el, { controlType: "orbit", rendererConfig: { antialias: true, alpha: true, powerPreference: "high-performance" } });
      } catch {
        return onUnavailable();
      }
      graph.current = g;
      let framed = false;
      const tieLit = (l: GLink) => {
        const open = live.current.spec.open;
        return !!open && (endId(l.source) === open || endId(l.target) === open);
      };
      g.backgroundColor("rgba(0,0,0,0)")
        .showNavInfo(false)
        .width(el.clientWidth)
        .height(el.clientHeight)
        .nodeId("id")
        .nodeThreeObject((n: object) => buildNode(T, n as GNode))
        .nodeLabel((n: object) => {
          const x = n as GNode;
          if (x.kind === "entry") return `<div class="mg-tip"><b>${esc(x.title ?? "")}</b><span>${esc(x.date ?? "")}</span></div>`;
          if (x.kind === "core") return `<div class="mg-tip"><b>All Tracker entries</b><span>${esc(plural(x.count, "entry", "entries"))}</span></div>`;
          return `<div class="mg-tip"><b>${esc(x.name)}</b><span>${esc(plural(x.count, "entry", "entries"))} · click to explore</span></div>`;
        })
        // Competitors: ties show for the open competitor only.
        .linkVisibility((l: object) => ((l as GLink).kind === "tie" ? tieLit(l as GLink) : true))
        .linkColor((l: object) => ((l as GLink).kind === "core" ? "rgba(127, 211, 216, 0.30)" : (l as GLink).kind === "tie" ? "rgba(159, 216, 220, 0.75)" : "rgba(127, 211, 216, 0.42)"))
        .linkOpacity(0.5)
        .linkWidth((l: object) => ((l as GLink).kind === "entry" ? 0.15 : (l as GLink).kind === "tie" ? Math.min(1.2, 0.25 + 0.2 * (l as GLink).weight) : 0.35))
        .linkDirectionalParticles((l: object) => (reducedMotion ? 0 : (l as GLink).kind === "core" || (l as GLink).kind === "sub" ? 2 : 0))
        .linkDirectionalParticleWidth(1.1)
        .linkDirectionalParticleSpeed(0.0035)
        .linkDirectionalParticleColor(() => "#7fd3d8")
        .onNodeClick((n: object) => {
          const x = n as GNode;
          if (x.kind === "entry") return live.current.onEntry(x.id.slice(2));
          if (x.kind === "core") return live.current.onCore();
          live.current.onHub(x.id);
        })
        .onNodeDragEnd((n: object) => {
          // Let a dragged node float again (a dragged core stays where it is dropped).
          const x = n as GNode;
          if (x.kind === "core") return;
          if (x.pinned) {
            x.fx = x.x;
            x.fy = x.y;
            x.fz = x.z;
          } else x.fx = x.fy = x.fz = undefined;
        })
        .cooldownTime(6000)
        .onEngineStop(() => {
          if (framed || live.current.spec.layout !== "competitors" || live.current.spec.selected || !live.current.spec.hubs.length) return;
          framed = true;
          g.zoomToFit(900, 40, (n: object) => (n as GNode).kind !== "entry");
        });
      const comp = () => live.current.spec.layout === "competitors";
      // No re-centring force: it would push the hubs away from a dragged core.
      // The core is pinned and every hub is linked to it, so the graph holds together.
      g.d3Force("center", null);
      g.d3Force("slots", slotForce(0.12) as never);
      g.d3Force("charge")?.strength?.((n: GNode) =>
        n.kind === "entry" ? -18 : n.kind === "core" ? -40 : comp() ? -(40 + n.r * 5) : n.level === 1 ? -170 : -110,
      );
      // Every level-1 hub hangs off the core on the same short orbit (so dragging
      // the core brings them along). Competitor ties are only drawn: each
      // competitor keeps its own place on the orbit (the "slots" force).
      g.d3Force("link")
        ?.distance?.((l: GLink) => {
          const s = l.source as GNode;
          const t = l.target as GNode;
          if (l.kind === "core") return orbitOf(t);
          if (l.kind === "tie") return 16 + s.r + t.r + 40 / Math.max(1, l.weight);
          if (l.kind === "sub") return 34 + s.r + t.r * 2;
          // Entries orbit well clear of their hub, spread out rather than in a tight cluster.
          return 26 + s.r * 1.9;
        })
        ?.strength?.((l: GLink) => (l.kind === "core" ? 0.6 : l.kind === "tie" ? 0 : l.kind === "entry" ? 0.5 : 0.9));

      // Lighting: a soft fill plus a key light, so spheres read as spheres.
      const key = new T.DirectionalLight(0xffffff, 2.6);
      key.position.set(160, 220, 260);
      g.lights([new T.AmbientLight(0x9fc6d6, 1.25), key]);
      const stars = starfield(T);
      g.scene().add(stars);
      g.cameraPosition({ x: 0, y: 40, z: comp() ? 420 : 360 });

      const controls = g.controls() as {
        autoRotate: boolean;
        autoRotateSpeed: number;
        enableDamping: boolean;
        addEventListener: (e: string, f: () => void) => void;
        removeEventListener: (e: string, f: () => void) => void;
      };
      controls.enableDamping = true;
      controls.autoRotate = !reducedMotion;
      controls.autoRotateSpeed = 0.35;
      let idle: ReturnType<typeof setTimeout> | undefined;
      const onStart = () => {
        controls.autoRotate = false;
        clearTimeout(idle);
      };
      const onEnd = () => {
        clearTimeout(idle);
        if (!reducedMotion) idle = setTimeout(() => (controls.autoRotate = true), 15_000);
      };
      // Zooming into a hub shows its summary.
      let raf = 0;
      let lastFocus = "";
      const onChange = () => {
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          const cam = g.camera().position;
          let best: GNode | null = null;
          let bestD = Infinity;
          for (const n of nodes.current.values()) {
            if (n.kind !== "hub" || n.x == null) continue;
            const d = Math.hypot(cam.x - n.x, cam.y - (n.y ?? 0), cam.z - (n.z ?? 0)) - n.r;
            const reach = n.level === 1 ? (comp() ? 60 : 95) + n.r * 2 : 55 + n.r * 2;
            if (d < reach && d < bestD) {
              best = n;
              bestD = d;
            }
          }
          const id = best ? best.id : "";
          if (id === lastFocus) return;
          lastFocus = id;
          live.current.onFocus(best ? best.id : null);
        });
      };
      controls.addEventListener("start", onStart);
      controls.addEventListener("end", onEnd);
      controls.addEventListener("change", onChange);

      // Centre the graph in the space left free by the column of summary and
      // list (.mg-side, over the stage's left edge) and, while it is open, the
      // drawer over its right edge: shift the view by half the difference.
      // The view glides to a new shift (with the drawer). Picking follows, as
      // it uses the same projection. The library clears the camera's view
      // offset once after it starts, so the frame loop puts it back whenever
      // it is missing.
      const cam = g.camera() as ThreeNS.PerspectiveCamera;
      let shift = 0;
      let target = 0;
      let placed = false;
      const applyShift = () => {
        const w = el.clientWidth;
        const h = el.clientHeight;
        if (shift !== 0) cam.setViewOffset(w, h, shift, 0, w, h);
        else cam.clearViewOffset();
        cam.updateProjectionMatrix();
      };
      const fit = () => {
        const w = el.clientWidth;
        g.width(w).height(el.clientHeight);
        const side = el.parentElement?.querySelector(".mg-side");
        if (!side || getComputedStyle(side).position !== "absolute") {
          target = 0;
        } else {
          const a = el.getBoundingClientRect();
          const b = side.getBoundingClientRect();
          // Left column: shift the view right (negative offset); right column: left.
          const covered = b.left - a.left < a.right - b.right ? -(b.right - a.left) : a.right - b.left;
          // The drawer (fixed, 16px in from the window's right edge), measured as it will sit when open.
          const drawer = el.closest(".mg-page")?.querySelector<HTMLElement>(".mg-drawer");
          const right = live.current.rightPanel && drawer ? Math.max(0, a.right - (window.innerWidth - 16 - drawer.offsetWidth)) : 0;
          const base = Math.abs(covered) < w * 0.6 ? covered : 0;
          target = Math.abs(base) + right < w * 0.8 ? (base + right) / 2 : base / 2;
        }
        if (!placed || reducedMotion) shift = target;
        placed = true;
        applyShift();
      };
      refit.current = fit;

      // The selected node's ring turns slowly; the stars drift.
      let spin = 0;
      const tick = () => {
        spin = requestAnimationFrame(tick);
        if (shift !== target) {
          shift += (target - shift) * 0.12;
          if (Math.abs(target - shift) < 0.5) shift = target;
          applyShift();
        } else if (shift !== 0 && (!cam.view?.enabled || cam.view.fullWidth !== el.clientWidth)) applyShift();
        if (reducedMotion) return;
        stars.rotation.y += 0.00006;
        for (const p of parts.current.values()) if (p.ring?.visible) p.ring.rotation.z += 0.004;
      };
      tick();

      fit();
      const ro = new ResizeObserver(fit);
      ro.observe(el);
      const side = el.parentElement?.querySelector(".mg-side");
      if (side) ro.observe(side);
      cleanup = () => {
        ro.disconnect();
        cancelAnimationFrame(spin);
        cancelAnimationFrame(raf);
        clearTimeout(idle);
        controls.removeEventListener("start", onStart);
        controls.removeEventListener("end", onEnd);
        controls.removeEventListener("change", onChange);
        const r = g.renderer();
        g._destructor();
        r.dispose();
        r.forceContextLoss();
        el.replaceChildren();
      };
      setReady(true);
    })();
    return () => {
      gone = true;
      cleanup();
      graph.current = null;
    };
    // The scene is created once; data and selection are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The drawer opened or closed: glide the graph into the space left free.
  useEffect(() => {
    refit.current();
  }, [rightPanel, ready]);

  // Data and selection → nodes, links, emphasis and camera.
  const lastSel = useRef<string>("");
  useEffect(() => {
    const g = graph.current;
    const T = three.current;
    if (!g || !T || !ready) return;
    const want: GNode[] = [];
    const links: GLink[] = [];
    const born = new Set<string>();
    const node = (n: Omit<GNode, "dotsKey">): GNode => {
      const dotsKey = n.dots.join(",");
      const cur = nodes.current.get(n.id);
      // Keep the same object (and so its position) unless its look changed.
      if (cur && cur.colour === n.colour && cur.r === n.r && cur.dotsKey === dotsKey) {
        cur.count = n.count;
        return cur;
      }
      const near = nodes.current.get(n.kind === "entry" ? n.root : n.level === 2 ? n.root : "core");
      const jitter = () => (Math.random() - 0.5) * 18;
      const fresh: GNode = { ...n, dotsKey, ...(cur ? { x: cur.x, y: cur.y, z: cur.z } : near?.x != null ? { x: near.x + jitter(), y: (near.y ?? 0) + jitter(), z: (near.z ?? 0) + jitter() } : {}) };
      if (!cur) born.add(n.id);
      nodes.current.set(n.id, fresh);
      return fresh;
    };
    const core = node({ id: "core", kind: "core", level: 0, root: "core", name: "Tracker", count: spec.total, colour: "#7fd3d8", r: 4.5, dots: [], labelScale: 0 });
    // Pinned at the centre at first; a dragged core stays where it is dropped.
    if (core.fx == null) core.fx = core.fy = core.fz = 0;
    want.push(core);
    const byId = new Map(spec.hubs.map((h) => [h.id, h]));
    for (const h of spec.hubs) {
      const root = h.level === 2 && h.parent ? h.parent : h.id;
      want.push(
        node({ id: h.id, kind: "hub", level: h.level, root, name: h.name, count: h.count, colour: h.colour, r: h.r, dots: h.dots.slice(0, DOTS_MAX), labelScale: h.labelScale }),
      );
      links.push(h.level === 2 && h.parent && byId.has(h.parent) ? { source: h.parent, target: h.id, kind: "sub", weight: 1 } : { source: "core", target: h.id, kind: "core", weight: 1 });
    }
    // Competitors: an even place on the orbit each, the biggest ones far apart.
    const slotted = spec.layout === "competitors" ? want.filter((n) => n.kind === "hub" && n.level === 1) : [];
    const slots = spreadSlots(slotted.map((n) => n.r));
    slotted.forEach((n, i) => {
      n.slot = slots[i];
      // A new competitor starts at its place rather than drifting there from the core.
      if (born.has(n.id)) {
        const d = orbitOf(n);
        n.x = (core.x ?? 0) + n.slot![0] * d;
        n.y = (core.y ?? 0) + n.slot![1] * d;
        n.z = (core.z ?? 0) + n.slot![2] * d;
      }
    });
    for (const t of spec.ties) if (byId.has(t.a) && byId.has(t.b)) links.push({ source: t.a, target: t.b, kind: "tie", weight: t.weight });
    if (spec.orbit && byId.has(spec.orbit.hub)) {
      const hub = spec.orbit.hub;
      for (const e of spec.orbit.entries.slice(-ENTRIES_SHOWN)) {
        want.push(node({ id: `e:${e.id}`, kind: "entry", level: 0, root: hub, name: e.title, title: e.title, date: e.date, count: 1, colour: e.colour, r: 1.5, dots: [], labelScale: 0 }));
        links.push({ source: hub, target: `e:${e.id}`, kind: "entry", weight: 1 });
      }
    }
    for (const n of want) {
      const hold = n.kind === "hub" && n.id === spec.selected;
      if (hold && !n.pinned && n.x != null) {
        n.fx = n.x;
        n.fy = n.y;
        n.fz = n.z;
        n.pinned = true;
      } else if (!hold && n.pinned) {
        n.fx = n.fy = n.fz = undefined;
        n.pinned = false;
      }
    }
    const keep = new Set(want.map((n) => n.id));
    for (const id of [...nodes.current.keys()]) if (!keep.has(id)) nodes.current.delete(id);
    for (const id of [...parts.current.keys()]) if (!keep.has(id)) parts.current.delete(id);
    g.graphData({ nodes: want, links });

    // Emphasis: the open branch is bright, the rest recedes (nodes drawn later get it in buildNode).
    const lit = litSet(spec);
    for (const n of want) {
      const p = parts.current.get(n.id);
      if (p) emphasise(n, p, spec, lit);
    }

    // Camera: fly to what was just selected.
    const key = spec.selected ?? "";
    if (key === lastSel.current) return;
    lastSel.current = key;
    const target = spec.selected ? nodes.current.get(spec.selected) : null;
    const fly = () => {
      if (!target) return void g.cameraPosition({ x: 0, y: 40, z: spec.layout === "competitors" ? 420 : 360 }, { x: 0, y: 0, z: 0 }, 1400);
      // Opened from a link, the node had no position to hold yet: hold it now, so the
      // layout settles around it instead of carrying it away from the camera.
      if (!target.pinned && target.x != null && lastSel.current === key) {
        target.fx = target.x;
        target.fy = target.y;
        target.fz = target.z;
        target.pinned = true;
      }
      const { x = 0, y = 0, z = 0 } = target;
      // Look from beyond the node, away from its parent (the core, or the Macrotrend), so nothing blocks it.
      const parent = target.level === 2 ? nodes.current.get(target.root) : null;
      const dx = x - (parent?.x ?? 0);
      const dy = y - (parent?.y ?? 0);
      const dz = z - (parent?.z ?? 0);
      const len = Math.hypot(dx, dy, dz) || 1;
      const back = (target.level === 2 ? 85 : spec.layout === "competitors" ? 170 : 140) + target.r * 3;
      g.cameraPosition({ x: x + (dx / len) * back, y: y + (dy / len) * back + 14, z: z + (dz / len) * back }, { x, y, z }, 1400);
    };
    // A node just added has no settled position yet: wait for the layout.
    if (target && target.x == null) setTimeout(fly, 900);
    else fly();
    // Entries spread out in orbit around the selected hub: then frame them all.
    if (target && spec.orbit?.hub === target.id) {
      const id = target.id;
      setTimeout(() => {
        if (graph.current !== g || lastSel.current !== key) return;
        const group = [...nodes.current.values()].filter((n) => (n.id === id || (n.kind === "entry" && n.root === id)) && n.x != null);
        if (group.length < 2) return;
        const c = { x: 0, y: 0, z: 0 };
        for (const n of group) {
          c.x += n.x! / group.length;
          c.y += (n.y ?? 0) / group.length;
          c.z += (n.z ?? 0) / group.length;
        }
        const reach = Math.max(...group.map((n) => Math.hypot(n.x! - c.x, (n.y ?? 0) - c.y, (n.z ?? 0) - c.z) + n.r));
        const fov = ((g.camera() as ThreeNS.PerspectiveCamera).fov * Math.PI) / 180;
        const dist = Math.max(spec.layout === "competitors" ? 150 : 70, (reach / Math.tan(fov / 2)) * 1.5);
        const parent = target.level === 2 ? nodes.current.get(target.root) : null;
        const dx = c.x - (parent?.x ?? 0);
        const dy = c.y - (parent?.y ?? 0);
        const dz = c.z - (parent?.z ?? 0);
        const len = Math.hypot(dx, dy, dz) || 1;
        g.cameraPosition({ x: c.x + (dx / len) * dist, y: c.y + (dy / len) * dist, z: c.z + (dz / len) * dist }, c, 1100);
      }, 2200);
    }
  }, [spec, ready]);

  function buildNode(T: Three, n: GNode) {
    const group = new T.Group();
    const materials: Parts["materials"] = [];
    const track = <M extends ThreeNS.Material & { opacity: number }>(m: M) => {
      m.transparent = true;
      materials.push({ m, base: m.opacity });
      return m;
    };
    const colour = new T.Color(n.colour);
    if (n.kind === "entry") {
      const dot = new T.Mesh(new T.SphereGeometry(n.r, 16, 12), track(new T.MeshBasicMaterial({ color: new T.Color(shade(n.colour, 0.25)), opacity: 1 })));
      group.add(dot);
      group.add(glow(T, n.colour, n.r * 6, 0.5, track));
    } else if (n.kind === "core") {
      const sphere = new T.Mesh(
        new T.SphereGeometry(n.r, 48, 32),
        track(new T.MeshStandardMaterial({ color: colour, emissive: colour, emissiveIntensity: 0.9, roughness: 0.42, metalness: 0.12, opacity: 1 })),
      );
      group.add(sphere);
      group.add(glow(T, n.colour, n.r * 7, 0.75, track));
    } else {
      // A translucent shell, so the entries inside show through.
      const shell = new T.Mesh(
        new T.SphereGeometry(n.r, 48, 32),
        track(new T.MeshStandardMaterial({ color: colour, emissive: colour, emissiveIntensity: 0.35, roughness: 0.3, metalness: 0.05, opacity: 0.24, depthWrite: false })),
      );
      shell.renderOrder = 1;
      group.add(shell);
      const rim = new T.Mesh(new T.SphereGeometry(n.r * 1.002, 48, 32), track(new T.MeshBasicMaterial({ color: colour, side: T.BackSide, opacity: 0.16, depthWrite: false })));
      rim.renderOrder = 1;
      group.add(rim);
      if (n.dots.length) {
        const pts = innerDots(T, n.id, n.dots, n.r);
        track(pts.material as ThreeNS.PointsMaterial);
        group.add(pts);
      }
      group.add(glow(T, n.colour, n.r * 3.6, 0.3, track));
      // Hubs too small to label (competitors named once or twice) show their name on hover.
      if (n.labelScale > 0) {
        const label = textSprite(T, n.name, plural(n.count, "entry", "entries"), n.labelScale);
        label.position.set(0, -n.r - Math.max(2.5, 9 * n.labelScale), 0);
        track(label.material);
        group.add(label);
      }
    }
    let ring: ThreeNS.Mesh | null = null;
    if (n.kind === "hub") {
      ring = new T.Mesh(new T.TorusGeometry(Math.max(n.r * 1.55, n.r + 2.5), Math.max(0.18, n.r * 0.03), 8, 96), new T.MeshBasicMaterial({ color: 0x7fd3d8, transparent: true, opacity: 0.7 }));
      ring.rotation.x = Math.PI / 2.6;
      ring.visible = false;
      group.add(ring);
    }
    const p = { group, materials, ring };
    emphasise(n, p, live.current.spec, litSet(live.current.spec));
    parts.current.set(n.id, p);
    return group;
  }

  return <div ref={host} className={`mg-canvas ${layout}`} aria-hidden="true" data-testid="mg-canvas" />;
}

/** Hubs that stay bright: the open one, its Subtrends, and (Competitors) the competitors tied to it. */
function litSet(spec: GraphSpec): Set<string> | null {
  if (!spec.open) return null;
  const lit = new Set([spec.open]);
  for (const h of spec.hubs) if (h.parent === spec.open) lit.add(h.id);
  for (const t of spec.ties) {
    if (t.a === spec.open) lit.add(t.b);
    if (t.b === spec.open) lit.add(t.a);
  }
  return lit;
}

/** The open branch is bright; the rest recedes. With a Subtrend selected, its siblings and its Macrotrend step back. */
function emphasise(n: GNode, p: Parts, spec: GraphSpec, lit: Set<string> | null) {
  const on = !lit || n.kind === "core" || lit.has(n.kind === "entry" ? n.root : n.id) || lit.has(n.root);
  const selLevel2 = spec.selected != null && spec.hubs.find((h) => h.id === spec.selected)?.level === 2;
  const recede = selLevel2 && n.kind === "hub" && n.id !== spec.selected;
  const k = !on ? 0.2 : recede ? 0.45 : 1;
  for (const { m, base } of p.materials) m.opacity = base * k;
  if (p.ring) p.ring.visible = n.id === spec.selected;
}

/** One dot per entry, scattered through the sphere (the same place every time), coloured by Impact. */
function innerDots(T: Three, id: string, colours: string[], r: number): ThreeNS.Points {
  let seed = 0;
  for (let i = 0; i < id.length; i++) seed = (seed * 31 + id.charCodeAt(i)) >>> 0;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const n = colours.length;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const c = new T.Color();
  for (let i = 0; i < n; i++) {
    const d = r * 0.78 * Math.cbrt(rand());
    const th = Math.acos(2 * rand() - 1);
    const ph = rand() * Math.PI * 2;
    pos.set([d * Math.sin(th) * Math.cos(ph), d * Math.sin(th) * Math.sin(ph), d * Math.cos(th)], i * 3);
    c.set(colours[i]!);
    col.set([c.r, c.g, c.b], i * 3);
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute("position", new T.BufferAttribute(pos, 3));
  geo.setAttribute("color", new T.BufferAttribute(col, 3));
  const size = Math.max(0.8, Math.min(3.6, r * 0.14 + 0.8));
  const mat = new T.PointsMaterial({ size, sizeAttenuation: true, vertexColors: true, map: dotTexture(T), alphaTest: 0.2, transparent: true, opacity: 0.95, depthWrite: false });
  const pts = new T.Points(geo, mat);
  pts.renderOrder = 2;
  return pts;
}

let dotTex: ThreeNS.Texture | null = null;
function dotTexture(T: Three): ThreeNS.Texture {
  if (dotTex) return dotTex;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const gr = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, "rgba(255,255,255,1)");
  gr.addColorStop(0.55, "rgba(255,255,255,1)");
  gr.addColorStop(0.75, "rgba(255,255,255,0.5)");
  gr.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, 64, 64);
  dotTex = new T.CanvasTexture(c);
  return dotTex;
}

function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
}

let glowTexture: ThreeNS.Texture | null = null;
function glow(T: Three, colour: string, size: number, opacity: number, track: <M extends ThreeNS.Material & { opacity: number }>(m: M) => M) {
  if (!glowTexture) {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const ctx = c.getContext("2d")!;
    const gr = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, "rgba(255,255,255,1)");
    gr.addColorStop(0.22, "rgba(255,255,255,0.45)");
    gr.addColorStop(0.55, "rgba(255,255,255,0.10)");
    gr.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, 128, 128);
    glowTexture = new T.CanvasTexture(c);
  }
  const s = new T.Sprite(track(new T.SpriteMaterial({ map: glowTexture, color: new T.Color(colour), blending: T.AdditiveBlending, depthWrite: false, opacity })));
  s.scale.set(size, size, 1);
  return s;
}

/** A crisp two-line label (name, count) that always faces the camera. */
function textSprite(T: Three, title: string, sub: string, scale: number) {
  const px = 44;
  const lines = wrap(title, 26);
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d")!;
  const font = `700 ${px}px "Nunito Sans", system-ui, sans-serif`;
  const small = `600 ${px * 0.72}px "Nunito Sans", system-ui, sans-serif`;
  ctx.font = font;
  const w = Math.ceil(Math.max(...lines.map((l) => ctx.measureText(l).width), 10)) + 24;
  const h = Math.ceil(px * 1.18 * lines.length + px * 0.95) + 12;
  c.width = w;
  c.height = h;
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.shadowColor = "rgba(2, 10, 18, 0.9)";
  ctx.shadowBlur = 10;
  ctx.fillStyle = "#eef6f8";
  lines.forEach((l, i) => ctx.fillText(l, w / 2, 4 + i * px * 1.18));
  ctx.font = small;
  ctx.fillStyle = "#9fd8dc";
  ctx.fillText(sub, w / 2, 8 + lines.length * px * 1.18);
  const tex = new T.CanvasTexture(c);
  tex.colorSpace = T.SRGBColorSpace;
  tex.anisotropy = 4;
  const sprite = new T.Sprite(new T.SpriteMaterial({ map: tex, depthWrite: false, transparent: true, opacity: 1 }));
  const k = 0.11 * scale;
  sprite.scale.set(w * k, h * k, 1);
  sprite.center.set(0.5, 1);
  sprite.renderOrder = 10;
  return sprite;
}

function wrap(text: string, max: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const w of text.split(/\s+/)) {
    if (line && (line + " " + w).length > max) {
      out.push(line);
      line = w;
    } else line = line ? `${line} ${w}` : w;
  }
  if (line) out.push(line);
  return out.slice(0, 3);
}

/** A sparse shell of faint stars around the graph (it turns with the view, for depth). */
function starfield(T: Three) {
  const n = 1600;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const tints = [
    [1, 1, 1],
    [0.75, 0.9, 1],
    [0.62, 0.86, 0.88],
    [1, 0.93, 0.8],
  ];
  for (let i = 0; i < n; i++) {
    const r = 700 + Math.random() * 1100;
    const t = Math.acos(2 * Math.random() - 1);
    const p = Math.random() * Math.PI * 2;
    pos.set([r * Math.sin(t) * Math.cos(p), r * Math.sin(t) * Math.sin(p), r * Math.cos(t)], i * 3);
    const tint = tints[i % tints.length]!;
    const b = 0.35 + Math.random() * 0.65;
    col.set([tint[0]! * b, tint[1]! * b, tint[2]! * b], i * 3);
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute("position", new T.BufferAttribute(pos, 3));
  geo.setAttribute("color", new T.BufferAttribute(col, 3));
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const ctx = c.getContext("2d")!;
  const gr = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, "rgba(255,255,255,1)");
  gr.addColorStop(0.4, "rgba(255,255,255,0.5)");
  gr.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, 32, 32);
  const mat = new T.PointsMaterial({ size: 5, sizeAttenuation: true, vertexColors: true, map: new T.CanvasTexture(c), transparent: true, opacity: 0.8, depthWrite: false, blending: T.AdditiveBlending });
  return new T.Points(geo, mat);
}

/** How far a level-1 hub sits from the core: the same orbit for Macrotrends and competitors. */
const orbitOf = (n: GNode) => 66 + n.r * 2.2;

/** Pulls each hub with a `slot` towards its place on the orbit around the core (a d3-force-3d compatible force). */
function slotForce(strength: number) {
  let nodes: GNode[] = [];
  let core: GNode | undefined;
  const force = (alpha: number) => {
    const cx = core?.x ?? 0;
    const cy = core?.y ?? 0;
    const cz = core?.z ?? 0;
    for (const n of nodes) {
      if (!n.slot || n.x == null) continue;
      const d = orbitOf(n);
      const k = strength * alpha;
      n.vx = (n.vx ?? 0) + (cx + n.slot[0] * d - n.x) * k;
      n.vy = (n.vy ?? 0) + (cy + n.slot[1] * d - (n.y ?? 0)) * k;
      n.vz = (n.vz ?? 0) + (cz + n.slot[2] * d - (n.z ?? 0)) * k;
    }
  };
  force.initialize = (ns: GNode[]) => {
    nodes = ns;
    core = ns.find((n) => n.kind === "core");
  };
  return force;
}
