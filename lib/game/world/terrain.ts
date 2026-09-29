import type { Vec } from "@/lib/game/types";
import { MINE, MINE_HILL } from "./mine";
import { cumulative, nearestOn, ROADS, TRAILS, type Road, type Trail } from "./roads";
import { WORLD_CELL, WORLD_H, WORLD_W, ZONE_IDS, ZONES, type OutdoorMapId } from "./zones";

// The world's landform (spec §1, P2/P3's visual part): one deterministic heightmap over the whole 4160 × 2240 px world
// and a ring beyond it. Pure — the 3D renderer (lib/game/diorama/world) meshes it, wild.ts turns it into collision.
//   - each zone sits on a flat plateau at its own elevation (ZONE_ELEV), blended into the land over PLATEAU_MARGIN px;
//   - the roads ramp linearly from one zone's elevation to the other's (never steeper than MAX_ROAD_SLOPE);
//   - the flat Mekong delta in between (paddies a hand above the water), canals (CANALS) joined to the river, one low
//     rounded hill group in the east (the mine, a pagoda), and the river mouths' open water past the world's edge;
//   - Sông Cái winds through a valley across the south (the zone's own water stays where the gameplay has it; the
//     wild river meets it at the zone's west and east edges), and a stream runs from the pond down to it.
// Units: x/y in world px, heights in 3D units (px / 16, the diorama's), 0 = the river's bank level datum.

export const TERRAIN_SEED = 20260929;
/** px per 3D unit (lib/game/diorama/coords.ts PX_PER_UNIT; not imported: that module is the renderer's). */
const PXU = 16;

/** Each zone's plateau height, units (village hall mid, fields low near the river, Khu nhà high in the east; the mine's
 *  apron is MINE.pad.elev). */
export const ZONE_ELEV: Readonly<Record<OutdoorMapId, number>> = {
  song_cai: 0.6, field: 1.0, pond: 1.2, hall: 1.5, bai_dat: 1.6, market: 1.7, khu_nha: 1.9,
};
/** How far (px) a plateau blends into the land around it. */
export const PLATEAU_MARGIN = 160;
/** The steepest a road or trail may climb (rise over run). */
export const MAX_ROAD_SLOPE = 0.25;
/** Steeper ground than this (rise over run, between cell centres) is a cliff: blocked. */
export const MAX_WALK_SLOPE = 0.55;
/** Land higher than this (units) is mountain: blocked. */
export const MAX_WALK_HEIGHT = 12;
/** The zones' water surface sits this far below their ground (outdoor-kit.ts ZONE_WATER_Y). */
const ZONE_WATER_Y = -0.22;
/** The river's surface (Sông Cái's water, continued through the wild). */
export const RIVER_LEVEL = ZONE_ELEV.song_cai + ZONE_WATER_Y;
/** The land at the river's edge. */
export const RIVER_BANK = ZONE_ELEV.song_cai;

/** The river's centreline, world px (it runs off the world at both ends; through Sông Cái on the zone's mid-line). */
export const RIVER_PTS: readonly Vec[] = [
  { x: -1300, y: 1560 }, { x: -600, y: 1640 }, { x: -200, y: 1700 }, { x: 150, y: 1790 }, { x: 424, y: 1900 }, { x: 660, y: 1930 },
  { x: 880, y: 1862 }, { x: 960, y: 1840 }, { x: 1920, y: 1840 }, { x: 2060, y: 1826 }, { x: 2250, y: 1770 }, { x: 2450, y: 1860 },
  { x: 2624, y: 1960 }, { x: 2820, y: 1990 }, { x: 3050, y: 1905 }, { x: 3300, y: 1850 }, { x: 3560, y: 1905 }, { x: 3820, y: 1990 },
  { x: 4120, y: 1985 }, { x: 4450, y: 1910 }, { x: 5400, y: 1840 },
];
const RIVER_CUM = cumulative(RIVER_PTS);
/** The stretch (arc length, px) that runs inside Sông Cái: the zone draws that water itself. */
const RIVER_ZONE = { s0: RIVER_CUM[7], s1: RIVER_CUM[8] };

/** The stream from the pond's south edge down to the river (west of Sông Cái). */
export const STREAM_PTS: readonly Vec[] = [
  { x: 1232, y: 1440 }, { x: 1228, y: 1498 }, { x: 1182, y: 1546 }, { x: 1040, y: 1572 }, { x: 944, y: 1612 }, { x: 906, y: 1700 },
  { x: 900, y: 1800 },
];
const STREAM_CUM = cumulative(STREAM_PTS);
export const STREAM_HALF_W = 11;
const STREAM_TOP = ZONE_ELEV.pond + ZONE_WATER_Y;

