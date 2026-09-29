import * as THREE from "three";
import { JETTY } from "@/lib/game/maps/song-cai";
import type { GameMap } from "@/lib/game/maps/types";
import { RIVER, riverWater } from "@/lib/game/river/geometry";
import { pxLen } from "../coords";
import { rng } from "../layout";
import { Kit, ZONE_WATER_Y, type Inst, type OutdoorOptions } from "./outdoor-kit";

// Sông Cái ("song_cai") as a diorama: the wide brown-green river flowing east between grassy banks with a muddy lip and
// reeds (lau sậy), deeper in the middle, lighter over the three shoals (bãi cá, with rising bubbles), four mossy rocks
// with foam on their upstream side, the little island with its palm and the fisherman's lamp, the west jetty (Bến
// sông) on posts with its mooring post and lantern, and drifting things that show the current: light streaks and lục
// bình (water hyacinth) clumps moving downstream. Faithful to lib/game/maps/song-cai.ts, song-cai-art.ts and
// lib/game/river/geometry.ts. Pure layout first, then the Three.js builder.

// ---------------------------------------------------------------- pure

export type RiverGround = "grass" | "mud" | "water" | "rock" | "island" | "sand" | "jetty";

const ISLAND = RIVER.rocks[RIVER.rocks.length - 1];

/** The ground at one px (the 2D painter's order). */
export function riverGroundAt(x: number, y: number): RiverGround {
  if (x >= JETTY.x && x < JETTY.x + JETTY.w && y >= JETTY.y && y < JETTY.y + JETTY.h) return "jetty";
  const [ix, iy, ir] = ISLAND;
  const di = Math.hypot(x - ix, y - iy);
  if (di < ir) return di > ir - 6 ? "sand" : "island";
  if (RIVER.rocks.some(([cx, cy, r]) => Math.hypot(x - cx, y - cy) < r)) return "rock";
  if (riverWater(x, y)) return "water";
  const n = 4 + 2 * Math.sin(x / 37) + Math.sin(x / 11);
  const nearBand = x >= RIVER.x0 - 6 && x <= RIVER.x1 + 6 && y >= RIVER.y0 - n - 2 && y <= RIVER.y1 + n + 2;
  return nearBand ? "mud" : "grass";
}

/** How deep the river bed is at (x, y) (units below the ground): deepest mid-stream, shallow over shoals. */
export function riverDepth(x: number, y: number): number {
  const mid = (RIVER.y0 + RIVER.y1) / 2, half = (RIVER.y1 - RIVER.y0) / 2;
  const k = 1 - Math.min(1, Math.abs(y - mid) / half);
  const shoal = RIVER.shoals.some(([sx, sy, r]) => Math.hypot(x - sx, (y - sy) / 0.8) < r * 0.7);
  return shoal ? 0.55 : 0.6 + k * 0.9;
}

/** The water's colour: the painter's three bands (deep, mid, edge) and the shoals' lighter water. */
export function riverTint(x: number, y: number): number {
  if (RIVER.shoals.some(([sx, sy, r]) => Math.hypot(x - sx, (y - sy) / 0.8) < r * 0.6)) return 0x74b0a2;
  const mid = (RIVER.y0 + RIVER.y1) / 2, half = (RIVER.y1 - RIVER.y0) / 2;
  const k = Math.abs(y - mid) / half;
  return k < 0.35 ? 0x3f7478 : k < 0.7 ? 0x46807f : 0x4f8a8c;
}

/** The current's lanes for the drifting streaks and hyacinths (px), seeded. */
export interface RiverLayout {
  reeds: Array<{ x: number; y: number; h: number; tip: boolean }>;
  streaks: Array<{ lane: number; off: number; speed: number; len: number }>;
  hyacinths: Array<{ y: number; speed: number; off: number }>;
  lights: Array<{ x: number; y: number; r: number }>;
}

