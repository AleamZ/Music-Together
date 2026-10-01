import type { Vec } from "@/lib/game/types";
import { canalCrossings, lotusPonds, stiltHouses } from "./delta";
import { CABLE, LAKE } from "./nuicam";
import { cumulative, pointAt, ROADS, TRAILS } from "./roads";
import { CANALS, CANAL_HALF_W, canalDist, RIVER_PTS, riverAt, riverHalfWidth, STREAM_HALF_W, STREAM_PTS, zoneUnder } from "./terrain";
import type { WaypointMark } from "./waypoints";
import { BASE_H, BASE_W, baseRows, KIND_COLOUR, MAP_LABELS, MAP_STEP, toCanvas, ZONE_TINT, type MapView } from "./worldmap";
import { WORLD_H, WORLD_W, ZONE_IDS, ZONES } from "./zones";

// Browser only: the world map's base image (built ONCE per session: the land in workers — worldmap.worker.ts — or in
// idle slices without them; the water, zones, roads, bridges and houses drawn over it as shapes from the world data) and
// the per-frame overlays (labels, waypoints, people, me). The minimap and the full map share the one base.

/** Base canvas px per world px (2 × the land's resolution, so the roads and bridges stay crisp when zoomed). */
export const BASE_SCALE = 2 / MAP_STEP;

let base: HTMLCanvasElement | null = null;
let building = false;
const waiting = new Set<() => void>();

/** The finished base image, or null while it builds (it starts on the first call; `onReady` fires once it's done). */
export function worldMapBase(onReady?: () => void): HTMLCanvasElement | null {
  if (base) return base;
  if (onReady) waiting.add(onReady);
  if (!building && typeof document !== "undefined") {
    building = true;
    buildLand((land) => {
      base = finishBase(land);
      for (const f of waiting) f();
      waiting.clear();
    });
  }
  return null;
}

/** Test hook: forget the cached base. */
export function resetWorldMapBase(): void {
  base = null;
  building = false;
  waiting.clear();
}

function buildLand(done: (rgba: Uint8ClampedArray) => void): void {
  const rgba = new Uint8ClampedArray(BASE_W * BASE_H * 4);
  const bands = 2, per = Math.ceil(BASE_H / bands);
  let left = bands;
  const put = (row0: number, rows: Uint8ClampedArray) => {
    rgba.set(rows, row0 * BASE_W * 4);
    if (--left === 0) done(rgba);
  };
  let workers: Worker[] = [];
  if (typeof Worker !== "undefined") {
    try {
      for (let b = 0; b < bands; b++) {
        const w = new Worker(new URL("./worldmap.worker.ts", import.meta.url), { type: "module" });
        const row0 = b * per, row1 = Math.min(BASE_H, row0 + per);
        w.onmessage = (e: MessageEvent<{ rows: Uint8ClampedArray }>) => { put(row0, e.data.rows); w.terminate(); };
        w.onerror = () => { w.terminate(); put(row0, baseRows(row0, row1)); };      // the fallback: build that band here
        w.postMessage({ row0, row1 });
        workers.push(w);
      }
      return;
    } catch {
      for (const w of workers) w.terminate();
      workers = [];
      left = bands;
    }
  }
  // no workers: a few rows per idle slice (no long frame)
  let row = 0;
  const idle = (f: () => void) => (typeof requestIdleCallback === "function" ? requestIdleCallback(f) : setTimeout(f, 0));
  const step = () => {
    const end = Math.min(BASE_H, row + 16);
    rgba.set(baseRows(row, end), row * BASE_W * 4);
    row = end;
    if (row < BASE_H) idle(step);
    else done(rgba);
  };
  idle(step);
}

function finishBase(land: Uint8ClampedArray): HTMLCanvasElement {
  const img = document.createElement("canvas");
  img.width = BASE_W; img.height = BASE_H;
  const ictx = img.getContext("2d");
  if (ictx) ictx.putImageData(new ImageData(new Uint8ClampedArray(land), BASE_W, BASE_H), 0, 0);
  const c = document.createElement("canvas");
  c.width = Math.round(WORLD_W * BASE_SCALE); c.height = Math.round(WORLD_H * BASE_SCALE);
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, 0, 0, c.width, c.height);
  ctx.scale(BASE_SCALE, BASE_SCALE);
  drawBaseShapes(ctx);
  return c;
}

const line = (ctx: CanvasRenderingContext2D, pts: readonly Vec[], width: number, colour: string, dash: number[] = []) => {
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.lineJoin = ctx.lineCap = "round";
  ctx.setLineDash(dash);
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.stroke();
  ctx.setLineDash([]);
};

/** The shapes over the land, in world px: the zones' ground, the water (the one river at its true width, the canals,
 *  the stream, the lake, the lotus ponds), the roads and trails, the bridges and cầu khỉ, the stilt houses, the cable. */
