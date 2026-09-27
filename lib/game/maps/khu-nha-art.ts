import { APT_BLOCK, APT_LOBBY, ESTATE_OFFICE, KHU_H, KHU_LAMPS, KHU_W, LOTS, TOWNHOUSES } from "./khu-nha";
import { propSprite } from "./props";
import { C, ctx2d, makeCanvas, px, rect, rng, type Ctx, type SceneArt, type SceneLight } from "./scene-art";
import type { GameMap, Rect } from "./types";

// Procedural painter for Khu nhà (v19.2): a quiet residential street at dusk — the cream Chung cư Phú Mỹ block with its
// balconies and lit windows, two old townhouses, the Sàn bất động sản office (open since v19.4), eight fenced lots waiting for v19.3,
// a little park and the canal. Browser only (canvas). Original art in the approved Miền Tây style.

const K = {
  pave: "#b4a48c", paveDark: "#9c8c74", paveLight: "#c8b89e",
  road: "#7a7068", roadLine: "#d8d0b8",
  cream: "#eadcb8", creamDark: "#cbb88e", creamLight: "#f6ecd0",
  tile: "#b0503a", tileDark: "#8a3a2a", tileLight: "#cc6a4a",
  glass: "#f6d890", glassDim: "#8aa0b8", frame: "#6e4a28",
  rail: "#4a4a54", teal: "#2e9a94", tealDark: "#1f6e6a",
  fence: "#a8743f", fenceDark: "#6e4424", soil: "#9a7a4e", soilDark: "#86683f",
  canal: "#2f5e7a", canalLight: "#4a7e9a",
  blue: "#3d6fd1", grey: "#8a8e98", greyDark: "#62666e",
};

/** 3×5 letters for the signs (no diacritics at this size). */
const FONT: Record<string, string[]> = {
  A: [".#.", "#.#", "###", "#.#", "#.#"], C: ["###", "#..", "#..", "#..", "###"], H: ["#.#", "#.#", "###", "#.#", "#.#"],
  N: ["##.", "#.#", "#.#", "#.#", "#.#"], G: ["###", "#..", "#.#", "#.#", "###"], U: ["#.#", "#.#", "#.#", "#.#", "###"],
  P: ["##.", "#.#", "##.", "#..", "#.."], M: ["#.#", "###", "###", "#.#", "#.#"], Y: ["#.#", "#.#", ".#.", ".#.", ".#."],
  S: ["###", "#..", "###", "..#", "###"], D: ["##.", "#.#", "#.#", "#.#", "##."], B: ["##.", "#.#", "##.", "#.#", "##."],
  O: ["###", "#.#", "#.#", "#.#", "###"], T: ["###", ".#.", ".#.", ".#.", ".#."], L: ["#..", "#..", "#..", "#..", "###"], I: ["###", ".#.", ".#.", ".#.", "###"],
  "1": [".#.", "##.", ".#.", ".#.", "###"], "2": ["##.", "..#", ".#.", "#..", "###"], "3": ["##.", "..#", ".#.", "..#", "##."],
  "4": ["#.#", "#.#", "###", "..#", "..#"], "5": ["###", "#..", "##.", "..#", "##."], "6": [".##", "#..", "###", "#.#", "###"],
  "7": ["###", "..#", ".#.", ".#.", ".#."], "8": ["###", "#.#", "###", "#.#", "###"], " ": ["...", "...", "...", "...", "..."],
};

export function drawText(c: Ctx, col: string, s: string, x: number, y: number): void {
  [...s].forEach((ch, k) => {
    const g = FONT[ch];
    if (!g) return;
    g.forEach((row, j) => { for (let i = 0; i < 3; i++) if (row.charAt(i) === "#") px(c, col, x + k * 4 + i, y + j); });
  });
}

