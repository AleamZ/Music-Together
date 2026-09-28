import { C, px, rect, type Ctx } from "./scene-art";

// Shared painting kit for Chợ Lớn's shop fronts (market-art.ts and the standalone shops in lib/game/art/*): the market
// palette, tiled roofs, lit windows, striped awnings, window glare and a tiny sign font. Browser only (canvas).

/** Market-only colours (the shared ones are in scene-art.ts). */
export const M = {
  stone: "#8a7868", stoneDark: "#76655a", stoneLight: "#a08a74", stoneDeep: "#5e5048",
  pave: "#b09a80", paveDark: "#96806a", paveLight: "#c4ae90",
  glow: "#f6c36a", glowHot: "#ffe6a0",
  wallCream: "#e8d6b0", wallCreamDark: "#c9b48a", wallTeal: "#cfe0d4", wallTealDark: "#a6c2b0",
  wallPink: "#e6b8a8", wallBlue: "#a8bcd8", wallYellow: "#ecd07a",
  tile: "#b0503a", tileDark: "#8a3a2a", tileLight: "#cc6a4a",
  tileGrey: "#6a6e7a", tileGreyDark: "#50545e", tileGreyLight: "#868b98",
  interior: "#5a3a2a", interiorDark: "#3e2820",
  teal: "#2e9a94", tealDark: "#1f6e6a",
  brick: "#9a5a44", brickDark: "#7a4434", mortar: "#b89a80",
  canal: "#2f5e7a", canalLight: "#4a7e9a",
  shutter: "#4f8a6a", shutterDark: "#3a6a50",
  sky: "#3b3050",
};

/** A tiny 3×5 pixel font for the shop signs (no diacritics, so the words stay legible at this size). */
const FONT: Record<string, string[]> = {
  A: [".#.", "#.#", "###", "#.#", "#.#"], C: ["###", "#..", "#..", "#..", "###"], D: ["##.", "#.#", "#.#", "#.#", "##."],E: ["###", "#..", "##.", "#..", "###"],
  G: ["###", "#..", "#.#", "#.#", "###"], H: ["#.#", "#.#", "###", "#.#", "#.#"], I: ["###", ".#.", ".#.", ".#.", "###"],
  L: ["#..", "#..", "#..", "#..", "###"], M: ["#.#", "###", "###", "#.#", "#.#"], N: ["##.", "#.#", "#.#", "#.#", "#.#"],
  O: ["###", "#.#", "#.#", "#.#", "###"], Q: ["###", "#.#", "#.#", "###", "..#"], R: ["##.", "#.#", "##.", "#.#", "#.#"],
  T: ["###", ".#.", ".#.", ".#.", ".#."], U: ["#.#", "#.#", "#.#", "#.#", "###"], " ": ["...", "...", "...", "...", "..."],
  S: ["###", "#..", "###", "..#", "###"], V: ["#.#", "#.#", "#.#", "#.#", ".#."], X: ["#.#", "#.#", ".#.", "#.#", "#.#"],
};

export function text(c: Ctx, col: string, s: string, x: number, y: number): void {
  for (let k = 0; k < s.length; k++) {
    const g = FONT[s.charAt(k)];
    if (!g) continue;
    g.forEach((row, j) => { for (let i = 0; i < 3; i++) if (row.charAt(i) === "#") px(c, col, x + k * 4 + i, y + j); });
  }
}
export const textW = (s: string) => s.length * 4 - 1;

/** A pitched roof seen from the front: rows of tiles, lighter at the top of each row, a dark eave. */
export function roof(c: Ctx, x: number, y: number, w: number, h: number, base: string, dark: string, light: string): void {
  rect(c, C.outline, x - 1, y - 1, w + 2, h + 2);
  for (let j = 0; j < h; j++) {
    const row = j % 5;
    rect(c, row === 0 ? light : row === 4 ? dark : base, x, y + j, w, 1);
  }
  for (let j = 0; j < h; j += 5) for (let i = ((j / 5) % 2) * 4; i < w; i += 8) rect(c, dark, x + i, y + j + 1, 1, 3);
  rect(c, dark, x, y + h - 1, w, 1);
  rect(c, C.outline, x - 1, y + h, w + 2, 1);
}

/** A glowing window with a frame and a cross bar. */
export function windowGlow(c: Ctx, x: number, y: number, w: number, h: number): void {
  rect(c, C.outline, x - 1, y - 1, w + 2, h + 2);
  rect(c, M.glow, x, y, w, h);
  rect(c, M.glowHot, x + 1, y + 1, Math.max(1, Math.floor(w / 3)), h - 2);
  rect(c, C.woodDark, x + Math.floor(w / 2), y, 1, h); rect(c, C.woodDark, x, y + Math.floor(h / 2), w, 1);
}

/** A glare streak across a pane of glass. */
export function glare(c: Ctx, x: number, y: number, h: number): void {
  for (let k = 0; k < h; k++) { px(c, "#fffaf0", x + k, y + h - k); if (k % 3) px(c, "#fffaf0", x + k + 4, y + h - k); }
}

/** A striped awning with a scalloped hem. */
export function awning(c: Ctx, x: number, y: number, w: number, h: number, a: string, b: string): void {
  rect(c, C.outline, x, y, w, h + 1);
  for (let i = 0; i < w - 2; i += 6) {
    const col = (i / 6) % 2 === 0 ? a : b;
    rect(c, col, x + 1 + i, y + 1, Math.min(6, w - 2 - i), h - 3);
    rect(c, col, x + 2 + i, y + h - 2, Math.min(4, w - 3 - i), 2);
  }
}

/** The open front of a shop (the room behind the counter, where the keeper stands): a dark lit room, `iw` wide, from
 *  `iy` down to the building's base `by`. */
export function openFront(c: Ctx, ix: number, iy: number, iw: number, by: number): void {
  rect(c, C.outline, ix - 1, iy - 1, iw + 2, by - iy + 1);
  rect(c, M.interior, ix, iy, iw, by - iy);
  rect(c, M.glow, ix + 1, iy, iw - 2, 1);
}
