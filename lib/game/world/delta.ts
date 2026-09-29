import type { Vec } from "@/lib/game/types";
import { cumulative, nearestOn, pointAt, ROADS, TRAILS } from "./roads";
import { bridgeAt, CANAL_HALF_W, canalDist, CANALS, hashAt, heightAt, RIVER_LEVEL, RIVER_PTS, riverAt, waterAt, zoneUnder } from "./terrain";
import { WORLD_H, WORLD_W, ZONE_IDS, ZONES } from "./zones";

// Pure: the delta's life along the water (pass 4) — where the bridges cross the canals (a plank bridge for a road, a
// cầu khỉ for a trail), the stilt houses on the banks with a xuồng moored below each, and the floating market (chợ
// nổi) of ghe on the river south-east of the market. World px; deterministic; the 3D view (diorama/world/delta.ts)
// draws them, wild.ts makes the houses solid.

export interface Crossing { x: number; y: number; yaw: number; len: number; w: number; deck: number; monkey: boolean }
export interface House { x: number; y: number; yaw: number; ground: number; roof: "tin" | "leaf"; seed: number }
export interface Boat { x: number; y: number; yaw: number; kind: "xuong" | "ghe"; goods: number; seed: number }

let crossings: Crossing[] | null = null;
/** Every place a road or a trail crosses a canal: the bridge's middle, heading, span and deck height. */
export function canalCrossings(): readonly Crossing[] {
  if (crossings) return crossings;
  const out: Crossing[] = [];
  for (const [list, monkey] of [[ROADS, false], [TRAILS, true]] as const) for (const r of list) {
    const cum = cumulative(r.pts), L = cum[cum.length - 1];
    let s0 = -1;
    for (let s = 0; s <= L + 4; s += 3) {
      const p = pointAt(r.pts, cum, Math.min(s, L));
      const wet = s <= L && canalDist(p.x, p.y) < CANAL_HALF_W && !zoneUnder(p.x, p.y);
      if (wet && s0 < 0) s0 = s;
      if (!wet && s0 >= 0) {
        const m = pointAt(r.pts, cum, (s0 + s) / 2);
        out.push({ x: m.x, y: m.y, yaw: Math.atan2(m.dx, m.dy), len: s - s0 + 22, w: r.w, deck: bridgeAt(m.x, m.y) ?? heightAt(m.x, m.y), monkey });
        s0 = -1;
      }
    }
  }
  crossings = out;
  return out;
}

const zoneGap = (x: number, y: number) => {
  let d = Infinity;
  for (const id of ZONE_IDS) {
    const z = ZONES[id];
    d = Math.min(d, Math.hypot(Math.max(z.ox - x, 0, x - z.ox - z.w), Math.max(z.oy - y, 0, y - z.oy - z.h)));
  }
  return d;
};
const pathGap = (() => {
  let geo: Array<{ pts: readonly Vec[]; cum: number[]; hw: number }> | null = null;
  return (x: number, y: number) => {
    geo ??= [...ROADS, ...TRAILS].map((r) => ({ pts: r.pts, cum: cumulative(r.pts), hw: r.w / 2 }));
    let d = Infinity;
    for (const p of geo) d = Math.min(d, nearestOn(p.pts, p.cum, x, y).d - p.hw);
    return d;
  };
})();

