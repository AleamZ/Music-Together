import * as THREE from "three";
import { CAGE, CRATES, DRUM, HAM_LADDER, HAM_WALL_H, LADDER_DOOR, TU_SEO_TABLE, UG_BOARD } from "@/lib/game/maps/ham-ngam";
import type { GameMap } from "@/lib/game/maps/types";
import { pxLen } from "../coords";
import { rng } from "../layout";
import { Kit, type Inst, type OutdoorOptions } from "./outdoor-kit";

// "Hầm đấu ngầm" (ham_ngam, v20.4) as a diorama: the hidden cellar under Chợ Lớn's manhole — a stained concrete floor
// with expansion joints, oil stains and two drain grates; the raw concrete north wall in poured bands with a rusty pipe,
// a sagging cable and caged bulbs; the iron ladder up the shaft to the manhole; the chain-link cage on its red padded
// floor (a painted ring, four posts with sand-bags, a top rail, the chained gate on the south side); the iron "Cửa thách
// đấu" in the west wall with the chalk tallies of its ten floors; anh Tư Sẹo's table with a lamp, cash box and cups;
// the "Bảng xếp hạng ngầm"; crates and a blue oil drum. Faithful to lib/game/maps/ham-ngam.ts and ham-ngam-art.ts (the
// layout and interactables are unchanged). Lit as a cave (rig.cave: no sky, dark fog, the bulbs always on). The walls
// east, west and south stay low so the tilted camera sees in.

// ---------------------------------------------------------------- pure

export type HamGround = "wall" | "floor" | "mat";

/** The ground at one px: the walls round the edge, the cage's padded floor, the concrete. */
export function hamGroundAt(x: number, y: number, w = 480, h = 320): HamGround {
  if (y < HAM_WALL_H || x < 20 || x >= w - 12 || y >= h - 16) return "wall";
  if (x >= CAGE.x && x < CAGE.x + CAGE.w && y >= CAGE.y && y < CAGE.y + CAGE.h) return "mat";
  return "floor";
}

const GROUND: Record<HamGround, { top: number; color: number }> = {
  wall: { top: 0.02, color: 0x46433f }, floor: { top: 0, color: 0x4a4744 }, mat: { top: 0.06, color: 0x7d2a26 },
};

/** Feet on the floor (the mat is a hair higher: the fighters are in the overlay, the spectators outside). */
export const hamHeightAt = (x: number, y: number): number => (hamGroundAt(x, y) === "mat" ? 0.06 : 0);

/** Where the bulbs hang on the north wall (px), and the lamps' pools. */
export const HAM_BULBS: readonly number[] = [90, 180, 300, 420];

// ---------------------------------------------------------------- Three.js

