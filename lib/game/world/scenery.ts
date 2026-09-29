import type { Vec } from "@/lib/game/types";
import { MINE } from "./mine";
import { cumulative, nearestOn, ROADS, TRAILS } from "./roads";
import {
  DOMAIN, fbm, hashAt, heightAt, rectDistance, riverAt, smoothstep, streamAt, STREAM_HALF_W, waterAt,
} from "./terrain";
import { WORLD_H, ZONE_IDS, ZONES } from "./zones";

// Where the world's scenery stands (pure, deterministic): the forests (round deciduous trees, conifers up the slopes,
// a few yellow ones), rocks, grass tufts and flowers, the windmills and the landmarks seen from afar (spec §1: the
// đình's flag, the market arch, the dojo tower, the mine headframe and its tunnel mouth). World px; the 3D view (lib/game/diorama/world)
// instances them per chunk. Nothing here is ever on a zone, a road, a trail or in the water.

/** Scenery chunks (px): the renderer's streaming unit. */
export const CHUNK_PX = 640;
export const CHUNKS_X = Math.ceil((DOMAIN.x1 - DOMAIN.x0) / CHUNK_PX);
export const CHUNKS_Y = Math.ceil((DOMAIN.y1 - DOMAIN.y0) / CHUNK_PX);

export function chunkOf(x: number, y: number): number {
  const cx = Math.max(0, Math.min(CHUNKS_X - 1, Math.floor((x - DOMAIN.x0) / CHUNK_PX)));
  const cy = Math.max(0, Math.min(CHUNKS_Y - 1, Math.floor((y - DOMAIN.y0) / CHUNK_PX)));
  return cy * CHUNKS_X + cx;
}

export type TreeKind = "round" | "conifer" | "yellow";

export interface TreeSpot { x: number; y: number; h: number; kind: TreeKind; scale: number; rot: number; tint: number }
export interface Spot { x: number; y: number; h: number; scale: number; rot: number; tint: number }

/** A landmark or a windmill: what, where (px) and which way it faces (radians about y). */
export interface Landmark { kind: "windmill" | "flag" | "arch" | "tower" | "headframe" | "mine"; x: number; y: number; yaw: number }

export const LANDMARKS: readonly Landmark[] = [
  { kind: "flag", x: 1290, y: 456, yaw: 0 },            // the đình's flag, on the rise behind the hall
  { kind: "arch", x: 1722, y: 724, yaw: 0 },            // cổng chợ over the road into the market
  { kind: "tower", x: 2440, y: 420, yaw: 0.2 },         // the dojo's watchtower behind the market
  { kind: "headframe", x: 3716, y: 1150, yaw: 0.3 },    // the mine's headframe, on the hill above the mouth (P2)
  { kind: "mine", x: MINE.mouth.x, y: MINE.mouth.y, yaw: -1.05 },   // the mine mouth, facing west-south-west (the road, the camera)
  { kind: "windmill", x: 2150, y: 1180, yaw: 0.6 },
  { kind: "windmill", x: 540, y: 1180, yaw: -0.4 },
  { kind: "windmill", x: 3880, y: 1470, yaw: 0.9 },
  { kind: "windmill", x: 2020, y: 1440, yaw: 0.3 },
  { kind: "windmill", x: 3000, y: 2150, yaw: -0.8 },
];

interface PathGeo { pts: readonly Vec[]; cum: number[]; hw: number }
let pathGeo: PathGeo[] | null = null;
function paths(): PathGeo[] {
  pathGeo ??= [...ROADS, ...TRAILS].map((r) => ({ pts: r.pts, cum: cumulative(r.pts), hw: r.w / 2 }));
  return pathGeo;
}

/** How far (px) (x, y) is from the nearest road/trail's edge. */
export function pathClearance(x: number, y: number): number {
  let d = Infinity;
  for (const p of paths()) d = Math.min(d, nearestOn(p.pts, p.cum, x, y).d - p.hw);
  return d;
}

/** How far (px) from the nearest zone's rect (negative inside one). */
export function zoneClearance(x: number, y: number): number {
  let d = Infinity;
  for (const id of ZONE_IDS) d = Math.min(d, rectDistance(id, x, y));
  return d;
}

/** Is (x, y) free for a piece of scenery `pad` px wide: off the zones (and Sông Cái's reed bank), paths, water, landmarks? */
export function sceneryFree(x: number, y: number, pad: number): boolean {
  if (zoneClearance(x, y) < pad + (x >= ZONES.song_cai.ox - 40 && x < ZONES.song_cai.ox + ZONES.song_cai.w + 40 && y > ZONES.song_cai.oy - 40 ? 28 : 0)) return false;
  if (pathClearance(x, y) < pad * 1.6 + 10) return false;
  const r = riverAt(x, y);
  if (!r.inZone && r.d < r.hw + pad) return false;
  const s = streamAt(x, y);
  if (s.d < STREAM_HALF_W + pad) return false;
  if (waterAt(x, y) !== null) return false;
  return !LANDMARKS.some((l) => Math.hypot(l.x - x, l.y - y) < 70 + pad);
}

