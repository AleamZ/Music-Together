import * as THREE from "three";
import { BAI_BAG, BRIDGE, BROKEN_WALL, RECORDS_BOARD, RING_RECTS, TAP, TIRES } from "@/lib/game/maps/bai-dat";
import type { GameMap, Rect } from "@/lib/game/maps/types";
import { GATE, RAID_ARENA, STALL } from "@/lib/game/realm/model";
import { pxLen } from "../coords";
import { rng } from "../layout";
import { inRect, Kit, type Inst, type OutdoorOptions } from "./outdoor-kit";

// Bãi đất trống ("bai_dat") as a diorama: packed dirt with weeds and tyre ruts, the canal and its little bridge to the
// north, the four boxing rings on raised plank floors (canvas mats, three ropes, red corner posts on the west and blue
// on the east) under corrugated tin roofs with a bulb each, the boss arena's staked border between them, the old tyre
// stack, the dripping tap, the broken brick wall on the east, the sheet-iron fence along the south, the training corner
// with its punching bag, the records board, the hunter's stall and the dungeon's stone gate with its torches. Faithful to
// lib/game/maps/bai-dat.ts, bai-dat-art.ts and the realm's places (lib/game/realm/model.ts). Pure layout first, then
// the Three.js builder.

// ---------------------------------------------------------------- pure

export type BaiGround = "canal" | "bridge" | "dirt" | "rut" | "fence" | "rubble";

export const RING_FLOOR = 0.45;
/** The hunter's stall (its footprint north of the point where you trade) and the dungeon gate's rock. */
export const STALL_RECT: Rect = { x: STALL.x - 26, y: STALL.y - 26, w: 52, h: 22 };
export const GATE_RECT: Rect = { x: GATE.x - 22, y: GATE.y - 30, w: 44, h: 26 };

export function baiGroundAt(x: number, y: number): BaiGround {
  if (y < 22) return inRect(x, y, BRIDGE) ? "bridge" : "canal";
  if (y >= 384) return "fence";
  if (x >= 736 && x < 784 && BROKEN_WALL.some((w) => y >= w.y - 8 && y < w.y + w.h + 8)) return "rubble";
  const wob = Math.round(Math.sin(y / 23) * 3);
  if (Math.abs(x - (392 + wob)) < 2 || Math.abs(x - (408 + wob)) < 2) return "rut";
  return "dirt";
}

const GROUND: Record<BaiGround, { top: number; color: number }> = {
  canal: { top: -0.9, color: 0x3a3226 }, bridge: { top: -0.9, color: 0x3a3226 }, dirt: { top: 0, color: 0xb99468 },
  rut: { top: -0.03, color: 0x94734e }, fence: { top: 0, color: 0xa3805a }, rubble: { top: 0.02, color: 0xa88a66 },
};

export function inRing(x: number, y: number): number {
  return RING_RECTS.findIndex((r) => inRect(x, y, r));
}

/** Where feet stand (units): up on a ring's floor, on the bridge. */
export function baiHeightAt(x: number, y: number): number {
  if (inRing(x, y) >= 0) return RING_FLOOR + 0.06;
  return inRect(x, y, BRIDGE) ? 0.12 : 0;
}

export interface BaiLayout {
  weeds: Array<{ x: number; y: number; h: number; light: boolean }>;
  stakes: Array<{ x: number; y: number }>;
  lights: Array<{ x: number; y: number; r: number }>;
}

export function baiLayout(map: GameMap, opts: OutdoorOptions = {}): BaiLayout {
  const density = opts.density ?? 1;
  const R = rng(2003);
  const weeds: BaiLayout["weeds"] = [];
  for (let k = 0; k < 400 && weeds.length < Math.round(140 * density); k++) {
    const edge = R() < 0.5;
    const x = edge ? (R() < 0.5 ? 6 + R() * 60 : 690 + R() * 50) : 320 + R() * 160, y = 30 + R() * 350;
    if (inRing(x, y) >= 0 || inRect(x, y, TIRES, 4) || inRect(x, y, GATE_RECT, 4) || baiGroundAt(x, y) !== "dirt") continue;
    if (map.interactables.some((i) => inRect(x, y, i.rect))) continue;
    weeds.push({ x, y, h: 4 + R() * 6, light: R() < 0.5 });
  }
  // the boss arena's border: a stake every ~42 px round RAID_ARENA (none on the ruts' track in and out)
  const A = RAID_ARENA, stakes: BaiLayout["stakes"] = [];
  const along = (x1: number, y1: number, x2: number, y2: number) => {
    const n = Math.max(1, Math.round(Math.hypot(x2 - x1, y2 - y1) / 42));
    for (let i = 0; i < n; i++) {
      const x = x1 + ((x2 - x1) * i) / n, y = y1 + ((y2 - y1) * i) / n;
      if (x > 384 && x < 416) continue;
      stakes.push({ x, y });
    }
  };
  along(A.x, A.y, A.x + A.w, A.y); along(A.x + A.w, A.y, A.x + A.w, A.y + A.h);
  along(A.x + A.w, A.y + A.h, A.x, A.y + A.h); along(A.x, A.y + A.h, A.x, A.y);
  return {
    weeds, stakes,
    lights: [
      ...RING_RECTS.map((r) => ({ x: r.x + r.w / 2, y: r.y + 12, r: 60 })),
      { x: STALL.x, y: STALL.y - 8, r: 44 },
      { x: GATE.x, y: GATE.y - 6, r: 40 },
    ],
  };
}

