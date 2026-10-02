/**
 * The Megatrends knowledge graph: Macrotrends (sized by their number of
 * Tracker entries) around a central core, a selected Macrotrend's Subtrends,
 * and a selected Subtrend's entries, floating in a field of stars. Drag to
 * rotate, scroll to zoom, drag a node to move it.
 *
 * three.js and 3d-force-graph are loaded on first use, so only this page
 * carries them. Everything here is also reachable without the canvas (the
 * page's Macrotrend list, summary panel and timeline).
 */
import { useEffect, useRef, useState } from "react";
import type { MegatrendEntry } from "@eradigm/shared";
import type { ForceGraph3DInstance } from "3d-force-graph";
import type ForceGraph3DClass from "3d-force-graph";
import type * as ThreeNS from "three";
import { NEUTRAL, plural, shade, type Macro, type Palette, type Selection } from "./model";

type Three = typeof ThreeNS;

export interface Focus {
  macro: string;
  sub: string | null;
}

interface GNode {
  id: string;
  kind: "core" | "macro" | "sub" | "entry";
  name: string;
  macro: string | null;
  sub: string | null;
  count: number;
  colour: string;
  r: number;
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
}
interface GLink {
  source: string | GNode;
  target: string | GNode;
  kind: "macro" | "sub" | "entry";
}

/** The Three.js pieces of a node whose look changes with the selection. */
interface Parts {
  group: ThreeNS.Group;
  materials: { m: ThreeNS.Material & { opacity: number }; base: number }[];
  ring: ThreeNS.Mesh | null;
}

