import * as THREE from "three";
import { ANVIL, CAULDRON, MINE_NODES, MO_WALL_H, SHED } from "@/lib/game/maps/mo-da";
import { mineView } from "@/lib/game/maps/mo-da-art";
import type { GameMap } from "@/lib/game/maps/types";
import { pxLen } from "../coords";
import { rng } from "../layout";
import { inRect, Kit, type Inst, type OutdoorOptions } from "./outdoor-kit";

// Mỏ đá ("mo_da") as a diorama: a quarry at the foot of the hills — the layered rock face along the north with timber
// props and oil lamps (and a tunnel mouth), low rock walls round the other sides with the gate in the west, the gravel
// floor with the cart rails, the ten ore rocks (their veins in the colour of what each node holds now, rubble while it
// grows back — read live from the mining hook's mineView), the four glowing herb patches, chú Tám's plank shed, the anvil
// on its stump and bà Sáu's bubbling cauldron over a fire with her jar shelf. Faithful to lib/game/maps/mo-da.ts and
// mo-da-art.ts. Pure layout first, then the Three.js builder.

// ---------------------------------------------------------------- pure

export type MoGround = "face" | "wall" | "gate" | "floor" | "rail";

/** The ground at one px: the rock face (north), the low walls, the gate's opening, the rails' bed, the floor. */
export function moGroundAt(x: number, y: number, w = 640, h = 400): MoGround {
  if (y < MO_WALL_H) return "face";
  if (x < 12) return y >= 184 && y < 216 ? "gate" : "wall";
  if (x >= w - 16 || y >= h - 16) return "wall";
  if (x >= 12 && x < 470 && y >= 194 && y < 208) return "rail";
  return "floor";
}

const GROUND: Record<MoGround, { top: number; color: number }> = {
  face: { top: 0.02, color: 0x6d655c }, wall: { top: 0.02, color: 0x4f4841 }, gate: { top: 0, color: 0x665846 },
  floor: { top: 0, color: 0x7a6a58 }, rail: { top: -0.01, color: 0x6e5a44 },
};

/** The veins' colours by item (mo-da-art's VEIN). */
export const VEIN_COLORS: Readonly<Record<string, number>> = {
  ore_da: 0xb0a898, ore_than: 0x2a2622, ore_dong: 0xd07a3a, ore_sat: 0xa9b2bb, ore_bac: 0xe8eef4,
  ore_vang: 0xf2c93a, ore_ngoc: 0x3ccf7a, ore_kimcuong: 0x9be8ff, ore_tinhthe: 0xff5a3a,
  herb_nam: 0xc0503a, herb_reu: 0x9fe8a0, herb_linhchi: 0xb8661c,
};

/** A node's look now: "vein" (ready, in its colour), "rubble" (growing back) or "plain" (nothing known yet). */
export function nodeLook(no: number, now: number, view: { nodes: Map<number, { item: string; readyAtMs: number }> } = mineView):
  { state: "vein" | "rubble" | "plain"; color: number } {
  const v = view.nodes.get(no);
  if (!v) return { state: "plain", color: 0x8a8178 };
  if (v.readyAtMs > now) return { state: "rubble", color: 0x4f4841 };
  return { state: "vein", color: VEIN_COLORS[v.item] ?? 0xffffff };
}

export interface MoLayout {
  /** Strata columns of the rock face: x, height (units), colour. */
  face: Array<{ x: number; w: number; h: number; color: number }>;
  props: number[];
  gravel: Array<{ x: number; y: number; s: number }>;
  hills: Array<{ x: number; y: number; r: number; color: number }>;
  lights: Array<{ x: number; y: number; r: number; fire?: boolean }>;
}

