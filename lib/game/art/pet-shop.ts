import { PET_SHOP_FRONT } from "@/lib/game/maps/market";
import { awning, glare, M, openFront, roof, text, textW, windowGlow } from "@/lib/game/maps/market-kit";
import { C, px, rect, type Ctx } from "@/lib/game/maps/scene-art";

// v18.12: cô Mười's "Tiệm thú cưng", since the market redo a building on Chợ Lớn's north row (the paw-print "THU
// CUNG" board, a window of cages, an aquarium, cô Mười behind the counter in the open front), painted into the
// market's background. Original art.

const K = {
  green: "#3f8a5a", greenDark: "#2e6a44", cream: "#f4ead0", creamDark: "#d8c8a0",
  wood: "#9a6a3a", woodDark: "#6e4a28", woodLight: "#b8844c",
  bars: "#c8ccd4", barsDark: "#8a8e98", water: "#8fcbe8", waterDark: "#5aa0c8", fish: "#f07a2e",
  paw: "#6b2424", hay: "#e8cf7a",
};

function cage(c: Ctx, x: number, y: number, i: number): void {
  rect(c, K.barsDark, x, y, 10, 8);
  rect(c, K.hay, x + 1, y + 6, 8, 1);
  for (let k = 1; k < 10; k += 2) rect(c, K.bars, x + k, y + 1, 1, 6);
  // a little face peeking out
  const fur = ["#e0a860", "#f4f1ec", "#9a6232", "#3a3438"][i % 4];
  rect(c, fur, x + 3, y + 3, 4, 3); px(c, "#1a1210", x + 4, y + 4); px(c, "#1a1210", x + 6, y + 4);
}

// ---------------------------------------------------------------- the shop building (market redo)

const PT = { tile: "#4f8a5a", tileDark: "#3a6a44", tileLight: "#6aa874", tank: "#2f7fa8", weed: "#3f8a5a", sand: "#e8d49a" };

/** A paw print, 8×7. */
function paw(c: Ctx, x: number, y: number, col: string): void {
  rect(c, col, x + 2, y + 4, 4, 3); px(c, col, x + 1, y + 4);
  px(c, col, x + 1, y + 2); px(c, col, x + 3, y + 1); px(c, col, x + 5, y + 1); px(c, col, x + 7, y + 2);
  px(c, col, x + 6, y + 4);
}

/** Where the aquarium's water is in the east window (world px), shared with the bubbles. */
export const PET_TANK = { x: PET_SHOP_FRONT.x + 129, y: PET_SHOP_FRONT.y + 80, w: 22, h: 18 } as const;

/** cô Mười's "Tiệm thú cưng" as a building on the north row: a green-tiled roof, a cream front with the paw-print "THU
 *  CUNG" board, a cat on the upstairs sill, a window of cages (hamster, bunny, kitten, puppy) in the west, an aquarium
 *  in the east, and the open front under a green awning where she stands behind the counter. World coordinates. */