const slopeAt = (x: number, y: number, h: number) =>
  Math.max(Math.abs(heightAt(x + 12, y) - h), Math.abs(heightAt(x, y + 12) - h)) / (12 / 16);

/** The forest's density 0…1 at (x, y) (before the clear-outs). */
export function forestDensity(x: number, y: number, h: number): number {
  let f = 0.04 + 0.86 * smoothstep(0.02, 0.36, fbm(x / 430 + 5, y / 430 - 3, 3));
  f = Math.max(f, smoothstep(600, 300, y) * 0.95);                                    // the north ridge
  if (h > 9) f = Math.max(f, 0.8 * (1 - smoothstep(28, 40, h)));                     // the mountains' flanks, to the treeline
  f *= 0.2 + 0.8 * smoothstep(50, 300, zoneClearance(x, y));                        // clearings round the zones
  const r = riverAt(x, y);
  f *= 0.3 + 0.7 * smoothstep(r.hw + 60, r.hw + 560, r.d);                           // the valley's meadows
  if (y > WORLD_H) f *= 0.35 + 0.65 * smoothstep(WORLD_H + 660, WORLD_H + 1060, y);                           // the south's open downs (the view's foreground)
  return f;
}

const STEP = 22;

let trees: TreeSpot[] | null = null;

/** Every tree of the world (deterministic; cached). */
export function scatterTrees(): readonly TreeSpot[] {
  if (trees) return trees;
  const out: TreeSpot[] = [];
  for (let gy = DOMAIN.y0; gy < DOMAIN.y1; gy += STEP) for (let gx = DOMAIN.x0; gx < DOMAIN.x1; gx += STEP) {
    const roll = hashAt(gx, gy, 1);
    if (roll > 0.95) continue;
    const x = gx + (hashAt(gx, gy, 2) - 0.5) * STEP * 0.9, y = gy + (hashAt(gx, gy, 3) - 0.5) * STEP * 0.9;
    const h = heightAt(x, y);
    if (roll > forestDensity(x, y, h)) continue;
    if (!sceneryFree(x, y, 14)) continue;
    if (h > 40 || slopeAt(x, y, h) > 1.6) continue;
    const k = hashAt(gx, gy, 4);
    const autumn = smoothstep(0.1, 0.45, fbm(x / 300 - 9, y / 300 + 4, 2));
    const kind: TreeKind = k < smoothstep(7, 18, h) * 0.85 + 0.12 ? "conifer" : k > 0.93 - autumn * 0.5 ? "yellow" : "round";
    out.push({ x, y, h, kind, scale: 0.55 + hashAt(gx, gy, 5) * 0.45, rot: hashAt(gx, gy, 6) * Math.PI * 2, tint: hashAt(gx, gy, 7) });
  }
  trees = out;
  return out;
}

function scatter(step: number, salt: number, keep: (x: number, y: number, h: number, roll: number) => boolean, pad: number): Spot[] {
  const out: Spot[] = [];
  for (let gy = DOMAIN.y0; gy < DOMAIN.y1; gy += step) for (let gx = DOMAIN.x0; gx < DOMAIN.x1; gx += step) {
    const roll = hashAt(gx, gy, salt);
    const x = gx + (hashAt(gx, gy, salt + 1) - 0.5) * step, y = gy + (hashAt(gx, gy, salt + 2) - 0.5) * step;
    if (roll > 0.5) continue;
    const h = heightAt(x, y);
    if (!keep(x, y, h, roll * 2)) continue;
    if (!sceneryFree(x, y, pad)) continue;
    out.push({ x, y, h, scale: 0.6 + hashAt(gx, gy, salt + 3) * 0.9, rot: hashAt(gx, gy, salt + 4) * Math.PI * 2, tint: hashAt(gx, gy, salt + 5) });
  }
  return out;
}

let rocks: Spot[] | null = null, tufts: Spot[] | null = null, flowers: Spot[] | null = null;

/** Rocks: on the slopes, the mountains and along the river's banks. */
export function scatterRocks(): readonly Spot[] {
  rocks ??= scatter(44, 20, (x, y, h, roll) => {
    const r = riverAt(x, y);
    const bank = !r.inZone && r.d < r.hw + 50 ? 0.55 : 0;
    const steep = smoothstep(0.6, 1.6, slopeAt(x, y, h)) * 0.4;
    const high = smoothstep(14, 34, h) * 0.12;
    return roll < Math.max(bank, steep, high, 0.03);
  }, 6);
  return rocks;
}

/** Grass tufts in the meadows (the near chunks only draw them). */
export function scatterGrass(): readonly Spot[] {
  tufts ??= scatter(18, 40, (x, y, h, roll) => h < 14 && roll < 0.55 && x > -200 && y > -200 && x < 4360 && y < 2440, 4);
  return tufts;
}

/** Flowers dotted over the meadows. */
export function scatterFlowers(): readonly Spot[] {
  flowers ??= scatter(26, 60, (x, y, h, roll) => h < 10 && roll < 0.35 * smoothstep(-0.2, 0.4, fbm(x / 200, y / 200, 2)) && x > -100 && y > -100 && x < 4260 && y < 2340, 4);
  return flowers;
}