export function moLayout(map: GameMap, opts: OutdoorOptions = {}): MoLayout {
  const density = opts.density ?? 1;
  const R = rng(7201);
  const face: MoLayout["face"] = [];
  for (let x = 0; x < map.width; x += 16) face.push({ x, w: 16, h: 3.4 + R() * 1.4 + Math.sin(x / 70) * 0.5, color: [0x6d655c, 0x625b53, 0x7a7266][Math.floor(R() * 3)] });
  const gravel: MoLayout["gravel"] = [];
  for (let k = 0; k < 900 && gravel.length < Math.round(160 * density); k++) {
    const x = 14 + R() * (map.width - 32), y = MO_WALL_H + 4 + R() * (map.height - MO_WALL_H - 22);
    if (moGroundAt(x, y, map.width, map.height) !== "floor" || MINE_NODES.some((n) => inRect(x, y, n.rect, 6))) continue;
    if (inRect(x, y, { x: SHED.x - 32, y: 196, w: 64, h: 76 }) || Math.hypot(x - CAULDRON.x, y - CAULDRON.y) < 24) continue;
    gravel.push({ x, y, s: 0.06 + R() * 0.1 });
  }
  // the hills behind the quarry (off the map's north edge)
  const hills: MoLayout["hills"] = [];
  for (let i = 0; i < Math.round(12 * density) + 2; i++) {
    hills.push({ x: (i + R()) * (map.width / (Math.round(12 * density) + 2)), y: -30 - R() * 40, r: 3 + R() * 3, color: [0x5a7a3a, 0x4f6e33, 0x6a8a45][i % 3] });
  }
  return {
    face, gravel, hills, props: [40, 136, 232, 328, 424, 520, 616].filter((x) => x < map.width - 16),
    lights: [
      ...[40, 232, 424, 616].map((x) => ({ x: x + 3, y: MO_WALL_H + 6, r: 80 })),
      { x: SHED.x, y: 270, r: 70 },
      { x: CAULDRON.x, y: CAULDRON.y, r: 60, fire: true },
    ],
  };
}

/** Feet on the quarry floor. */
export const moHeightAt = (): number => 0;

// ---------------------------------------------------------------- Three.js