export function drawBaseShapes(ctx: CanvasRenderingContext2D): void {
  for (const id of ZONE_IDS) {
    const z = ZONES[id];
    ctx.fillStyle = ZONE_TINT[id];
    ctx.fillRect(z.ox, z.oy, z.w, z.h);
    ctx.strokeStyle = "rgba(59,42,26,0.55)";
    ctx.lineWidth = 6;
    ctx.strokeRect(z.ox, z.oy, z.w, z.h);
  }
  // the river: segment by segment at its half-width there, a darker bank under it
  const cum = cumulative(RIVER_PTS), L = cum[cum.length - 1];
  for (const [colour, grow] of [["#6f6a44", 10], [KIND_COLOUR.river, 0]] as const) {
    ctx.strokeStyle = colour;
    ctx.lineCap = "round";
    let prev = pointAt(RIVER_PTS, cum, 0);
    for (let s = 24; s <= L + 23; s += 24) {
      const q = pointAt(RIVER_PTS, cum, Math.min(s, L));
      ctx.lineWidth = 2 * riverHalfWidth(Math.min(s, L)) + grow;
      ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(q.x, q.y); ctx.stroke();
      prev = q;
    }
  }
  for (const c of CANALS) { line(ctx, c, CANAL_HALF_W * 2 + 6, "#6f6a44"); line(ctx, c, CANAL_HALF_W * 2, KIND_COLOUR.canal); }
  line(ctx, STREAM_PTS, STREAM_HALF_W * 2, KIND_COLOUR.stream);
  ctx.fillStyle = KIND_COLOUR.lake;
  ctx.beginPath(); ctx.arc(LAKE.x, LAKE.y, LAKE.r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = KIND_COLOUR.pond;
  for (const p of lotusPonds()) { ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); }
  // the paths: the trails dashed, the roads with a kerb
  for (const t of TRAILS) line(ctx, t.pts, t.w, "#b8955e", [18, 10]);
  for (const r of ROADS) { line(ctx, r.pts, r.w + 10, "#8a6f4a"); line(ctx, r.pts, r.w, "#e2cfa4"); }
  // bridges: wherever a path is over the river or a canal (outside the zones), planks with rails; cầu khỉ thinner
  for (const [list, monkey] of [[ROADS, false], [TRAILS, true]] as const) for (const r of list) {
    const rc = cumulative(r.pts), rl = rc[rc.length - 1];
    let run: Vec[] = [];
    const flush = () => {
      if (run.length > 1) { line(ctx, run, (monkey ? r.w * 0.55 : r.w) + 10, "#3b2a1a"); line(ctx, run, monkey ? r.w * 0.55 : r.w, monkey ? "#a07a4a" : "#8a5a33"); }
      run = [];
    };
    for (let s = 0; s <= rl; s += 4) {
      const p = pointAt(r.pts, rc, s), rv = riverAt(p.x, p.y);
      const wet = !zoneUnder(p.x, p.y) && (rv.d < rv.hw || canalDist(p.x, p.y) < CANAL_HALF_W + 2);
      if (wet) run.push({ x: p.x, y: p.y }); else flush();
    }
    flush();
  }
  for (const b of canalCrossings()) if (b.monkey) {                                  // cầu khỉ: a bamboo pole across
    ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(-b.yaw);
    ctx.fillStyle = "#c9a45a"; ctx.fillRect(-3, -b.len / 2, 6, b.len);
    ctx.restore();
  }
  // nhà sàn: little roofs by the water
  for (const h of stiltHouses()) {
    ctx.save(); ctx.translate(h.x, h.y); ctx.rotate(-h.yaw);
    ctx.fillStyle = h.roof === "tin" ? "#9aa0a6" : "#8a6a3a";
    ctx.fillRect(-14, -11, 28, 22);
    ctx.strokeStyle = "#3b2a1a"; ctx.lineWidth = 3; ctx.strokeRect(-14, -11, 28, 22);
    ctx.restore();
  }
  line(ctx, [CABLE.a, CABLE.b], 5, "#3b3b3b", [14, 8]);
}

// ------------------------------------------------------------------ the overlays (per frame)

export interface MapPerson { id: string; x: number; y: number; kind: "party" | "friend" | "other"; name?: string }

export interface OverlayOpts {
  labels: "all" | "major" | "none";
  me: Vec | null;
  heading: number;
  boat: boolean;
  people: readonly MapPerson[];
  waypoints: readonly WaypointMark[];
  /** The canvas px per CSS px (text sizes). */
  dpr?: number;
  /** 0117: the room's ổ thính (world px), a dot of the kind's tint. */
  baits?: ReadonlyArray<{ x: number; y: number; color: string }>;
}

const PERSON: Readonly<Record<MapPerson["kind"], string>> = { party: "#22c55e", friend: "#38bdf8", other: "#f5f5f4" };