/** Knolls (blocked mounds): centre and radius, world px. The delta is flat: only the mine's hill (a low Thất Sơn-like
 *  rise in the east; the tunnel runs into it). */
export const KNOLLS: readonly { x: number; y: number; r: number }[] = [
  MINE_HILL,
];

/** The low hill group in the east (Núi Sam-like: rounded, a pagoda on top): centre / radius px, height units. */
export const EAST_HILLS: readonly { x: number; y: number; r: number; h: number }[] = [
  { x: 3780, y: 1232, r: 250, h: 5 }, { x: 3950, y: 1110, r: 180, h: 3.4 }, { x: 3930, y: 1430, r: 160, h: 2.8 },
];
/** Where the hill's pagoda stands (the summit). */
export const PAGODA = { x: 3800, y: 1180 } as const;

/** Kênh rạch: the canals crossing the delta, joined to the river (their water is the river's level). World px. */
export const CANALS: readonly (readonly Vec[])[] = [
  [{ x: -200, y: 300 }, { x: 700, y: 320 }, { x: 1700, y: 290 }, { x: 2700, y: 330 }, { x: 3600, y: 300 }, { x: 4400, y: 320 }],
  [{ x: 560, y: 1080 }, { x: 650, y: 1250 }, { x: 700, y: 1400 }, { x: 760, y: 1580 }, { x: 830, y: 1880 }],
  [{ x: 2150, y: 900 }, { x: 2210, y: 1150 }, { x: 2250, y: 1400 }, { x: 2250, y: 1790 }],
  [{ x: 3340, y: 900 }, { x: 3330, y: 1300 }, { x: 3360, y: 1600 }, { x: 3320, y: 1870 }],
  [{ x: 4060, y: 300 }, { x: 4080, y: 800 }, { x: 4130, y: 1000 }, { x: 4300, y: 1100 }],
  [{ x: 60, y: 1100 }, { x: 250, y: 1300 }, { x: 300, y: 1600 }, { x: 310, y: 1800 }],
];
const CANAL_CUM = CANALS.map((c) => cumulative(c));
export const CANAL_HALF_W = 13;
/** Distance (px) to the nearest canal's centreline. */
export function canalDist(x: number, y: number): number {
  let d = Infinity;
  for (let i = 0; i < CANALS.length; i++) d = Math.min(d, nearestOn(CANALS[i], CANAL_CUM[i], x, y).d);
  return d;
}
/** How far (px) past the world's edge (0 inside): beyond it the delta opens onto the river mouths' water. */
export function outside(x: number, y: number): number {
  return Math.max(-x, x - WORLD_W, -y, y - WORLD_H, 0);
}

/** The ring rendered around the world (mountains to the horizon), px beyond each edge. */
export const RING = 1120;
export const DOMAIN = { x0: -RING, y0: -RING, x1: WORLD_W + RING, y1: WORLD_H + RING } as const;

// ---------------------------------------------------------------- noise

function hash2(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise in −1…1. */
export function valueNoise(x: number, y: number, seed = TERRAIN_SEED): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed), c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
  return (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy) * 2 - 1;
}

export function fbm(x: number, y: number, octaves = 4, seed = TERRAIN_SEED): number {
  let s = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < octaves; i++) { s += valueNoise(x * f, y * f, seed + i * 101) * amp; norm += amp; amp *= 0.5; f *= 2.03; }
  return s / norm;
}

/** A deterministic 0…1 hash of a point (scenery scatter). */
export function hashAt(x: number, y: number, salt = 0): number {
  return hash2(Math.floor(x), Math.floor(y), TERRAIN_SEED + salt * 7919);
}

export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ---------------------------------------------------------------- the pieces

/** Signed distance (px) from a zone's rect: negative inside. */
export function rectDistance(id: OutdoorMapId, x: number, y: number): number {
  const z = ZONES[id];
  const dx = Math.max(z.ox - x, x - (z.ox + z.w)), dy = Math.max(z.oy - y, y - (z.oy + z.h));
  if (dx <= 0 && dy <= 0) return Math.max(dx, dy);
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
}