export function buildMoDaZone(map: GameMap, opts: OutdoorOptions = {}): THREE.Group {
  const L = moLayout(map, opts);
  const k = new Kit(map);
  const W = (x: number, y: number) => k.W(x, y);
  k.terrain(map.cell, (x, y) => GROUND[moGroundAt(x, y, map.width, map.height)], 7201);
  k.base(0x6a5238, 0x5a544c);

  // ---- the hills behind
  const hillGeo = k.geo(new THREE.SphereGeometry(1, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2));
  k.inst(hillGeo, k.lam(0xffffff), L.hills.map((h) => { const p = W(h.x, h.y); return { x: p.x, y: 0, z: p.z, sx: h.r * 1.4, sy: h.r * 0.9, sz: h.r, color: h.color }; }));

  // ---- the rock face: strata columns, crack lines, timber props, a tunnel mouth
  const rock = k.geo(new THREE.DodecahedronGeometry(1, 0));
  const RR = rng(7202);
  for (const c of L.face) {
    const p = W(c.x + c.w / 2, MO_WALL_H / 2);
    k.box(pxLen(c.w) + 0.02, c.h, pxLen(MO_WALL_H), c.color, p.x, 0, p.z);
    for (let y = 0.7; y < c.h - 0.2; y += 0.9) k.box(pxLen(c.w) + 0.04, 0.08, pxLen(MO_WALL_H) + 0.04, 0x4f4841, p.x, y + Math.sin(c.x / 23 + y) * 0.1, p.z);
    if (RR() < 0.4) { const b = k.mesh(rock, k.lam(0x8a8178), p.x + (RR() - 0.5), c.h, p.z + (RR() - 0.5) * 2); b.scale.set(0.6, 0.35, 0.6); }
  }
  for (const x of L.props) {
    const p = W(x + 3, MO_WALL_H + 2);
    k.box(0.36, 3.2, 0.36, 0x6e4424, p.x, 0, p.z);
    k.box(0.9, 0.3, 0.5, 0x8a5a30, p.x, 3.1, p.z - 0.1);
  }
  {
    const p = W(520, MO_WALL_H);
    k.box(2.2, 2.4, 0.2, 0x151210, p.x, 0, p.z + 0.02);
    for (const s of [-1, 1]) k.box(0.3, 2.6, 0.4, 0x6e4424, p.x + s * 1.2, 0, p.z + 0.1);
    k.box(2.9, 0.34, 0.45, 0x8a5a30, p.x, 2.55, p.z + 0.1);
  }
  // the low walls (west with the gate, east, south) — low so the tilted camera sees in
  for (const r of [{ x: 0, y: MO_WALL_H, w: 12, h: 184 - MO_WALL_H }, { x: 0, y: 216, w: 12, h: 184 }, { x: map.width - 16, y: MO_WALL_H, w: 16, h: map.height - MO_WALL_H }, { x: 0, y: map.height - 16, w: map.width, h: 16 }]) {
    k.boxPx(r, 0, 1.0, 0x5a544c);
    const n = Math.max(1, Math.round(Math.max(r.w, r.h) / 28));
    for (let i = 0; i < n; i++) {
      const along = r.w > r.h;
      const p = W(along ? r.x + (i + 0.5) * (r.w / n) : r.x + r.w / 2, along ? r.y + r.h / 2 : r.y + (i + 0.5) * (r.h / n));
      const b = k.mesh(rock, k.lam([0x6d655c, 0x7a7266][i % 2]), p.x, 1.0, p.z);
      b.scale.set(along ? 1.0 : 0.6, 0.55 + RR() * 0.3, along ? 0.6 : 1.0);
      b.rotation.y = RR() * 3;
    }
  }
  // the gate's timber frame
  for (const y of [182, 218]) { const p = W(8, y); k.box(0.3, 2.3, 0.3, 0x6e4424, p.x, 0, p.z); }
  k.beam(8, 182, 8, 218, 2.35, 0.34, 0x8a5a30, 0.3);

  // ---- the cart rails into the deep end, and a cart
  for (let x = 12; x < 470; x += 6) k.beam(x + 1.5, 194, x + 1.5, 208, 0.03, 0.12, 0x6e4424, 0.06);
  for (const y of [197, 205]) k.beam(12, y, 470, y, 0.1, 0.07, 0x8a939c, 0.08);
  {
    const p = W(430, 201);
    k.box(1.3, 0.7, 0.9, 0x5b636b, p.x, 0.2, p.z);
    const load = k.mesh(rock, k.lam(0x8a8178), p.x, 0.9, p.z);
    load.scale.set(0.55, 0.3, 0.4);
    for (const dx of [-0.4, 0.4]) for (const dz of [-0.45, 0.45]) {
      const wh = k.mesh(k.geo(new THREE.CylinderGeometry(0.16, 0.16, 0.08, 8)), k.lam(0x3b4148), p.x + dx, 0.18, p.z + dz);
      wh.rotation.x = Math.PI / 2;
    }
  }
  // gravel
  k.inst(rock, k.lam(0xffffff), L.gravel.map((g, i) => { const p = W(g.x, g.y); return { x: p.x, y: 0.02, z: p.z, sx: g.s * 1.4, sy: g.s * 0.6, sz: g.s, ry: i, color: i % 3 ? 0x9a8a74 : 0x665846 }; }), { thin: true, shadow: false });

  // ---- the ore rocks (a boulder cluster each) and their veins (live)
  const nuggetGeo = k.geo(new THREE.OctahedronGeometry(0.13, 0));
  const ores = MINE_NODES.filter((n) => n.kind === "ore"), herbs = MINE_NODES.filter((n) => n.kind === "herb");
  for (const n of ores) {
    const p = W(n.x, n.y - 8), OR = rng(n.no * 31);
    const big = k.mesh(rock, k.lam(0x6d655c), p.x, 0.45, p.z);
    big.scale.set(0.85, 0.7, 0.62);
    big.rotation.set(OR(), OR() * 3, 0);
    const side = k.mesh(rock, k.lam(0x7a7266), p.x + 0.5, 0.25, p.z + 0.2);
    side.scale.set(0.45, 0.38, 0.4);
    side.rotation.y = OR() * 3;
    const cap = k.mesh(rock, k.lam(0x8a8178), p.x - 0.25, 0.85, p.z - 0.1);
    cap.scale.set(0.35, 0.22, 0.3);
  }
  const vein = k.inst(nuggetGeo, k.lam(0xffffff), [], { capacity: ores.length * 3, shadow: false });
  const rubbleIm = k.inst(k.unit, k.lam(0x4f4841), [], { capacity: ores.length * 4 });
  // the herb patches: moss and mushrooms / herbs (in the node's colour when ready), a soft glow
  const moss = k.geo(new THREE.CylinderGeometry(1, 1, 0.05, 10));
  for (const n of herbs) {
    const p = W(n.x, n.y - 3);
    const m = k.mesh(moss, k.lam(0x3f6e23), p.x, 0.03, p.z, k.root, false);
    m.scale.set(pxLen(12), 1, pxLen(7));
  }
  const capGeo = k.geo(new THREE.SphereGeometry(0.14, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2));
  const stemGeo = k.geo(new THREE.CylinderGeometry(0.035, 0.045, 0.2, 5));
  const glowMat = k.own(new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, emissive: 0x2a6a2a }));
  const caps = k.inst(capGeo, glowMat, [], { capacity: herbs.length * 3, shadow: false });
  const stems = k.inst(stemGeo, k.lam(0xe6d2b0), herbs.flatMap((n) => [0, 1, 2].map((i) => {
    const p = W(n.x - 6 + i * 6, n.y - 4 + (i % 2) * 3);
    return { x: p.x, y: 0.1, z: p.z };
  })), { shadow: false });
  for (const im of [vein, rubbleIm, caps, stems]) im.userData.keep = true;
  let lastKey = "", lastCheck = -Infinity;
  const refreshNodes = (now: number) => {
    const looks = MINE_NODES.map((n) => nodeLook(n.no, now));
    const key = looks.map((l) => `${l.state}${l.color}`).join("|");
    if (key === lastKey) return;
    lastKey = key;
    const vs: Inst[] = [], rs: Inst[] = [], cs: Inst[] = [];
    ores.forEach((n) => {
      const l = nodeLook(n.no, now), p = W(n.x, n.y - 8);
      if (l.state === "rubble") {
        for (let i = 0; i < 4; i++) rs.push({ x: p.x - 0.5 + i * 0.32, y: 0.06, z: p.z + 0.62, sx: 0.18, sy: 0.12, sz: 0.14, ry: i });
      } else {
        const col = l.state === "vein" ? l.color : 0x9a9082;
        for (const [dx, dy, dz] of [[-0.3, 0.7, 0.5], [0.15, 0.45, 0.62], [0.35, 0.8, 0.35]] as const) vs.push({ x: p.x + dx, y: dy, z: p.z + dz, color: col, sx: l.state === "vein" ? 1.2 : 0.8, sy: l.state === "vein" ? 1.2 : 0.8, sz: l.state === "vein" ? 1.2 : 0.8 });
      }
    });
    herbs.forEach((n) => {
      const l = nodeLook(n.no, now);
      if (l.state === "rubble") return;
      const col = l.state === "vein" ? l.color : 0x9fe8a0;
      for (let i = 0; i < 3; i++) {
        const p = W(n.x - 6 + i * 6, n.y - 4 + (i % 2) * 3);
        cs.push({ x: p.x, y: 0.19, z: p.z, color: col, sx: 1 + (i % 2) * 0.3, sy: 1, sz: 1 + (i % 2) * 0.3 });
      }
    });
    k.fill(vein, vs);
    k.fill(rubbleIm, rs);
    k.fill(caps, cs);
  };
  refreshNodes(Date.now());

  // ---- chú Tám's shed: plank walls, a sloped plank roof, the dark doorway, the counter with a pickaxe and a scale
  {
    const x0 = SHED.x - 28, c = W(SHED.x, 200 + 29), w = pxLen(56), d = pxLen(58) - 0.9, h = 2.3;
    k.box(w, h, d, 0xa8743f, c.x, 0, c.z - 0.4);
    for (let i = 0; i < 8; i++) k.box(0.04, h, d + 0.02, 0x6e4424, W(x0 + i * 7 + 3.5, 0).x, 0, c.z - 0.4);
    const front = c.z - 0.4 + d / 2;
    k.box(2.0, 1.4, 0.05, 0x2a2622, c.x, 0, front + 0.01);
    const roof = k.roof({ x: x0 - 4, y: 192, w: 64, h: 70 });
    const top = k.box(w + 0.6, 0.12, d + 0.9, roof.mat(0x8a5a33), c.x, h + 0.3, c.z - 0.2);
    top.rotation.x = 0.28;
    k.box(1.6, 0.4, 0.06, 0xf4ead0, c.x, h - 0.55, front + 0.03);                     // the "MỎ ĐÁ" board
    const counter = W(SHED.x, 262);
    k.box(w, 0.85, 0.6, 0xc9955a, counter.x, 0, counter.z);
    k.box(w + 0.1, 0.1, 0.7, 0x8a5a33, counter.x, 0.85, counter.z);
    k.box(0.7, 0.06, 0.08, 0x8a5a30, counter.x - 1.1, 0.98, counter.z, 0.3);
    k.box(0.1, 0.1, 0.4, 0x8a939c, counter.x - 0.8, 0.98, counter.z, 0.3);
    k.box(0.6, 0.06, 0.4, 0x3b4148, counter.x + 1.0, 0.95, counter.z);
    k.box(0.06, 0.4, 0.06, 0x8a939c, counter.x + 1.0, 0.95, counter.z);
    k.bulb(counter.x - w / 2 + 0.2, 1.9, counter.z + 0.1);
  }
  // ---- the anvil on its stump, the hammer
  {
    const p = W(ANVIL.x, ANVIL.y - 4);
    k.mesh(k.geo(new THREE.CylinderGeometry(0.42, 0.48, 0.6, 8)), k.lam(0x6e4424), p.x, 0.3, p.z);
    k.box(0.9, 0.22, 0.4, 0x3b4148, p.x, 0.6, p.z);
    k.box(0.4, 0.2, 0.3, 0x3b4148, p.x, 0.82, p.z);
    k.box(1.1, 0.12, 0.42, 0x4a5058, p.x + 0.05, 1.0, p.z);
    k.box(0.3, 0.08, 0.2, 0x8a939c, p.x + 0.7, 1.0, p.z);
    k.box(0.06, 0.06, 0.6, 0x6e4424, p.x - 1.0, 0.05, p.z + 0.2, 0.4);
    k.box(0.28, 0.14, 0.14, 0x8a939c, p.x - 1.1, 0.02, p.z - 0.05, 0.4);
  }
  // ---- bà Sáu's cauldron over its fire, her jar shelf
  const flames: THREE.Mesh[] = [];
  let brew: THREE.Mesh;
  {
    const p = W(CAULDRON.x, CAULDRON.y - 4);
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; k.box(0.5, 0.1, 0.1, 0x5a3a1e, p.x + Math.cos(a) * 0.25, 0.02, p.z + Math.sin(a) * 0.25, a); }
    for (let i = 0; i < 3; i++) {
      const f = k.mesh(k.geo(new THREE.ConeGeometry(0.16, 0.45, 5)), k.own(new THREE.MeshBasicMaterial({ color: i === 1 ? 0xffd07a : 0xe0703c })), p.x + (i - 1) * 0.2, 0.3, p.z + (i % 2) * 0.1, k.root, false);
      f.userData.keep = true;
      flames.push(f);
    }
    k.mesh(k.geo(new THREE.SphereGeometry(0.75, 10, 7, 0, Math.PI * 2, Math.PI * 0.35, Math.PI * 0.65)),
      k.own(new THREE.MeshLambertMaterial({ color: 0x26282c, flatShading: true, side: THREE.DoubleSide })), p.x, 1.05, p.z);
    const rim = k.mesh(k.geo(new THREE.TorusGeometry(0.66, 0.07, 5, 14)), k.lam(0x4a4e56), p.x, 1.4, p.z);
    rim.rotation.x = Math.PI / 2;
    for (const s of [-1, 1]) k.box(0.08, 0.5, 0.08, 0x26282c, p.x + s * 0.55, 0, p.z);
    brew = k.mesh(k.geo(new THREE.CylinderGeometry(0.62, 0.62, 0.04, 12)), k.own(new THREE.MeshLambertMaterial({ color: 0x6fc26a, emissive: 0x2f7a2a, flatShading: true })), p.x, 1.3, p.z, k.root, false);
    brew.userData.keep = true;
    const sh = W(CAULDRON.x + 36, CAULDRON.y - 32);
    k.box(pxLen(28), 1.6, 0.35, 0xb07a45, sh.x, 0, sh.z);
    for (const y of [0.55, 1.15]) k.box(pxLen(28) + 0.05, 0.06, 0.45, 0x6e4424, sh.x, y, sh.z + 0.05);
    [0x6fc26a, 0xc0503a, 0x3d6fd1, 0xe0b33c, 0x9fe8a0, 0xb8661c].forEach((col, i) => {
      k.mesh(k.geo(new THREE.CylinderGeometry(0.1, 0.12, 0.32, 6)), k.lam(col), sh.x - 0.55 + (i % 3) * 0.55, (i < 3 ? 0.61 : 1.21) + 0.16, sh.z + 0.1);
    });
  }

  // ---- lamps on the timber props, the city post
  const bulbAt = (x: number) => { const p = W(x + 3, MO_WALL_H + 5); k.bulb(p.x, 2.6, p.z + 0.1, 0.12); };
  for (const l of L.lights) {
    if (!l.fire && l.y < MO_WALL_H + 10) bulbAt(l.x - 3);
    k.lamp(l.x, l.y, l.r, l.fire ? 1.2 : 2.6, l.fire ? 0xff8a40 : 0xffb060);
  }
  for (const p of map.props) if (p.kind === "city_map_post") k.sign(p.x, p.y, "city");

  return k.finish({
    heightAt: moHeightAt,
    animate(t) {
      flames.forEach((f, i) => { const s = 1 + Math.sin(t / 80 + i * 2.1) * 0.18; f.scale.set(s, s * (1 + Math.sin(t / 55 + i) * 0.15), s); });
      brew.position.y = 1.3 + Math.sin(t / 300) * 0.02;
      const now = Date.now();
      if (now - lastCheck > 500) { lastCheck = now; refreshNodes(now); }
    },
  });
}