export function riverLayout(map: GameMap, opts: OutdoorOptions = {}): RiverLayout {
  const density = opts.density ?? 1;
  const R = rng(8601);
  const reeds: RiverLayout["reeds"] = [];
  for (let k = 0; k < Math.round(260 * density); k++) {
    const x = R() * map.width, north = k % 2 === 0;
    const y = north ? RIVER.y0 - 2 - R() * 8 : RIVER.y1 + 3 + R() * 8;
    if (x < JETTY.x + JETTY.w + 6 && y > JETTY.y - 20 && y < JETTY.y + JETTY.h + 10) continue;
    reeds.push({ x, y, h: 8 + R() * 10, tip: R() < 0.45 });
  }
  const streaks: RiverLayout["streaks"] = [];
  for (let i = 0; i < Math.round(80 * density); i++) {
    streaks.push({ lane: RIVER.y0 + 8 + ((i * 61) % (RIVER.y1 - RIVER.y0 - 16)), off: i * 131, speed: 18 + (i % 5) * 4, len: 5 + (i % 3) * 3 });
  }
  const hyacinths = Array.from({ length: 9 }, (_, i) => ({ y: 100 + ((i * 37) % 290), speed: 6 + (i % 4) * 2, off: i * 211 }));
  return {
    reeds, streaks, hyacinths,
    lights: [{ x: JETTY.x + JETTY.w - 1, y: JETTY.y - 8, r: 70 }, { x: 620, y: 226, r: 40 }],
  };
}

/** Where a drifting thing is at t (ms): x along the river, wrapping (it only moves downstream, +x). */
export function driftX(off: number, speedPxPerS: number, t: number): number {
  const span = RIVER.x1 - RIVER.x0 + 40;
  return RIVER.x0 - 20 + ((((off + (t / 1000) * speedPxPerS) % span) + span) % span);
}

/** Feet: on the jetty's deck, afloat in a ghe on the water, on the island / banks. */
export function riverHeightAt(x: number, y: number): number {
  const g = riverGroundAt(x, y);
  return g === "jetty" ? 0.3 : g === "water" ? ZONE_WATER_Y + 0.12 : g === "island" || g === "sand" ? 0.15 : 0;
}

// ---------------------------------------------------------------- Three.js