function paintGround(c: Ctx): void {
  const r = rng(1902);
  // pavement everywhere, a street band through the middle, grass in the park
  rect(c, K.pave, 0, 0, KHU_W, KHU_H);
  for (let y = 0; y < KHU_H; y += 8) for (let x = (y / 8) % 2 ? 4 : 0; x < KHU_W; x += 8) {
    if (r() < 0.3) rect(c, K.paveDark, x, y, 7, 1);
    if (r() < 0.12) px(c, K.paveLight, x + 3, y + 4);
  }
  rect(c, K.road, 0, 176, KHU_W, 48);
  for (let x = 8; x < KHU_W; x += 32) rect(c, K.roadLine, x, 199, 16, 2);
  rect(c, K.paveDark, 0, 174, KHU_W, 2); rect(c, K.paveDark, 0, 224, KHU_W, 2);
  // the park between the lots
  rect(c, C.outline, 259, 239, 282, 138);
  rect(c, C.grass, 260, 240, 280, 136);
  for (let k = 0; k < 420; k++) {
    const x = 262 + Math.floor(r() * 276), y = 242 + Math.floor(r() * 132);
    px(c, r() < 0.5 ? C.grassLight : C.grassDark, x, y);
  }
  // a stone path through the park and two benches
  for (let y = 244; y < 376; y += 10) rect(c, K.paveLight, 394, y, 12, 7);
  for (const bx of [330, 446]) {
    rect(c, C.outline, bx - 1, 327, 26, 8); rect(c, C.woodLight, bx, 328, 24, 3); rect(c, C.wood, bx, 331, 24, 3);
    rect(c, C.outline, bx + 2, 335, 2, 3); rect(c, C.outline, bx + 20, 335, 2, 3);
  }
  // flowers along the park's edge
  for (let x = 266; x < 534; x += 9) px(c, [C.red, C.gold, "#d4758f"][Math.floor(r() * 3)], x, 244 + Math.floor(r() * 3));
  // the canal along the south
  rect(c, K.canal, 0, 386, KHU_W, 14);
  rect(c, C.outline, 0, 384, KHU_W, 2);
  for (let x = 0; x < KHU_W; x += 12) rect(c, K.canalLight, x + Math.floor(r() * 6), 390 + Math.floor(r() * 6), 5, 1);
}

function paintBackRow(c: Ctx): void {
  const r = rng(1903);
  let x = 0;
  while (x < KHU_W) {
    const w = 40 + Math.floor(r() * 30);
    const wall = ["#e6b8a8", "#a8bcd8", "#ecd07a", "#cfe0d4"][Math.floor(r() * 4)];
    rect(c, C.outline, x, 6, w, 34); rect(c, wall, x + 1, 8, w - 2, 32);
    rect(c, K.tileDark, x, 2, w, 6); rect(c, K.tile, x + 1, 3, w - 2, 3);
    for (let wx = x + 6; wx < x + w - 10; wx += 16) { rect(c, C.outline, wx, 16, 9, 10); rect(c, r() < 0.6 ? K.glass : K.glassDim, wx + 1, 17, 7, 8); }
    x += w;
  }
}

function paintTownhouses(c: Ctx): void {
  const { x, y, w, h } = TOWNHOUSES;
  for (const [hx, wall, dark] of [[x, "#e8d6b0", "#c9b48a"], [x + w / 2, "#cfe0d4", "#a6c2b0"]] as const) {
    const hw = w / 2;
    rect(c, C.outline, hx, y - 20, hw, h + 20);
    rect(c, wall, hx + 1, y - 18, hw - 2, h + 17);
    rect(c, dark, hx + 1, y + 34, hw - 2, 2);
    // roof and windows
    rect(c, K.tileDark, hx - 2, y - 26, hw + 4, 8); rect(c, K.tile, hx - 1, y - 25, hw + 2, 5);
    for (const wx of [hx + 12, hx + hw - 30]) {
      rect(c, C.outline, wx - 1, y - 8, 20, 18); rect(c, K.frame, wx, y - 7, 18, 16); rect(c, K.glass, wx + 1, y - 6, 7, 14); rect(c, K.glass, wx + 10, y - 6, 7, 14);
    }
    // the ground floor: shuttered front and potted plants
    rect(c, C.outline, hx + 20, y + 44, hw - 40, h - 44); rect(c, "#4f8a6a", hx + 21, y + 45, hw - 42, h - 45);
    for (let sy = y + 48; sy < y + h; sy += 4) rect(c, "#3a6a50", hx + 21, sy, hw - 42, 1);
    for (const px0 of [hx + 6, hx + hw - 16]) { rect(c, C.outline, px0, y + h - 12, 10, 12); rect(c, C.redDark, px0 + 1, y + h - 8, 8, 8); rect(c, C.leaf, px0 + 1, y + h - 13, 8, 6); }
  }
}