export function paintPetShopFront(c: Ctx): void {
  const { x, y, w, h } = PET_SHOP_FRONT, b = y + h;
  roof(c, x - 4, y, w + 8, 22, PT.tile, PT.tileDark, PT.tileLight);
  rect(c, C.outline, x, y + 23, w, h - 23);
  rect(c, K.cream, x + 1, y + 23, w - 2, h - 24);
  for (let i = x + 8; i < x + w - 4; i += 19) rect(c, K.creamDark, i, y + 26, 1, 28);
  rect(c, K.creamDark, x + 1, b - 6, w - 2, 5);
  // the board: paws either side of "THU CUNG"
  const label = "THU CUNG", tw = textW(label) + 32, sx = x + Math.floor((w - tw) / 2), sy = y + 27;
  rect(c, C.outline, sx, sy, tw, 15); rect(c, K.greenDark, sx + 1, sy + 1, tw - 2, 13);
  rect(c, K.green, sx + 2, sy + 2, tw - 4, 1); rect(c, K.green, sx + 2, sy + 12, tw - 4, 1);
  paw(c, sx + 4, sy + 4, K.cream); paw(c, sx + tw - 12, sy + 4, K.cream);
  text(c, C.goldLight, label, sx + 16, sy + 5);
  // upstairs windows, a cat asleep on the east sill
  windowGlow(c, x + 14, y + 29, 16, 12); windowGlow(c, x + w - 30, y + 29, 16, 12);
  const kx = x + w - 27, ky = y + 38;
  rect(c, C.outline, kx - 1, ky - 1, 12, 6); rect(c, "#e0a860", kx, ky, 10, 4); rect(c, "#c08040", kx + 2, ky + 1, 1, 3); rect(c, "#c08040", kx + 5, ky + 1, 1, 3);
  rect(c, C.outline, kx + 8, ky - 3, 5, 5); rect(c, "#e0a860", kx + 9, ky - 2, 3, 3); px(c, C.outline, kx + 9, ky - 4); px(c, C.outline, kx + 12, ky - 4);
  // the awning over the open front
  awning(c, x + 34, y + 46, 92, 14, K.green, K.cream);
  // the open front: shelves of cages on the back wall, sacks of food, a tiled floor
  openFront(c, x + 40, y + 62, 80, b);
  rect(c, K.woodDark, x + 42, y + 76, 76, 2);
  for (const [i, cx] of [x + 44, x + 56, x + 98, x + 108].entries()) cage(c, cx, y + 67, i);
  for (const sx2 of [x + 44, x + 106]) {
    rect(c, C.outline, sx2, y + 84, 10, 12); rect(c, K.creamDark, sx2 + 1, y + 85, 8, 10); paw(c, sx2 + 1, y + 87, K.paw);
  }
  for (let i = 0; i < 80; i += 4) rect(c, (i / 4) % 2 ? "#e8e0d0" : "#bfb6a4", x + 40 + i, b - 6, 4, 6);
  // the west window: two shelves of cages, and a puppy on the floor
  const wx = x + 6, wy = y + 66, ww = 28, wh = 46;
  rect(c, C.outline, wx - 1, wy - 1, ww + 2, wh + 2);
  rect(c, M.glow, wx, wy, ww, wh); rect(c, M.glowHot, wx + 1, wy + 1, 3, wh - 2);
  for (let s = 0; s < 2; s++) {
    rect(c, K.woodDark, wx + 1, wy + 13 + s * 14, ww - 2, 2);
    cage(c, wx + 3, wy + 4 + s * 14, s * 2); cage(c, wx + 15, wy + 4 + s * 14, s * 2 + 1);
  }
  const dx = wx + 8, dy = wy + wh - 10;                                            // the puppy
  rect(c, C.outline, dx - 1, dy - 1, 14, 9); rect(c, "#f4f1ec", dx, dy, 12, 7); rect(c, "#9a6232", dx + 8, dy, 4, 3);
  rect(c, C.outline, dx + 9, dy + 1, 1, 1); rect(c, C.outline, dx - 2, dy + 1, 2, 1);
  glare(c, wx + 14, wy + 4, 10);
  rect(c, C.outline, wx - 2, wy + wh + 1, ww + 4, 3); rect(c, K.cream, wx - 1, wy + wh + 1, ww + 2, 1);
  // the east window: an aquarium on a wooden stand
  const ex = x + 126, ey = wy;
  rect(c, C.outline, ex - 1, ey - 1, ww + 2, wh + 2);
  rect(c, M.glow, ex, ey, ww, wh); rect(c, M.glowHot, ex + 1, ey + 1, 3, wh - 2);
  const t = PET_TANK;
  rect(c, C.outline, t.x - 1, t.y - 2, t.w + 2, t.h + 3); rect(c, "#8e9ba8", t.x - 1, t.y - 2, t.w + 2, 1);
  rect(c, PT.tank, t.x, t.y, t.w, t.h); rect(c, K.water, t.x, t.y, t.w, 2);
  rect(c, PT.sand, t.x, t.y + t.h - 3, t.w, 3);
  for (const [gx, gh] of [[3, 9], [5, 6], [17, 11], [19, 7]] as const) rect(c, PT.weed, t.x + gx, t.y + t.h - 3 - gh, 1, gh);
  for (const [fx, fy, col] of [[7, 6, K.fish], [13, 11, "#f4d03a"], [9, 13, "#e05a8a"]] as const) {
    rect(c, col, t.x + fx, t.y + fy, 3, 2); px(c, col, t.x + fx + 3, t.y + fy - 1); px(c, col, t.x + fx + 3, t.y + fy + 2);
  }
  rect(c, C.outline, t.x - 1, t.y + t.h + 1, t.w + 2, ey + wh - t.y - t.h - 1); rect(c, K.wood, t.x, t.y + t.h + 2, t.w, ey + wh - t.y - t.h - 3);
  rect(c, K.woodDark, t.x + t.w / 2, t.y + t.h + 2, 1, ey + wh - t.y - t.h - 3);
  glare(c, ex + 16, ey + 3, 8);
  rect(c, C.outline, ex - 2, ey + wh + 1, ww + 4, 3); rect(c, K.cream, ex - 1, ey + wh + 1, ww + 2, 1);
}

/** Bubbles rising in the aquarium (animated layer). */
export function drawPetTankBubbles(c: Ctx, t: number, camX: number, camY: number): void {
  const k = PET_TANK;
  for (let i = 0; i < 3; i++) {
    const ph = (t / 1600 + i / 3) % 1;
    px(c, "#dff4ff", k.x + 6 + i * 5 + (Math.floor(ph * 6) % 2) - camX, k.y + k.h - 4 - Math.floor(ph * (k.h - 5)) - camY);
  }
}

