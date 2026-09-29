import type * as THREE from "three";
import { APT_BLOCK, APT_LOBBY, ESTATE_DOOR, ESTATE_OFFICE, KHU_H, KHU_W, LOTS, TOWNHOUSES } from "@/lib/game/maps/khu-nha";
import type { GameMap } from "@/lib/game/maps/types";
import { COL, ZoneKit, type ZGround, type ZoneLayout, type ZoneOpts } from "./kit";
import { renderZone } from "./render";

// Khu nhà — the residential quarter as a diorama, from khu-nha.ts (collision, props, interactables) and khu-nha-art.ts
// (the look): the houses behind, two old townhouses, the cream Chung cư Phú Mỹ block (three floors of four flats,
// balconies, lit windows, the lobby with chú Sáu under the porch), the Sàn bất động sản office, the street, the eight
// fenced lots with their boards, the little park with its palms, benches and lamps, and the canal.

const PARK = { x: 260, y: 240, w: 280, h: 136 } as const;

export function khuNhaGroundAt(x: number, y: number): ZGround {
  if (y >= 386) return "water";
  if (y >= 382) return "stone";
  if (y >= 176 && y < 224) return "road";
  if (x >= PARK.x && x < PARK.x + PARK.w && y >= PARK.y && y < PARK.y + PARK.h) return "grass";
  if (LOTS.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h)) return "soil";
  return "pave";
}

