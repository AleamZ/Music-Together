import { C, px, rect, type Ctx, type PropFrame } from "@/lib/game/maps/scene-art";

// v21 (0076) props: the moored ghe in the pond's deep water and anh Hai's machine shed on the field. Original pixel art
// in the chibi world's palette (scene-art C).

/** The ghe's sprite: the base point is just above the deck spot, so whoever stands on it is drawn over the hull. */
export const GHE_FRAME: PropFrame = { w: 64, h: 22, ox: 32, oy: 12 };

/** A Mekong wooden ghe: a long tapered hull, a pale gunwale, planks inside, the painted eye at the bow, a pole across
 *  and the ripple of its waterline. */
export function drawGhe(c: Ctx): void {
  // the waterline ripple and shadow
  rect(c, C.waterDeep, 6, 18, 52, 3);
  for (let x = 4; x < 60; x += 5) px(c, C.sparkle, x, 20);
  // the hull: tapered at both ends (bow on the right)
  const rows: ReadonlyArray<readonly [number, number]> = [[8, 56], [5, 60], [3, 62], [3, 62], [4, 61], [6, 59], [9, 56], [12, 53], [16, 49]];
  rows.forEach(([a, b], i) => {
    const y = 9 + i;
    rect(c, C.outline, a - 1, y, b - a + 2, 1);
    rect(c, i < 2 ? C.woodPale : i < 5 ? C.wood : C.woodDark, a, y, b - a, 1);
  });
  // the inside: planks and ribs
  rect(c, C.woodDeep, 8, 11, 48, 3);
  for (let x = 14; x < 52; x += 8) rect(c, C.woodLight, x, 11, 1, 3);
  // the gunwale and the raised bow and stern
  rect(c, C.outline, 7, 8, 50, 1);
  rect(c, C.outline, 58, 5, 4, 4); rect(c, C.woodPale, 59, 6, 2, 3);
  rect(c, C.outline, 2, 6, 4, 3); rect(c, C.woodPale, 3, 7, 2, 2);
  // the painted eye (mắt ghe) at the bow
  rect(c, C.white, 50, 13, 5, 3); rect(c, C.red, 51, 13, 3, 3); px(c, C.outline, 52, 14);
  // a bamboo pole laid across, and a coil of rope at the stern
  rect(c, C.bambooDark, 20, 7, 26, 1); px(c, C.bambooNode, 28, 7); px(c, C.bambooNode, 38, 7);
  rect(c, C.trunkLight, 10, 10, 3, 2); px(c, C.trunkDark, 11, 10);
}

/** anh Hai's machine shed: base point at the middle of its front wall's foot. */
export const MACHINE_SHED_FRAME: PropFrame = { w: 60, h: 44, ox: 30, oy: 44 };

/** A small shed with a tin roof, plank walls, the wide door open on a red machine, and a gear painted on a board. */
export function drawMachineShed(c: Ctx): void {
  // the tin roof, corrugated
  rect(c, C.outline, 0, 4, 60, 12);
  for (let x = 1; x < 59; x++) rect(c, x % 3 === 0 ? "#9aa0a6" : C.silver, x, 5, 1, 10);
  rect(c, C.outline, 2, 2, 56, 2); rect(c, "#9aa0a6", 3, 3, 54, 1);
  // the walls
  rect(c, C.outline, 3, 16, 54, 28); rect(c, C.wood, 4, 16, 52, 27);
  for (let x = 8; x < 56; x += 6) rect(c, C.woodDark, x, 16, 1, 27);
  // the open door and the machine inside
  rect(c, C.outline, 18, 22, 26, 22); rect(c, C.woodDeep, 19, 23, 24, 21);
  rect(c, C.redDark, 22, 30, 18, 9); rect(c, C.red, 23, 30, 16, 4); rect(c, C.goldLight, 36, 31, 2, 2);
  rect(c, C.outline, 23, 38, 6, 6); rect(c, "#4a4040", 24, 39, 4, 4);
  rect(c, C.outline, 33, 39, 5, 5); rect(c, "#4a4040", 34, 40, 3, 3);
  rect(c, C.speaker, 27, 26, 2, 4);
  // the gear board
  rect(c, C.outline, 45, 19, 10, 10); rect(c, C.paper, 46, 20, 8, 8);
  rect(c, C.blue, 48, 21, 4, 6); rect(c, C.blue, 47, 22, 6, 4); rect(c, C.paper, 49, 23, 2, 2);
  // a sack of rice by the door
  rect(c, C.outline, 6, 34, 9, 10); rect(c, "#e6d7b0", 7, 35, 7, 9); rect(c, C.gold, 8, 37, 5, 1);
}