let houses: House[] | null = null, moored: Boat[] | null = null;
/** Nhà sàn along the canals and the river: every ~170 px, alternating banks, facing the water; a xuồng tied below. */
export function stiltHouses(): readonly House[] {
  if (houses) return houses;
  const hs: House[] = [], bs: Boat[] = [];
  const along = (pts: readonly Vec[], off: number, boatOff: number, step: number, salt: number) => {
    const cum = cumulative(pts), L = cum[cum.length - 1];
    for (let s = 60, i = 0; s < L - 60; s += step, i++) {
      if (hashAt(s, salt, 90) < 0.3) continue;
      const p = pointAt(pts, cum, s), side = i % 2 ? 1 : -1;
      const nx = -p.dy * side, ny = p.dx * side;
      const x = p.x + nx * off, y = p.y + ny * off;
      if (x < 40 || y < 420 || x > WORLD_W - 40 || y > WORLD_H - 40) continue;
      if (zoneGap(x, y) < 60 || pathGap(x, y) < 26 || waterAt(x, y) !== null || canalDist(x, y) < CANAL_HALF_W + 14) continue;
      if (hs.some((h) => Math.hypot(h.x - x, h.y - y) < 90)) continue;
      const seed = Math.floor(hashAt(x, y, 91) * 1e6);
      hs.push({ x, y, yaw: Math.atan2(-nx, -ny), ground: heightAt(x, y), roof: seed % 3 ? "tin" : "leaf", seed });
      const bx = p.x + nx * boatOff, by = p.y + ny * boatOff;
      if (waterAt(bx, by) === RIVER_LEVEL) bs.push({ x: bx, y: by, yaw: Math.atan2(p.dx, p.dy), kind: "xuong", goods: 0, seed });
    }
  };
  CANALS.forEach((c, i) => along(c, CANAL_HALF_W + 34, CANAL_HALF_W - 7, 170, i));
  const cumR = cumulative(RIVER_PTS);
  const riverSide = (s: number) => riverAt(pointAt(RIVER_PTS, cumR, s).x, pointAt(RIVER_PTS, cumR, s).y).hw;
  along(RIVER_PTS, riverSide(0) + 40, riverSide(0) - 12, 240, 17);
  houses = hs;
  moored = bs;
  return hs;
}
/** The xuồng moored below the houses. */
export function mooredBoats(): readonly Boat[] {
  stiltHouses();
  return moored ?? [];
}

/** Where the floating market gathers: on the river, south-east of Chợ Lớn (past Sông Cái's east edge). */
export const FLOATING_MARKET = { x: 2330, y: 1790, r: 150 } as const;

let market: Boat[] | null = null;
/** Chợ nổi: ghe loaded with fruit and vegetables, each with its cây bẹo pole, milling on the river. */
export function floatingMarket(): readonly Boat[] {
  if (market) return market;
  const out: Boat[] = [];
  for (let i = 0; i < 40 && out.length < 16; i++) {
    const a = hashAt(i, 3, 92) * Math.PI * 2, r = Math.sqrt(hashAt(i, 5, 93)) * FLOATING_MARKET.r;
    const x = FLOATING_MARKET.x + Math.cos(a) * r, y = FLOATING_MARKET.y + Math.sin(a) * r * 0.5;
    if (waterAt(x, y) !== RIVER_LEVEL || riverAt(x, y).d > riverAt(x, y).hw - 18) continue;
    if (out.some((b) => Math.hypot(b.x - x, b.y - y) < 44)) continue;
    out.push({ x, y, yaw: hashAt(i, 7, 94) * 0.6 - 0.3 + (i % 2 ? Math.PI : 0), kind: i % 4 ? "ghe" : "xuong", goods: i % 5, seed: i });
  }
  market = out;
  return out;
}

/** A spot searched on a jittered grid (deterministic): the first `max` that `ok` accepts, `gap` px apart. */
function spots(step: number, salt: number, max: number, gap: number, ok: (x: number, y: number) => boolean): Vec[] {
  const out: Vec[] = [];
  for (let gy = 440; gy < WORLD_H - 60 && out.length < max; gy += step) for (let gx = 60; gx < WORLD_W - 60 && out.length < max; gx += step) {
    if (hashAt(gx, gy, salt) > 0.45) continue;
    const x = gx + (hashAt(gx, gy, salt + 1) - 0.5) * step * 0.6, y = gy + (hashAt(gx, gy, salt + 2) - 0.5) * step * 0.6;
    if (!ok(x, y) || out.some((p) => Math.hypot(p.x - x, p.y - y) < gap)) continue;
    out.push({ x, y });
  }
  return out;
}
const dry = (x: number, y: number, r: number) => waterAt(x, y) === null && canalDist(x, y) > CANAL_HALF_W + r && riverAt(x, y).d > riverAt(x, y).hw + r
  && !stiltHouses().some((h) => Math.hypot(h.x - x, h.y - y) < 60 + r);

