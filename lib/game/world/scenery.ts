import type { Vec } from "@/lib/game/types";
import { gardenSpots, lotusPonds, stiltHouses } from "./delta";
import { MINE } from "./mine";
import { LAKE, NUI, NUI_SOLIDS, SUMMIT, WATERFALL } from "./nuicam";
import { cumulative, nearestOn, ROADS, TRAILS } from "./roads";
import {
  CANAL_HALF_W, canalDist, DOMAIN, fbm, hashAt, heightAt, rectDistance, riverAt, RIVER_LEVEL, smoothstep, streamAt, STREAM_HALF_W, waterAt,
} from "./terrain";
import { WORLD_H, WORLD_W, ZONE_IDS, ZONES } from "./zones";

// Where the world's scenery stands (pure, deterministic): the Mekong delta's trees (rừng tràm, coconut and nipa palms,
// bamboo, orchards), lục bình on the water, rocks, grass tufts and flowers and the landmarks seen from afar (spec §1: the
// hall's flag, the market arch, the dojo tower, the mine headframe and its tunnel mouth). World px; the 3D view (lib/game/diorama/world)
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

/** The delta's trees: tràm (melaleuca, the forests), dừa (coconut palms), dừa nước (nipa palms on the banks), tre
 *  (bamboo clumps round the houses), xoài (mango), mận (rose-apple), chuối (banana), thốt nốt (sugar palms on the
 *  paddies' dikes), bông điên điển (round the lotus ponds) and dâm bụt hedges along the paths. */
export type TreeKind = "tram" | "dua" | "duanuoc" | "tre" | "xoai" | "man" | "chuoi" | "thotnot" | "diendien" | "hedge";

export interface TreeSpot { x: number; y: number; h: number; kind: TreeKind; scale: number; rot: number; tint: number }
export interface Spot { x: number; y: number; h: number; scale: number; rot: number; tint: number }

/** A landmark or a windmill: what, where (px) and which way it faces (radians about y). */
export interface Landmark { kind: "windmill" | "flag" | "arch" | "tower" | "headframe" | "mine" | "pagoda"; x: number; y: number; yaw: number }

export const LANDMARKS: readonly Landmark[] = [
  { kind: "flag", x: 1290, y: 456, yaw: 0 },            // the national flag, on the rise behind the hall
  { kind: "arch", x: 1722, y: 724, yaw: 0 },            // cổng chợ over the road into the market
  { kind: "tower", x: 2440, y: 420, yaw: 0.2 },         // the dojo's watchtower behind the market
  { kind: "headframe", x: 3716, y: 1150, yaw: 0.3 },    // the mine's headframe, on the hill above the mouth (P2)
  { kind: "mine", x: MINE.mouth.x, y: MINE.mouth.y, yaw: -1.05 },   // the mine mouth, facing west-south-west (the road, the camera)
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
  if (lotusPonds().some((p) => Math.hypot(p.x - x, p.y - y) < p.r + 4 + pad) || gardenSpots().some((g) => Math.hypot(g.x - x, g.y - y) < 36 + pad)) return false;
  const r = riverAt(x, y);
  if (!r.inZone && r.d < r.hw + pad) return false;
  const s = streamAt(x, y);
  if (s.d < STREAM_HALF_W + pad) return false;
  if (waterAt(x, y) !== null) return false;
  if (stiltHouses().some((h) => Math.hypot(h.x - x, h.y - y) < 40 + pad)) return false;
  if (NUI_SOLIDS.some((s) => Math.hypot(s.x - x, s.y - y) < s.r + 16 + pad) || Math.hypot(LAKE.x - x, LAKE.y - y) < LAKE.r + 30 + pad) return false;
  if (Math.hypot(SUMMIT.x - x, SUMMIT.y - y) < 40 || Math.hypot(WATERFALL.x - x, WATERFALL.y - y) < 40) return false;
  return !LANDMARKS.some((l) => Math.hypot(l.x - x, l.y - y) < 70 + pad);
}

const slopeAt = (x: number, y: number, h: number) =>
  Math.max(Math.abs(heightAt(x + 12, y) - h), Math.abs(heightAt(x, y + 12) - h)) / (12 / 16);

/** What the open land is used for at (x, y): rừng tràm (the forests, where the wild animals live), vườn (orchards
 *  on raised beds near the villages), or ruộng (rice paddies). Pure; the terrain paints the same. */
export type LandUse = "tram" | "orchard" | "paddy";
export function landUse(x: number, y: number): LandUse {
  const z = zoneClearance(x, y);
  if (z > 160 && fbm(x / 430 + 5, y / 430 - 3, 3) > 0.02) return "tram";
  if (z < 520 && fbm(x / 300 - 9, y / 300 + 4, 2) > 0.2) return "orchard";
  return "paddy";
}
/** Is (x, y) in a rừng tràm (the wild's forest)? */
export const inTramForest = (x: number, y: number): boolean => landUse(x, y) === "tram";