// ---------------------------------------------------------------- Three.js

export function buildBaiDatZone(map: GameMap, opts: OutdoorOptions = {}): THREE.Group {
  const L = baiLayout(map, opts);
  const k = new Kit(map);
  const W = (x: number, y: number) => k.W(x, y);
  k.terrain(map.cell, (x, y) => GROUND[baiGroundAt(x, y)], 2003);
  k.base(0x8a6440, 0x8a7050);

  // ---- the canal (flowing east) and the bridge back to Chợ Lớn
  k.water({ x: 0, y: 0, w: map.width, h: 22 }, { y: -0.3, color: 0x3f7a96, flow: 0.5, segs: [90, 3] });
  {
    const c = W(BRIDGE.x + BRIDGE.w / 2, BRIDGE.y + BRIDGE.h / 2);
    k.box(pxLen(BRIDGE.w + 4), 0.12, pxLen(BRIDGE.h), 0x9a6a3c, c.x, 0, c.z);
    for (let y = 2; y < BRIDGE.h; y += 4) k.beam(BRIDGE.x, y, BRIDGE.x + BRIDGE.w, y, 0.125, 0.03, 0x6e4a28, 0.01);
    for (const sx of [BRIDGE.x - 1, BRIDGE.x + BRIDGE.w + 1]) {
      k.beam(sx, 0, sx, BRIDGE.h, 0.6, 0.07, 0x6e4a28);
      for (const sy of [2, BRIDGE.h - 2]) { const p = W(sx, sy); k.box(0.09, 1.5, 0.09, 0x6e4a28, p.x, -0.9, p.z); }
    }
  }

  // ---- the sheet-iron fence along the south
  for (let x = 0; x < map.width; x += 14) {
    const c = W(x + 6.5, 390);
    k.box(pxLen(13), 1.5, 0.08, x % 28 ? 0x7d8690 : 0x59616a, c.x, 0, c.z, (x % 42) * 0.002);
    if ((x * 7) % 3 === 0) k.box(0.25, 0.14, 0.02, 0x9a5a32, c.x + 0.1, 0.4 + (x % 5) * 0.15, c.z + 0.05);
  }
  for (let x = 0; x <= map.width; x += 56) { const p = W(x, 392); k.box(0.1, 1.6, 0.1, 0x59616a, p.x, 0, p.z); }

  // ---- the rings
  RING_RECTS.forEach((r, i) => {
    const c = W(r.x + r.w / 2, r.y + r.h / 2), w = pxLen(r.w), d = pxLen(r.h);
    k.box(w, RING_FLOOR - 0.05, d, 0x7a5a3a, c.x, 0, c.z);                                      // the plank apron
    for (let x = r.x + 10; x < r.x + r.w; x += 10) k.beam(x, r.y, x, r.y + r.h, RING_FLOOR - 0.04, 0.02, 0x6e4a28, 0.02);
    k.boxPx(r, RING_FLOOR - 0.05, 0.06, 0xd9cfb4, 5);                                           // the mat
    for (let yy = r.y + 20; yy < r.y + r.h - 6; yy += 20) k.beam(r.x + 5, yy, r.x + r.w - 5, yy, RING_FLOOR + 0.015, 0.02, 0xa89c7c, 0.01);
    // the corner pads (red west, blue east)
    for (const [px0, col] of [[r.x + 8, 0xc0392b], [r.x + r.w - 8, 0x2f5fb8]] as const) {
      const p = W(px0, r.y + r.h / 2);
      k.box(0.25, 0.9, 1.25, col, p.x, RING_FLOOR, p.z);
    }
    // corner posts and three ropes a side
    const posts: Array<[number, number, number]> = [
      [r.x + 3, r.y + 3, 0xc0392b], [r.x + 3, r.y + r.h - 3, 0xc0392b], [r.x + r.w - 3, r.y + 3, 0x2f5fb8], [r.x + r.w - 3, r.y + r.h - 3, 0x2f5fb8],
    ];
    for (const [px0, py0, col] of posts) { const p = W(px0, py0); k.box(0.2, 1.55, 0.2, col, p.x, RING_FLOOR, p.z); }
    for (const hy of [0.55, 0.9, 1.25]) {
      const y = RING_FLOOR + hy;
      k.beam(r.x + 3, r.y + 3, r.x + r.w - 3, r.y + 3, y, 0.05, 0xf1ece0);
      k.beam(r.x + 3, r.y + r.h - 3, r.x + r.w - 3, r.y + r.h - 3, y, 0.05, 0xf1ece0);
      k.beam(r.x + 3, r.y + 3, r.x + 3, r.y + r.h - 3, y, 0.05, 0xf1ece0);
      k.beam(r.x + r.w - 3, r.y + 3, r.x + r.w - 3, r.y + r.h - 3, y, 0.05, 0xf1ece0);
    }
    // the tin roof on four tall posts (it fades while you stand under it)
    for (const [px0, py0] of [[r.x - 2, r.y - 2], [r.x + r.w + 2, r.y - 2], [r.x - 2, r.y + r.h + 2], [r.x + r.w + 2, r.y + r.h + 2]]) {
      const p = W(px0, py0);
      k.box(0.14, 3.6, 0.14, 0x6f7882, p.x, 0, p.z);
    }
    const roof = k.roof({ x: r.x - 4, y: r.y - 16, w: r.w + 8, h: r.h + 20 });
    const n = Math.round((r.w + 8) / 6);
    for (let s = 0; s < n; s++) {
      const x = r.x - 4 + (s + 0.5) * ((r.w + 8) / n), p = W(x, r.y + r.h / 2);
      const sheet = k.box(pxLen((r.w + 8) / n) + 0.01, 0.07, d + 0.9, roof.mat(s % 2 ? 0x9aa3ad : 0xc2c9d0), p.x, 3.6 + (s % 2) * 0.05, p.z);
      sheet.rotation.x = 0.1;
    }
    for (let s = 0; s < 5; s++) {
      const p = W(r.x + 12 + s * 41, r.y + 10 + ((s * 37 + i * 13) % (r.h - 20)));
      k.box(0.3, 0.02, 0.22, roof.mat(0x9a5a32), p.x, 3.72, p.z);
    }
    k.bulb(c.x, 3.2, W(0, r.y + 12).z, 0.16);
    k.beam(r.x + r.w / 2, r.y + 12, r.x + r.w / 2, r.y + 12, 3.45, 0.02, 0x2a2622, 0.3);
  });

  // ---- the boss arena's border: stakes with red rags
  for (const s of L.stakes) {
    const p = W(s.x, s.y);
    k.box(0.12, 1.1, 0.12, 0x5a3a1e, p.x, 0, p.z);
    k.box(0.28, 0.18, 0.03, 0xc0392b, p.x + 0.16, 0.8, p.z);
  }

  // ---- the tyre stack
  const tyre = k.geo(new THREE.TorusGeometry(0.62, 0.26, 6, 12));
  tyre.rotateX(Math.PI / 2);
  const tc = W(TIRES.x + TIRES.w / 2, TIRES.y + TIRES.h / 2);
  k.inst(tyre, 0x2a2a2e, [0, 1, 2].map((i) => ({ x: tc.x + i * 0.05, y: 0.26 + i * 0.44, z: tc.z - i * 0.04, sx: 1 - i * 0.05, sz: 1 - i * 0.05 })));
  k.inst(tyre, 0x2a2a2e, [{ x: tc.x + 1.1, y: 0.62, z: tc.z + 0.4, rz: Math.PI / 2 - 0.3 }]);

  // ---- the tap: a pipe, the spout, a puddle below
  {
    const p = W(TAP.x, TAP.y);
    k.box(0.14, 1.2, 0.14, 0x59616a, p.x, 0, p.z - 0.1);
    k.box(0.35, 0.08, 0.08, 0xc9ccd2, p.x + 0.12, 1.15, p.z - 0.1);
    k.box(0.06, 0.16, 0.06, 0xc9ccd2, p.x + 0.26, 1.02, p.z - 0.1);
    const puddle = k.mesh(k.geo(new THREE.CylinderGeometry(0.4, 0.4, 0.02, 10)), k.lam(0x4a7e9a), p.x + 0.26, 0.01, p.z + 0.05, k.root, false);
    puddle.scale.set(1.2, 1, 0.7);
  }

  // ---- the broken brick wall (jagged tops) and its rubble
  const WR = rng(2004);
  for (const wl of BROKEN_WALL) {
    for (let y = wl.y; y < wl.y + wl.h; y += 6) {
      const p = W(wl.x + wl.w / 2, y + 3), h = 1.4 + WR() * 1.2 - (y === wl.y || y + 6 >= wl.y + wl.h ? 0.6 : 0);
      k.box(pxLen(wl.w), h, pxLen(6), (y / 6) % 2 ? 0xa8523a : 0x9a4a34, p.x, 0, p.z);
      for (let row = 0.35; row < h; row += 0.35) k.box(pxLen(wl.w) + 0.02, 0.03, pxLen(6) + 0.01, 0xc9b89a, p.x, row, p.z);
    }
  }
  const rubble: Inst[] = [];
  for (let i = 0; i < 70; i++) {
    const y = 60 + WR() * 310, x = 736 + WR() * 40;
    if (inRect(x, y, { x: 762, y: 248, w: 22, h: 40 })) continue;
    const p = W(x, y);
    rubble.push({ x: p.x, y: 0.05, z: p.z, sx: 0.12 + WR() * 0.12, sy: 0.08 + WR() * 0.08, sz: 0.1 + WR() * 0.1, ry: WR() * 3, color: WR() < 0.6 ? 0xa8523a : 0xc9b89a });
  }
  k.inst(k.unit, k.lam(0xffffff), rubble, { thin: true });
  // the east edge behind the wall: scrub and a low bank
  k.boxPx({ x: 784, y: 22, w: 16, h: 362 }, 0, 0.5, 0x8a7050);

  // ---- weeds
  const blade = k.geo(new THREE.ConeGeometry(0.1, 1, 4));
  blade.translate(0, 0.5, 0);
  k.inst(blade, k.lam(0xffffff), L.weeds.flatMap((w, i) => {
    const p = W(w.x, w.y), h = pxLen(w.h);
    return [-1, 0, 1].map((s) => ({ x: p.x + s * 0.08, y: 0, z: p.z, sy: h * (s ? 0.7 : 1), rz: s * 0.4, ry: i, color: w.light ? 0x88ac48 : 0x6a8f3a }));
  }), { thin: true, shadow: false });

  // ---- the training corner: the punching bag on its gallows, a practice mat, a wooden dummy
  {
    const p = W(BAI_BAG.x, BAI_BAG.y);
    k.box(pxLen(40), 0.05, pxLen(22), 0x3f6fb8, p.x - 0.1, 0, p.z - pxLen(16));
    k.box(0.5, 0.25, 0.5, 0x8a8478, p.x + 0.45, 0, p.z);
    k.box(0.16, 2.3, 0.16, 0xb07a45, p.x + 0.45, 0.25, p.z);
    k.box(1.0, 0.14, 0.14, 0xb07a45, p.x, 2.45, p.z);
    k.box(0.03, 0.4, 0.03, 0x8a8e98, p.x - 0.35, 2.05, p.z);
    const bag = new THREE.Group();
    bag.position.set(p.x - 0.35, 2.05, p.z);
    k.mesh(k.geo(new THREE.CylinderGeometry(0.26, 0.26, 1.0, 8)), k.lam(0xc0392b), 0, -0.55, 0, bag);
    k.mesh(k.geo(new THREE.CylinderGeometry(0.27, 0.27, 0.08, 8)), k.lam(0x8e2a1f), 0, -0.06, 0, bag);
    bag.userData.keep = true;
    k.root.add(bag);
    k.sway.push({ obj: bag, seed: 7, base: 0 });
    const dm = W(BAI_BAG.x + 30, BAI_BAG.y + 6);                                   // a mộc nhân (wooden dummy)
    k.mesh(k.geo(new THREE.CylinderGeometry(0.2, 0.22, 1.9, 8)), k.lam(0x8a5a30), dm.x, 0.95, dm.z);
    for (const [dy, ry] of [[1.35, 0.4], [1.05, -0.5], [0.6, 0]] as const) {
      const arm = k.box(0.55, 0.08, 0.08, 0x6e4424, dm.x + Math.cos(ry) * 0.3, dy, dm.z + Math.sin(ry) * 0.3, ry);
      arm.castShadow = true;
    }
  }

  // ---- the records board ("Bảng thành tích")
  k.sign(RECORDS_BOARD.x, RECORDS_BOARD.y, "board");

  // ---- the hunter's stall (the night market by night): a plank counter, a leaf awning, pelts and antlers
  {
    const r = STALL_RECT, c = W(r.x + r.w / 2, r.y + r.h / 2), w = pxLen(r.w), d = pxLen(r.h);
    k.box(w, 0.9, 0.5, 0x6e4424, c.x, 0, c.z + d / 2 - 0.25);
    k.box(w + 0.1, 0.08, 0.6, 0xa8743f, c.x, 0.9, c.z + d / 2 - 0.25);
    k.box(w, 1.8, 0.12, 0x8a5a30, c.x, 0, c.z - d / 2);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(0.12, 2.3, 0.12, 0x5a3a1e, c.x + sx * (w / 2 - 0.06), 0, c.z + sz * (d / 2 - 0.06));
    const roof = k.roof({ x: r.x - 4, y: r.y - 14, w: r.w + 8, h: r.h + 16 });
    const leaf = k.mesh(k.geo(new THREE.ConeGeometry(1, 1, 4, 1)), roof.mat(0xa8843f), c.x, 2.75, c.z);
    leaf.scale.set(w * 0.78, 0.9, d * 0.95);
    leaf.rotation.y = Math.PI / 4;
    for (const [dx, col] of [[-0.9, 0x8a5a2b], [-0.2, 0xb88a52], [0.6, 0x5a4636]] as const) k.box(0.5, 0.7, 0.04, col, c.x + dx, 0.7, c.z - d / 2 + 0.09);
    const ant = W(STALL.x + 14, STALL.y - 24);
    for (const s of [-1, 1]) { const a = k.box(0.05, 0.5, 0.05, 0xe8dcc0, ant.x + s * 0.12, 1.35, ant.z + 0.08); a.rotation.z = s * 0.5; }
    k.bulb(c.x + w / 2 - 0.1, 2.0, c.z + d / 2);
  }

  // ---- the dungeon gate: a stone arch on a boulder mound, a black mouth, two torches
  const flames: THREE.Mesh[] = [];
  {
    const r = GATE_RECT, c = W(r.x + r.w / 2, r.y + r.h / 2 - 4);
    const rock = k.geo(new THREE.DodecahedronGeometry(1, 0));
    const GR = rng(61);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI;
      const m = k.mesh(rock, k.lam([0x6d655c, 0x5a544c, 0x7a7266][i % 3]), c.x + Math.cos(a) * 1.3, 0.3 + Math.sin(a) * 1.4, c.z - 0.2 + GR() * 0.1);
      m.scale.set(0.55 + GR() * 0.2, 0.5 + GR() * 0.2, 0.6);
      m.rotation.set(GR() * 3, GR() * 3, 0);
    }
    const back = k.mesh(rock, k.lam(0x4f4841), c.x, 0.6, c.z - 0.9);
    back.scale.set(2.1, 1.7, 1.0);
    k.box(1.5, 1.6, 0.1, 0x0d0b0a, c.x, 0, c.z - 0.25);
    k.box(1.9, 0.14, 0.4, 0x3a342f, c.x, 1.95, c.z - 0.2);
    for (const s of [-1, 1]) {
      const tx = c.x + s * 1.35, tz = c.z + 0.35;
      k.box(0.08, 1.2, 0.08, 0x5a3a1e, tx, 0, tz);
      const f = k.mesh(k.geo(new THREE.ConeGeometry(0.12, 0.34, 5)), k.own(new THREE.MeshBasicMaterial({ color: 0xffa040 })), tx, 1.35, tz, k.root, false);
      f.userData.keep = true;
      flames.push(f);
    }
  }

  // ---- signs, the city post
  for (const p of map.props) {
    if (p.kind === "sign") k.sign(p.x, p.y);
    else if (p.kind === "city_map_post") k.sign(p.x, p.y, "city");
  }
  for (const l of L.lights) k.lamp(l.x, l.y, l.r, l === L.lights[L.lights.length - 1] ? 1.4 : 3.1);

  return k.finish({
    heightAt: baiHeightAt,
    animate(t) {
      flames.forEach((f, i) => { const s = 1 + Math.sin(t / 90 + i * 2) * 0.15 + Math.sin(t / 37 + i) * 0.08; f.scale.set(s, s * 1.1, s); });
    },
  });
}