/** The zone whose rect holds (x, y), if any (half-open, as zoneAt). */
export function zoneUnder(x: number, y: number): OutdoorMapId | null {
  for (const id of ZONE_IDS) {
    const z = ZONES[id];
    if (x >= z.ox && x < z.ox + z.w && y >= z.oy && y < z.oy + z.h) return id;
  }
  return null;
}

/** The river's half-width (px) at arc length s: wider where it nears Sông Cái (the zone's water is 320 px wide). */
export function riverHalfWidth(s: number): number {
  const toZone = s < RIVER_ZONE.s0 ? RIVER_ZONE.s0 - s : s > RIVER_ZONE.s1 ? s - RIVER_ZONE.s1 : 0;
  // through Sông Cái a touch wider still, so the one continuous river covers the zone's playable water (local y 80–400)
  return 104 + 64 * (1 - smoothstep(0, 360, toZone)) + (toZone === 0 ? 10 : 16) * valueNoise(s / 260, 3.7);
}

export interface RiverHit { d: number; s: number; hw: number; inZone: boolean }

export function riverAt(x: number, y: number): RiverHit {
  const n = nearestOn(RIVER_PTS, RIVER_CUM, x, y);
  return { d: n.d, s: n.s, hw: riverHalfWidth(n.s), inZone: n.s > RIVER_ZONE.s0 && n.s < RIVER_ZONE.s1 };
}

/** The stream's surface at arc length s (falls from the pond's water to the river's). */
export function streamLevel(s: number): number {
  return lerp(STREAM_TOP, RIVER_LEVEL, s / STREAM_CUM[STREAM_CUM.length - 1]);
}

export function streamAt(x: number, y: number): { d: number; s: number } {
  const n = nearestOn(STREAM_PTS, STREAM_CUM, x, y);
  return { d: n.d, s: n.s };
}

// ---- roads and trails: their height profile along their length

interface PathInfo { pts: readonly Vec[]; cum: number[]; w: number; h0: number; h1: number; trail: boolean; ends: OutdoorMapId[] }

/** A road end's zone (null: the wild's own end, the mine mouth) and its height. */
const zoneOf = (end: string): OutdoorMapId | null => (end.startsWith("wild:") ? null : end.split(":")[0] as OutdoorMapId);
const endElev = (end: string): number => { const z = zoneOf(end); return z ? ZONE_ELEV[z] : MINE.pad.elev; };

let paths: PathInfo[] | null = null;

function roadInfo(r: Road): PathInfo {
  const ends = [zoneOf(r.a), zoneOf(r.b)].filter((z): z is OutdoorMapId => z !== null);
  return { pts: r.pts, cum: cumulative(r.pts), w: r.w, h0: endElev(r.a), h1: endElev(r.b), trail: false, ends };
}

/** Roads first (a trail starts on one: its first height is the road's there), then the trails. */
function allPaths(): PathInfo[] {
  if (paths) return paths;
  const roads = ROADS.map(roadInfo);
  const trails = TRAILS.map((t: Trail) => {
    const from = roads[ROADS.findIndex((r) => r.id === t.from)];
    const n = nearestOn(from.pts, from.cum, t.pts[0].x, t.pts[0].y);
    const h0 = lerp(from.h0, from.h1, n.s / from.cum[from.cum.length - 1]);
    return { pts: t.pts, cum: cumulative(t.pts), w: t.w, h0, h1: RIVER_BANK + 0.5, trail: true, ends: [] };
  });
  paths = [...roads, ...trails];
  return paths;
}

export interface PathBlend { road: number; roadH: number; trail: number; trailH: number }

/** How strongly the roads (and, apart, the trails) pull the land to their profiles at (x, y), and to what height. */
export function pathBlend(x: number, y: number): PathBlend {
  const out: PathBlend = { road: 0, roadH: 0, trail: 0, trailH: 0 };
  let rs = 0, rh = 0, ts = 0, th = 0;
  for (const p of allPaths()) {
    const n = nearestOn(p.pts, p.cum, x, y);
    if (n.d > p.w / 2 + 64) continue;
    const w = (1 - smoothstep(p.w / 2 + 2, p.w / 2 + 64, n.d)) * edgeYield(x, y, p.ends);
    if (w <= 0) continue;
    const h = lerp(p.h0, p.h1, n.s / p.cum[p.cum.length - 1]);
    if (p.trail) { ts += w; th += w * h; out.trail = Math.max(out.trail, w); }
    else { rs += w; rh += w * h; out.road = Math.max(out.road, w); }
  }
  if (rs > 0) out.roadH = rh / rs;
  if (ts > 0) out.trailH = th / ts;
  return out;
}