const ENTRIES_SHOWN = 80;
const radius = (kind: GNode["kind"], n: number) =>
  kind === "core" ? 4.5 : kind === "macro" ? Math.min(26, 5 + 2.6 * Math.sqrt(n)) : kind === "sub" ? Math.min(15, 3 + 1.9 * Math.sqrt(n)) : 1.25;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function Graph3D({
  macros,
  entries,
  palette,
  sel,
  total,
  reducedMotion,
  onSelect,
  onFocus,
  onEntry,
  onUnavailable,
}: {
  macros: Macro[];
  entries: MegatrendEntry[];
  palette: Palette;
  sel: Selection;
  total: number;
  reducedMotion: boolean;
  onSelect: (s: Selection) => void;
  onFocus: (f: Focus | null) => void;
  onEntry: (id: string) => void;
  onUnavailable: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const graph = useRef<ForceGraph3DInstance | null>(null);
  const three = useRef<Three | null>(null);
  const nodes = useRef(new Map<string, GNode>());
  const parts = useRef(new Map<string, Parts>());
  const [ready, setReady] = useState(false);
  // Latest callbacks and selection, for the long-lived graph handlers.
  const live = useRef({ onSelect, onFocus, onEntry, sel });
  live.current = { onSelect, onFocus, onEntry, sel };

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
        .linkColor((l: object) => ((l as GLink).kind === "macro" ? "rgba(127, 211, 216, 0.30)" : "rgba(127, 211, 216, 0.42)"))
        .linkOpacity(0.5)
        .linkWidth((l: object) => ((l as GLink).kind === "entry" ? 0.15 : 0.35))
        .linkDirectionalParticles((l: object) => (reducedMotion ? 0 : (l as GLink).kind === "entry" ? 0 : 2))
        .linkDirectionalParticleWidth(1.1)
        .linkDirectionalParticleSpeed(0.0035)
        .linkDirectionalParticleColor(() => "#7fd3d8")
        .onNodeClick((n: object) => {
          const x = n as GNode;
          const s = live.current.sel;
          if (x.kind === "entry") return live.current.onEntry(x.id.slice(2));
          if (x.kind === "core") return live.current.onSelect({ macro: null, sub: null });
          if (x.kind === "macro") return live.current.onSelect(s.macro === x.name && !s.sub ? { macro: null, sub: null } : { macro: x.name, sub: null });
          live.current.onSelect(s.sub === x.sub ? { macro: x.macro, sub: null } : { macro: x.macro, sub: x.sub });
        })
        .onNodeDragEnd((n: object) => {
          // Let a dragged node float again (the core stays at the centre).
          const x = n as GNode;
          if (x.kind === "core") return;
          if (x.pinned) {
            x.fx = x.x;
            x.fy = x.y;
            x.fz = x.z;
          } else x.fx = x.fy = x.fz = undefined;
        })
        .cooldownTime(6000);
      g.d3Force("charge")?.strength?.((n: GNode) => (n.kind === "macro" ? -170 : n.kind === "sub" ? -110 : n.kind === "entry" ? -6 : -40));
      g.d3Force("link")
        ?.distance?.((l: GLink) => {
          const s = l.source as GNode;
          const t = l.target as GNode;
          return l.kind === "macro" ? 66 + t.r * 2.2 : l.kind === "sub" ? 34 + s.r + t.r * 2 : 10 + s.r;
        })
        ?.strength?.((l: GLink) => (l.kind === "macro" ? 0.6 : 0.9));

      // Lighting: a soft fill plus a key light, so spheres read as spheres.
      const key = new T.DirectionalLight(0xffffff, 2.6);
      key.position.set(160, 220, 260);
      g.lights([new T.AmbientLight(0x9fc6d6, 1.25), key]);
      const stars = starfield(T);
      g.scene().add(stars);
      g.cameraPosition({ x: 0, y: 40, z: 360 });

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
      // Zooming into a node shows its summary (the nearest Macrotrend, or Subtrend once one is open).
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
            if ((n.kind !== "macro" && n.kind !== "sub") || n.x == null) continue;
            const d = Math.hypot(cam.x - n.x, cam.y - (n.y ?? 0), cam.z - (n.z ?? 0)) - n.r;
            const reach = n.kind === "macro" ? 95 + n.r * 2 : 55 + n.r * 2;
            if (d < reach && d < bestD) {
              best = n;
              bestD = d;
            }
          }
          const key = best ? best.id : "";
          if (key === lastFocus) return;
          lastFocus = key;
          live.current.onFocus(best ? { macro: best.macro ?? best.name, sub: best.kind === "sub" ? best.sub : null } : null);
        });
      };
      controls.addEventListener("start", onStart);
      controls.addEventListener("end", onEnd);
      controls.addEventListener("change", onChange);

      // Centre the graph in the space beside the summary and Macrotrend list
      // (the .mg-side column over its right edge): shift the view left by half
      // the width they cover. Picking follows, as it uses the same projection.
      // The library clears the camera's view offset once after it starts, so
      // the frame loop puts it back whenever it is missing.
      const cam = g.camera() as ThreeNS.PerspectiveCamera;
      let shift = 0;
      const applyShift = () => {
        const w = el.clientWidth;
        const h = el.clientHeight;
        if (shift > 0) cam.setViewOffset(w, h, shift, 0, w, h);
        else cam.clearViewOffset();
        cam.updateProjectionMatrix();
      };
      const fit = () => {
        const w = el.clientWidth;
        g.width(w).height(el.clientHeight);
        const side = el.parentElement?.querySelector(".mg-side");
        const covered = side && getComputedStyle(side).position === "absolute" ? Math.max(0, el.getBoundingClientRect().right - side.getBoundingClientRect().left) : 0;
        shift = covered > 0 && covered < w * 0.6 ? covered / 2 : 0;
        applyShift();
      };

      // The selected node's ring turns slowly; the stars drift.
      let spin = 0;
      const tick = () => {
        spin = requestAnimationFrame(tick);
        if (shift > 0 && (!cam.view?.enabled || cam.view.fullWidth !== el.clientWidth)) applyShift();
        if (reducedMotion) return;
        stars.rotation.y += 0.00006;
        for (const p of parts.current.values()) if (p.ring?.visible) p.ring.rotation.z += 0.004;
      };
      tick();

      fit();
      const ro = new ResizeObserver(fit);
      ro.observe(el);
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

  // Data and selection → nodes, links, emphasis and camera.
  const lastSel = useRef<string>("");
  useEffect(() => {
    const g = graph.current;
    const T = three.current;
    if (!g || !T || !ready) return;
    const want: GNode[] = [];
    const links: GLink[] = [];
    const node = (n: Omit<GNode, "r">): GNode => {
      const r = radius(n.kind, n.count);
      const cur = nodes.current.get(n.id);
      // Keep the same object (and so its position) unless its look changed.
      if (cur && cur.colour === n.colour && cur.r === r) {
        cur.count = n.count;
        return cur;
      }
      const near = n.macro ? nodes.current.get(n.sub && n.kind === "entry" ? `s:${n.macro}\u001f${n.sub}` : `m:${n.macro}`) : undefined;
      const jitter = () => (Math.random() - 0.5) * 18;
      const fresh: GNode = { ...n, r, ...(cur ? { x: cur.x, y: cur.y, z: cur.z } : near?.x != null ? { x: near.x + jitter(), y: (near.y ?? 0) + jitter(), z: (near.z ?? 0) + jitter() } : {}) };
      nodes.current.set(n.id, fresh);
      return fresh;
    };
    const core = node({ id: "core", kind: "core", name: "Tracker", macro: null, sub: null, count: total, colour: "#7fd3d8" });
    core.fx = core.fy = core.fz = 0;
    want.push(core);
    for (const m of macros) {
      if (m.count < 1) continue;
      want.push(node({ id: `m:${m.name}`, kind: "macro", name: m.name, macro: m.name, sub: null, count: m.count, colour: palette.macro.get(m.name) ?? NEUTRAL }));
      links.push({ source: "core", target: `m:${m.name}`, kind: "macro" });
      if (sel.macro !== m.name) continue;
      for (const s of m.subtrends) {
        if (s.count < 1) continue;
        const id = `s:${m.name}\u001f${s.name}`;
        want.push(node({ id, kind: "sub", name: s.name, macro: m.name, sub: s.name, count: s.count, colour: palette.sub.get(m.name)?.get(s.name) ?? NEUTRAL }));
        links.push({ source: `m:${m.name}`, target: id, kind: "sub" });
        if (sel.sub !== s.name) continue;
        const own = entries.filter((e) => e.macrotrend === m.name && e.subtrend === s.name).slice(-ENTRIES_SHOWN);
        for (const e of own) {
          want.push(node({ id: `e:${e.id}`, kind: "entry", name: e.title, title: e.title, date: e.date, macro: m.name, sub: s.name, count: 1, colour: palette.sub.get(m.name)?.get(s.name) ?? NEUTRAL }));
          links.push({ source: id, target: `e:${e.id}`, kind: "entry" });
        }
      }
    }
    for (const n of want) {
      const hold = (n.kind === "macro" && n.name === sel.macro) || (n.kind === "sub" && n.macro === sel.macro && n.sub === sel.sub);
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
    for (const n of want) {
      const p = parts.current.get(n.id);
      if (p) emphasise(n, p, sel);
    }

    // Camera: fly to what was just selected.
    const key = `${sel.macro ?? ""}\u001f${sel.sub ?? ""}`;
    if (key === lastSel.current) return;
    lastSel.current = key;
    const target = sel.sub ? nodes.current.get(`s:${sel.macro}\u001f${sel.sub}`) : sel.macro ? nodes.current.get(`m:${sel.macro}`) : null;
    const fly = () => {
      if (!target) return void g.cameraPosition({ x: 0, y: 40, z: 360 }, { x: 0, y: 0, z: 0 }, 1400);
      const { x = 0, y = 0, z = 0 } = target;
      // Look from beyond the node, away from its parent (the core, or the Macrotrend), so nothing blocks it.
      const parent = sel.sub ? nodes.current.get(`m:${sel.macro}`) : null;
      const dx = x - (parent?.x ?? 0);
      const dy = y - (parent?.y ?? 0);
      const dz = z - (parent?.z ?? 0);
      const len = Math.hypot(dx, dy, dz) || 1;
      const back = (sel.sub ? 85 : 140) + target.r * 3;
      g.cameraPosition({ x: x + (dx / len) * back, y: y + (dy / len) * back + 14, z: z + (dz / len) * back }, { x, y, z }, 1400);
    };
    // A node just added has no settled position yet: wait for the layout.
    if (target?.x == null) setTimeout(fly, 900);
    else fly();
    // A Subtrend's entries spread out around it: then frame them all.
    if (sel.sub && target) {
      const id = target.id;
      setTimeout(() => {
        if (graph.current !== g || lastSel.current !== key) return;
        const group = [...nodes.current.values()].filter((n) => (n.id === id || n.kind === "entry") && n.x != null);
        if (group.length < 2) return;
        const c = { x: 0, y: 0, z: 0 };
        for (const n of group) {
          c.x += n.x! / group.length;
          c.y += (n.y ?? 0) / group.length;
          c.z += (n.z ?? 0) / group.length;
        }
        const reach = Math.max(...group.map((n) => Math.hypot(n.x! - c.x, (n.y ?? 0) - c.y, (n.z ?? 0) - c.z) + n.r));
        const fov = ((g.camera() as ThreeNS.PerspectiveCamera).fov * Math.PI) / 180;
        const dist = Math.max(70, (reach / Math.tan(fov / 2)) * 1.5);
        const parent = nodes.current.get(`m:${sel.macro}`);
        const dx = c.x - (parent?.x ?? 0);
        const dy = c.y - (parent?.y ?? 0);
        const dz = c.z - (parent?.z ?? 0);
        const len = Math.hypot(dx, dy, dz) || 1;
        g.cameraPosition({ x: c.x + (dx / len) * dist, y: c.y + (dy / len) * dist, z: c.z + (dz / len) * dist }, c, 1100);
      }, 2200);
    }
  }, [macros, entries, palette, sel, total, ready]);

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
      const dot = new T.Mesh(new T.SphereGeometry(n.r, 16, 12), track(new T.MeshBasicMaterial({ color: new T.Color(shade(n.colour, 0.35)), opacity: 1 })));
      group.add(dot);
      group.add(glow(T, n.colour, n.r * 6, 0.5, track));
    } else {
      const sphere = new T.Mesh(
        new T.SphereGeometry(n.r, 48, 32),
        track(
          new T.MeshStandardMaterial({
            color: colour,
            emissive: colour,
            emissiveIntensity: n.kind === "core" ? 0.9 : 0.28,
            roughness: 0.42,
            metalness: 0.12,
            opacity: 1,
          }),
        ),
      );
      group.add(sphere);
      group.add(glow(T, n.colour, n.r * (n.kind === "core" ? 7 : 4.2), n.kind === "core" ? 0.75 : 0.42, track));
      if (n.kind !== "core") {
        const label = textSprite(T, n.name, plural(n.count, "entry", "entries"), n.kind === "macro" ? 0.9 : 0.62);
        label.position.set(0, -n.r - (n.kind === "macro" ? 9 : 6), 0);
        track(label.material);
        group.add(label);
      }
    }
    let ring: ThreeNS.Mesh | null = null;
    if (n.kind === "macro" || n.kind === "sub") {
      ring = new T.Mesh(new T.TorusGeometry(n.r * 1.55, Math.max(0.18, n.r * 0.03), 8, 96), new T.MeshBasicMaterial({ color: 0x7fd3d8, transparent: true, opacity: 0.7 }));
      ring.rotation.x = Math.PI / 2.6;
      ring.visible = false;
      group.add(ring);
    }
    const p = { group, materials, ring };
    emphasise(n, p, live.current.sel);
    parts.current.set(n.id, p);
    return group;
  }

  return <div ref={host} className="mg-canvas" aria-hidden="true" data-testid="mg-canvas" />;
}

/** The open branch is bright; the rest recedes. With a Subtrend open, its siblings and its Macrotrend step back. */
function emphasise(n: GNode, p: Parts, sel: Selection) {
  const lit = !sel.macro || n.kind === "core" || n.macro === sel.macro;
  const recede = sel.sub != null && ((n.kind === "sub" && n.sub !== sel.sub) || n.kind === "macro");
  const k = !lit ? 0.22 : recede ? 0.4 : 1;
  for (const { m, base } of p.materials) m.opacity = base * k;
  if (p.ring) p.ring.visible = (n.kind === "macro" && n.name === sel.macro && !sel.sub) || (n.kind === "sub" && n.sub === sel.sub);
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
