// The rim: the land round the playable world (beyond its edge — never walkable, not on the minimap), one seamless
// heightfield with the world's own (terrain.ts heightAt folds it in). Mekong-themed:
//   - Thất Sơn: seven rounded forested hills (Núi Cấm-like) rising round the north and east;
//   - the delta going on everywhere else — paddies and canals on the low land;
//   - the river's two mouths, and the south-west opening into a wide estuary / the sea;
//   - a far river winding off east between the hills, the west one out to the estuary.
// World px. Pure, deterministic.

import { fbm, smoothstep } from "./terrain";   // (a cycle: used at call time only)

export const RIM_WORLD_W = 4160;
export const RIM_WORLD_H = 2240;

/** How far (px) past the world's edge (0 inside). */
export function outsideWorld(x: number, y: number): number {
  return Math.max(-x, x - RIM_WORLD_W, -y, y - RIM_WORLD_H, 0);
}

/** Thất Sơn: centre, radius (px) and height (units). */
export const RIM_HILLS: readonly { x: number; y: number; r: number; h: number }[] = [
  { x: 600, y: -1250, r: 900, h: 16 }, { x: 2000, y: -1650, r: 1150, h: 24 }, { x: 3500, y: -1350, r: 950, h: 19 },
  { x: 4950, y: -900, r: 1250, h: 30 }, { x: 5600, y: 500, r: 950, h: 21 }, { x: 5800, y: 1800, r: 800, h: 15 },
  { x: 6700, y: -2700, r: 1900, h: 42 },
  // a second, farther line behind (bluer in the haze)
  { x: -600, y: -3200, r: 1800, h: 30 }, { x: 2800, y: -4200, r: 2400, h: 46 }, { x: 8600, y: 400, r: 2200, h: 38 },
  { x: 8200, y: 3200, r: 1600, h: 24 },
];

/** The far rivers (px): the main river's east end winding on between the hills; the west end out to the estuary. */
export const FAR_RIVER: readonly { x: number; y: number }[] = [
  { x: 5400, y: 1840 }, { x: 6900, y: 2500 }, { x: 8600, y: 2150 }, { x: 10500, y: 2700 }, { x: 13000, y: 2300 },
];
export const WEST_RIVER: readonly { x: number; y: number }[] = [
  { x: -1300, y: 1560 }, { x: -3000, y: 1900 }, { x: -4800, y: 2700 }, { x: -6500, y: 3800 },
];
/** The far canals (straight, as the delta's are). */
export const FAR_CANALS: readonly (readonly { x: number; y: number }[])[] = [
  [{ x: -9000, y: 300 }, { x: -200, y: 300 }],
  [{ x: 4400, y: 320 }, { x: 4700, y: 340 }],
  [{ x: -2600, y: -300 }, { x: -2500, y: 5200 }],
  [{ x: 600, y: 3100 }, { x: 9000, y: 3500 }],
  [{ x: 2400, y: 2240 }, { x: 2500, y: 7000 }],
  [{ x: -6000, y: -1500 }, { x: -1000, y: -900 }],
];

function segDist(pts: readonly { x: number; y: number }[], x: number, y: number): number {
  let d = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    const t = Math.max(0, Math.min(1, ((x - a.x) * (b.x - a.x) + (y - a.y) * (b.y - a.y)) / l2));
    d = Math.min(d, Math.hypot(x - a.x - t * (b.x - a.x), y - a.y - t * (b.y - a.y)));
  }
  return d;
}

/** The estuary: 1 = open sea (the south-west). */
export function estuary(x: number, y: number): number {
  const d = Math.hypot((x + 7000) / 1.4, y - 6200);
  return 1 - smoothstep(5000, 6200, d + fbm(x / 1400, y / 1400, 2) * 900);
}

/** The hills' rise (units) at (x, y); 0 inside the world (they stand only past its edge). */
export function rimHills(x: number, y: number): number {
  const out = outsideWorld(x, y);
  if (out <= 0) return 0;
  let h = 0;
  for (const H of RIM_HILLS) {
    const d = Math.hypot(x - H.x, (y - H.y) * 1.1);
    if (d >= H.r) continue;
    const t = 1 - (d / H.r) ** 2;
    h = Math.max(h, H.h * Math.pow(t, 1.4) * (0.85 + 0.25 * fbm(x / 240 + H.x, y / 240, 3)));
  }
  return h * smoothstep(0, 420, out);
}

/** How wet the rim is at (x, y), 0…1 (smooth across the banks), and how much of it is sea. 0 inside the world. */
export function rimWet(x: number, y: number): { wet: number; sea: number } {
  const out = outsideWorld(x, y);
  if (out <= 0) return { wet: 0, sea: 0 };
  const sea = smoothstep(0.3, 0.7, estuary(x, y));
  const w = 150 + out * 0.02;
  const river = Math.max(1 - smoothstep(w - 120, w + 120, segDist(FAR_RIVER, x, y)), 1 - smoothstep(w * 1.4 - 120, w * 1.4 + 120, segDist(WEST_RIVER, x, y)));
  let canal = 0;
  for (const c of FAR_CANALS) canal = Math.max(canal, 1 - smoothstep(14, 60, segDist(c, x, y)));
  return { wet: Math.max(sea, river, canal) * smoothstep(0, 120, out), sea };
}
