import { FURNITURE_FRONT } from "@/lib/game/maps/market";
import { awning, glare, M, openFront, roof, text, textW, windowGlow } from "@/lib/game/maps/market-kit";
import { C, px, rect, type Ctx } from "@/lib/game/maps/scene-art";

// v19.2: cô Năm's "Nội thất cô Năm" — since the market redo a building on Chợ Lớn's north row (teak front, the carved
// "NOI THAT" board, display windows with a sofa and a wardrobe, her counter in the open front), painted into the
// market's background. Original art.

const K = {
  wall: "#c89a64", wallDark: "#9a6a3a", wallLight: "#dcb07a",
  awn: "#3f8a5a", awnLight: "#f4ecd0", board: "#3a2418",
  glass: "#f6d890", sofa: "#b04a4a", sofaDark: "#8a3434", lamp: "#ffe08a", counter: "#8b5a33", counterLight: "#a8743f",
};

// ---------------------------------------------------------------- the shop building (market redo)

/** A little chair icon for the board, 7×8. */
function chairIcon(c: Ctx, x: number, y: number, col: string): void {
  rect(c, col, x, y, 2, 8); rect(c, col, x, y + 4, 7, 2); rect(c, col, x + 5, y + 4, 2, 4);
}

/** cô Năm's "Nội thất cô Năm" as a building on the north row: a teak-planked front under a tiled roof, a carved wooden
 *  "NOI THAT" board, a display window with a red sofa and a floor lamp in the west, a wardrobe, a potted palm and a
 *  pendant lamp in the east, and the open front under a green awning where she stands behind the counter. World
 *  coordinates. */
