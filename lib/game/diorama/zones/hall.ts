import type * as THREE from "three";
import { CARD_DECK, HALL_H, HALL_W, HALL_WALKABLE, hallShoreY } from "@/lib/game/maps/hall";
import type { GameMap } from "@/lib/game/maps/types";
import { blockedAt, COL, ZoneKit, type ZGround, type ZoneLayout, type ZoneOpts } from "./kit";
import { renderZone } from "./render";
import { seatAnchors } from "./seats";

// Sảnh — the hall ("quán cà phê võng ven sông") as a diorama, from hall.ts (collision, props, interactables) and
// hall-art.ts (the look): the bamboo grove, the stage with its banner, speakers and the DJ booth, the café counter under
// its striped awning with its menu board and bar stools, the yard, the card corner's plank deck — a real table and a
// real seat for every place at each game (seats.ts) — with its floor lanterns, the hammock between palm A and the west
// light pole, the river with the dock and a xuồng, and the string lights over the yard.

/** The same yard/path shapes the 2D painter uses (hall-art.ts). */
function inYard(x: number, y: number): boolean {
  const dx = (x - 330) / 245, dy = (y - 238) / 98;
  const n = Math.sin(x * 0.11) * 0.05 + Math.sin(y * 0.17 + x * 0.05) * 0.05;
  return dx * dx + dy * dy < 1 + n;
}
function onPath(x: number, y: number): boolean {
  if (x < 470) return false;
  return Math.abs(y - (300 + Math.sin(x * 0.05) * 4)) < 15 + Math.sin(x * 0.3) * 1.5;
}

export function hallGroundAt(x: number, y: number): ZGround {
  const sy = hallShoreY(x);
  if (y >= sy) return "water";
  if (y >= sy - 6) return "sand";
  if (x < 72 && y < 150) return "bamboo";
  if (inYard(x, y) || onPath(x, y)) return "dirt";
  return "grass";
}

/** The card deck's floor lanterns (hall-art.ts's DECK_LANTERNS). */
const DECK_LANTERNS: ReadonlyArray<readonly [number, number]> = [[68, 246], [286, 246], [70, 312]];
const STRING_COLS = [0xff6f91, 0xffd166, 0x06d6a0, 0x4cc9f0] as const;
const STAGE = { x: 232, y: 18, w: 176, h: 118 } as const;

/** A speaker cabinet facing south: the box, a woofer and a tweeter, a grille rim. */
function speaker(k: ZoneKit, x: number, y: number, z0: number, w: number, d: number, h: number): void {
  k.box(x, y, w, d, h, 0x24232a, { z0 });
  k.box(x - 0.6, y + d - 1, w + 1.2, 1.2, 1, 0x4a4a58, { z0: z0 + h - 1 });
  const cx = x + w / 2, front = y + d;
  k.cyl(cx, front + 0.3, w * 0.36, 0.8, 0x4a4a58, { z0: z0 + h * 0.18, axis: "y", seg: 14 });
  k.cyl(cx, front + 0.8, w * 0.22, 0.6, 0x15151c, { z0: z0 + h * 0.18 + w * 0.14, axis: "y", seg: 12 });
  k.cyl(cx, front + 0.3, w * 0.16, 0.8, 0x4a4a58, { z0: z0 + h * 0.7, axis: "y", seg: 10 });
}