export interface Pond { x: number; y: number; r: number; seed: number }
let ponds: Pond[] | null = null;
/** Ao sen: the hamlets' lotus ponds (round pads, pink flowers and buds), điên điển shrubs round their banks. */
export function lotusPonds(): readonly Pond[] {
  ponds ??= spots(210, 101, 10, 260, (x, y) => { const z = zoneGap(x, y); return z > 70 && z < 320 && pathGap(x, y) > 60 && dry(x, y, 50); })
    .map((p, i) => ({ ...p, r: 26 + hashAt(p.x, p.y, 105) * 14, seed: i }));
  return ponds;
}

export interface Garden { x: number; y: number; yaw: number; seed: number }
let gardens: Garden[] | null = null;
/** Thatched garden houses among the fruit trees, a winding pale stone path to each. */
export function gardenSpots(): readonly Garden[] {
  gardens ??= spots(180, 111, 8, 300, (x, y) => { const z = zoneGap(x, y); return z > 60 && z < 420 && pathGap(x, y) > 50 && dry(x, y, 40)
    && !lotusPonds().some((p) => Math.hypot(p.x - x, p.y - y) < p.r + 70); })
    .map((p, i) => ({ ...p, yaw: hashAt(p.x, p.y, 115) * Math.PI * 2, seed: i }));
  return gardens;
}

export interface Shop { x: number; y: number; yaw: number; name: string; seed: number }
/** Invented shop names (no real brands). */
const SHOP_NAMES = ["TẠP HÓA CÔ BA", "TẠP HÓA HAI LÚA", "TẠP HÓA ÚT HIỀN", "TẠP HÓA BẢY NHỎ", "TẠP HÓA MƯỜI THƠM", "TẠP HÓA CHÍN LỤA"];
let shops: Shop[] | null = null;
/** Roadside tạp hóa: single-storey fronts facing the road near the villages. */
export function villageShops(): readonly Shop[] {
  if (shops) return shops;
  const out: Shop[] = [];
  for (const r of ROADS) {
    const cum = cumulative(r.pts), L = cum[cum.length - 1];
    for (let s = 40; s < L - 40 && out.length < SHOP_NAMES.length; s += 150) {
      const p = pointAt(r.pts, cum, s), side = (out.length % 2) ? 1 : -1;
      const nx = -p.dy * side, ny = p.dx * side, off = r.w / 2 + 34;
      const x = p.x + nx * off, y = p.y + ny * off;
      if (zoneGap(x, y) < 40 || pathGap(x, y) < 22 || !dry(x, y, 30) || out.some((o) => Math.hypot(o.x - x, o.y - y) < 200)) continue;
      if (lotusPonds().some((o) => Math.hypot(o.x - x, o.y - y) < o.r + 50) || gardenSpots().some((o) => Math.hypot(o.x - x, o.y - y) < 80)) continue;
      out.push({ x, y, yaw: Math.atan2(-nx, -ny), name: SHOP_NAMES[out.length], seed: out.length });
    }
  }
  shops = out;
  return out;
}

/** The houses, shops, garden huts and ponds are solid (a circle each, px); the boats float. */
export function deltaSolid(x: number, y: number): boolean {
  return stiltHouses().some((h) => (x - h.x) ** 2 + (y - h.y) ** 2 <= 20 * 20)
    || villageShops().some((h) => (x - h.x) ** 2 + (y - h.y) ** 2 <= 22 * 22)
    || gardenSpots().some((h) => (x - h.x) ** 2 + (y - h.y) ** 2 <= 18 * 18)
    || lotusPonds().some((p) => (x - p.x) ** 2 + (y - p.y) ** 2 <= p.r * p.r);
}