/** The block: three floors of four flats, each a window pair and a balcony; the lobby with its glass door; the name. */
function paintBlock(c: Ctx): void {
  const { x, y, w, h } = APT_BLOCK;
  const top = y - 24;
  rect(c, C.outline, x - 1, top, w + 2, h + 24 + 1);
  rect(c, K.cream, x, top + 1, w, h + 23);
  rect(c, K.creamLight, x, top + 1, w, 3);
  // the flat roof with a water tank and the sign
  rect(c, K.creamDark, x - 4, top - 4, w + 8, 6);
  rect(c, C.outline, x + w - 40, top - 14, 24, 12); rect(c, K.grey, x + w - 39, top - 13, 22, 10); rect(c, K.greyDark, x + w - 39, top - 6, 22, 2);
  rect(c, C.outline, x + 72, top + 7, 112, 12); rect(c, K.teal, x + 73, top + 8, 110, 10);
  drawText(c, "#f6ecd0", "CHUNG CU PHU MY", x + 98, top + 10);
  // three floors × four flats (top to bottom: floor 3, 2, 1)
  const floorH = 42;
  for (let f = 0; f < 3; f++) {
    const fy = top + 24 + f * floorH;
    rect(c, K.creamDark, x, fy + floorH - 2, w, 2);
    for (let u = 0; u < 4; u++) {
      const ux = x + 10 + u * 62;
      if (f === 2 && (u === 1 || u === 2)) continue;          // the lobby takes the middle of the ground floor
      rect(c, C.outline, ux - 1, fy + 3, 42, 20);
      rect(c, K.frame, ux, fy + 4, 40, 18);
      const lit = (u + f) % 3 !== 0;
      rect(c, lit ? K.glass : K.glassDim, ux + 2, fy + 6, 17, 14); rect(c, lit ? K.glass : K.glassDim, ux + 21, fy + 6, 17, 14);
      if (lit) { px(c, "#fff4d0", ux + 3, fy + 7); px(c, "#fff4d0", ux + 22, fy + 7); }
      // balcony rail and a pot
      rect(c, K.rail, ux - 2, fy + 22, 44, 1);
      for (let i = ux - 2; i < ux + 42; i += 4) rect(c, K.rail, i, fy + 22, 1, 7);
      rect(c, K.rail, ux - 2, fy + 28, 44, 1);
      if ((u * 3 + f) % 2 === 0) { rect(c, C.redDark, ux + 30, fy + 24, 6, 4); rect(c, C.leafLight, ux + 29, fy + 20, 8, 4); }
    }
  }
  // the lobby: an awning, the glass door, the name plate
  const d = APT_LOBBY;
  rect(c, C.outline, d.x - 25, d.y - 12, d.w + 50, 8);
  for (let i = 0; i < d.w + 48; i++) rect(c, i % 8 < 4 ? K.teal : "#f6ecd0", d.x - 24 + i, d.y - 11, 1, 6);
  rect(c, C.outline, d.x - 1, d.y - 1, d.w + 2, d.h + 1);
  rect(c, K.tealDark, d.x, d.y, d.w, d.h);
  rect(c, "#9fd0d8", d.x + 3, d.y + 3, d.w / 2 - 4, d.h - 3); rect(c, "#9fd0d8", d.x + d.w / 2 + 1, d.y + 3, d.w / 2 - 4, d.h - 3);
  rect(c, "#d6f0f2", d.x + 4, d.y + 4, 2, d.h - 8);
  rect(c, C.gold, d.x + d.w / 2 - 3, d.y + 20, 2, 5); rect(c, C.gold, d.x + d.w / 2 + 1, d.y + 20, 2, 5);
  // the guard's booth window beside the door
  rect(c, C.outline, d.x + d.w + 6, d.y + 4, 30, 22); rect(c, K.glass, d.x + d.w + 7, d.y + 5, 28, 20);
  // steps
  rect(c, K.creamDark, d.x - 6, d.y + d.h, d.w + 12, 3);
}

function paintOffice(c: Ctx): void {
  const { x, y, w, h } = ESTATE_OFFICE;
  rect(c, C.outline, x - 1, y - 24, w + 2, h + 24);
  rect(c, "#a8bcd8", x, y - 23, w, h + 22);
  rect(c, K.tileDark, x - 4, y - 30, w + 8, 8); rect(c, K.tile, x - 3, y - 29, w + 6, 5);
  rect(c, C.outline, x + 14, y - 16, 100, 12); rect(c, C.redDark, x + 15, y - 15, 98, 10);
  drawText(c, C.goldLight, "SAN BDS", x + 50, y - 13);
  // big shop windows with the listings, a rolled-down shutter
  for (const wx of [x + 8, x + 84]) {
    rect(c, C.outline, wx - 1, y + 10, 38, 44); rect(c, K.glassDim, wx, y + 11, 36, 42);
    for (let k = 0; k < 4; k++) { rect(c, C.paper, wx + 3 + (k % 2) * 17, y + 14 + Math.floor(k / 2) * 18, 14, 14); rect(c, C.red, wx + 5 + (k % 2) * 17, y + 16 + Math.floor(k / 2) * 18, 10, 2); }
  }
  // v19.4: open — a double glass door with brass handles, the broker's desk lamp inside, a "MO CUA" board and a doormat
  rect(c, C.outline, x + 47, y + 40, 34, h - 40); rect(c, K.tealDark, x + 48, y + 41, 32, h - 41);
  rect(c, "#9fd0d8", x + 50, y + 43, 13, h - 45); rect(c, "#9fd0d8", x + 65, y + 43, 13, h - 45);
  rect(c, "#d6f0f2", x + 51, y + 44, 2, h - 50); rect(c, "#d6f0f2", x + 66, y + 44, 2, h - 50);
  rect(c, K.creamDark, x + 52, y + 64, 24, 3); rect(c, C.goldLight, x + 60, y + 60, 3, 3);   // the desk and its lamp, seen through
  rect(c, C.gold, x + 61, y + 70, 2, 6); rect(c, C.gold, x + 65, y + 70, 2, 6);
  rect(c, C.outline, x + 44, y + 28, 40, 11); rect(c, C.paper, x + 45, y + 29, 38, 9);
  drawText(c, C.redDark, "MO CUA", x + 52, y + 30);
  rect(c, C.red, x + 44, y + h, 40, 3);
}