export function paintFurnitureFront(c: Ctx): void {
  const { x, y, w, h } = FURNITURE_FRONT, b = y + h;
  roof(c, x - 4, y, w + 8, 22, M.tile, M.tileDark, M.tileLight);
  rect(c, C.outline, x, y + 23, w, h - 23);
  rect(c, K.wall, x + 1, y + 23, w - 2, h - 24);
  rect(c, K.wallLight, x + 1, y + 23, w - 2, 2);
  for (let i = x + 7; i < x + w - 2; i += 8) rect(c, K.wallDark, i, y + 25, 1, h - 31);   // teak planks
  rect(c, K.wallDark, x + 1, b - 6, w - 2, 5);
  // the carved board
  const label = "NOI THAT", tw = textW(label) + 32, sx = x + Math.floor((w - tw) / 2), sy = y + 27;
  rect(c, C.outline, sx, sy, tw, 15); rect(c, K.wallLight, sx + 1, sy + 1, tw - 2, 13); rect(c, K.board, sx + 3, sy + 3, tw - 6, 9);
  rect(c, C.outline, sx + 6, sy - 3, 1, 3); rect(c, C.outline, sx + tw - 7, sy - 3, 1, 3);
  chairIcon(c, sx + 6, sy + 3, K.wallLight); chairIcon(c, sx + tw - 13, sy + 3, K.wallLight);
  text(c, C.goldLight, label, sx + 16, sy + 5);
  windowGlow(c, x + 14, y + 29, 16, 12); windowGlow(c, x + w - 30, y + 29, 16, 12);
  awning(c, x + 34, y + 46, 92, 14, K.awn, K.awnLight);
  // the open front: a rug hung on the back wall, stacked chairs, a shelf of vases
  openFront(c, x + 40, y + 62, 80, b);
  rect(c, C.outline, x + 46, y + 66, 20, 24); rect(c, "#3d6fd1", x + 47, y + 67, 18, 22); rect(c, "#e8c26a", x + 49, y + 69, 14, 18); rect(c, C.red, x + 52, y + 72, 8, 12);
  rect(c, C.woodDark, x + 94, y + 74, 22, 2);
  for (const [i, col] of ["#3d6fd1", "#e8c26a", "#2e9a94"].entries()) { rect(c, C.outline, x + 96 + i * 7, y + 67, 5, 7); rect(c, col, x + 97 + i * 7, y + 68, 3, 6); }
  for (let k = 0; k < 3; k++) { rect(c, C.outline, x + 98, y + 84 + k * 6, 14, 3); rect(c, K.counterLight, x + 99, y + 85 + k * 6, 12, 1); }
  rect(c, K.counter, x + 99, y + 102, 2, 14); rect(c, K.counter, x + 109, y + 102, 2, 14);
  for (let i = 0; i < 80; i += 8) rect(c, (i / 8) % 2 ? "#9a6a3a" : "#8a5a30", x + 40 + i, b - 6, 8, 6);
  // the west window: a red sofa and a floor lamp
  const wx = x + 5, wy = y + 64, ww = 30, wh = 48;
  rect(c, C.outline, wx - 1, wy - 1, ww + 2, wh + 2);
  rect(c, "#f3e4bf", wx, wy, ww, wh - 10); rect(c, M.glowHot, wx + 1, wy + 1, ww - 2, 2);
  for (let i = 0; i < ww; i += 6) rect(c, (i / 6) % 2 ? "#b88a5a" : "#a07448", wx + i, wy + wh - 10, 6, 10);
  const fy = wy + wh - 10;
  rect(c, C.outline, wx + 1, fy - 14, 22, 13); rect(c, K.sofaDark, wx + 2, fy - 13, 20, 11);
  rect(c, K.sofa, wx + 4, fy - 12, 16, 5); rect(c, K.sofa, wx + 2, fy - 8, 20, 4); rect(c, "#d06060", wx + 4, fy - 12, 16, 1);
  rect(c, C.outline, wx + 3, fy - 2, 2, 2); rect(c, C.outline, wx + 19, fy - 2, 2, 2);
  rect(c, C.outline, wx + 25, fy - 30, 1, 30); rect(c, C.outline, wx + 23, fy - 1, 5, 1);
  rect(c, C.outline, wx + 21, fy - 36, 9, 7); rect(c, K.lamp, wx + 22, fy - 35, 7, 5); rect(c, "#fff6c8", wx + 23, fy - 35, 2, 5);
  rect(c, C.outline, wx + 3, wy + 4, 10, 9); rect(c, C.paper, wx + 4, wy + 5, 8, 7); rect(c, C.red, wx + 5, wy + 8, 6, 1);   // price tag
  glare(c, wx + 12, wy + 2, 10);
  rect(c, C.outline, wx - 2, wy + wh + 1, ww + 4, 3); rect(c, K.wallLight, wx - 1, wy + wh + 1, ww + 2, 1);
  // the east window: a wardrobe, a potted palm and a pendant lamp
  const ex = x + w - 35;
  rect(c, C.outline, ex - 1, wy - 1, ww + 2, wh + 2);
  rect(c, "#f3e4bf", ex, wy, ww, wh - 10); rect(c, M.glowHot, ex + 1, wy + 1, ww - 2, 2);
  for (let i = 0; i < ww; i += 6) rect(c, (i / 6) % 2 ? "#b88a5a" : "#a07448", ex + i, wy + wh - 10, 6, 10);
  rect(c, C.outline, ex + 2, fy - 30, 16, 30); rect(c, K.counter, ex + 3, fy - 29, 14, 28); rect(c, K.counterLight, ex + 3, fy - 29, 14, 2);
  rect(c, C.woodDark, ex + 10, fy - 27, 1, 26); px(c, C.goldLight, ex + 8, fy - 15); px(c, C.goldLight, ex + 12, fy - 15);
  rect(c, C.outline, ex + 20, fy - 7, 8, 7); rect(c, C.redDark, ex + 21, fy - 6, 6, 6);
  for (let k = 0; k < 5; k++) { rect(c, C.leaf, ex + 19 + k * 2, fy - 16 + Math.abs(2 - k) * 2, 2, 10 - Math.abs(2 - k) * 2); px(c, C.leafLight, ex + 19 + k * 2, fy - 16 + Math.abs(2 - k) * 2); }
  rect(c, C.outline, ex + 24, wy, 1, 8); rect(c, C.outline, ex + 20, wy + 8, 9, 4); rect(c, K.lamp, ex + 21, wy + 9, 7, 2);
  glare(c, ex + 14, wy + 2, 8);
  rect(c, C.outline, ex - 2, wy + wh + 1, ww + 4, 3); rect(c, K.wallLight, ex - 1, wy + wh + 1, ww + 2, 1);
}

