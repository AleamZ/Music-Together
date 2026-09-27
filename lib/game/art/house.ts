import { CELL_COUNT, LOT_COLS, LOT_ROWS, LOT_TILE, type Roof } from "@/lib/game/housing/lot";
import { C, px, rect, rng, type Ctx } from "@/lib/game/maps/scene-art";
import { floorTile, wallColors } from "./furniture";

// v19.3: the houses players build on Khu nhà's lots — the exterior seen from the street (a roof over the built cells in
// one of four styles, the front walls with their windows and doors), drawn at EXT_CELL px per cell over the lot, and the
// walkable interior's shell (the yard, the walls, the windows, the doors and the floors) at 16 px per cell.
// Browser only (canvas). Original art.

/** Street pixels per design cell: 20 × 14 cells → 80 × 56, inside a lot of 88 × 56. */
export const EXT_CELL = 4;
export const EXT_W = LOT_COLS * EXT_CELL;
export const EXT_H = LOT_ROWS * EXT_CELL;
export const INT_W = LOT_COLS * LOT_TILE;
export const INT_H = LOT_ROWS * LOT_TILE;

const ROOF_COLORS: Record<Roof, { main: string; dark: string; light: string }> = {
  ngoi: { main: "#b0503a", dark: "#8a3a2a", light: "#cc6a4a" },
  tole: { main: "#4f7fa8", dark: "#3a5f80", light: "#7aa4c8" },
  la: { main: "#b8964a", dark: "#8a6e34", light: "#d4b464" },
  bang: { main: "#b8b4aa", dark: "#8e8a82", light: "#d4d0c6" },
};
const WALL_FACE = "#eadcb8", WALL_FACE_DARK = "#cbb88e", GLASS = "#f6d890", GLASS_DIM = "#8aa0b8", DOOR = "#6e4424";

const built = (g: string, r: number, c: number): boolean => r >= 0 && r < LOT_ROWS && c >= 0 && c < LOT_COLS && g.charAt(r * LOT_COLS + c) !== ".";
const cellAt = (g: string, r: number, c: number): string => (r >= 0 && r < LOT_ROWS && c >= 0 && c < LOT_COLS ? g.charAt(r * LOT_COLS + c) : "");

/** The house seen from the street, into (ox, oy) at EXT_CELL px per cell: the roof over every built cell, the outline,
 *  the ridge, and on the cells whose south side is open, the front wall with its windows and doors. */
export function paintHouseExterior(c: Ctx, g: string, roof: Roof, ox: number, oy: number): void {
  if (g.length !== CELL_COUNT) return;
  const R = ROOF_COLORS[roof] ?? ROOF_COLORS.ngoi;
  const k = EXT_CELL;
  const noise = rng(1931);
  let minR = LOT_ROWS, maxR = -1;
  for (let r = 0; r < LOT_ROWS; r++) for (let q = 0; q < LOT_COLS; q++) {
    if (!built(g, r, q)) continue;
    minR = Math.min(minR, r); maxR = Math.max(maxR, r);
    const x = ox + q * k, y = oy + r * k;
    const front = !built(g, r + 1, q);
    // the roof cell
    rect(c, R.main, x, y, k, k);
    if (roof === "ngoi") { rect(c, R.dark, x, y + k - 1, k, 1); if ((q + r) % 2 === 0) px(c, R.light, x + 1, y + 1); }
    else if (roof === "tole") { rect(c, R.dark, x + (q % 2 ? 0 : 2), y, 1, k); px(c, R.light, x + 1, y); }
    else if (roof === "la") { for (let i = 0; i < 3; i++) px(c, noise() < 0.5 ? R.dark : R.light, x + Math.floor(noise() * k), y + Math.floor(noise() * k)); }
    else { if ((q + r) % 3 === 0) px(c, R.dark, x + 2, y + 2); }
    // the front face under the eave: wall, a window's glass or a door
    if (front) {
      const ch = cellAt(g, r, q);
      rect(c, ch === "d" ? DOOR : WALL_FACE, x, y + k - 2, k, 2);
      if (ch === "n") rect(c, (q + r) % 3 ? GLASS : GLASS_DIM, x + 1, y + k - 2, k - 2, 2);
      else if (ch !== "d") px(c, WALL_FACE_DARK, x, y + k - 1);
    }
    // the outline where the house meets the yard, and its shadow on the yard
    if (!built(g, r - 1, q)) rect(c, C.outline, x, y, k, 1);
    if (front) {
      rect(c, C.outline, x, y + k, k, 1);
      c.save(); c.globalAlpha = 0.25; rect(c, "#000", x + 1, y + k + 1, k, 1); c.restore();
    }
    if (!built(g, r, q + 1)) { c.save(); c.globalAlpha = 0.25; rect(c, "#000", x + k, y + 1, 1, k); c.restore(); }
    if (!built(g, r, q - 1)) rect(c, C.outline, x, y, 1, k);
    if (!built(g, r, q + 1)) rect(c, C.outline, x + k - 1, y, 1, k);
    // side windows and doors show as a mark on the outline
    const ch = cellAt(g, r, q);
    if ((ch === "n" || ch === "d") && (!built(g, r, q - 1) || !built(g, r, q + 1))) {
      const sx = !built(g, r, q - 1) ? x : x + k - 1;
      rect(c, ch === "d" ? DOOR : GLASS, sx, y + 1, 1, k - 2);
    }
  }
  if (maxR < 0) return;
  // the ridge along the middle of a pitched roof; a flat roof gets a water tank
  const mid = Math.floor((minR + maxR) / 2);
  if (roof !== "bang") {
    for (let q = 0; q < LOT_COLS; q++) {
      if (built(g, mid, q) && built(g, mid - 1, q) && built(g, mid + 1, q)) rect(c, R.light, ox + q * k, oy + mid * k + 1, k, 1);
    }
  } else {
    for (let q = 0; q < LOT_COLS; q++) {
      if (built(g, mid, q) && built(g, mid, q + 1) && built(g, mid - 1, q) && built(g, mid - 1, q + 1)) {
        const x = ox + q * k + 1, y = oy + (mid - 1) * k + 1;
        rect(c, C.outline, x, y, 6, 5); rect(c, "#8a8e98", x + 1, y + 1, 4, 3);
        break;
      }
    }
  }
}