export function buildSongCaiZone(map: GameMap, opts: OutdoorOptions = {}): THREE.Group {
  const L = riverLayout(map, opts);
  const k = new Kit(map);
  const W = (x: number, y: number) => k.W(x, y);
  k.terrain(map.cell, (x, y) => {
    const g = riverGroundAt(x, y);
    switch (g) {
      case "water": return { top: -riverDepth(x, y), color: 0x5a4a30 };
      case "rock": return { top: -0.9, color: 0x56514a };
      case "mud": return { top: -0.12, color: 0x8a6a3f };
      case "island": return { top: 0.12, color: 0x6aa23c };
      case "sand": return { top: 0.02, color: 0xdcc08a };
      case "jetty": return { top: -0.6, color: 0x5a4a30 };
      default: return { top: 0, color: 0x6aa23c };
    }
  }, 8601);
  k.base();

  // ---- the river: one wide surface, flowing east; foam lines at its lips
  k.water({ x: RIVER.x0 - 6, y: RIVER.y0 - 4, w: RIVER.x1 - RIVER.x0 + 12, h: RIVER.y1 - RIVER.y0 + 8 }, { flow: 1, tint: riverTint, segs: [120, 44], opacity: 0.86 });

  // ---- rocks (mossy, with a foam collar upstream) and the island
  const rockGeo = k.geo(new THREE.DodecahedronGeometry(1, 0));
  const foam: Inst[] = [];
  RIVER.rocks.slice(0, -1).forEach(([cx, cy, r], i) => {
    const p = W(cx, cy), s = pxLen(r), RR = rng(8603 + i);
    const m = k.mesh(rockGeo, k.lam(0x7a7468), p.x, -0.2, p.z);
    m.scale.set(s * 1.05, s * 0.75, s * 0.95);
    m.rotation.set(RR(), RR() * 3, 0);
    const hi = k.mesh(rockGeo, k.lam(0xa39c8e), p.x - s * 0.25, s * 0.3, p.z - s * 0.2);
    hi.scale.set(s * 0.45, s * 0.3, s * 0.4);
    const mossy = k.mesh(rockGeo, k.lam(0x5a8a3a), p.x + s * 0.1, s * 0.42, p.z + s * 0.05);
    mossy.scale.set(s * 0.5, s * 0.12, s * 0.45);
    for (let a = Math.PI * 0.6; a < Math.PI * 1.4; a += 0.18) {
      const f = W(cx + Math.cos(a) * (r + 2), cy + Math.sin(a) * (r + 2));
      foam.push({ x: f.x, y: ZONE_WATER_Y + 0.05, z: f.z, sx: 0.2, sy: 0.03, sz: 0.3, ry: -a, color: 0xd6ece4 });
    }
  });
  k.inst(k.unit, k.lam(0xffffff), foam, { shadow: false });
  {
    const [ix, iy, ir] = ISLAND, p = W(ix, iy);
    const mound = k.mesh(k.geo(new THREE.SphereGeometry(1, 14, 5, 0, Math.PI * 2, 0, Math.PI / 2)), k.lam(0x5f9a38), p.x, 0.05, p.z);
    mound.scale.set(pxLen(ir - 6), 0.45, pxLen(ir - 6) * 0.95);
    // the fisherman's lamp on a pole and a little hut of leaves
    const lp = W(620, 226);
    k.box(0.08, 1.8, 0.08, 0x5a3a1e, lp.x - 0.9, 0.2, lp.z + 0.8);
    k.bulb(lp.x - 0.9, 2.0, lp.z + 0.8);
    const hut = k.mesh(k.geo(new THREE.ConeGeometry(1, 1, 5)), k.lam(0xa8843f), p.x + 0.9, 0.9, p.z + 0.7);
    hut.scale.set(0.9, 0.9, 0.8);
    k.box(0.6, 0.02, 0.9, 0x8a6a45, p.x - 0.1, 0.42, p.z + 1.4, 0.3);                        // a drying net frame
  }

  // ---- reeds along both banks
  const reedGeo = k.geo(new THREE.BoxGeometry(0.05, 1, 0.05));
  reedGeo.translate(0, 0.5, 0);
  k.inst(reedGeo, k.lam(0xffffff), L.reeds.map((r, i) => {
    const p = W(r.x, r.y);
    return { x: p.x, y: -0.1, z: p.z, sy: pxLen(r.h), rx: ((i % 13) - 6) / 40, rz: ((i % 11) - 5) / 40, color: i % 3 ? 0x9aa84a : 0x6e7a2e };
  }), { thin: true, shadow: false });
  k.inst(k.geo(new THREE.CapsuleGeometry(0.05, 0.16, 2, 4)), k.lam(0xd8c878), L.reeds.filter((r) => r.tip).map((r) => {
    const p = W(r.x, r.y);
    return { x: p.x, y: -0.1 + pxLen(r.h), z: p.z };
  }), { thin: true, shadow: false });

  // ---- the jetty: planks on posts, the mooring post and rope, the lantern
  {
    const c = W(JETTY.x + JETTY.w / 2, JETTY.y + JETTY.h / 2), w = pxLen(JETTY.w), d = pxLen(JETTY.h);
    k.box(w, 0.14, d, 0xc9955a, c.x, 0.16, c.z);
    for (let y = JETTY.y + 4; y < JETTY.y + JETTY.h; y += 4) k.beam(JETTY.x, y, JETTY.x + JETTY.w, y, 0.305, 0.02, 0x8a5a33, 0.01);
    for (const px0 of [JETTY.x + 7, JETTY.x + 27, JETTY.x + 47]) for (const py of [JETTY.y + 1, JETTY.y + JETTY.h - 1]) {
      const p = W(px0, py);
      k.mesh(k.geo(new THREE.CylinderGeometry(0.09, 0.1, 1.3, 6)), k.lam(0x5a3a1e), p.x, -0.4, p.z);
    }
    const mp = W(JETTY.x + JETTY.w - 2, JETTY.y - 4);
    k.box(0.22, 1.3, 0.22, 0x6e4424, mp.x, 0, mp.z);
    k.box(0.26, 0.06, 0.26, 0xf6c945, mp.x, 0.6, mp.z);
    k.box(0.05, 1.9, 0.05, 0x3a2418, mp.x - 0.25, 0.3, mp.z);
    k.bulb(mp.x - 0.25, 2.25, mp.z, 0.16);
  }

  // ---- palms, bananas, the sign, the city post
  for (const p of map.props) {
    if (p.kind === "palm") {
      const onIsland = Math.hypot(p.x - ISLAND[0], p.y - ISLAND[1]) < ISLAND[2];
      k.palm(p.x, p.y, p.h, p.lean, p.seed, onIsland ? 0.4 : 0);
    } else if (p.kind === "banana") k.banana(p.x, p.y);
    else if (p.kind === "sign") k.sign(p.x, p.y);
    else if (p.kind === "city_map_post") k.sign(p.x, p.y, "city");
  }
  for (const l of L.lights) k.lamp(l.x, l.y, l.r, 2.1, 0xffc070);

  // ---- the current: streaks and lục bình drifting downstream; bubbles over the shoals
  const streakIm = k.inst(k.unit, k.lam(0x8cc4bc, 0x2a4a48), [], { capacity: L.streaks.length, shadow: false });
  const hyGeo = k.geo(new THREE.SphereGeometry(1, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2));
  const hyIm = k.inst(hyGeo, k.lam(0x3f7a2e), [], { capacity: L.hyacinths.length * 2 });
  const flowerIm = k.inst(k.geo(new THREE.ConeGeometry(0.1, 0.18, 5)), k.lam(0xb58ae0), [], { capacity: L.hyacinths.length, shadow: false });
  const bubbleIm = k.inst(k.geo(new THREE.IcosahedronGeometry(0.06, 0)), k.lam(0xd6ece4), [], { capacity: RIVER.shoals.length * 4, shadow: false });
  for (const im of [streakIm, hyIm, flowerIm, bubbleIm]) { im.userData.keep = true; im.frustumCulled = false; }
  const drift = (t: number) => {
    const ss: Inst[] = [];
    for (const s of L.streaks) {
      const x = driftX(s.off, s.speed, t);
      if (!riverWater(x, s.lane) || !riverWater(x + s.len, s.lane)) continue;
      const p = W(x + s.len / 2, s.lane);
      ss.push({ x: p.x, y: ZONE_WATER_Y + 0.07, z: p.z, sx: pxLen(s.len), sy: 0.015, sz: 0.05 });
    }
    k.fill(streakIm, ss);
    const hs: Inst[] = [], fs: Inst[] = [];
    L.hyacinths.forEach((h, i) => {
      const x = driftX(h.off, h.speed, t), y = h.y + Math.sin(t / 700 + h.off) * 1.5;
      if (!riverWater(Math.round(x), Math.round(y))) return;
      const p = W(x, y);
      hs.push({ x: p.x, y: ZONE_WATER_Y, z: p.z, sx: 0.36, sy: 0.18, sz: 0.28, ry: i + t / 4000 });
      hs.push({ x: p.x + 0.22, y: ZONE_WATER_Y, z: p.z - 0.1, sx: 0.22, sy: 0.14, sz: 0.2, ry: i });
      fs.push({ x: p.x + 0.05, y: ZONE_WATER_Y + 0.26, z: p.z, rx: Math.PI });
    });
    k.fill(hyIm, hs);
    k.fill(flowerIm, fs);
    const bs: Inst[] = [];
    RIVER.shoals.forEach(([sx, sy], i) => {
      for (let b = 0; b < 4; b++) {
        const ph = (t / 900 + b * 0.25 + i * 0.3) % 1;
        if (ph >= 0.8) continue;
        const p = W(sx - 20 + ((b * 23 + i * 7) % 40), sy + 10 - ph * 20);
        bs.push({ x: p.x, y: ZONE_WATER_Y + 0.06 + ph * 0.1, z: p.z });
      }
    });
    k.fill(bubbleIm, bs);
  };
  drift(0);

  return k.finish({ heightAt: riverHeightAt, animate: (t) => drift(t) });
}
