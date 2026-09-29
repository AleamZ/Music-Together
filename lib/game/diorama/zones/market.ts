import type * as THREE from "three";
import {
  BRIDGE_GAP, CLOTHES_FRONT, FURNITURE_FRONT, LANTERN_POSTS, MARKET_H, MARKET_W, MOTEL_FRONT, PET_SHOP_FRONT, RESTAURANT_FRONT, SALON_FRONT,
  SHOWROOM_DOOR, SHOWROOM_FRONT, STALLS, UG_HATCH, VO_DUONG_AWNING, VO_DUONG_FRONT,
} from "@/lib/game/maps/market";
import type { GameMap, Rect, StallGoods } from "@/lib/game/maps/types";
import { COL, DECAL_LIFT, upper, wrap, ZoneKit, type ZGround, type ZoneLayout, type ZoneOpts } from "./kit";
import { renderZone } from "./render";
import type { SignIcon } from "./signart";

// Chợ Lớn — the street market at dusk as a diorama, from market.ts (collision, props, interactables) and market-art.ts
// (the look): the row of houses behind, seven shops on the north row with their open fronts (the keeper stands inside,
// behind the counter), the cobbled street between two paved pavements, the striped stalls on the south side, the Võ
// đường's compound and gate, the canal wall with the plank bridge, lantern posts and the lantern strings overhead.

export function marketGroundAt(x: number, y: number): ZGround {
  if (y >= 392) return "water";
  if (y >= 384) return "stone";
  if ((y >= 160 && y < 180) || (y >= 296 && y < 352)) return "pave";
  return "cobble";
}

const STALL_STRIPES: Record<StallGoods, [number, number]> = {
  fruit: [0xe07a2e, 0xf4e2b8], flower: [0xd4758f, 0xf4efe0], lantern: [0xc0392b, 0xe0b33c],
  fish: [0x2e9a94, 0xf4efe0], produce: [0x5caa4a, 0xf4e2b8], umbrella: [0x2f5fa8, 0xf4efe0],
};
const GOODS: Record<StallGoods, number[]> = {
  fruit: [0xe07a2e, 0xf4d03a, 0x6aa83f, 0xd23a3a], flower: [0xf29bb5, 0xf4f1e8, 0xd4758f], lantern: [0xd23a3a, 0xe0b33c, 0xe07a2e],
  fish: [0x9fb8c8, 0xc0d0d8, 0x7a8e9a], produce: [0xe8cf7a, 0x6aa83f, 0x9a6a3a], umbrella: [0x2f5fa8, 0xd23a3a, 0xf4d03a, 0x2e9a94],
};
const GOODS_NAME: Record<StallGoods, string> = { fruit: "Trái cây", flower: "Hoa tươi", lantern: "Lồng đèn", fish: "Cá tươi", produce: "Nông sản", umbrella: "Ô dù" };
const GOODS_ICON: Record<StallGoods, SignIcon> = { fruit: "market", flower: "star", lantern: "star", fish: "fish", produce: "rice", umbrella: "home" };
/** market-art.ts's LANTERN_STRINGS: [x1, y1, x2, y2, sag] in the 2D picture. */
const LANTERN_STRINGS: ReadonlyArray<readonly [number, number, number, number, number]> = [
  [26, 134, 244, 64, 10], [244, 64, 396, 64, 12], [396, 64, 600, 134, 10], [604, 64, 774, 134, 10], [26, 134, 774, 134, 34],
  [244, 64, 240, 250, 14], [396, 64, 400, 250, 14], [764, 64, 934, 134, 10], [924, 64, 1094, 134, 10], [1084, 64, 1250, 134, 10],
  [774, 134, 1250, 134, 34],
];
const LANTERN_COLS = [0xd23a3a, 0xe0b33c, 0xe07a2e, 0xd4758f, 0xd23a3a, 0x3d6fd1] as const;
/** A 2D string end → where it hangs in 3D: the shop facades (y 64 in the picture), the lantern posts' tops (134) or the
 *  stall awnings across the street (250). */
function anchor(x: number, y: number): { x: number; y: number; z: number } {
  if (y <= 64) return { x, y: 161, z: 66 };
  if (y <= 134) return { x, y: 176, z: 40 };
  return { x, y: 300, z: 46 };
}

interface Shop { r: Rect; wall: number; roof: number; sign: number; recess?: { x: number; w: number }; storeys?: number }