/** 0 on a zone's edge … 1 from 40 px out: a road passing beside a plateau (not one of its own ends, whose height it
 *  has there) yields to it, so there is no step at the zone's edge. */
function edgeYield(x: number, y: number, ends: readonly OutdoorMapId[]): number {
  let d = Infinity;
  for (const id of ZONE_IDS) if (!ends.includes(id)) d = Math.min(d, rectDistance(id, x, y));
  return smoothstep(0, 40, d);
}
/** Is (x, y) on a road or a trail's walkable width? */
export function onPath(x: number, y: number): boolean {
  for (const p of allPaths()) if (nearestOn(p.pts, p.cum, x, y).d <= p.w / 2) return true;
  return false;
}

// ---------------------------------------------------------------- the height

/** The land before the zones, roads and water: the flat delta (paddies a hand above the river, gentle swells), the
 *  low eastern hills, the river's bank, the shore where the land sinks into the river mouths past the world's edge. */
export function naturalHeight(x: number, y: number): number {
  let h = RIVER_BANK + 0.8 + 0.35 * fbm(x / 520, y / 520, 3) + 0.12 * fbm(x / 90, y / 90, 2);
  for (const k of EAST_HILLS) {
    const d = Math.hypot(x - k.x, y - k.y);
    if (d < k.r) { const u = 1 - d / k.r; h += k.h * u * u * (3 - 2 * u); }
  }
  // the river valley: the land settles toward the bank
  const r = riverAt(x, y);
  const v = 1 - smoothstep(r.hw, r.hw + 560, r.d);
  h = lerp(h, RIVER_BANK + 0.4 + 0.5 * fbm(x / 160, y / 160, 2), v * 0.96);
  // the edge: a mangrove shore, then the open water of the river mouths
  const inEdge = Math.min(x, WORLD_W - x, y, WORLD_H - y);
  if (inEdge < 90) h = lerp(h, RIVER_LEVEL - 1.6, smoothstep(90, -120, inEdge));
  return h;
}

/**
 * The ground's height (units) at world px (x, y). Inside a zone: exactly its plateau (the zone's own diorama stands on
 * it). Deterministic: the same on every client and in the tests.
 */
export function heightAt(x: number, y: number): number {
  const z = zoneUnder(x, y);
  if (z) return ZONE_ELEV[z];
  let h = naturalHeight(x, y);

  // plateaus: blend toward the nearest zones' elevations
  let wsum = 0, esum = 0, wmax = 0;
  for (const id of ZONE_IDS) {
    const d = rectDistance(id, x, y);
    if (d >= PLATEAU_MARGIN) continue;
    const w = 1 - smoothstep(0, PLATEAU_MARGIN, d);
    wsum += w; esum += w * ZONE_ELEV[id]; wmax = Math.max(wmax, w);
  }
  if (wsum > 0) h = lerp(h, esum / wsum, wmax);
  // the mine mouth's apron: flat at its height, blending out over PLATEAU_MARGIN / 2
  const pd = Math.hypot(x - MINE.pad.x, y - MINE.pad.y) - MINE.pad.r;
  if (pd < PLATEAU_MARGIN / 2) h = lerp(h, MINE.pad.elev, 1 - smoothstep(0, PLATEAU_MARGIN / 2, pd));

  // the river's channel (outside Sông Cái): a bank lip, then the bed
  const r = riverAt(x, y);
  let water = 0;
  if (!r.inZone && r.d < r.hw + 40) {
    if (r.d < r.hw) {
      const t = r.d / r.hw;
      h = RIVER_LEVEL - 0.35 - 1.3 * (1 - t * t);
      water = 1;
    } else {
      h = lerp(RIVER_LEVEL - 0.3, Math.min(h, RIVER_BANK + 0.6), smoothstep(r.hw, r.hw + 40, r.d));
    }
  }
  // the canals: water at the river's level (a road or trail crossing one is a raised causeway)
  const cd = canalDist(x, y);
  if (cd < CANAL_HALF_W + 48) {
    if (cd < CANAL_HALF_W) h = RIVER_LEVEL - 0.3 - 0.6 * (1 - cd / CANAL_HALF_W);
    else h = lerp(RIVER_LEVEL - 0.2, h, smoothstep(CANAL_HALF_W, CANAL_HALF_W + 48, cd));
  }
  // the stream: a little gully falling to the river
  const st = streamAt(x, y);
  if (st.d < STREAM_HALF_W + 56) {
    const lvl = streamLevel(st.s);
    if (st.d < STREAM_HALF_W) { h = lvl - 0.25 - 0.3 * (1 - st.d / STREAM_HALF_W); water = 1; }
    else h = lerp(lvl + 0.15, h, smoothstep(STREAM_HALF_W, STREAM_HALF_W + 56, st.d));
  }

  // roads and trails ramp between their ends (a trail's bridge leaves the water under it)
  const p = pathBlend(x, y);
  if (cd < CANAL_HALF_W) { p.road = 0; p.trail = 0; }                 // the water shows under the bridge
  if (p.road > 0 || p.trail > 0) {
    if (p.trail > 0) h = lerp(h, p.trailH, p.trail * (1 - water));
    if (p.road > 0) h = lerp(h, p.roadH, p.road);
  }
  return h;
}

