import { BRIDGE_GAP, CLOTHES_FRONT, FURNITURE_FRONT, LANTERN_POSTS, MARKET_H, MARKET_W, MOTEL_FRONT, PET_SHOP_FRONT, RESTAURANT_FRONT, SALON_FRONT, SHOWROOM_DOOR, SHOWROOM_FRONT, STALLS, UG_HATCH } from "./market";
import { drawPetTankBubbles, paintPetShopFront } from "@/lib/game/art/pet-shop";
import { drawMotelNeon, paintMotelFront } from "@/lib/game/art/motel";
import { paintFurnitureFront } from "@/lib/game/art/furniture-shop";
import { paintDojoFront } from "@/lib/game/art/dojo";
import { awning, glare, M, roof, text, textW, windowGlow } from "./market-kit";
import { drawBikeDisplay, drawCarDisplay, drawPriceTag, drawScooterDisplay, propSprite } from "./props";
import { C, ctx2d, hexToRgb, makeCanvas, px, rect, rng, type Ctx, type PropSprite, type SceneArt, type SceneLight } from "./scene-art";
import type { GameMap, Rect, StallGoods } from "./types";

// Procedural painters for Chợ Lớn (v18.4), a street market at dusk. Browser only (canvas). Props live in props.ts,
// shared helpers in scene-art.ts, the layout in market.ts. Original art in the approved Miền Tây style.

/** Overhead lantern strings: [x1, y1, x2, y2, sag] in world px. */
const LANTERN_STRINGS: ReadonlyArray<readonly [number, number, number, number, number]> = [
  [26, 134, 244, 64, 10],
  [244, 64, 396, 64, 12],
  [396, 64, 600, 134, 10],
  [604, 64, 774, 134, 10],
  [26, 134, 774, 134, 34],
  [244, 64, 240, 250, 14],
  [396, 64, 400, 250, 14],
  [764, 64, 934, 134, 10],     // over the three shops east of the salon
  [924, 64, 1094, 134, 10],
  [1084, 64, 1250, 134, 10],
  [774, 134, 1250, 134, 34],
];
const LANTERN_COLS = [C.red, C.gold, "#e07a2e", "#d4758f", C.red, "#3d6fd1"];

/** Points of warm light on the street: the posts' lanterns, the shop doors and the stalls. */
const LIGHTS: ReadonlyArray<readonly [number, number, number]> = [
  ...LANTERN_POSTS.map((p) => [p.x + 3, p.y - 20, 46] as const),
  [140, 176, 60], [500, 176, 60], [320, 120, 44], [680, 176, 60],
  ...[FURNITURE_FRONT, MOTEL_FRONT, PET_SHOP_FRONT].map((r) => [r.x + r.w / 2, r.y + r.h + 16, 60] as const),
  ...STALLS.map((s) => [s.rect.x + s.rect.w / 2, s.rect.y + s.rect.h + 6, 44] as const),
  [320, 200, 70],
  [920, 268, 56],                                                               // v20.2: the Võ đường's gate
];

function lightAt(x: number, y: number): number {
  let l = 0;
  for (const [lx, ly, r] of LIGHTS) {
    const d = Math.hypot(x - lx, (y - ly) * 1.3);
    if (d < r) l = Math.max(l, 1 - d / r);
  }
  return l;
}

function mix(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
}

// ---------------------------------------------------------------- ground