export function khuNhaLayout(map: GameMap, opts: ZoneOpts = {}): ZoneLayout {
  const k = new ZoneKit(map, khuNhaGroundAt, opts, 1902);
  k.L.water.push({ x: 0, y: 386, w: KHU_W, h: KHU_H - 386 });

  // the houses behind (solid y 0–40)
  for (let x = 0, i = 0; x < KHU_W; i++) {
    const w = Math.min(KHU_W - x, 40 + Math.floor(k.R() * 30)), h = 56 + Math.floor(k.R() * 3) * 8;
    k.box(x, 0, w, 38, h, [0xe6b8a8, 0xa8bcd8, 0xecd07a, 0xcfe0d4][i % 4]);
    k.gable(x - 1, -2, w + 2, 42, h, 14, i % 2 ? COL.tileDark : COL.tile, "x");
    k.windows(x, 38, w, [h - 24], Math.max(1, Math.floor(w / 24)), (j) => (i + j) % 3 !== 1, 10, 9);
    x += w;
  }

  // two old townhouses: cream and teal, shutters below, windows above, tiled roofs
  const hw = TOWNHOUSES.w / 2;
  [[0xe8d6b0, 0xc9b48a], [0xcfe0d4, 0xa6c2b0]].forEach(([wall, dark], i) => {
    const x = TOWNHOUSES.x + i * hw, y = TOWNHOUSES.y, d = TOWNHOUSES.h, face = y + d;
    k.box(x, y, hw, d, 84, wall);
    k.box(x, face - 1, hw, 1.5, 3, dark, { z0: 38 });
    k.gable(x - 2, y - 2, hw + 4, d + 6, 84, 24, COL.tile, "x", k.roofGroup(`town${i}`, { x, y, w: hw, h: d - 40 }));
    k.windows(x, face, hw, [52], 2, () => true, 18, 20);
    k.box(x + 20, face - 1, hw - 40, 1.5, 34, 0x4f8a6a);
    for (let z = 3; z < 34; z += 4) k.box(x + 20, face - 0.8, hw - 40, 1.4, 0.8, 0x3a6a50, { z0: z });
  });

  // Chung cư Phú Mỹ: the ground floor recessed under a porch where the lobby door and chú Sáu's booth are, two upper
  // floors of four flats with balconies, a flat roof with the water tank and the name board
  const b = APT_BLOCK, face = b.y + b.h, GF = 56, FL = 40, TOP = GF + FL * 2;
  const porch = { x: APT_LOBBY.x - 8, w: 104 };
  k.box(b.x, b.y, b.w, b.h - 20, TOP, COL.cream);
  k.box(b.x, face - 20, porch.x - b.x, 20, GF, COL.cream);
  k.box(porch.x + porch.w, face - 20, b.x + b.w - porch.x - porch.w, 20, GF, COL.cream);
  const porchRoof = k.roofGroup("apt_porch", { x: porch.x, y: face - 20, w: porch.w, h: 20 });
  k.box(b.x, face - 20, b.w, 20, TOP - GF, COL.cream, { z0: GF, roof: porchRoof });
  k.box(b.x - 3, b.y - 3, b.w + 6, b.h + 6, 4, 0xcbb88e, { z0: TOP });
  k.box(b.x + b.w - 40, b.y + 10, 24, 16, 14, COL.grey, { z0: TOP + 4 });
  k.box(b.x + 72, face - 1, 112, 2, 12, COL.teal, { z0: TOP - 16, glow: true, roof: porchRoof });
  for (let f = 0; f < 2; f++) {
    const z = GF + f * FL;
    k.windows(b.x, face, b.w, [z + 12], 4, (u) => (u + f) % 3 !== 0, 16, 36);
    for (let u = 0; u < 4; u++) {
      const ux = b.x + 10 + u * 62;
      k.box(ux - 2, face, 44, 8, 2, 0xcbb88e, { z0: z, roof: porchRoof });
      k.box(ux - 2, face + 7, 44, 1, 8, 0x4a4a54, { z0: z + 2, roof: porchRoof });
      if ((u * 3 + f) % 2 === 0) k.box(ux + 30, face + 2, 6, 4, 6, COL.leaf, { z0: z + 2, roof: porchRoof });
    }
  }
  // ground floor: flats either side, the lobby's glass door, the guard's booth window
  k.windows(b.x, face - 20, porch.x - b.x, [18], 2, () => true, 18, 30);
  k.windows(porch.x + porch.w, face - 20, b.x + b.w - porch.x - porch.w, [18], 2, () => true, 18, 30);
  k.box(APT_LOBBY.x, face - 21, APT_LOBBY.w, 1.5, 40, COL.tealDark);
  k.box(APT_LOBBY.x + 3, face - 20, APT_LOBBY.w - 6, 1.5, 36, 0x9fd0d8, { glow: true });
  k.box(APT_LOBBY.x + APT_LOBBY.w + 8, face - 21, 30, 1.5, 22, COL.glass, { z0: 12, glow: true });
  k.box(porch.x, face - 20, porch.w, 20, 1, 0xcbb88e);
  const awn = k.roofGroup("apt_awning", { x: APT_LOBBY.x - 24, y: face, w: APT_LOBBY.w + 48, h: 6 });
  for (let i = 0; i < 10; i++) k.box(APT_LOBBY.x - 24 + i * 8, face - 2, 8, 8, 3, i % 2 ? 0xf6ecd0 : COL.teal, { z0: 46, roof: awn });
  k.light(APT_LOBBY.x + APT_LOBBY.w / 2, face - 4, 40, 3);

  // Sàn bất động sản: blue walls, a tiled roof, the red sign, listings in the windows, the glass door, anh Tư's desk in
  // the open corner east of the door
  const o = ESTATE_OFFICE, of = o.y + o.h, OH = 72, desk = { x: ESTATE_DOOR.x + ESTATE_DOOR.w + 3, w: 44 };
  k.box(o.x, o.y, o.w, o.h - 26, OH, 0xa8bcd8);
  k.box(o.x, of - 26, desk.x - o.x, 26, OH, 0xa8bcd8);
  k.box(desk.x + desk.w, of - 26, o.x + o.w - desk.x - desk.w, 26, OH, 0xa8bcd8);
  k.box(desk.x, of - 26, desk.w, 26, OH - 50, 0xa8bcd8, { z0: 50 });
  k.box(desk.x, of - 27, desk.w, 1, 50, COL.interior);
  k.box(desk.x + 4, of - 20, desk.w - 8, 8, 12, 0xcbb88e);
  k.bulb(desk.x + 12, of - 16, 16, COL.goldLight, 1.6);
  k.gable(o.x - 4, o.y - 2, o.w + 8, o.h + 6, OH, 22, COL.tile, "x", k.roofGroup("estate", { x: o.x, y: o.y, w: o.w, h: o.h - 40 }));
  k.box(o.x + 14, of - 1, 100, 2, 12, COL.redDark, { z0: OH - 16, glow: true });
  for (const wx of [o.x + 8, o.x + 84]) if (wx + 36 <= ESTATE_DOOR.x || wx >= desk.x + desk.w) {
    k.box(wx, of - 1, 36, 1.5, 36, COL.glassDim, { z0: 10 });
    for (let j = 0; j < 4; j++) k.box(wx + 3 + (j % 2) * 17, of - 0.2, 14, 1, 13, COL.paper, { z0: 12 + Math.floor(j / 2) * 17 });
  }
  k.box(ESTATE_DOOR.x + 2, of - 1, ESTATE_DOOR.w - 4, 1.5, 44, 0x9fd0d8, { glow: true });
  k.box(ESTATE_DOOR.x - 2, of - 1, ESTATE_DOOR.w + 4, 1.5, 4, COL.tealDark, { z0: 44 });
  k.light(o.x + 64, of, 30, 2);

  // the east wall and the canal wall
  k.box(780, 40, 20, 344, 30, 0xb4a48c);
  k.box(0, 380, KHU_W, 4, 6, COL.stoneLight);

  // the street: the centre line, the kerbs
  for (let x = 8; x < KHU_W; x += 32) k.box(x, 199, 16, 2, 0.3, 0xd8d0b8);
  for (const y of [174, 224]) k.box(0, y, KHU_W, 2, 1.5, 0x9c8c74);

  // the eight lots: a fence around, a board on a post in the middle
  LOTS.forEach((r, i) => {
    k.fenceRect(r);
    k.boxC(r.x + r.w / 2, r.y + r.h / 2 + 4, 2, 2, 20, COL.woodDeep);
    k.boxC(r.x + r.w / 2, r.y + r.h / 2 + 4, 28, 2, 12, COL.paper, { z0: 12 });
    k.boxC(r.x + r.w / 2 - 6 + (i % 4) * 3, r.y + r.h / 2 + 3, 8, 0.5, 3, COL.outline, { z0: 16 });
  });

  // the park: the stone path, two benches, flowers along the edge (all low: the park stays walkable)
  for (let y = PARK.y + 4; y < PARK.y + PARK.h; y += 10) k.box(394, y, 12, 7, 0.6, 0xc8b89e);
  for (const bx of [330, 446]) { k.box(bx, 327, 24, 7, 6, COL.wood); k.box(bx, 326, 24, 2, 9, COL.woodDark); }
  for (let x = PARK.x + 6; x < PARK.x + PARK.w; x += 9) k.box(x, PARK.y + 3, 3, 3, 3, [COL.red, COL.gold, 0xd4758f][Math.floor(k.R() * 3)]);

  for (const p of map.props) k.prop(p);
  return k.done();
}

/** Khu nhà as a Three.js group in zone-local units (origin: the map's middle, or its corner with opts.origin). */
export function buildKhuNha(map: GameMap, opts: ZoneOpts = {}): THREE.Group {
  const built = renderZone(khuNhaLayout(map, opts), opts);
  built.root.userData.built = built;
  return built.root;
}