/** Water at (x, y) in the wild: the river (outside Sông Cái) or the stream — its surface height, or null. */
export function waterAt(x: number, y: number): number | null {
  if (zoneUnder(x, y)) return null;
  const r = riverAt(x, y);
  if (!r.inZone && r.d < r.hw) return RIVER_LEVEL;
  if (outside(x, y) > 0) return RIVER_LEVEL;
  if (canalDist(x, y) < CANAL_HALF_W) return RIVER_LEVEL;
  const st = streamAt(x, y);
  if (st.d < STREAM_HALF_W) return streamLevel(st.s);
  return null;
}

/** A bridge deck: a trail over the water, or a road or trail over a canal (its height), or null. */
export function bridgeAt(x: number, y: number): number | null {
  if (waterAt(x, y) === null) return null;
  const canal = canalDist(x, y) < CANAL_HALF_W;
  for (const t of allPaths()) {
    if (!t.trail && !canal) continue;
    const n = nearestOn(t.pts, t.cum, x, y);
    if (n.d <= t.w / 2 + 4) return lerp(t.h0, t.h1, n.s / t.cum[t.cum.length - 1]);
  }
  return null;
}

/** The land the world draws under Sông Cái (its diorama brings only props there, P2 "liền mạch"): the zone's bank level
 *  with the one continuous river's channel carved through it — the same channel as outside, so there is no seam. */
export function songCaiRenderHeight(x: number, y: number): number {
  const r = riverAt(x, y), base = ZONE_ELEV.song_cai;
  if (r.d < r.hw) { const t = r.d / r.hw; return RIVER_LEVEL - 0.35 - 1.3 * (1 - t * t); }
  return lerp(RIVER_LEVEL - 0.3, base, smoothstep(r.hw, r.hw + 40, r.d));
}

/** Where feet stand in the wild: the ground, or a bridge's deck. */
export function standHeight(x: number, y: number): number {
  return bridgeAt(x, y) ?? heightAt(x, y);
}

// ---------------------------------------------------------------- the collision grid's heights

export interface HeightGrid { cols: number; rows: number; cell: number; h: Float32Array }

let grid: HeightGrid | null = null;

/** The height at every collision cell's centre (cached: deterministic). */
export function heightGrid(): HeightGrid {
  if (grid) return grid;
  const cell = WORLD_CELL, cols = WORLD_W / cell, rows = WORLD_H / cell;
  const h = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) h[r * cols + c] = heightAt(c * cell + cell / 2, r * cell + cell / 2);
  grid = { cols, rows, cell, h };
  return grid;
}

/** The steepest rise over run (units per unit) from a cell to its four neighbours. */
export function slopeAtCell(g: HeightGrid, c: number, r: number): number {
  const h0 = g.h[r * g.cols + c], run = g.cell / PXU;
  let s = 0;
  if (c > 0) s = Math.max(s, Math.abs(g.h[r * g.cols + c - 1] - h0));
  if (c < g.cols - 1) s = Math.max(s, Math.abs(g.h[r * g.cols + c + 1] - h0));
  if (r > 0) s = Math.max(s, Math.abs(g.h[(r - 1) * g.cols + c] - h0));
  if (r < g.rows - 1) s = Math.max(s, Math.abs(g.h[(r + 1) * g.cols + c] - h0));
  return s / run;
}