export function hallLayout(map: GameMap, opts: ZoneOpts = {}): ZoneLayout {
  const k = new ZoneKit(map, hallGroundAt, opts, 311);
  const blocked = (x: number, y: number) => blockedAt(map, x, y);
  k.L.water.push({ x: 0, y: 326, w: HALL_W, h: HALL_H - 326 });

  // the bamboo grove (solid in the map), only on blocked cells
  k.fill({ x: 0, y: 0, w: 72, h: 150 }, 8, (x, y) => k.L.bamboo.push({ x, y, h: 50 + k.R() * 30, seed: Math.floor(k.R() * 1e6) }), blocked);

  // the stage: a plank platform with a skirt and steps, a backdrop, two poles carrying the banner, speaker stacks
  k.box(STAGE.x, STAGE.y, STAGE.w, STAGE.h, 11, COL.woodDark);
  k.box(STAGE.x - 1, STAGE.y - 1, STAGE.w + 2, STAGE.h + 2, 1, COL.wood, { z0: 11 });
  for (let x = STAGE.x + 11; x < STAGE.x + STAGE.w - 2; x += 11) k.box(x, STAGE.y, 0.6, STAGE.h, 0.3, COL.woodDark, { z0: 12 });
  for (let x = STAGE.x + 8; x < STAGE.x + STAGE.w; x += 16) k.box(x, STAGE.y + STAGE.h, 1.5, 0.8, 11, COL.woodDeep);
  for (let s = 0; s < 3; s++) k.box(302, STAGE.y + STAGE.h + 1 + s * 4, 36, 12 - s * 4, 3 + s * 0 + (2 - s) * 3.5, COL.wood);
  k.box(STAGE.x + 4, 2, STAGE.w - 8, 12, 70, 0x3a2a34);
  for (let x = STAGE.x + 10; x < STAGE.x + STAGE.w - 8; x += 12) k.box(x, 13.6, 6, 0.8, 56, 0x4a3448, { z0: 12 });
  for (const px of [245, 395]) k.cyl(px, 16, 2, 96, COL.woodDeep, { seg: 8 });
  k.box(246, 16, 148, 2, 30, COL.red, { z0: 60 });
  k.box(246, 15.4, 148, 3.2, 2.4, COL.gold, { z0: 58 });
  k.box(246, 15.4, 148, 3.2, 2.4, COL.gold, { z0: 90 });
  k.signFace(320, 18.4, 75, { lines: ["SÂN KHẤU"], icon: "note", bg: COL.red, fg: COL.goldLight, rim: COL.gold }, "s", 100);
  for (const sx of [250, 372]) {
    speaker(k, sx, 30, 12, 18, 12, 22);
    speaker(k, sx + 2, 31, 34, 14, 10, 16);
  }
  k.L.decks.push({ rect: { ...STAGE }, top: 12 });
  for (const lx of [262, 300, 340, 378]) { k.cyl(lx, 22, 2.2, 3, COL.metal, { z0: 58, seg: 8, taper: 1.4 }); k.bulb(lx, 22, 56.5, 0xfff1c0, 1.3); }
  k.light(320, 100, 54, 4);

  // the café counter "Quầy nước": a shelf wall with jars and cups, the bar with its menu board and bar stools, a
  // red-white striped awning on four posts
  k.box(466, 4, 138, 26, 50, COL.woodDark);
  for (const z of [16, 30]) k.box(468, 30, 134, 4, 1.2, COL.woodPale, { z0: z });
  for (let x = 471; x < 600; x += 7) for (const z of [17.2, 31.2]) k.cyl(x + 2, 32, 1.8, 4.5, [0xe0b33c, 0xd9534f, 0x5fae6e, 0xf4f1ea, 0x3d86a8, 0xf29bb5][Math.floor(k.R() * 6)], { z0: z, seg: 7 });
  k.signFace(535, 30.8, 42, { lines: ["QUẦY NƯỚC"], icon: "cup", bg: COL.cream, fg: COL.redDark }, "s", 50);
  k.box(466, 80, 138, 20, 15, COL.wood);
  for (let x = 470; x < 600; x += 9) k.box(x, 100, 5, 0.8, 11, COL.woodDark, { z0: 2 });
  k.box(464, 78.5, 142, 23, 1.6, 0xe0b27a, { z0: 15 });
  for (const gx of [482, 520, 566]) { k.cyl(gx, 88, 1.4, 3.2, COL.white, { z0: 16.6, seg: 8 }); k.cyl(gx, 88, 1.15, 0.2, 0x5a3218, { z0: 19.8, seg: 8 }); }
  k.box(586, 84, 12, 8, 6, COL.metal, { z0: 16.6 });
  k.cyl(592, 88, 2, 4, 0xc0c0c8, { z0: 22.6, seg: 8 });
  k.signboard(596, 104, { lines: ["CÀ PHÊ", "TRÀ ĐÁ"], bg: 0x2a3a2a, fg: COL.white, rim: COL.wood }, { z0: 2, posts: 0, w: 18, depth: 1 });
  for (const sx of [486, 510, 534, 558]) k.stool(sx, 108, 11, 0, COL.red);
  for (const [px, py] of [[468, 33], [602, 33], [468, 101], [602, 101]]) k.cyl(px, py, 1.4, 46, COL.woodDeep, { seg: 6 });
  const cafe = k.roofGroup("cafe", { x: 466, y: 30, w: 138, h: 36 });
  for (let i = 0; i < 23; i++) k.box(464 + i * 6, 28, 6, 80, 3, i % 2 ? COL.white : COL.red, { z0: 46, roof: cafe });
  for (let i = 0; i < 23; i++) k.box(464 + i * 6, 108, 6, 1, 4, i % 2 ? COL.red : COL.white, { z0: 43, roof: cafe });
  k.light(535, 100, 60, 4);

  // the card corner's plank deck (walkable) with its rope edge and floor lanterns
  const deckBottom = Math.min(CARD_DECK.y + CARD_DECK.h, hallShoreY(CARD_DECK.x) - 6);
  k.box(CARD_DECK.x, CARD_DECK.y, CARD_DECK.w, deckBottom - CARD_DECK.y, 3, 0xa8743f, { z0: -1.5 });
  for (let y = CARD_DECK.y + 5; y < deckBottom; y += 5) k.box(CARD_DECK.x, y, CARD_DECK.w, 0.5, 0.3, COL.woodDark, { z0: 1.5 });
  k.box(CARD_DECK.x, CARD_DECK.y - 1, CARD_DECK.w, 1.5, 2.5, 0xe0c27a, { z0: -0.5 });
  k.L.decks.push({ rect: { x: CARD_DECK.x, y: CARD_DECK.y, w: CARD_DECK.w, h: deckBottom - CARD_DECK.y }, top: 1.5 });
  for (const [lx, ly] of DECK_LANTERNS) {
    k.box(lx - 2.5, ly - 3.5, 5, 5, 1, COL.woodDeep, { z0: 1.5 });
    k.cyl(lx, ly - 1, 0.6, 5, COL.woodDeep, { z0: 2.5, seg: 5 });
    k.lantern(lx, ly - 1, 10, COL.red, 2.6);
    k.light(lx, ly, 22, 1);
  }
  // the river: the dock (walkable) on posts, the moored xuồng, clumps of lục bình
  for (const d of HALL_WALKABLE) {
    k.box(d.x, d.y + 2, d.w, d.h - 2, 4, COL.wood, { z0: -2 });
    for (let y = d.y + 6; y < d.y + d.h; y += 6) k.box(d.x, y, d.w, 0.6, 0.3, COL.woodDark, { z0: 2 });
    for (const [px, py] of [[d.x + 1, d.y + 20], [d.x + d.w - 3, d.y + 20], [d.x + 1, d.y + 60], [d.x + d.w - 3, d.y + 60]]) k.cyl(px + 1, py + 1, 1.3, 16, COL.woodDeep, { z0: -12, seg: 6 });
    k.L.decks.push({ rect: { ...d }, top: 2 });
  }
  k.box(542, 352, 36, 8, 4, COL.woodDark, { z0: -5 });
  k.box(548, 354, 24, 4, 1, COL.woodPale, { z0: -1.5 });
  k.cyl(560, 355.5, 0.5, 14, COL.outline, { z0: -2, seg: 5 });
  for (const [cx, cy] of [[40, 372], [150, 385], [262, 360], [330, 390], [420, 370], [585, 382], [622, 358]]) {
    k.cyl(cx, cy, 7, 2, COL.leaf, { z0: -4, seg: 7, ry: 3.5 });
    k.cyl(cx, cy - 1, 1.6, 3, 0xb58ad8, { z0: -2, seg: 6, taper: 1.3 });
  }

  for (const p of map.props) k.prop(p);

  // a real seat under every place the game seats someone (the card tables' seats, the café chairs), matched to seats.ts
  const seatCol: Record<string, number> = { poker: 0x2f7a4a, xidach: COL.red, tienlen: COL.wood, cao: 0xd9534f };
  for (const a of seatAnchors("hall")) {
    if (a.kind === "hammock") { k.L.seats.push(a); continue; }
    const game = a.key.startsWith("cards_") ? a.key.slice(6).split(":")[0] : "";
    k.seat(a, seatCol[game] ?? COL.wood);
  }

  // string lights (hall.ts's LIGHT_STRINGS, re-anchored in 3D: stage poles, palm crowns, the light poles)
  const palmTop = (i: number) => { const p = k.L.palms[i]; return { x: p.x + p.lean * p.h * 0.3, y: p.y, z: p.h - 6 }; };
  const stageW = { x: 245, y: 16, z: 94 }, stageE = { x: 395, y: 16, z: 94 };
  const poleW = { x: 160, y: 186, z: 44 }, poleE = { x: 446, y: 168, z: 44 }, poleCards = { x: 298, y: 248, z: 44 };
  const palmA = k.L.palms.length > 0 ? palmTop(0) : poleW;
  const palmC = k.L.palms.length > 2 ? palmTop(2) : poleE;
  k.lightString(stageW, palmA, 10, STRING_COLS);
  k.lightString(stageE, palmC, 12, STRING_COLS);
  k.lightString(poleW, poleE, 14, STRING_COLS);
  k.lightString(palmA, poleCards, 12, STRING_COLS);
  return k.done();
}

/** The hall as a Three.js group in zone-local units (origin: the map's middle, or its corner with opts.origin). */
export function buildHall(map: GameMap, opts: ZoneOpts = {}): THREE.Group {
  const built = renderZone(hallLayout(map, opts), opts);
  built.root.userData.built = built;
  return built.root;
}