/** How far (px) from the nearest open water's edge (the river, the canals, the stream). */
export function waterEdge(x: number, y: number): number {
  const r = riverAt(x, y), s = streamAt(x, y);
  return Math.min(r.inZone ? Infinity : r.d - r.hw, canalDist(x, y) - CANAL_HALF_W, s.d - STREAM_HALF_W);
}

const STEP = 22;

/** Which tree (if any) grows at (x, y) for a roll 0…1: nipa on the banks (in patches, so the canals still read),
 *  coconuts along the roads and round the villages, bamboo by the houses, tràm in the forests, fruit trees in rows. */
function treeKindAt(x: number, y: number, roll: number, k: number): TreeKind | null {
  const we = waterEdge(x, y);
  if (we > 2 && we < 26) return roll < 0.6 && fbm(x / 140 + 3, y / 140, 2) > -0.05 ? "duanuoc" : null;
  if (lotusPonds().some((p) => { const d = Math.hypot(p.x - x, p.y - y); return d > p.r + 6 && d < p.r + 30; })) return roll < 0.5 ? "diendien" : null;
  const pc = pathClearance(x, y), zc = zoneClearance(x, y);
  if (pc > 10 && pc < 17 && zc > 20) return roll < 0.35 ? "hedge" : null;                // dâm bụt along the paths
  if (pc > 17 && pc < 34 && roll < 0.2) return "dua";
  if (zc > 16 && zc < 150 && roll < 0.16) return k < 0.35 ? "tre" : k < 0.65 ? "chuoi" : "dua";
  // the mountain: a dense rounded broadleaf canopy all over its slopes
  if (Math.hypot(x - NUI.x, (y - NUI.y) * 1.15) < NUI.r * 0.92) return roll < 0.75 ? (k < 0.8 ? "xoai" : "dua") : null;
  const use = landUse(x, y);
  if (use === "tram") return roll < 0.8 ? "tram" : null;
  if (use === "orchard") return roll < 0.55 && Math.abs(((y + 4000) % 44) - 22) < 8 ? (k < 0.4 ? "xoai" : k < 0.65 ? "man" : k < 0.9 ? "chuoi" : "dua") : null;
  // the paddies: dừa groves standing like dark islands, thốt nốt in loose rows on the dikes, else open rice
  if (fbm(x / 260 + 11, y / 260 - 5, 2) > 0.32) return roll < 0.5 ? "dua" : null;
  const onDike = Math.abs(((x + 4096) % 96) - 48) > 42 || Math.abs(((y + 4096) % 72) - 36) > 30;
  return onDike && roll < 0.09 ? "thotnot" : null;
}

let trees: TreeSpot[] | null = null;

/** Every tree of the world (deterministic; cached). */
export function scatterTrees(): readonly TreeSpot[] {
  if (trees) return trees;
  const out: TreeSpot[] = [];
  for (let gy = DOMAIN.y0; gy < DOMAIN.y1; gy += STEP) for (let gx = DOMAIN.x0; gx < DOMAIN.x1; gx += STEP) {
    const roll = hashAt(gx, gy, 1);
    if (roll > 0.8) continue;                                                  // no rule plants above 0.8: skip early
    const x = gx + (hashAt(gx, gy, 2) - 0.5) * STEP * 0.9, y = gy + (hashAt(gx, gy, 3) - 0.5) * STEP * 0.9;
    const kind = treeKindAt(x, y, roll, hashAt(gx, gy, 4));
    if (!kind) continue;
    const h = heightAt(x, y);
    if (slopeAt(x, y, h) > (Math.hypot(x - NUI.x, y - NUI.y) < NUI.r ? 3 : 1.6)) continue;
    if (!sceneryFree(x, y, kind === "duanuoc" || kind === "hedge" ? 2 : 12)) continue;
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

let hyacinths: Spot[] | null = null;
/** Lục bình (water hyacinth) drifting in clumps on the river and the canals. */
export function scatterHyacinths(): readonly Spot[] {
  if (hyacinths) return hyacinths;
  const out: Spot[] = [];
  for (let gy = -200; gy < WORLD_H + 200; gy += 34) for (let gx = -200; gx < WORLD_W + 200; gx += 34) {
    const x = gx + (hashAt(gx, gy, 81) - 0.5) * 30, y = gy + (hashAt(gx, gy, 82) - 0.5) * 30;
    if (hashAt(gx, gy, 80) > 0.3 || zoneClearance(x, y) < 8 || waterAt(x, y) !== RIVER_LEVEL) continue;
    out.push({ x, y, h: RIVER_LEVEL, scale: 0.6 + hashAt(gx, gy, 83) * 0.8, rot: hashAt(gx, gy, 84) * Math.PI * 2, tint: hashAt(gx, gy, 85) });
  }
  hyacinths = out;
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
    return roll < Math.max(bank * 0.3, steep, high, 0.005);
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