export function buildHamNgamZone(map: GameMap, opts: OutdoorOptions = {}): THREE.Group {
  void opts;
  const k = new Kit(map);
  const W = (x: number, y: number) => k.W(x, y);
  const R = rng(4404);
  k.terrain(map.cell, (x, y) => GROUND[hamGroundAt(x, y, map.width, map.height)], 4404);
  k.base(0x2e2c2a, 0x3c3a38);

  // ---- the floor: joints every 64 px, oil stains, the drain grates, the chalk tallies by the door
  for (let x = 64; x < map.width - 12; x += 64) k.beam(x, HAM_WALL_H, x, map.height - 16, 0.005, 0.05, 0x3c3a38, 0.01);
  for (let y = HAM_WALL_H + 32; y < map.height - 16; y += 64) k.beam(20, y, map.width - 12, y, 0.005, 0.05, 0x3c3a38, 0.01);
  const stains: Inst[] = [];
  for (let i = 0; i < 14; i++) {
    const x = 30 + R() * 420, y = 60 + R() * 230;
    if (hamGroundAt(x, y) !== "floor") continue;
    const p = W(x, y);
    stains.push({ x: p.x, y: 0.012, z: p.z, sx: 0.4 + R() * 0.5, sy: 0.01, sz: 0.2 + R() * 0.25, ry: R() * 3, color: 0x34302d });
  }
  k.inst(k.unit, k.lam(0xffffff), stains, { shadow: false });
  for (const [gx, gy] of [[126, 124], [366, 204]] as const) {
    const p = W(gx, gy);
    k.box(pxLen(14), 0.02, pxLen(10), 0x1a1a1c, p.x, 0.005, p.z);
    for (let i = 0; i < 4; i++) k.box(0.05, 0.03, pxLen(8), 0x3b4148, p.x - pxLen(4.5) + i * pxLen(3), 0.01, p.z);
  }
  for (let i = 0; i < 10; i++) { const p = W(44 + i * 4, 289); k.box(0.04, 0.012, pxLen(6), 0xb8b0a0, p.x, 0.012, p.z); }
  { const p = W(63, 289); k.box(pxLen(41), 0.012, 0.04, 0xb8b0a0, p.x, 0.013, p.z); }

  // ---- the north wall: raw concrete in poured bands up to the ceiling's edge, cracks, the pipe and the cable
  const wallH = 4.2;
  {
    const p = W(map.width / 2, HAM_WALL_H / 2);
    k.box(pxLen(map.width), wallH, pxLen(HAM_WALL_H), 0x5d5a55, p.x, 0, p.z);
    for (let y = 0.6; y < wallH; y += 0.62) k.box(pxLen(map.width) + 0.02, 0.05, pxLen(HAM_WALL_H) + 0.02, 0x46433f, p.x, y, p.z);
    const front = p.z + pxLen(HAM_WALL_H) / 2;
    for (let i = 0; i < 6; i++) {                                                // cracks down the face
      const x = W(60 + R() * 380, 0).x;
      for (let s = 0; s < 4; s++) k.box(0.04, 0.35, 0.02, 0x2e2c2a, x + (R() - 0.5) * 0.15, wallH - 0.5 - s * 0.35, front + 0.011, 0);
    }
    // the rusty pipe along the wall on its brackets, and the sagging cable under it
    const pipe = k.mesh(k.geo(new THREE.CylinderGeometry(0.11, 0.11, pxLen(map.width), 8)), k.lam(0x7a5a3a), p.x, 3.3, front + 0.14);
    pipe.rotation.z = Math.PI / 2;
    for (let x = 20; x < map.width; x += 60) k.box(0.08, 0.3, 0.2, 0x2a2320, W(x, 0).x, 3.15, front + 0.08);
    for (let x = 0; x < map.width; x += 24) {
      const a = W(x, 0).x, b = W(Math.min(map.width, x + 24), 0).x, y = 2.85 - Math.abs(Math.sin(x / 30)) * 0.12;
      const c = k.box(b - a + 0.02, 0.035, 0.035, 0x1c1c20, (a + b) / 2, y, front + 0.06);
      c.castShadow = false;
    }
  }

  // ---- the ladder up the shaft to the manhole (the shaft a dark hole in the ceiling's edge)
  {
    const { x, y, w, h } = HAM_LADDER;
    const top = W(x + w / 2, y), front = W(0, HAM_WALL_H).z;
    k.box(pxLen(w + 8), 0.9, 0.5, 0x141414, top.x, wallH - 0.6, front - 0.2);
    for (const sx of [x + 1, x + w - 1]) k.box(0.07, wallH - 0.2, 0.07, 0x8a939c, W(sx, 0).x, 0, front + 0.12);
    for (let yy = 0.3; yy < wallH - 0.3; yy += 0.36) k.box(pxLen(w - 2), 0.05, 0.06, yy % 1.08 < 0.36 ? 0x8a4a2a : 0x5b636b, top.x, yy, front + 0.12);
    void h;
  }

  // ---- the side and south walls: low concrete with a coping, so the camera sees in; the iron door in the west one
  const low = 1.1;
  for (const r of [
    { x: 0, y: HAM_WALL_H, w: 20, h: LADDER_DOOR.y - HAM_WALL_H }, { x: 0, y: LADDER_DOOR.y + LADDER_DOOR.h, w: 20, h: map.height - LADDER_DOOR.y - LADDER_DOOR.h },
    { x: map.width - 12, y: HAM_WALL_H, w: 12, h: map.height - HAM_WALL_H }, { x: 0, y: map.height - 16, w: map.width, h: 16 },
  ]) {
    k.boxPx(r, 0, low, 0x5d5a55);
    k.boxPx({ x: r.x - 1, y: r.y, w: r.w + 2, h: r.h }, low, 0.1, 0x46433f);
  }
  for (let x = 24; x < map.width; x += 24) { const p = W(x, map.height - 8); k.box(0.03, low, pxLen(16) + 0.02, 0x46433f, p.x, 0, p.z); }
  {
    // the "Cửa thách đấu": an iron door in a taller frame, ribbed, a rusty patch, a lit handle, "10" chalked above
    const d = LADDER_DOOR, c = W(d.x + 10, d.y + d.h / 2);
    k.boxPx({ x: 0, y: d.y - 4, w: 20, h: 4 }, 0, 2.6, 0x46433f);
    k.boxPx({ x: 0, y: d.y + d.h, w: 20, h: 4 }, 0, 2.6, 0x46433f);
    k.boxPx({ x: 0, y: d.y - 4, w: 20, h: d.h + 8 }, 2.3, 0.3, 0x46433f);
    k.box(0.22, 2.25, pxLen(d.h), 0x3b4148, c.x, 0, c.z);
    for (let y = 0.3; y < 2.2; y += 0.45) k.box(0.24, 0.05, pxLen(d.h) - 0.1, 0x8a939c, c.x + 0.01, y, c.z);
    k.box(0.25, 0.3, 0.4, 0x8a4a2a, c.x + 0.01, 0.4, c.z + 0.5);
    const handle = k.mesh(k.geo(new THREE.SphereGeometry(0.06, 6, 4)), k.lam(0xffe9a0, 0xffd27a), c.x + 0.16, 1.1, c.z - 0.5, k.root, false);
    handle.userData.keep = true;
    k.face(c.x + 0.14, 2.45, c.z, 0.6, { lines: ["10"], bg: 0x46433f, fg: 0xd8d0c0 }, "e");
  }

  // ---- the cage: the padded floor's ring, four posts with sand-bags, chain-link sides, a top rail, the chained gate
  {
    const x0 = CAGE.x, y0 = CAGE.y, x1 = CAGE.x + CAGE.w, y1 = CAGE.y + CAGE.h, c = W(x0 + CAGE.w / 2, y0 + CAGE.h / 2);
    const ring = k.mesh(k.geo(new THREE.RingGeometry(0.93, 1, 40).rotateX(-Math.PI / 2)), k.lam(0xa4403a), c.x, 0.07, c.z, k.root, false);
    ring.scale.set(pxLen(30), 1, pxLen(22));
    for (let y = y0 + 12; y < y1; y += 24) k.beam(x0, y, x1, y, 0.065, 0.03, 0x5e1f1c, 0.006);
    const postH = 2.1;
    for (const [px0, py0] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]] as const) {
      const p = W(px0, py0);
      k.mesh(k.geo(new THREE.CylinderGeometry(0.09, 0.1, postH, 8)), k.lam(0x5b636b), p.x, postH / 2, p.z);
      const bag = k.mesh(k.geo(new THREE.CapsuleGeometry(0.16, 0.32, 3, 6).rotateZ(Math.PI / 2)), k.lam(0x8a7a52), p.x, 0.16, p.z + (py0 === y0 ? -0.25 : 0.25));
      bag.rotation.y = px0 === x0 ? 0.3 : -0.3;
    }
    // the mesh: a see-through chain-link material on each side, the rails top and bottom
    const link = k.own(new THREE.MeshLambertMaterial({ color: 0x9aa3aa, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
    for (const [ax, ay, bx, by] of [[x0, y0, x1, y0], [x0, y1, x1, y1], [x0, y0, x0, y1], [x1, y0, x1, y1]] as const) {
      const a = W(ax, ay), b = W(bx, by), len = Math.hypot(b.x - a.x, b.z - a.z);
      const m = k.mesh(k.geo(new THREE.PlaneGeometry(1, 1)), link, (a.x + b.x) / 2, postH / 2 + 0.05, (a.z + b.z) / 2, k.root, false);
      m.scale.set(len, postH - 0.1, 1);
      m.rotation.y = Math.atan2(-(b.z - a.z), b.x - a.x);
      m.userData.keep = true;
      k.beam(ax, ay, bx, by, postH - 0.04, 0.07, 0x8a939c);
      k.beam(ax, ay, bx, by, 0.12, 0.05, 0x6a7278);
      // the diamond weave's vertical wires
      const n = Math.round(len / 0.35);
      for (let i = 1; i < n; i++) {
        const t = i / n, w = k.box(0.02, postH - 0.1, 0.02, 0x6a7278, a.x + (b.x - a.x) * t, 0.05, a.z + (b.z - a.z) * t);
        w.castShadow = false;
      }
    }
    // the gate on the south side, chained shut
    const g = W(x0 + CAGE.w / 2, y1);
    k.box(pxLen(20), 0.08, 0.06, 0x3b4148, g.x, 1.0, g.z + 0.04);
    k.box(0.16, 0.16, 0.1, 0x9aa3aa, g.x, 0.92, g.z + 0.08);
  }

  // ---- anh Tư Sẹo's table: a plank top, a lamp, a cash box, the cups on it; a stool behind
  {
    const p = W(TU_SEO_TABLE.x, TU_SEO_TABLE.y - 4);
    k.box(pxLen(34), 0.08, pxLen(12), 0x8a6238, p.x, 0.78, p.z);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(0.07, 0.78, 0.07, 0x5e4224, p.x + sx * (pxLen(15)), 0, p.z + sz * pxLen(4.5));
    k.box(0.32, 0.18, 0.22, 0x3b4148, p.x - 0.55, 0.86, p.z);                                   // the cash box
    k.box(0.1, 0.02, 0.02, 0xe0b43a, p.x - 0.55, 1.05, p.z + 0.1);
    [0xe0b43a, 0xb8b8c0, 0xb07a45].forEach((col, i) => {                                         // the cups
      const cup = k.mesh(k.geo(new THREE.CylinderGeometry(0.08, 0.05, 0.18, 7)), k.lam(col), p.x + 0.15 + i * 0.22, 0.95, p.z - 0.05);
      cup.castShadow = false;
    });
    k.box(0.04, 0.4, 0.04, 0x2a2320, p.x + 0.85, 0.86, p.z - 0.1);                             // the desk lamp
    k.bulb(p.x + 0.85, 1.3, p.z - 0.1, 0.1);
    const stool = W(TU_SEO_TABLE.x + 14, TU_SEO_TABLE.y - 22);
    k.mesh(k.geo(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 8)), k.lam(0x8a6238), stool.x, 0.5, stool.z);
    k.mesh(k.geo(new THREE.CylinderGeometry(0.04, 0.05, 0.5, 5)), k.lam(0x5e4224), stool.x, 0.25, stool.z);
  }
  // the underground ladder board, the city post
  k.sign(UG_BOARD.x, UG_BOARD.y, "board", "BXH ngầm", "cup");
  for (const p of map.props) if (p.kind === "city_map_post") k.sign(p.x, p.y, "city");

  // ---- the crates and the oil drum
  {
    const { x, y } = CRATES;
    for (const [cx, cy, cw, ch, y0] of [[x, y + 8, 16, 16, 0], [x + 16, y + 8, 16, 16, 0], [x + 6, y - 6, 16, 14, 0], [x + 8, y + 8, 16, 14, 1]] as const) {
      const p = W(cx + cw / 2, cy + ch / 2), s = pxLen(Math.min(cw, ch)) * 0.95;
      k.box(s, s, s, 0x8a6238, p.x, y0 * s, p.z, R() * 0.2);
      k.box(s + 0.02, 0.05, s + 0.02, 0x5e4224, p.x, y0 * s + s / 2, p.z);
    }
    const d = W(DRUM.x, DRUM.y - 4);
    k.mesh(k.geo(new THREE.CylinderGeometry(0.34, 0.34, 0.95, 12)), k.lam(0x2f5a7a), d.x, 0.475, d.z);
    for (const yy of [0.25, 0.7]) { const r = k.mesh(k.geo(new THREE.TorusGeometry(0.345, 0.03, 4, 14)), k.lam(0x1f3f56), d.x, yy, d.z); r.rotation.x = Math.PI / 2; }
  }

  // ---- the caged bulbs on the north wall, their pools of light; a warm lamp over the cage
  const front = W(0, HAM_WALL_H).z;
  const cages = k.geo(new THREE.OctahedronGeometry(0.2, 0));
  const wire = k.own(new THREE.MeshLambertMaterial({ color: 0x3b4148, wireframe: true }));
  for (const x of HAM_BULBS) {
    const p = W(x, HAM_WALL_H);
    k.box(0.05, 0.4, 0.3, 0x2a2320, p.x, 2.45, front + 0.12);
    k.bulb(p.x, 2.4, front + 0.3, 0.12);
    const c = k.mesh(cages, wire, p.x, 2.4, front + 0.3, k.root, false);
    c.userData.keep = true;
    k.lamp(x, HAM_WALL_H + 14, 90, 2.4, 0xffc070);
  }
  const hang = W(CAGE.x + CAGE.w / 2, CAGE.y + CAGE.h / 2);
  k.box(0.02, 1.2, 0.02, 0x1c1c20, hang.x, 3.0, hang.z);
  const shade = k.mesh(k.geo(new THREE.ConeGeometry(0.35, 0.3, 10, 1, true)), k.own(new THREE.MeshLambertMaterial({ color: 0x3b5a3a, side: THREE.DoubleSide })), hang.x, 3.0, hang.z, k.root, false);
  shade.userData.keep = true;
  k.bulb(hang.x, 2.86, hang.z, 0.1);
  k.lamp(CAGE.x + CAGE.w / 2, CAGE.y + CAGE.h / 2, 110, 2.8, 0xffe0a0);
  k.lamp(TU_SEO_TABLE.x, TU_SEO_TABLE.y, 60, 1.4, 0xffb060);
  k.lamp(36, LADDER_DOOR.y + 20, 60, 1.6, 0xffb060);

  // the swinging bulb over the cage
  return k.finish({
    heightAt: hamHeightAt,
    cave: true,
    animate(t) {
      const a = Math.sin(t / 900) * 0.05;
      shade.rotation.z = a;
    },
  });
}
