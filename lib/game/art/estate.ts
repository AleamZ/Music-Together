import { C, px, rect, type Ctx } from "@/lib/game/maps/scene-art";

// v19.4: inside the Sàn bất động sản office on Khu nhà — the header of the office's panel: a cork board of listing
// cards (one per listing, up to 8), anh Tư the broker at his desk with a ledger and a waving lucky cat, a window onto
// the chung cư, a ceiling fan and a potted areca palm. Original pixel art.

export const OFFICE_W = 200;
export const OFFICE_H = 72;

const K = {
  wall: "#d8e4ec", wallDark: "#b4c6d4", skirting: "#8a6a4a",
  floor: "#c9a878", floorDark: "#a8865a",
  cork: "#b8844c", corkDark: "#8a5e34", card: "#f6ecd0", pin: "#d8403a",
  desk: "#7a4e2c", deskLight: "#9a6a3a", deskDark: "#5a381e",
  sky: "#9fd0e8", block: "#e8d6b0", blockDark: "#c8b48a",
  skin: "#f0c8a0", hair: "#2a1a14", shirt: "#f4f4f0", shirtDark: "#d0d0c8", tie: "#b0283a",
  cat: "#fbf6ec", catRed: "#d8403a", leaf: "#3f8a5a", leafDark: "#2c6a42", pot: "#b0503a",
  fan: "#5a5a64", ledger: "#2a5aa0",
};

/** A roof colour per card so the board reads as "houses for sale". */
const ROOFS = ["#b0503a", "#2e9a94", "#8a7a3a", "#6a6a74"];

/** Paint the office at time `t` (ms; 0 is still) with `listings` cards on the board. */
export function paintEstateOffice(c: Ctx, t: number, listings: number): void {
  // wall, skirting, floor tiles
  rect(c, K.wall, 0, 0, OFFICE_W, 52);
  for (let x = 0; x < OFFICE_W; x += 20) rect(c, K.wallDark, x, 0, 1, 52);
  rect(c, K.skirting, 0, 50, OFFICE_W, 3);
  rect(c, K.floor, 0, 53, OFFICE_W, OFFICE_H - 53);
  for (let x = 0; x < OFFICE_W; x += 12) rect(c, K.floorDark, x, 53, 1, OFFICE_H - 53);
  rect(c, K.floorDark, 0, 62, OFFICE_W, 1);

  // the window: sky and the chung cư's balconies
  rect(c, C.outline, 8, 8, 40, 30); rect(c, K.sky, 9, 9, 38, 28);
  rect(c, K.block, 14, 16, 28, 21);
  for (let r = 0; r < 3; r++) for (let k = 0; k < 4; k++) rect(c, K.blockDark, 16 + k * 7, 18 + r * 6, 4, 3);
  rect(c, C.outline, 27, 9, 1, 28); rect(c, C.outline, 9, 22, 38, 1);

  // the cork board with the listing cards
  rect(c, C.outline, 60, 6, 72, 38); rect(c, K.cork, 61, 7, 70, 36);
  for (let k = 0; k < 20; k++) px(c, K.corkDark, 62 + ((k * 29) % 68), 8 + ((k * 13) % 34));
  const n = Math.max(0, Math.min(8, Math.floor(listings)));
  for (let i = 0; i < n; i++) {
    const cx = 64 + (i % 4) * 17, cy = 10 + Math.floor(i / 4) * 17;
    rect(c, C.outline, cx - 1, cy - 1, 15, 15); rect(c, K.card, cx, cy, 13, 13);
    // a little house: roof triangle, wall and door
    const roof = ROOFS[i % ROOFS.length];
    for (let j = 0; j < 4; j++) rect(c, roof, cx + 6 - j - 1, cy + 2 + j, 2 * j + 3 - 1, 1);
    rect(c, K.blockDark, cx + 3, cy + 6, 7, 5); rect(c, K.deskDark, cx + 6, cy + 8, 2, 3);
    rect(c, K.catRed, cx + 2, cy + 11, 9, 1);                               // the price line
    px(c, K.pin, cx + 6, cy);
  }
  if (n === 0) { rect(c, K.card, 84, 20, 24, 10); rect(c, K.corkDark, 87, 24, 18, 1); }

  // the ceiling fan
  const blade = t ? Math.floor(t / 90) % 2 : 0;
  rect(c, K.fan, 160, 0, 1, 6); rect(c, K.fan, blade ? 150 : 154, 6, blade ? 21 : 13, 1); rect(c, C.outline, 159, 5, 3, 2);

  // the areca palm in its pot
  rect(c, K.pot, 184, 44, 10, 9); rect(c, C.outline, 184, 44, 10, 1);
  for (let k = 0; k < 5; k++) {
    const lx = 188 + (k - 2) * 3, sway = t ? Math.round(Math.sin(t / 700 + k)) : 0;
    rect(c, k % 2 ? K.leaf : K.leafDark, lx + sway, 26 + Math.abs(k - 2) * 3, 2, 18 - Math.abs(k - 2) * 3);
  }

  // anh Tư behind his desk
  const bx = 150, by = 30;
  rect(c, K.shirt, bx - 6, by + 8, 13, 12); rect(c, K.shirtDark, bx - 6, by + 18, 13, 2);
  rect(c, K.tie, bx, by + 9, 1, 8);
  rect(c, K.skin, bx - 4, by, 9, 9); rect(c, K.hair, bx - 4, by - 1, 9, 3); rect(c, K.hair, bx - 5, by, 1, 4);
  px(c, C.outline, bx - 2, by + 4); px(c, C.outline, bx + 2, by + 4); rect(c, "#c07a6a", bx - 1, by + 6, 3, 1);
  // the desk, the open ledger, the lucky cat
  rect(c, C.outline, 118, 48, 64, 1); rect(c, K.deskLight, 118, 49, 64, 3); rect(c, K.desk, 120, 52, 60, 12);
  rect(c, K.deskDark, 122, 55, 56, 1);
  rect(c, K.ledger, 136, 45, 14, 4); rect(c, K.card, 137, 45, 5, 3); rect(c, K.card, 143, 45, 6, 3);
  const wave = t ? Math.floor(t / 400) % 2 : 0;
  rect(c, K.cat, 124, 40, 8, 8); rect(c, K.cat, 124, 38, 2, 2); rect(c, K.cat, 130, 38, 2, 2);
  px(c, C.outline, 126, 42); px(c, C.outline, 129, 42); rect(c, K.catRed, 126, 45, 4, 1);
  rect(c, K.cat, 132, wave ? 37 : 39, 2, 4);                                 // the waving paw
}