export function marketLayout(map: GameMap, opts: ZoneOpts = {}): ZoneLayout {
  const k = new ZoneKit(map, marketGroundAt, opts, 1804);
  k.L.water.push({ x: 0, y: 390, w: MARKET_W, h: MARKET_H - 390 });

  // the row of houses behind (solid y 0–40): pink, blue, yellow, cream, teal fronts with tiled roofs
  const walls = [0xe6b8a8, 0xa8bcd8, 0xecd07a, 0xe8d6b0, 0xcfe0d4];
  for (let i = 0, x = 0; x < MARKET_W; i++, x += 64) {
    const h = 64 + (i % 3) * 10;
    k.box(x, 0, 64, 38, h, walls[i % walls.length]);
    k.gable(x - 1, -2, 66, 42, h, 18, i % 2 ? COL.tileGrey : COL.tile, "x");
    k.windows(x, 38, 64, [h - 26], 2, (j) => (i + j) % 3 !== 0, 12, 12);
  }
  // the alley walls at both ends
  for (const x of [0, MARKET_W - 40]) { k.box(x, 40, 40, 118, 44, COL.brick); k.box(x, 40, 40, 118, 3, COL.stoneLight, { z0: 44 }); }

  // the north row: every shop a body with a tiled roof, a sign, windows, and an open front where its keeper stands
  const shops: Shop[] = [
    { r: RESTAURANT_FRONT, wall: 0xe8d6b0, roof: COL.tile, sign: COL.red, recess: { x: 100, w: 80 } },
    { r: SHOWROOM_FRONT, wall: 0xa8bcd8, roof: COL.tile, sign: 0x1f3f86, recess: { x: SHOWROOM_DOOR.x - 4, w: SHOWROOM_DOOR.w + 8 } },
    { r: CLOTHES_FRONT, wall: 0xcfe0d4, roof: COL.tile, sign: COL.teal, recess: { x: 460, w: 80 } },
    { r: SALON_FRONT, wall: 0xe6b8a8, roof: COL.tile, sign: 0x7a2e5e, recess: { x: 640, w: 80 } },
    { r: FURNITURE_FRONT, wall: 0xecd07a, roof: 0x8a5a30, sign: 0x6e4a28, recess: { x: FURNITURE_FRONT.x + 40, w: 80 } },
    { r: MOTEL_FRONT, wall: 0xe8b4b0, roof: 0x8a3a2a, sign: 0x2a1a2a, recess: { x: MOTEL_FRONT.x + 40, w: 80 }, storeys: 2 },
    { r: PET_SHOP_FRONT, wall: 0xf4ead0, roof: 0x4f8a5a, sign: 0x3f8a5a, recess: { x: PET_SHOP_FRONT.x + 40, w: 80 } },
  ];
  shops.forEach((s, i) => shop(k, s, `shop${i}`));
  // the showroom's display windows (lit glass) and the salon's barber pole
  for (const wx of [SHOWROOM_FRONT.x + 10, SHOWROOM_DOOR.x + SHOWROOM_DOOR.w + 10]) {
    k.box(wx, 158, 48, 2, 34, 0xcfe6f0, { z0: 8, glow: true });
  }
  const pole = { x: SALON_FRONT.x + SALON_FRONT.w - 14, y: SALON_FRONT.y + SALON_FRONT.h - 6 };
  for (let j = 0; j < 6; j++) k.box(pole.x, pole.y, 5, 5, 5, [0xd23a3a, 0xf4f1e8, 0x3a7bd5][j % 3], { z0: 14 + j * 5 });
  // the motel's neon board
  k.box(MOTEL_FRONT.x + 50, MOTEL_FRONT.y + MOTEL_FRONT.h - 1, 60, 2, 12, 0xff5fa2, { z0: 88, glow: true });
  k.signFace(MOTEL_FRONT.x + 80, MOTEL_FRONT.y + MOTEL_FRONT.h + 1 + DECAL_LIFT, 94, { lines: ["HOA SEN"], icon: "star", bg: 0x2a1a2a, fg: 0xff9fca, rim: 0xff5fa2 }, "s", 56);
  // the awnings over the three original shops' fronts (they reach over the pavement)
  const awnings: Array<[Rect, number, number]> = [[RESTAURANT_FRONT, COL.red, COL.white], [CLOTHES_FRONT, COL.teal, COL.white], [SALON_FRONT, 0xd4758f, COL.white]];
  for (const [r, a, b] of awnings) {
    const id = k.roofGroup(`awn${r.x}`, { x: r.x + 40, y: r.y + r.h, w: 120, h: 10 });
    for (let i = 0; i < 12; i++) k.box(r.x + 44 + i * 9.5, r.y + r.h - 4, 9.5, 18, 3, i % 2 ? b : a, { z0: 50, roof: id });
  }

  // the stalls along the south: a counter, four posts, a striped awning, the goods, a signboard on the served ones
  for (const s of STALLS) {
    const r = s.rect, [a, b] = STALL_STRIPES[s.goods];
    k.box(r.x + 2, r.y + 24, r.w - 4, 10, 14, COL.woodDark);
    k.box(r.x + 1, r.y + 23, r.w - 2, 12, 2, COL.woodPale, { z0: 14 });
    k.box(r.x + 4, r.y + 2, r.w - 8, 4, 30, COL.woodDark);
    for (const [px, py] of [[r.x + 1, r.y + 1], [r.x + r.w - 4, r.y + 1], [r.x + 1, r.y + r.h - 4], [r.x + r.w - 4, r.y + r.h - 4]]) k.box(px, py, 3, 3, 44, COL.woodDeep);
    const id = k.roofGroup(`stall${r.x}`, { x: r.x, y: r.y, w: r.w, h: r.h });
    for (let i = 0; i < 10; i++) k.box(r.x - 2 + i * ((r.w + 4) / 10), r.y - 2, (r.w + 4) / 10, r.h + 10, 3, i % 2 ? b : a, { z0: 44, roof: id });
    const goods = GOODS[s.goods];
    for (let i = 0; i < 9; i++) k.box(r.x + 6 + i * 8, r.y + 26 + (i % 2) * 3, 5, 4, 4, goods[i % goods.length], { z0: 16 });
    if (s.goods === "lantern") for (let i = 0; i < 5; i++) k.bulb(r.x + 10 + i * 15, r.y + r.h + 4, 38, goods[i % goods.length], 2.6);
    if (s.goods === "umbrella") for (let i = 0; i < 3; i++) k.gable(r.x + 10 + i * 22, r.y + 8, 16, 16, 30, 6, goods[i], "x");
    {
      const bg = s.goods === "fish" ? COL.tealDark : s.goods === "produce" ? 0x3a6e2a : s.goods === "umbrella" ? 0x1e3f78 : COL.woodDeep;
      k.box(r.x + 12, r.y + r.h + 6, r.w - 24, 1.6, 11, bg, { z0: 47, roof: id });
      k.signFace(r.x + r.w / 2, r.y + r.h + 7.6 + DECAL_LIFT, 52.5, { lines: wrap(k.labelNear(r.x + r.w / 2, r.y + r.h / 2, 60) ?? GOODS_NAME[s.goods], 14), icon: GOODS_ICON[s.goods], bg, fg: COL.white }, "s", r.w - 28);
    }
    k.light(r.x + r.w / 2, r.y + r.h + 6, 44, s.goods === "lantern" ? 3 : 1);
  }

  // the Võ đường: a walled compound, its hall with a red roof, the gate roof over the pavement
  const v = VO_DUONG_FRONT, gate = VO_DUONG_AWNING;
  k.box(v.x, v.y, 6, v.h, 30, 0xd8c8a0);
  k.box(v.x + v.w - 6, v.y, 6, v.h, 30, 0xd8c8a0);
  k.box(v.x, v.y + v.h - 6, v.w, 6, 30, 0xd8c8a0);
  k.box(v.x, v.y, gate.x + 6 - v.x, 6, 30, 0xd8c8a0);
  k.box(gate.x + gate.w - 6, v.y, v.x + v.w - gate.x - gate.w + 6, 6, 30, 0xd8c8a0);
  k.box(v.x + 30, v.y + 40, v.w - 60, v.h - 50, 44, 0xa84a3a);
  k.gable(v.x + 26, v.y + 36, v.w - 52, v.h - 42, 44, 24, COL.redDark, "x");
  k.windows(v.x + 30, v.y + 40, v.w - 60, [14], 4, () => true, 12, 16);
  for (const gx of [gate.x + 6, gate.x + gate.w - 14]) k.box(gx, v.y - 6, 8, 6, 52, COL.redDark);
  const gid = k.roofGroup("dojo_gate", { x: gate.x, y: gate.y, w: gate.w, h: gate.h });
  k.gable(gate.x - 6, gate.y + 4, gate.w + 12, gate.h, 52, 14, COL.tileDark, "x", gid);
  k.box(gate.x + 30, v.y - 4, gate.w - 60, 2, 11, COL.redDark, { z0: 40, roof: gid });
  k.signFace(gate.x + gate.w / 2, v.y - 2 + DECAL_LIFT, 45, { lines: ["VÕ ĐƯỜNG"], icon: "fist", bg: COL.redDark, fg: COL.goldLight, rim: COL.gold }, "s", gate.w - 64);
  k.light(920, 268, 56, 4);

  // the canal wall, the plank bridge over the gap, a xuồng in the canal, the manhole
  k.box(0, 384, BRIDGE_GAP.x, 6, 8, COL.stoneLight);
  k.box(BRIDGE_GAP.x + BRIDGE_GAP.w, 384, MARKET_W - BRIDGE_GAP.x - BRIDGE_GAP.w, 6, 8, COL.stoneLight);
  k.box(BRIDGE_GAP.x, 384, BRIDGE_GAP.w, MARKET_H - 384, 3, COL.wood, { z0: -2 });
  for (let y = 386; y < MARKET_H; y += 4) k.box(BRIDGE_GAP.x, y, BRIDGE_GAP.w, 0.5, 0.2, COL.woodDark, { z0: 1 });
  for (const bx of [BRIDGE_GAP.x - 4, BRIDGE_GAP.x + BRIDGE_GAP.w]) k.box(bx, 384, 4, 6, 16, COL.woodDark);
  k.box(382, 393, 32, 5, 3, COL.woodDark, { z0: -4 });
  k.boxC(UG_HATCH.x, UG_HATCH.y, 16, 12, 0.6, 0x5a5a60);

  for (const p of map.props) if (p.kind !== "market_stall") k.prop(p);
  for (const p of map.props) if (p.kind === "market_stall") k.L.pieces.push({ kind: p.kind, x: p.x, y: p.y });
  for (const [i, p] of LANTERN_POSTS.entries()) if (i % 2) k.light(p.x, p.y, 40, 0);
  k.light(140, 176, 60, 3); k.light(500, 176, 60, 3); k.light(1000, 176, 60, 2);

  for (const [x1, y1, x2, y2, sag] of LANTERN_STRINGS) k.lightString(anchor(x1, y1), anchor(x2, y2), sag * 0.6, LANTERN_COLS, 16);
  return k.done();
}

