import type * as THREE from "three";
import { CARD_DECK, HALL_H, HALL_W, HALL_WALKABLE, hallShoreY } from "@/lib/game/maps/hall";
import type { GameMap } from "@/lib/game/maps/types";
import { blockedAt, COL, ZoneKit, type ZGround, type ZoneLayout, type ZoneOpts } from "./kit";
import { renderZone } from "./render";

// Đình làng — the hall ("quán cà phê võng ven sông") as a diorama, from hall.ts (collision, props, interactables) and
// hall-art.ts (the look): the bamboo grove, the stage with its banner and the DJ booth, the café counter under its
// striped awning, the yard, the card corner's plank deck with its floor lanterns, the hammock between palm A and the
// west light pole, the river with the dock and a xuồng, and the string lights over the yard.

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

export function hallLayout(map: GameMap, opts: ZoneOpts = {}): ZoneLayout {
  const k = new ZoneKit(map, hallGroundAt, opts, 311);
  const blocked = (x: number, y: number) => blockedAt(map, x, y);
  k.L.water.push({ x: 0, y: 326, w: HALL_W, h: HALL_H - 326 });

  // the bamboo grove (solid in the map), only on blocked cells
  k.fill({ x: 0, y: 0, w: 72, h: 150 }, 8, (x, y) => k.L.bamboo.push({ x, y, h: 50 + k.R() * 30, seed: Math.floor(k.R() * 1e6) }), blocked);

  // the stage: a plank platform, a backdrop, two poles carrying the red banner, the speaker stacks
  k.box(STAGE.x, STAGE.y, STAGE.w, STAGE.h, 12, COL.wood);
  k.box(STAGE.x, STAGE.y + STAGE.h - 2, STAGE.w, 2, 11, COL.woodDark);
  for (let x = STAGE.x + 12; x < STAGE.x + STAGE.w; x += 12) k.box(x, STAGE.y + 1, 0.6, STAGE.h - 3, 0.3, COL.woodDark, { z0: 12 });
  k.box(STAGE.x + 4, 2, STAGE.w - 8, 12, 70, 0x3a2a34);
  for (const px of [243, 393]) k.box(px, 14, 4, 4, 96, COL.woodDeep);
  k.box(246, 16, 148, 2, 42, COL.red, { z0: 52 });
  k.box(246, 17, 148, 2, 3, COL.gold, { z0: 52 });
  for (let x = 262; x < 380; x += 18) k.box(x, 18, 6, 1, 8, COL.goldLight, { z0: 72, glow: true });
  for (const sx of [250, 374]) {
    k.box(sx, 30, 16, 12, 38, 0x2a2a34, { z0: 12 });
    for (const cz of [22, 38]) k.box(sx + 3, 42, 10, 1, 9, 0x6a6a78, { z0: cz });
  }
  k.L.decks.push({ rect: { ...STAGE }, top: 12 });
  k.light(320, 100, 54, 4);

  // the café counter "Quầy nước": a shelf wall with jars, the counter, a red-white awning on four posts
  k.box(466, 4, 138, 26, 50, COL.woodDark);
  for (let x = 470; x < 600; x += 7) for (const z of [18, 32]) k.box(x, 30, 4, 2, 5, [0xe0b33c, 0xd9534f, 0x5fae6e, 0xf4f1ea, 0x3d86a8, 0xf29bb5][Math.floor(k.R() * 6)], { z0: z });
  k.box(466, 80, 138, 22, 16, COL.woodPale);
  k.box(466, 79, 138, 24, 2, 0xe0b27a, { z0: 16 });
  for (const gx of [482, 520, 566]) k.box(gx, 86, 4, 4, 5, 0xf4f1ea, { z0: 18 });
  for (const [px, py] of [[467, 32], [600, 32], [467, 100], [600, 100]]) k.box(px, py, 3, 3, 46, COL.woodDeep);
  const cafe = k.roofGroup("cafe", { x: 466, y: 30, w: 138, h: 36 });
  for (let i = 0; i < 23; i++) k.box(464 + i * 6, 28, 6, 80, 3, i % 2 ? COL.white : COL.red, { z0: 46, roof: cafe });
  k.light(535, 100, 60, 4);

  // the card corner's plank deck (walkable) with its rope edge and floor lanterns
  const deckBottom = Math.min(CARD_DECK.y + CARD_DECK.h, hallShoreY(CARD_DECK.x) - 6);
  k.box(CARD_DECK.x, CARD_DECK.y, CARD_DECK.w, deckBottom - CARD_DECK.y, 3, 0xa8743f, { z0: -1.5 });
  for (let y = CARD_DECK.y + 5; y < deckBottom; y += 5) k.box(CARD_DECK.x, y, CARD_DECK.w, 0.5, 0.2, COL.woodDark, { z0: 1.5 });
  k.box(CARD_DECK.x, CARD_DECK.y - 1, CARD_DECK.w, 1.5, 2.5, 0xe0c27a, { z0: -0.5 });
  k.L.decks.push({ rect: { x: CARD_DECK.x, y: CARD_DECK.y, w: CARD_DECK.w, h: deckBottom - CARD_DECK.y }, top: 1.5 });
  for (const [lx, ly] of DECK_LANTERNS) { k.box(lx - 2, ly - 3, 5, 5, 1, COL.gold, { z0: 1 }); k.bulb(lx + 0.5, ly - 0.5, 5, COL.red, 2.6); k.light(lx, ly, 22, 1); }

  // the river: the dock (walkable) on posts, the moored xuồng, clumps of lục bình
  for (const d of HALL_WALKABLE) {
    k.box(d.x, d.y + 2, d.w, d.h - 2, 4, COL.wood, { z0: -2 });
    for (let y = d.y + 6; y < d.y + d.h; y += 6) k.box(d.x, y, d.w, 0.6, 0.2, COL.woodDark, { z0: 2 });
    for (const [px, py] of [[d.x + 1, d.y + 20], [d.x + d.w - 3, d.y + 20], [d.x + 1, d.y + 60], [d.x + d.w - 3, d.y + 60]]) k.box(px, py, 2, 2, 14, COL.woodDeep, { z0: -12 });
    k.L.decks.push({ rect: { ...d }, top: 2 });
  }
  k.box(542, 352, 36, 8, 4, COL.woodDark, { z0: -5 });
  k.box(548, 354, 24, 4, 1, COL.woodPale, { z0: -1.5 });
  k.box(560, 355, 1, 1, 14, COL.outline, { z0: -2 });
  for (const [cx, cy] of [[40, 372], [150, 385], [262, 360], [330, 390], [420, 370], [585, 382], [622, 358]]) {
    k.boxC(cx, cy, 14, 7, 2, COL.leaf, { z0: -4 });
    k.boxC(cx, cy - 1, 3, 3, 3, 0xb58ad8, { z0: -2 });
  }

  for (const p of map.props) k.prop(p);

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