function paintLot(c: Ctx, r: Rect, n: number): void {
  rect(c, K.soil, r.x, r.y, r.w, r.h);
  for (let yy = r.y + 3; yy < r.y + r.h; yy += 6) rect(c, K.soilDark, r.x + 2, yy, r.w - 4, 1);
  for (let k = 0; k < 6; k++) px(c, C.grassLight, r.x + 6 + ((k * 37 + n * 11) % (r.w - 12)), r.y + 6 + ((k * 23 + n * 7) % (r.h - 12)));
  // the fence: posts and two rails
  rect(c, K.fenceDark, r.x, r.y, r.w, 1); rect(c, K.fenceDark, r.x, r.y + r.h - 1, r.w, 1);
  rect(c, K.fenceDark, r.x, r.y, 1, r.h); rect(c, K.fenceDark, r.x + r.w - 1, r.y, 1, r.h);
  for (let xx = r.x; xx < r.x + r.w; xx += 8) { rect(c, K.fence, xx, r.y - 3, 2, 5); rect(c, K.fence, xx, r.y + r.h - 3, 2, 5); }
  for (let yy = r.y; yy < r.y + r.h; yy += 8) { rect(c, K.fence, r.x - 1, yy, 2, 3); rect(c, K.fence, r.x + r.w - 1, yy, 2, 3); }
  // the lot's board
  rect(c, C.outline, r.x + r.w / 2 - 15, r.y + r.h / 2 - 7, 30, 13); rect(c, C.paper, r.x + r.w / 2 - 14, r.y + r.h / 2 - 6, 28, 11);
  drawText(c, C.outline, `LO ${n}`, r.x + r.w / 2 - 10, r.y + r.h / 2 - 4);
  rect(c, C.outline, r.x + r.w / 2 - 1, r.y + r.h / 2 + 6, 2, 6);
}

// ---------------------------------------------------------------- public

export function paintKhuNha(map: GameMap): SceneArt {
  const background = makeCanvas(KHU_W, KHU_H);
  const g = ctx2d(background);
  paintGround(g);
  paintBackRow(g);
  paintTownhouses(g);
  paintBlock(g);
  paintOffice(g);
  LOTS.forEach((r, i) => paintLot(g, r, i + 1));
  const props = map.props.map(propSprite);
  const drawAnimated = (c: Ctx, t: number, camX: number, camY: number, reducedMotion: boolean) => {
    if (reducedMotion) return;
    // ripples drifting on the canal
    for (let k = 0; k < 6; k++) {
      const x = ((t / 40 + k * 140) % (KHU_W + 20)) - 10;
      rect(c, K.canalLight, x - camX, 392 + (k % 3) * 2 - camY, 6, 1);
    }
  };
  const drawOverhead = () => {};
  return { background, props, edge: K.canal, drawAnimated, drawOverhead, lights: KHU_LIGHTS, windows: KHU_WINDOWS };
}

/** v18.8 night lights: the street lamps, the lobby and the office's sign. */
const KHU_LIGHTS: ReadonlyArray<SceneLight> = [
  ...KHU_LAMPS.map((p): SceneLight => ({ x: p.x, y: p.y - 36, r: 30, hue: "warm" })),
  { x: APT_LOBBY.x + APT_LOBBY.w / 2, y: APT_LOBBY.y + 20, r: 34, hue: "cool" },
  { x: ESTATE_OFFICE.x + 64, y: ESTATE_OFFICE.y - 10, r: 18, hue: "lantern" },
];

/** The block's lit windows glow at night. */
const KHU_WINDOWS: ReadonlyArray<{ x: number; y: number; w: number; h: number }> = (() => {
  const out: Array<{ x: number; y: number; w: number; h: number }> = [];
  const top = APT_BLOCK.y - 24;
  for (let f = 0; f < 3; f++) for (let u = 0; u < 4; u++) {
    if ((f === 2 && (u === 1 || u === 2)) || (u + f) % 3 === 0) continue;
    out.push({ x: APT_BLOCK.x + 12 + u * 62, y: top + 30 + f * 42, w: 36, h: 14 });
  }
  return out;
})();