/** A north-row shop: the back of the body full height, the front either side of its open recess, a lintel over it, the
 *  recess's lit interior, a tiled roof (fades when you're right under/behind it), the sign and upstairs windows. */
function shop(k: ZoneKit, s: Shop, id: string): void {
  const { r } = s, H = s.storeys === 2 ? 96 : 72, depth = 32;
  const rec = s.recess ?? { x: r.x + 40, w: 80 };
  k.box(r.x, r.y, r.w, r.h - depth, H, s.wall);
  k.box(r.x, r.y + r.h - depth, rec.x - r.x, depth, H, s.wall);
  k.box(rec.x + rec.w, r.y + r.h - depth, r.x + r.w - rec.x - rec.w, depth, H, s.wall);
  k.box(rec.x, r.y + r.h - depth, rec.w, depth, H - 50, s.wall, { z0: 50 });
  k.box(rec.x, r.y + r.h - depth - 1, rec.w, 1, 50, COL.interior);
  k.box(rec.x, r.y + r.h - depth, rec.w, depth, 0.5, 0x6e4a38, { z0: 0 });
  k.box(rec.x + 2, r.y + r.h - 2, rec.w - 4, 2, 2, 0xf6c36a, { z0: 48, glow: true });
  k.box(r.x, r.y + r.h - 1, r.w, 1.5, 3, COL.outline, { z0: H - 3 });
  const roof = k.roofGroup(id, { x: r.x, y: r.y, w: r.w, h: r.h - 40 });
  k.gable(r.x - 4, r.y - 2, r.w + 8, r.h + 6, H, 26, s.roof, "x", roof);
  const name = k.labelNear(r.x + r.w / 2, r.y + r.h - 10, r.w / 2 + 20) ?? "";
  k.box(r.x + r.w / 2 - 38, r.y + r.h - 1, 76, 1.8, 16, s.sign, { z0: H - 20, glow: true });
  k.signFace(r.x + r.w / 2, r.y + r.h + 0.8 + DECAL_LIFT, H - 12, { lines: [upper(name)], bg: s.sign, fg: COL.goldLight, rim: COL.gold }, "s", 70);
  k.windows(r.x, r.y + r.h, (rec.x - r.x), [22], 1, () => true, 22, 20);
  k.windows(rec.x + rec.w, r.y + r.h, r.x + r.w - rec.x - rec.w, [22], 1, () => true, 22, 20);
  if (s.storeys === 2) k.windows(r.x, r.y + r.h, r.w, [62], 4, (i) => i % 3 !== 1, 14, 16);
}

/** Chợ Lớn as a Three.js group in zone-local units (origin: the map's middle, or its corner with opts.origin). */
export function buildMarket(map: GameMap, opts: ZoneOpts = {}): THREE.Group {
  const built = renderZone(marketLayout(map, opts), opts);
  built.root.userData.built = built;
  return built.root;
}