/** A built lot's garden inside its fence (it covers the "LÔ n" board of the empty lot). */
export function paintLotYard(c: Ctx, x: number, y: number, w: number, h: number, seed: number): void {
  const r = rng(1940 + seed);
  rect(c, C.grass, x, y, w, h);
  for (let k = 0; k < (w * h) / 10; k++) px(c, r() < 0.5 ? C.grassLight : C.grassDark, x + Math.floor(r() * w), y + Math.floor(r() * h));
  for (let k = 0; k < 6; k++) px(c, [C.red, C.gold, "#d4758f"][k % 3], x + 2 + Math.floor(r() * (w - 4)), y + 2 + Math.floor(r() * (h - 4)));
}

/** An owned lot with no house yet: a small red "sold" flag in its corner. */
export function paintSoldFlag(c: Ctx, x: number, y: number): void {
  rect(c, C.outline, x, y, 1, 10);
  rect(c, C.outline, x + 1, y, 6, 5); rect(c, C.red, x + 1, y + 1, 5, 3); px(c, C.goldLight, x + 3, y + 2);
}

/** The interior's shell: the yard (grass, the lot's fence), the floors (the house's floor surface), the walls (the
 *  house's wallpaper as a block), the windows and the doors. */
export function paintHouseInterior(c: Ctx, g: string, wall: string | null, floor: string | null): void {
  const T = LOT_TILE;
  const W = wallColors(wall);
  const noise = rng(1932);
  for (let r = 0; r < LOT_ROWS; r++) for (let q = 0; q < LOT_COLS; q++) {
    const ch = g.charAt(r * LOT_COLS + q);
    const x = q * T, y = r * T;
    if (ch === "." || ch === "") {
      rect(c, (q + r) % 2 ? C.grass : C.grassLight, x, y, T, T);
      for (let i = 0; i < 3; i++) px(c, noise() < 0.5 ? C.grassDark : C.grassTip, x + Math.floor(noise() * T), y + Math.floor(noise() * T));
      if (noise() < 0.06) { px(c, C.red, x + 5, y + 6); px(c, C.gold, x + 9, y + 11); }
      continue;
    }
    if (ch === "f" || ch === "d") floorTile(c, floor, q, r);
    if (ch === "w" || ch === "n") {
      // a wall block: its top in the wallpaper colour, a darker lower face where the south side is open
      rect(c, W.base, x, y, T, T);
      rect(c, W.line, x, y + T - 4, T, 4);
      if (W.alt) px(c, W.alt, x + 4, y + 4);
      rect(c, "#6e4a28", x, y + T - 1, T, 1);
      if (ch === "n") {
        rect(c, C.outline, x + 2, y + 3, T - 4, T - 7); rect(c, "#6e4a28", x + 3, y + 4, T - 6, T - 9);
        rect(c, "#9fd0d8", x + 4, y + 5, T - 8, T - 11); rect(c, "#d6f0f2", x + 5, y + 5, 1, T - 11);
      }
    }
    if (ch === "d") {
      // an open door: the frame on the wall sides, the leaf swung against one of them, a threshold
      const left = cellAt(g, r, q - 1);
      const vertical = left !== "f" && left !== ".";                         // walls left and right: one walks up/down
      if (vertical) {
        rect(c, "#6e4a28", x, y, 2, T); rect(c, "#6e4a28", x + T - 2, y, 2, T);
        rect(c, DOOR, x + 2, y + 1, 3, T - 2); px(c, C.gold, x + 4, y + 8);
        rect(c, "#a8743f", x + 2, y + T - 2, T - 4, 2);
      } else {
        rect(c, "#6e4a28", x, y, T, 2); rect(c, "#6e4a28", x, y + T - 2, T, 2);
        rect(c, DOOR, x + 1, y + 2, T - 2, 3); px(c, C.gold, x + 8, y + 4);
        rect(c, "#a8743f", x + T - 2, y + 2, 2, T - 4);
      }
    }
  }
  // the lot's fence around the edge
  c.save(); c.globalAlpha = 0.9;
  for (let x = 0; x < INT_W; x += 8) { rect(c, "#a8743f", x, 0, 2, 4); rect(c, "#a8743f", x, INT_H - 4, 2, 4); }
  for (let y = 0; y < INT_H; y += 8) { rect(c, "#a8743f", 0, y, 3, 2); rect(c, "#a8743f", INT_W - 3, y, 3, 2); }
  rect(c, "#6e4424", 0, 1, INT_W, 1); rect(c, "#6e4424", 0, INT_H - 2, INT_W, 1);
  c.restore();
}