function paintGround(c: Ctx): void {
  const R = rng(23);
  const img = c.createImageData(MARKET_W, MARKET_H);
  const d = img.data;
  const pal = {
    stone: hexToRgb(M.stone), stoneDark: hexToRgb(M.stoneDark), stoneLight: hexToRgb(M.stoneLight), stoneDeep: hexToRgb(M.stoneDeep),
    pave: hexToRgb(M.pave), paveDark: hexToRgb(M.paveDark), paveLight: hexToRgb(M.paveLight),
    glow: hexToRgb(M.glow), canal: hexToRgb(M.canal), canalLight: hexToRgb(M.canalLight),
  };
  for (let y = 0; y < MARKET_H; y++) for (let x = 0; x < MARKET_W; x++) {
    const r = R();
    let col: [number, number, number];
    if (y >= 392) col = r < 0.06 || (y === 392) ? pal.canalLight : pal.canal;
    else if ((y >= 160 && y < 180) || (y >= 296 && y < 352)) {
      // sidewalk pavers: 16 × 10 slabs with offset joints
      const row = Math.floor((y - (y >= 296 ? 296 : 160)) / 10);
      const jx = (x + (row % 2) * 8) % 16, jy = (y - (y >= 296 ? 296 : 160)) % 10;
      col = jx === 0 || jy === 0 ? pal.paveDark : r < 0.08 ? pal.paveLight : pal.pave;
    } else {
      // cobbles: a staggered grid of rounded stones
      const row = Math.floor(y / 7), ox = (row % 2) * 5;
      const cx = (x + ox) % 10, cy = y % 7;
      const edge = cx === 0 || cy === 0 || (cx === 9 && cy === 6);
      col = edge ? pal.stoneDeep : cy === 1 && cx < 5 ? pal.stoneLight : r < 0.1 ? pal.stoneDark : pal.stone;
    }
    if (y < 392) {
      const l = lightAt(x, y);
      if (l > 0) col = mix(col, pal.glow, l * 0.45);
    }
    const i = (y * MARKET_W + x) * 4;
    d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  // curbs
  rect(c, M.stoneDeep, 0, 180, MARKET_W, 1); rect(c, M.paveLight, 0, 179, MARKET_W, 1);
  rect(c, M.stoneDeep, 0, 295, MARKET_W, 1); rect(c, M.paveLight, 0, 296, MARKET_W, 1);
  // stray leaves and petals on the street
  for (let i = 0; i < 90; i++) {
    const x = Math.floor(R() * MARKET_W), y = 182 + Math.floor(R() * 110);
    px(c, R() < 0.5 ? "#c0392b" : R() < 0.5 ? "#e0b33c" : C.leafDark, x, y);
  }
  // the canal wall along the south, with a drain
  rect(c, C.outline, 0, 383, MARKET_W, 1);
  for (let x = 0; x < MARKET_W; x += 12) {
    rect(c, M.stoneLight, x, 384, 11, 3); rect(c, M.stoneDark, x, 387, 11, 4); rect(c, M.stoneDeep, x + 11, 384, 1, 8);
  }
  rect(c, C.outline, 0, 391, MARKET_W, 1);
  // v20.3: the little plank bridge to Bãi đất trống, in the wall's gap (x 1160–1200)
  rect(c, C.woodDark, BRIDGE_GAP.x, 383, BRIDGE_GAP.w, MARKET_H - 383);
  for (let y = 384; y < MARKET_H; y += 4) rect(c, C.wood, BRIDGE_GAP.x + 3, y, BRIDGE_GAP.w - 6, 3);
  rect(c, C.outline, BRIDGE_GAP.x + 2, 383, 1, MARKET_H - 383); rect(c, C.outline, BRIDGE_GAP.x + BRIDGE_GAP.w - 3, 383, 1, MARKET_H - 383);
  for (const bx of [BRIDGE_GAP.x, BRIDGE_GAP.x + BRIDGE_GAP.w - 3]) { rect(c, C.outline, bx, 376, 3, 8); rect(c, C.woodLight, bx + 1, 377, 1, 6); }
  // a xuồng floating in the canal
  for (let by = 0; by < 5; by++) {
    const inset = Math.abs(2 - by) * 3;
    rect(c, by === 0 || by === 4 ? C.outline : C.woodDark, 380 + inset, 394 + by, 36 - inset * 2, 1);
  }
}

// ---------------------------------------------------------------- buildings

function paintBackRow(c: Ctx): void {
  // dusk sky above the far houses
  for (let y = 0; y < 10; y++) rect(c, y < 4 ? M.sky : y < 7 ? "#5a3e5a" : "#8a4e5a", 0, y, MARKET_W, 1);
  const walls = [M.wallPink, M.wallBlue, M.wallYellow, M.wallCream, M.wallTeal];
  for (let i = 0; i < Math.ceil(MARKET_W / 64); i++) {
    const x = i * 64, h = 8 + (i % 3) * 3;
    const wall = walls[i % walls.length];
    roof(c, x + 1, 10 - (i % 2) * 3, 62, h, i % 2 ? M.tileGrey : M.tile, i % 2 ? M.tileGreyDark : M.tileDark, i % 2 ? M.tileGreyLight : M.tileLight);
    const wy = 10 - (i % 2) * 3 + h + 1;
    rect(c, C.outline, x, wy, 64, 40 - wy);
    rect(c, wall, x + 1, wy, 62, 39 - wy);
    for (let k = 0; k < 3; k++) windowGlow(c, x + 8 + k * 18, wy + 4, 8, Math.max(3, 30 - wy));
  }
  rect(c, C.outline, 0, 39, MARKET_W, 1);
}

function paintAlleyWalls(c: Ctx): void {
  for (const x0 of [0, MARKET_W - 40]) {
    rect(c, C.outline, x0, 40, 40, 121);
    for (let y = 40; y < 160; y += 5) {
      const off = ((y - 40) / 5) % 2 ? 5 : 0;
      rect(c, M.mortar, x0, y, 40, 1);
      for (let x = x0 - off; x < x0 + 40; x += 10) {
        rect(c, M.brick, Math.max(x0, x + 1), y + 1, Math.min(9, x0 + 40 - x - 1), 4);
        px(c, M.brickDark, Math.max(x0, x + 1), y + 4);
      }
    }
    // a potted plant at its foot
    rect(c, C.outline, x0 + 12, 146, 16, 14); rect(c, "#b5603a", x0 + 13, 148, 14, 11); rect(c, "#d27a4a", x0 + 13, 148, 14, 2);
    for (let k = 0; k < 7; k++) { rect(c, C.leafDark, x0 + 14 + k * 2, 138 + (k % 3), 2, 10); px(c, C.leafLight, x0 + 14 + k * 2, 138 + (k % 3)); }
  }
}

/** A display window of the showroom: a lit back wall, a tiled floor, a sill, and a glare across the glass. */
function showWindow(c: Ctx, x: number, y: number, w: number, h: number): void {
  rect(c, C.outline, x - 1, y - 1, w + 2, h + 2);
  rect(c, "#f3e4bf", x, y, w, h - 12); rect(c, M.glowHot, x + 2, y + 1, w - 4, 3);
  for (let i = 0; i < w; i += 4) for (let j = y + h - 12; j < y + h; j += 4) rect(c, ((i + j) / 4) % 2 ? "#d8d4c8" : "#b8b4a8", x + i, j, 4, 4);
  rect(c, "#9a8f7a", x, y + h - 12, w, 1);
}

/** ông Tám's "Xe cộ" showroom (v18.5): a blue shopfront, a bicycle and a scooter in the west window, a car in the east
 *  one, and the open door where ông Tám stands. */
function paintShowroom(c: Ctx): void {
  const r = SHOWROOM_FRONT, d = SHOWROOM_DOOR;
  shopFront(c, r, M.wallBlue, "#8aa0c0", "#1f3f86", C.goldLight, "XE CO");
  const wy = d.y + 2, wh = 42;
  const west = { x: r.x + 5, w: d.x - r.x - 7 }, east = { x: d.x + d.w + 2, w: r.x + r.w - d.x - d.w - 7 };
  // blue-and-white awnings over the windows (the door is left clear so ông Tám shows whole)
  awning(c, west.x - 2, wy - 16, west.w + 4, 12, C.blue, C.white);
  awning(c, east.x - 2, wy - 16, east.w + 4, 12, C.blue, C.white);
  showWindow(c, west.x, wy, west.w, wh);
  showWindow(c, east.x, wy, east.w, wh);
  // the vehicles on display, standing on the tiled floor
  const floor = wy + wh - 2;
  c.save(); c.translate(west.x - 3, floor - 28); drawBikeDisplay(c); drawScooterDisplay(c); c.restore();
  c.save(); c.translate(east.x + 4 - 64, floor - 28); drawCarDisplay(c); c.restore();
  drawPriceTag(c, west.x + 12, wy + 3); drawPriceTag(c, west.x + 42, wy + 3); drawPriceTag(c, east.x + 26, wy + 3);
  glare(c, west.x + 44, wy + 2, 14); glare(c, east.x + 40, wy + 2, 12);
  // the sills
  for (const w of [west, east]) { rect(c, C.outline, w.x - 2, wy + wh + 1, w.w + 4, 3); rect(c, "#c8d4e4", w.x - 1, wy + wh + 1, w.w + 2, 1); }
  // the open door: a lit room, a wooden frame and a tyre leaning inside
  rect(c, C.outline, d.x - 1, d.y - 1, d.w + 2, d.h + 1);
  rect(c, M.interior, d.x, d.y, d.w, d.h);
  rect(c, M.glow, d.x + 2, d.y + 3, d.w - 4, 30); rect(c, M.glowHot, d.x + 4, d.y + 5, 6, 26);
  rect(c, M.interiorDark, d.x, d.y + d.h - 10, d.w, 10);
  rect(c, C.woodDark, d.x - 1, d.y - 1, 1, d.h); rect(c, C.woodDark, d.x + d.w, d.y - 1, 1, d.h);
  rect(c, C.outline, d.x + d.w - 8, d.y + 18, 7, 12); rect(c, "#2b2626", d.x + d.w - 7, d.y + 19, 5, 10); rect(c, "#8e9ba8", d.x + d.w - 5, d.y + 23, 1, 2);
}
function shopFront(c: Ctx, r: Rect, wall: string, wallDark: string, sign: string, signCol: string, signText: string): void {
  const { x, y, w, h } = r;
  roof(c, x - 4, y, w + 8, 26, M.tile, M.tileDark, M.tileLight);
  rect(c, C.outline, x, y + 27, w, h - 27);
  rect(c, wall, x + 1, y + 27, w - 2, h - 28);
  // plaster streaks and a skirting band
  for (let i = x + 6; i < x + w - 4; i += 17) rect(c, wallDark, i, y + 30, 1, 40);
  rect(c, wallDark, x + 1, y + h - 6, w - 2, 5);
  // the signboard
  const tw = textW(signText) + 12, sx = x + Math.floor((w - tw) / 2);
  rect(c, C.outline, sx, y + 30, tw, 13); rect(c, sign, sx + 1, y + 31, tw - 2, 11);
  rect(c, signCol, sx + 2, y + 32, tw - 4, 1); rect(c, signCol, sx + 2, y + 40, tw - 4, 1);
  text(c, signCol, signText, sx + 6, y + 34);
  // upstairs windows
  windowGlow(c, x + 14, y + 32, 16, 12); windowGlow(c, x + w - 30, y + 32, 16, 12);
}

function paintRestaurant(c: Ctx): void {
  const r = RESTAURANT_FRONT;
  shopFront(c, r, M.wallCream, M.wallCreamDark, C.red, C.goldLight, "NHA HANG");
  // the open front: a lit kitchen behind the counter
  const ix = r.x + 56, iy = r.y + 74;
  rect(c, C.outline, ix - 1, iy - 1, 90, r.y + r.h - iy + 1);
  rect(c, M.interior, ix, iy, 88, r.y + r.h - iy);
  rect(c, M.glow, ix + 4, iy + 2, 80, 16); rect(c, M.glowHot, ix + 6, iy + 3, 30, 6);
  // shelves of bowls and a big pot of phở on the stove
  rect(c, C.woodDark, ix + 4, iy + 18, 80, 2);
  for (let k = 0; k < 8; k++) { rect(c, C.white, ix + 8 + k * 9, iy + 14, 6, 3); rect(c, "#3d6fd1", ix + 8 + k * 9, iy + 16, 6, 1); }
  rect(c, C.outline, ix + 60, iy + 22, 20, 14); rect(c, C.silver, ix + 61, iy + 23, 18, 12); rect(c, "#9aa0a8", ix + 61, iy + 31, 18, 4);
  rect(c, "#c9803a", ix + 62, iy + 23, 16, 2);
  rect(c, C.red, ix + 62, iy + 36, 16, 2);
  // a string of chillies and garlic
  for (let k = 0; k < 5; k++) { px(c, C.red, ix + 10 + k * 3, iy + 22 + k); px(c, "#f4efe0", ix + 11 + k * 3, iy + 23 + k); }
  // side windows
  windowGlow(c, r.x + 12, r.y + 80, 30, 24); windowGlow(c, r.x + r.w - 18, r.y + 80, 10, 24);
  // a chalk menu board by the door
  rect(c, C.outline, r.x + 12, r.y + 110, 30, 22); rect(c, "#2a3a32", r.x + 13, r.y + 111, 28, 20);
  for (let k = 0; k < 4; k++) rect(c, k === 0 ? C.goldLight : "#d8e0d8", r.x + 16, r.y + 114 + k * 4, 12 + (k * 5) % 9, 1);
}

function paintClothesShop(c: Ctx): void {
  const r = CLOTHES_FRONT;
  shopFront(c, r, M.wallTeal, M.wallTealDark, M.teal, C.white, "TIEM QUAN AO");
  // the open front behind the counter: shelves of folded clothes
  const ix = r.x + 56, iy = r.y + 74;
  rect(c, C.outline, ix - 1, iy - 1, 90, r.y + r.h - iy + 1);
  rect(c, M.interior, ix, iy, 88, r.y + r.h - iy);
  rect(c, M.glow, ix + 4, iy + 2, 80, 12);
  const folds = ["#c0392b", "#3d6fd1", "#f6c945", "#f4f1ea", "#2e9a94", "#d4758f", "#6a6e7a"];
  for (let s = 0; s < 2; s++) {
    rect(c, C.woodDark, ix + 4, iy + 18 + s * 12, 80, 2);
    for (let k = 0; k < 9; k++) rect(c, folds[(k + s * 3) % folds.length], ix + 6 + k * 9, iy + 13 + s * 12, 7, 5);
  }
  // display windows: a rack of áo dài and a mannequin
  for (const wx of [r.x + 8, r.x + r.w - 52]) {
    rect(c, C.outline, wx - 1, r.y + 75, 46, 52);
    rect(c, M.glow, wx, r.y + 76, 44, 50); rect(c, M.glowHot, wx + 2, r.y + 78, 10, 46);
    rect(c, C.silver, wx + 2, r.y + 80, 40, 1);
  }
  const lx = r.x + 8;
  ["#c0392b", "#e0b33c", "#3d6fd1", "#d4758f"].forEach((col, k) => {
    const hx = lx + 4 + k * 10;
    px(c, C.outline, hx + 3, r.y + 81);
    rect(c, C.outline, hx, r.y + 82, 8, 30); rect(c, col, hx + 1, r.y + 83, 6, 28); rect(c, C.white, hx + 3, r.y + 83, 2, 2);
  });
  const mx = r.x + r.w - 32;
  rect(c, C.outline, mx - 2, r.y + 82, 8, 7); rect(c, "#e8d0b0", mx - 1, r.y + 83, 6, 5);
  rect(c, C.outline, mx - 6, r.y + 89, 16, 22); rect(c, "#2e9a94", mx - 5, r.y + 90, 14, 20); rect(c, C.gold, mx - 5, r.y + 94, 14, 1);
  rect(c, C.outline, mx + 1, r.y + 111, 2, 12); rect(c, C.outline, mx - 4, r.y + 122, 12, 2);
  // a floor mirror by the door
  rect(c, C.outline, r.x + r.w - 12, r.y + 90, 8, 30); rect(c, "#bcd6e0", r.x + r.w - 11, r.y + 91, 6, 28); rect(c, C.white, r.x + r.w - 10, r.y + 93, 1, 10);
}

/** The barber pole's glass: red, white and blue bands spiralling down (phase shifts them for the animation). */
function poleStripes(c: Ctx, x: number, y: number, h: number, phase: number): void {
  const cols = [C.red, C.white, "#3d6fd1", C.white];
  for (let j = 0; j < h; j++) for (let i = 0; i < 4; i++) {
    const band = Math.floor(((j + i + phase) % 16 + 16) % 16 / 4);
    px(c, cols[band], x + i, y + j);
  }
}
/** Where the barber pole's glass is (world px), shared by the painter and the animation. */
const POLE = { x: SALON_FRONT.x + SALON_FRONT.w - 13, y: SALON_FRONT.y + 80, h: 34 };

/** anh Ba's salon (v18.6): a pink shopfront with a "SALON" sign, a window of styled wig heads, a big gilt mirror on the
 *  back wall behind the counter where anh Ba stands, a shelf of bottles, and a barber pole by the door. */
function paintSalon(c: Ctx): void {
  const r = SALON_FRONT;
  shopFront(c, r, M.wallPink, "#c99488", "#7a2e5e", C.goldLight, "SALON");
  // the open front: a lit room with a big mirror on the back wall
  const ix = r.x + 36, iy = r.y + 74;
  rect(c, C.outline, ix - 1, iy - 1, 90, r.y + r.h - iy + 1);
  rect(c, M.interior, ix, iy, 88, r.y + r.h - iy);
  rect(c, M.glow, ix + 1, iy, 86, 1);
  // checkered floor tiles at the back
  for (let i = 0; i < 88; i += 4) rect(c, (i / 4) % 2 ? "#e8e0d0" : "#3a3030", ix + i, r.y + r.h - 6, 4, 6);
  const mx = ix + 12, my = iy + 5, mw = 64, mh = 18;
  rect(c, C.outline, mx - 3, my - 3, mw + 6, mh + 6); rect(c, C.gold, mx - 2, my - 2, mw + 4, mh + 4); rect(c, C.goldLight, mx - 2, my - 2, mw + 4, 1);
  rect(c, "#bcd6e0", mx, my, mw, mh); rect(c, "#9ec0cc", mx, my + mh - 6, mw, 6);
  glare(c, mx + 4, my + 2, 12); glare(c, mx + 44, my + 3, 10);
  // bulbs round the mirror, like a dressing room
  for (let k = 0; k < 6; k++) { px(c, M.glowHot, mx + 4 + k * 11, my - 2); }
  for (let k = 0; k < 3; k++) { px(c, M.glowHot, mx - 2, my + 4 + k * 8); px(c, M.glowHot, mx + mw + 1, my + 4 + k * 8); }
  // a shelf of bottles and a hair dryer under the mirror
  rect(c, C.woodDark, ix + 6, my + mh + 4, 76, 2);
  const bottles = ["#d4758f", "#3d6fd1", "#e0b33c", "#2e9a94", "#f4f1ea", "#c0392b", "#7a4bb0"];
  bottles.forEach((col, k) => {
    const bx = ix + 8 + k * 10;
    rect(c, C.outline, bx, my + mh, 4, 4); rect(c, col, bx + 1, my + mh + 1, 2, 3); px(c, C.outline, bx + 1, my + mh - 1);
  });
  rect(c, C.outline, ix + 76, my + mh - 2, 8, 4); rect(c, "#d4758f", ix + 77, my + mh - 1, 6, 2); rect(c, C.outline, ix + 78, my + mh + 2, 2, 3);
  // the west window: two wig heads on stands with fresh styles
  const wx = r.x + 6, wy = r.y + 75, ww = 26, wh = 50;
  rect(c, C.outline, wx - 1, wy - 1, ww + 2, wh + 2);
  rect(c, M.glow, wx, wy, ww, wh); rect(c, M.glowHot, wx + 1, wy + 1, 4, wh - 2);
  const wig = (x: number, y: number, hair: string, hairDark: string, long: boolean) => {
    rect(c, C.outline, x - 1, y - 1, 10, long ? 14 : 10); rect(c, hair, x, y, 8, long ? 12 : 8); rect(c, hairDark, x, y + (long ? 10 : 6), 8, 2);
    rect(c, "#e8d0b0", x + 2, y + 3, 4, 5); px(c, C.outline, x + 3, y + 5);
    rect(c, C.outline, x + 3, y + (long ? 13 : 9), 2, 10); rect(c, C.outline, x, y + (long ? 22 : 18), 8, 2);
  };
  wig(wx + 3, wy + 6, "#d4758f", "#a8506a", false);
  wig(wx + 14, wy + 16, "#e8c26a", "#b8943a", true);
  rect(c, C.silver, wx + 1, wy + wh - 8, ww - 2, 1);
  glare(c, wx + 12, wy + 4, 10);
  rect(c, C.outline, wx - 2, wy + wh + 1, ww + 4, 3); rect(c, "#f0d0c8", wx - 1, wy + wh + 1, ww + 2, 1);
  // a round scissors plaque on the east wall
  const sx = r.x + r.w - 20, sy = r.y + 50;
  rect(c, C.outline, sx + 1, sy, 12, 14); rect(c, C.outline, sx, sy + 1, 14, 12); rect(c, "#7a2e5e", sx + 1, sy + 1, 12, 12);
  for (let k = 0; k < 6; k++) { px(c, C.silver, sx + 3 + k, sy + 3 + k); px(c, C.silver, sx + 10 - k, sy + 3 + k); }
  px(c, C.goldLight, sx + 3, sy + 10); px(c, C.goldLight, sx + 10, sy + 10);
  // the barber pole: a silver cap and base, the striped glass between
  rect(c, C.outline, POLE.x - 2, POLE.y - 5, 8, POLE.h + 10);
  rect(c, C.silver, POLE.x - 1, POLE.y - 4, 6, 3); px(c, C.white, POLE.x, POLE.y - 4);
  rect(c, C.silver, POLE.x - 1, POLE.y + POLE.h + 1, 6, 3);
  poleStripes(c, POLE.x, POLE.y, POLE.h, 0);
  rect(c, C.outline, POLE.x + 1, POLE.y + POLE.h + 4, 2, 4);
}

/** Each stall's back (awning on its poles, the signboard, the back table with crates) as its own sprite, y-sorted at the
 *  stall's north edge: a character (walking or riding) on the street behind it is hidden by it, while the vendor inside
 *  and the customers in front draw over it. */
function stallSprites(): PropSprite[] {
  return STALLS.map((s) => {
    const { x, y, w } = s.rect;
    const ox = x - 2, oy = y - STALL_AWNING_LIFT - 12;
    const canvas = makeCanvas(w + 4, y + 20 - oy);
    const c = ctx2d(canvas);
    c.translate(-ox, -oy);
    paintStallBack(c, s);
    return { canvas, x: ox, y: oy, sortY: y };
  });
}

function paintStallBack(c: Ctx, s: (typeof STALLS)[number]): void {
  const { x, y, w } = s.rect;
  // the awning on two poles, high enough that the vendor's head and shoulders show between it and the counter
  const [a, b] = STALL_STRIPES[s.goods];
  const ay = y - STALL_AWNING_LIFT;
  rect(c, C.outline, x + 2, ay + 10, 2, y - ay + 6); rect(c, C.woodDark, x + 2, ay + 12, 1, y - ay + 2);
  rect(c, C.outline, x + w - 4, ay + 10, 2, y - ay + 6); rect(c, C.woodDark, x + w - 4, ay + 12, 1, y - ay + 2);
  awning(c, x - 2, ay, w + 4, 14, a, b);
  const sign = STALL_SIGNS[s.goods];
  if (sign) {
    // a signboard standing on the awning's ridge
    const [label, board, ink] = sign, tw = textW(label) + 8, sx = x + Math.floor((w - tw) / 2);
    rect(c, C.outline, sx + 3, ay - 3, 1, 4); rect(c, C.outline, sx + tw - 4, ay - 3, 1, 4);
    rect(c, C.outline, sx, ay - 12, tw, 10); rect(c, board, sx + 1, ay - 11, tw - 2, 8);
    rect(c, ink, sx + 2, ay - 10, tw - 4, 1);
    text(c, ink, label, sx + 4, ay - 8);
  }
  // the back table the vendor stands behind, and crates stacked on it
  rect(c, C.outline, x + 2, y - 2, w - 4, 20); rect(c, C.woodDark, x + 3, y - 1, w - 6, 18);
  for (let k = 0; k < 3; k++) { rect(c, C.outline, x + 8 + k * 24, y + 2, 16, 10); rect(c, C.woodLight, x + 9 + k * 24, y + 3, 14, 8); rect(c, C.wood, x + 9 + k * 24, y + 7, 14, 1); }
}

/** How far above a stall's footprint its awning starts: the vendor (48 px tall, feet 16 px into the stall) shows whole
 *  from the head down to the counter. */
const STALL_AWNING_LIFT = 50;

// ---------------------------------------------------------------- overhead

const AWNINGS: ReadonlyArray<{ r: Rect; a: string; b: string }> = [
  { r: { x: RESTAURANT_FRONT.x + 50, y: RESTAURANT_FRONT.y + 58, w: 100, h: 16 }, a: C.red, b: C.white },
  { r: { x: CLOTHES_FRONT.x + 50, y: CLOTHES_FRONT.y + 58, w: 100, h: 16 }, a: M.teal, b: C.white },
  { r: { x: SALON_FRONT.x + 30, y: SALON_FRONT.y + 46, w: 100, h: 14 }, a: "#d4758f", b: C.white },
];

const STALL_STRIPES: Record<StallGoods, [string, string]> = {
  fruit: ["#e07a2e", "#f4e2b8"], flower: ["#d4758f", "#f4efe0"], lantern: ["#c0392b", "#e0b33c"],
  fish: ["#2e9a94", "#f4efe0"], produce: ["#5caa4a", "#f4e2b8"], umbrella: ["#2f5fa8", "#f4efe0"],
};

/** The signboards over the served stalls (v18.5): the text, the board and the letter colours. */
const STALL_SIGNS: Partial<Record<StallGoods, readonly [string, string, string]>> = {
  fish: ["VUA CA", M.tealDark, C.white], produce: ["NONG SAN", "#3a6e2a", C.goldLight], umbrella: ["O DU", "#1e3f78", C.white],
};

function sagY(x1: number, y1: number, x2: number, y2: number, sag: number, t: number): [number, number] {
  return [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t + Math.sin(Math.PI * t) * sag];
}

// ---------------------------------------------------------------- public

export function paintMarket(map: GameMap): SceneArt {
  const background = makeCanvas(MARKET_W, MARKET_H);
  const g = ctx2d(background);
  paintGround(g);
  paintBackRow(g);
  paintAlleyWalls(g);
  paintRestaurant(g);
  paintShowroom(g);
  paintClothesShop(g);
  paintSalon(g);
  paintFurnitureFront(g);
  paintMotelFront(g);
  paintPetShopFront(g);
  paintDojoFront(g);                                                           // v20.2
  paintManhole(g);                                                             // v20.4
  const props = [...map.props.map(propSprite), ...stallSprites()];

  const drawAnimated = (c: Ctx, t: number, camX: number, camY: number, reducedMotion: boolean) => {
    if (reducedMotion) return;
    // steam rising from the phở pot
    const sx = RESTAURANT_FRONT.x + 126, sy = RESTAURANT_FRONT.y + 94;
    for (let k = 0; k < 3; k++) {
      const ph = ((t / 900 + k / 3) % 1);
      const x = sx + k * 5 + Math.round(Math.sin(t / 300 + k) * 2), y = sy - ph * 16;
      px(c, "#f4f1ea", x - camX, y - camY); px(c, "#d8d4c8", x + 1 - camX, y - 1 - camY);
    }
    // the salon's barber pole turning
    poleStripes(c, POLE.x - camX, POLE.y - camY, POLE.h, Math.floor(t / 120));
    drawPetTankBubbles(c, t, camX, camY);
    drawMotelNeon(c, t, camX, camY);
  };

  const drawOverhead = (c: Ctx, t: number, camX: number, camY: number, reducedMotion: boolean) => {
    for (const w of AWNINGS) awning(c, w.r.x - camX, w.r.y - camY, w.r.w, w.r.h, w.a, w.b);
    // lantern strings with round paper lanterns
    LANTERN_STRINGS.forEach(([x1, y1, x2, y2, sag], si) => {
      const len = Math.hypot(x2 - x1, y2 - y1), steps = Math.ceil(len / 2);
      for (let k = 0; k <= steps; k++) {
        const [x, y] = sagY(x1, y1, x2, y2, sag, k / steps);
        px(c, C.outline, x - camX, y - camY);
      }
      const n = Math.max(2, Math.floor(len / 26));
      for (let k = 1; k < n; k++) {
        const [x, y] = sagY(x1, y1, x2, y2, sag, k / n);
        const col = LANTERN_COLS[(k + si) % LANTERN_COLS.length];
        const lit = reducedMotion || Math.sin(t / 500 + k * 1.3 + si) > -0.7;
        const lx = Math.round(x - camX) - 3, ly = Math.round(y - camY) + 1;
        rect(c, C.outline, lx + 1, ly, 5, 7); rect(c, C.outline, lx, ly + 1, 7, 5);
        rect(c, col, lx + 1, ly + 1, 5, 5);
        if (lit) { px(c, M.glowHot, lx + 2, ly + 2); px(c, M.glow, lx + 2, ly + 3); }
        rect(c, C.gold, lx + 2, ly + 7, 3, 1); px(c, C.gold, lx + 3, ly + 8);
      }
    });
  };

  return { background, props, edge: M.canal, drawAnimated, drawOverhead, lights: MARKET_LIGHTS };
}

/** v18.8 night lights: the street's pools of light (the same points the ground is lit from), the posts' lanterns, and
 *  a small red glow at each paper lantern on the strings overhead. */
const MARKET_LIGHTS: ReadonlyArray<SceneLight> = [
  ...LIGHTS.map(([x, y, r]): SceneLight => ({ x, y, r: Math.round(r * 0.9), hue: "warm" })),
  { x: MOTEL_FRONT.x + 80, y: MOTEL_FRONT.y + 32, r: 22, hue: "lantern" },               // v19.1: the motel's neon board
  { x: MOTEL_FRONT.x + MOTEL_FRONT.w - 6, y: MOTEL_FRONT.y + 98, r: 14, hue: "lantern" }, // and its blade
  ...LANTERN_POSTS.map((p): SceneLight => ({ x: p.x, y: p.y - 40, r: 18, hue: "lantern" })),
  ...LANTERN_STRINGS.flatMap(([x1, y1, x2, y2, sag]) => {
    const n = Math.max(2, Math.floor(Math.hypot(x2 - x1, y2 - y1) / 26));
    const out: SceneLight[] = [];
    for (let k = 1; k < n; k++) {
      const [x, y] = sagY(x1, y1, x2, y2, sag, k / n);
      out.push({ x: Math.round(x), y: Math.round(y) + 4, r: 12, hue: "lantern" });
    }
    return out;
  }),
];
/** v20.4: the rusty manhole in the pavement between the lantern stall and Vựa nông sản (the hầm's hatch). Everyone sees
 *  it; only the unlocked get its prompt. */
function paintManhole(c: Ctx): void {
  const { x, y } = UG_HATCH;
  for (let dy = -6; dy <= 6; dy++) {
    const w = Math.round(Math.sqrt(49 - dy * dy) * 1.5);
    rect(c, C.outline, x - w - 1, y + dy, 2 * w + 2, 1);
  }
  for (let dy = -5; dy <= 5; dy++) {
    const w = Math.round(Math.sqrt(36 - dy * dy) * 1.5);
    rect(c, dy < 0 ? "#6a5a4a" : "#56483a", x - w, y + dy, 2 * w, 1);
  }
  // the cast grid, rust streaks and the two lifting holes
  for (let k = -6; k <= 6; k += 3) rect(c, "#3e342a", x + k, y - 4, 1, 9);
  rect(c, "#3e342a", x - 8, y, 17, 1);
  rect(c, "#9a5a32", x - 5, y + 2, 3, 1); rect(c, "#9a5a32", x + 3, y - 3, 2, 1);
  px(c, "#1a1612", x - 6, y - 1); px(c, "#1a1612", x + 6, y - 1);
}