/** Draw the base (or a plain fill while it builds) and the overlays in view `v` on a w × h canvas. */
export function drawWorldMapFrame(ctx: CanvasRenderingContext2D, w: number, h: number, v: MapView, o: OverlayOpts): void {
  const k = o.dpr ?? 1;
  ctx.fillStyle = "#6d6a45";                                                        // the river mouths beyond the edge
  ctx.fillRect(0, 0, w, h);
  const b = base;
  if (b) {
    ctx.imageSmoothingEnabled = true;
    // the base's px of the view's world rect, clipped to the image
    const sx = v.x0 * BASE_SCALE, sy = v.y0 * BASE_SCALE, sw = (w / v.scale) * BASE_SCALE, sh = (h / v.scale) * BASE_SCALE;
    const cx0 = Math.max(0, sx), cy0 = Math.max(0, sy), cx1 = Math.min(b.width, sx + sw), cy1 = Math.min(b.height, sy + sh);
    if (cx1 > cx0 && cy1 > cy0) {
      const f = v.scale / BASE_SCALE;
      ctx.drawImage(b, cx0, cy0, cx1 - cx0, cy1 - cy0, (cx0 - sx) * f, (cy0 - sy) * f, (cx1 - cx0) * f, (cy1 - cy0) * f);
    }
  } else {
    const q = toCanvas(v, { x: 0, y: 0 });
    ctx.fillStyle = KIND_COLOUR.paddy_green;
    ctx.fillRect(q.x, q.y, WORLD_W * v.scale, WORLD_H * v.scale);
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const text = (s: string, x: number, y: number, px: number, bold = false) => {
    ctx.font = `${bold ? "bold " : ""}${Math.round(px * k)}px system-ui, sans-serif`;
    ctx.lineWidth = 3 * k;
    ctx.strokeStyle = "rgba(255,248,230,0.9)";
    ctx.strokeText(s, x, y);
    ctx.fillStyle = "#2a1d12";
    ctx.fillText(s, x, y);
  };
  // close in, everything is named; further out only the zones and the big places (the landmarks crowd each other)
  const near = v.scale / k >= 0.3;
  if (o.labels !== "none") {
    for (const l of MAP_LABELS) {
      if ((o.labels === "major" || !near) && !l.major) continue;
      const p = toCanvas(v, l);
      if (p.x < -80 || p.y < -20 || p.x > w + 80 || p.y > h + 20) continue;
      text(`${l.icon} ${l.name}`, p.x, p.y, l.major ? 13 : 11, l.major);
    }
  }
  for (const m of o.waypoints) {
    const p = toCanvas(v, m), s = 6 * k;
    ctx.fillStyle = m.found ? "#f2c14e" : "#9a9086";
    ctx.strokeStyle = "#2a1d12";
    ctx.lineWidth = 1.5 * k;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - s); ctx.lineTo(p.x + s, p.y); ctx.lineTo(p.x, p.y + s); ctx.lineTo(p.x - s, p.y);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    if (m.here) { ctx.strokeStyle = "#2f9e44"; ctx.lineWidth = 2 * k; ctx.beginPath(); ctx.arc(p.x, p.y, s + 3 * k, 0, Math.PI * 2); ctx.stroke(); }
    if (o.labels === "all" && near) text(`🌀 ${m.name}`, p.x, p.y + s + 8 * k, 10);
  }
  for (const g of o.baits ?? []) {                                                  // 0117
    const p = toCanvas(v, g);
    ctx.fillStyle = g.color;
    ctx.strokeStyle = "#1f4e5f";
    ctx.lineWidth = 1.5 * k;
    ctx.beginPath(); ctx.arc(p.x, p.y, 3.5 * k, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  for (const pe of o.people) {
    const p = toCanvas(v, pe);
    ctx.fillStyle = PERSON[pe.kind];
    ctx.strokeStyle = "#1c1917";
    ctx.lineWidth = 1.5 * k;
    ctx.beginPath(); ctx.arc(p.x, p.y, (pe.kind === "other" ? 3 : 4) * k, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  if (o.me) {
    const p = toCanvas(v, o.me);
    if (o.boat) {                                                                   // my xuồng under me
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(o.heading);
      ctx.fillStyle = "#7a4a22"; ctx.strokeStyle = "#2a1d12"; ctx.lineWidth = 1.5 * k;
      ctx.beginPath(); ctx.ellipse(0, 0, 12 * k, 5 * k, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(o.heading);
    const s = 8 * k;
    ctx.fillStyle = "#e0402a"; ctx.strokeStyle = "#fff"; ctx.lineWidth = 2 * k;
    ctx.beginPath(); ctx.moveTo(s * 1.2, 0); ctx.lineTo(-s * 0.8, s * 0.75); ctx.lineTo(-s * 0.35, 0); ctx.lineTo(-s * 0.8, -s * 0.75); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }
}
