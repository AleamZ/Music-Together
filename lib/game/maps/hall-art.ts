import { HALL_H, HALL_W, LIGHT_STRINGS, hallShoreY } from "./hall";
import type { GameMap, PropPlacement } from "./types";

// Procedural painters for the hall ("quán cà phê võng ven sông"). Browser only (canvas).
// Everything is drawn at 1 world px = 1 canvas px with a seeded RNG, so every client sees the same scene.
// Original art in the approved Miền Tây style — no copied images.

export interface PropSprite { canvas: HTMLCanvasElement; x: number; y: number; sortY: number }

export interface HallArt {
  /** Static 640×400 ground, river, bamboo, stage and counter. */
  background: HTMLCanvasElement;
  /** Depth-sorted sprites (palms, tables, hammock…): world top-left + sort y (= the prop's base). */
  props: PropSprite[];
  /** Per-frame ground animation (speaker pulse, water sparkles), drawn in world coordinates minus the camera. */
  drawAnimated(ctx: CanvasRenderingContext2D, t: number, camX: number, camY: number, reducedMotion: boolean): void;
  /** String lights, drawn above the characters. */
  drawOverhead(ctx: CanvasRenderingContext2D, t: number, camX: number, camY: number, reducedMotion: boolean): void;
}

/** Sprite canvas size and the anchor (the prop's base point) inside it. Pure. */
export interface PropFrame { w: number; h: number; ox: number; oy: number }

type Ctx = CanvasRenderingContext2D;

const C = {
  outline: "#3a2418",
  grass: "#6aa23c", grassLight: "#7fb548", grassDark: "#5a8f32", grassDeep: "#3f6e23", grassTip: "#8cc452",
  dirt: "#c89a5e", dirtDark: "#b58a52", dirtLight: "#d8b078",
  sand: "#dcc08a", bank: "#b89560", mud: "#8a6a3f",
  water: "#3d86a8", waterDeep: "#2f6e8f", waterLight: "#4a93b4", sparkle: "#a6d6e8", sparkle2: "#6fb2cf",
  wood: "#8b5a33", woodDark: "#6e4424", woodLight: "#a8743f", woodDeep: "#5a381e", woodPale: "#c8905c",
  leaf: "#3d8a3a", leafLight: "#5caa4a", leafHi: "#86c95c", leafDark: "#2f6e2f", leafDeep: "#24592a",
  trunk: "#8a6d4a", trunkLight: "#b08d62", trunkDark: "#6e5438", trunkRing: "#5e4630",
  bamboo: "#8bb84e", bambooDark: "#6a9a38", bambooNode: "#4f7a2a",
  red: "#c0392b", redDark: "#8e2a1f", gold: "#e0b33c", goldLight: "#ffe08a",
  speaker: "#1e1616", speakerFace: "#2b2020", cone: "#4a4040", coneCenter: "#1a1414",
  paper: "#f4efe0", white: "#f4f1ea",
};

/** Deterministic LCG in [0, 1) — the same seed paints the same scene on every client. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function propFrame(p: PropPlacement): PropFrame {
  switch (p.kind) {
    case "palm": return { w: 100, h: p.h + 40, ox: 50, oy: p.h + 38 };
    case "hammock": return { w: p.x2 - p.x + 8, h: 34, ox: 4, oy: 32 };
    case "post": return { w: 6, h: 32, ox: 3, oy: 32 };
    case "mixer": return { w: 44, h: 22, ox: 22, oy: 22 };
    case "table": return { w: 32, h: 30, ox: 16, oy: 30 };
    case "board": return { w: 28, h: 34, ox: 14, oy: 34 };
    case "sign": return { w: 18, h: 26, ox: 9, oy: 26 };
    case "banana": return { w: 40, h: 36, ox: 20, oy: 35 };
    case "lightpole": return { w: 6, h: 42, ox: 3, oy: 42 };
  }
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  return cv;
}

function ctx2d(cv: HTMLCanvasElement): Ctx {
  const c = cv.getContext("2d");
  if (!c) throw new Error("canvas-2d-unavailable");
  return c;
}

function rect(c: Ctx, col: string, x: number, y: number, w: number, h: number): void {
  c.fillStyle = col;
  c.fillRect(Math.round(x), Math.round(y), w, h);
}

function px(c: Ctx, col: string, x: number, y: number): void {
  c.fillStyle = col;
  c.fillRect(Math.round(x), Math.round(y), 1, 1);
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ---------------------------------------------------------------- ground

function inYard(x: number, y: number): boolean {
  const dx = (x - 330) / 245, dy = (y - 238) / 98;
  const n = Math.sin(x * 0.11) * 0.05 + Math.sin(y * 0.17 + x * 0.05) * 0.05;
  return dx * dx + dy * dy < 1 + n;
}

function onPath(x: number, y: number): boolean {
  if (x < 470) return false;
  const mid = 300 + Math.sin(x * 0.05) * 4;
  return Math.abs(y - mid) < 15 + Math.sin(x * 0.3) * 1.5;
}

function paintGround(c: Ctx): void {
  const R = rng(11);
  const img = c.createImageData(HALL_W, HALL_H);
  const d = img.data;
  const pal = {
    grass: hexToRgb(C.grass), grassLight: hexToRgb(C.grassLight), grassDark: hexToRgb(C.grassDark),
    dirt: hexToRgb(C.dirt), dirtDark: hexToRgb(C.dirtDark), dirtLight: hexToRgb(C.dirtLight),
    water: hexToRgb(C.water), waterDeep: hexToRgb(C.waterDeep), waterLight: hexToRgb(C.waterLight),
    sand: hexToRgb(C.sand), bank: hexToRgb(C.bank), mud: hexToRgb(C.mud),
  };
  for (let y = 0; y < HALL_H; y++) {
    for (let x = 0; x < HALL_W; x++) {
      const r = R();
      const sy = Math.round(hallShoreY(x));
      let col: [number, number, number];
      if (y >= sy) col = r < 0.04 ? pal.waterLight : y > sy + 24 ? pal.waterDeep : pal.water;
      else if (y === sy - 1) col = pal.mud;
      else if (y === sy - 2) col = pal.bank;
      else if (y === sy - 3) col = pal.sand;
      else if (inYard(x, y) || onPath(x, y)) col = r < 0.12 ? pal.dirtDark : r < 0.2 ? pal.dirtLight : pal.dirt;
      else col = r < 0.1 ? pal.grassLight : r < 0.17 ? pal.grassDark : pal.grass;
      const i = (y * HALL_W + x) * 4;
      d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
  // grass tufts + flowers
  for (let i = 0; i < 520; i++) {
    const x = Math.floor(R() * HALL_W), y = Math.floor(R() * HALL_H);
    if (inYard(x, y) || onPath(x, y) || y > hallShoreY(x) - 6) continue;
    px(c, C.grassDeep, x, y); px(c, C.grassDeep, x - 1, y - 1); px(c, C.grassTip, x + 1, y - 1); px(c, C.grassDark, x, y - 1);
    if (R() < 0.16) px(c, R() < 0.5 ? "#f6c945" : "#f29bb5", x + 2, y - 2);
  }
  // pebbles in the yard
  for (let i = 0; i < 90; i++) {
    const x = Math.floor(R() * HALL_W), y = Math.floor(R() * HALL_H);
    if (!inYard(x, y)) continue;
    px(c, "#a07a4a", x, y); px(c, "#e2c290", x, y - 1);
  }
}

function paintRiverDetails(c: Ctx): void {
  const R = rng(23);
  // water hyacinth (lục bình) clumps
  const clumps: Array<[number, number]> = [[40, 372], [150, 385], [262, 360], [330, 390], [420, 370], [585, 382], [622, 358]];
  for (const [cx, cy] of clumps) {
    for (let k = 0; k < 22; k++) {
      const a = R() * Math.PI * 2, dist = R() * 6;
      px(c, R() < 0.5 ? C.leaf : C.leafLight, cx + Math.cos(a) * dist * 1.5, cy + Math.sin(a) * dist * 0.7);
    }
    px(c, "#b58ad8", cx, cy - 3); px(c, "#d6b3ef", cx + 1, cy - 3); px(c, "#b58ad8", cx + 1, cy - 4); px(c, "#d6b3ef", cx - 2, cy - 2);
  }
  // dock (walkable, x 500–532)
  rect(c, C.outline, 499, 318, 34, 82);
  for (let y = 319; y < 400; y += 3) { rect(c, C.woodLight, 500, y, 32, 2); rect(c, C.wood, 500, y + 2, 32, 1); }
  rect(c, C.woodDeep, 500, 318, 2, 82); rect(c, C.woodDeep, 530, 318, 2, 82);
  // moored boat (xuồng ba lá)
  for (let by = 0; by < 8; by++) {
    const inset = Math.abs(3.5 - by) * 3;
    rect(c, by === 0 || by === 7 ? C.outline : C.woodDark, 540 + inset, 352 + by, 40 - inset * 2, 1);
  }
  rect(c, C.woodLight, 550, 355, 20, 2);
  rect(c, C.outline, 560, 342, 1, 11); rect(c, C.wood, 561, 342, 4, 2);
}

// ---------------------------------------------------------------- scenery painted into the background

function paintBamboo(c: Ctx): void {
  const R = rng(5);
  rect(c, "#4f8a30", 0, 0, 72, 150);
  // ragged leafy edge instead of a hard rectangle
  for (let y = 0; y < 158; y++) {
    const edge = 72 + Math.round(3 * Math.sin(y * 0.35) + 2 * Math.sin(y * 0.9));
    for (let x = 66; x < edge; x++) px(c, x > edge - 2 ? C.leafDark : "#4f8a30", x, y);
  }
  for (let x = 0; x < 78; x++) {
    const edge = 150 + Math.round(3 * Math.sin(x * 0.4) + 2 * Math.sin(x * 1.1));
    for (let y = 146; y < edge; y++) px(c, y > edge - 2 ? C.leafDark : "#4f8a30", x, y);
  }
  for (let y = 0; y < 150; y++) for (let x = 0; x < 72; x++) if (R() < 0.08) px(c, "#44792a", x, y);
  for (let i = 0; i < 18; i++) {
    const x = 2 + i * 4 + Math.floor(R() * 2), top = Math.floor(R() * 20), bot = 142 + Math.floor(R() * 10);
    for (let y = top; y < bot; y++) {
      px(c, C.bamboo, x, y); px(c, C.bambooDark, x + 1, y);
      if ((y - top) % 9 === 0) { px(c, C.bambooNode, x, y); px(c, C.bambooNode, x + 1, y); }
    }
    for (let l = 0; l < 10; l++) {
      const ly = top + Math.floor(R() * (bot - top - 10)), dir = R() < 0.5 ? -1 : 1;
      for (let k = 0; k < 6; k++) px(c, k < 2 ? C.leafLight : C.leaf, x + dir * (k + 1), ly + Math.floor(k / 2));
    }
  }
}

function drawNote(c: Ctx, x: number, y: number, col: string): void {
  ["..##.", "..#.#", "..#..", "..#..", ".##..", "###..", ".#..."].forEach((r, j) => {
    for (let i = 0; i < r.length; i++) if (r.charAt(i) === "#") px(c, col, x + i, y + j);
  });
}

function paintStage(c: Ctx): void {
  // poles + banner
  rect(c, C.woodDeep, 243, 4, 3, 92); rect(c, C.woodDeep, 393, 4, 3, 92);
  rect(c, C.redDark, 246, 8, 148, 48); rect(c, C.red, 248, 10, 144, 44);
  rect(c, C.gold, 248, 50, 144, 2);
  for (let x = 250; x < 392; x += 8) { rect(c, C.redDark, x, 56, 4, 2); px(c, C.redDark, x + 1, 58); }
  drawNote(c, 262, 18, C.goldLight); drawNote(c, 272, 26, C.gold); drawNote(c, 364, 26, C.gold); drawNote(c, 374, 18, C.goldLight);
  // platform
  rect(c, C.outline, 231, 95, 178, 46);
  for (let x = 232; x < 408; x += 6) { rect(c, C.woodLight, x, 96, 5, 34); rect(c, C.wood, x + 5, 96, 1, 34); }
  rect(c, C.woodDark, 232, 130, 176, 10);
  for (let x = 236; x < 408; x += 12) rect(c, C.woodDeep, x, 131, 1, 9);
  rect(c, C.outline, 231, 140, 178, 1);
  // speaker cabinets (the cones are animated in drawAnimated)
  for (const sx of [250, 374]) {
    rect(c, C.speaker, sx, 58, 16, 38);
    rect(c, C.speakerFace, sx + 1, 59, 14, 36);
    rect(c, C.gold, sx + 1, 92, 14, 1);
  }
}

function paintCounter(c: Ctx): void {
  // striped awning
  rect(c, C.outline, 464, 34, 142, 16);
  for (let x = 465; x < 605; x += 6) rect(c, ((x - 465) / 6) % 2 === 0 ? C.red : C.white, x, 35, 6, 13);
  for (let x = 466; x < 604; x += 6) rect(c, ((x - 466) / 6) % 2 === 0 ? C.red : C.white, x, 48, 4, 2);
  // back wall + shelves with jars
  rect(c, C.woodDark, 466, 50, 138, 28);
  rect(c, C.woodDeep, 466, 60, 138, 1); rect(c, C.woodDeep, 466, 70, 138, 1);
  const R = rng(31);
  const jar = ["#e0b33c", "#d9534f", "#5fae6e", "#f4f1ea", "#3d86a8", "#f29bb5"];
  for (let x = 470; x < 600; x += 7) {
    rect(c, jar[Math.floor(R() * jar.length)], x, 55, 4, 5); px(c, C.outline, x + 1, 54);
    rect(c, jar[Math.floor(R() * jar.length)], x + 2, 65, 3, 5);
  }
  // counter top + front
  rect(c, C.outline, 464, 77, 142, 30);
  rect(c, C.woodPale, 465, 78, 140, 7);
  rect(c, "#e0b27a", 465, 78, 140, 1);
  for (let x = 465; x < 605; x += 8) { rect(c, C.woodLight, x, 85, 7, 20); rect(c, C.wood, x + 7, 85, 1, 20); }
  rect(c, C.woodDark, 465, 104, 140, 2);
  // glasses of cà phê sữa đá on the counter
  for (const gx of [482, 520, 566]) { rect(c, "#f4f1ea", gx, 74, 4, 5); rect(c, "#7a4a2a", gx + 1, 76, 2, 3); }
}

// ---------------------------------------------------------------- props (drawn into their own canvas, anchor = frame ox/oy)

function drawPalm(c: Ctx, h: number, lean: number, seed: number): void {
  const R = rng(seed), bx = 50, by = h + 38;
  let tx = bx, ty = by;
  for (let t = 0; t <= h; t++) {
    const f = t / h, x = Math.round(bx + lean * 16 * f * f), y = by - t;
    px(c, C.outline, x - 2, y); px(c, C.trunkLight, x - 1, y); px(c, C.trunk, x, y); px(c, C.trunkDark, x + 1, y); px(c, C.outline, x + 2, y);
    if (t % 3 === 0) { px(c, C.trunkRing, x - 1, y); px(c, C.trunkRing, x, y); px(c, C.trunkRing, x + 1, y); }
    tx = x; ty = y;
  }
  const frond = (deg: number, len: number, back: boolean) => {
    const a = (deg * Math.PI) / 180, ca = Math.cos(a), sx = ca >= 0 ? 1 : -1;
    const rib = back ? C.leafDeep : C.leafDark, l1 = back ? C.leafDark : C.leafLight, l2 = back ? C.leafDeep : C.leaf;
    for (let s = 1; s < len; s++) {
      const x = tx + ca * s, y = ty + Math.sin(a) * s * 0.45 + s * s * 0.032;
      const leaf = Math.max(1, Math.round(Math.sin((Math.PI * s) / len) * 7));
      for (let k = 1; k <= leaf; k++) { px(c, l1, x + k * 0.45 * sx, y + k * 0.95); px(c, l2, x - k * 0.25 * sx, y + k * 0.75); }
      px(c, rib, x, y);
      if (!back && s % 3 === 1) px(c, C.leafHi, x, y - 1);
    }
  };
  const back: Array<[number, number]> = [], front: Array<[number, number]> = [];
  for (let i = 0; i < 12; i++) {
    const deg = i * 30 + (R() - 0.5) * 14, len = 23 + Math.floor(R() * 9);
    (Math.sin((deg * Math.PI) / 180) < 0 ? back : front).push([deg, len]);
  }
  back.forEach(([deg, len]) => frond(deg, len, true));
  // coconuts
  for (const [ox, oy] of [[-3, 1], [0, 2], [2, 0]] as const) {
    rect(c, C.outline, tx + ox - 1, ty + oy - 1, 5, 5); rect(c, "#6b4a2b", tx + ox, ty + oy, 3, 3); px(c, "#9a7048", tx + ox, ty + oy);
  }
  front.forEach(([deg, len]) => frond(deg, len, false));
  for (let q = 0; q < 10; q++) px(c, R() < 0.5 ? C.leafLight : C.leafHi, tx + (R() - 0.5) * 6, ty - 1 + (R() - 0.5) * 3);
}

function drawHammock(c: Ctx, x: number, y: number, x2: number): void {
  // world → local: lx = wx - (x - 4), ly = wy - (y - 32)
  const L = (wx: number) => wx - (x - 4), T = (wy: number) => wy - (y - 32);
  const cols = ["#e05a47", "#f2c23c", "#3d86a8", "#f4f1ea"];
  const a = x + 10, b = x2 - 8, len = b - a;
  // ropes: from the palm trunk (x+1, y-26) and the post top (x2, y-28) to the fabric ends
  for (let i = 0; i <= 8; i++) {
    px(c, "#d8c7a0", L(x + 1 + i), T(y - 26 + i * 0.5));
    px(c, "#d8c7a0", L(x2 - i), T(y - 28 + i * 0.75));
  }
  for (let wx = a; wx <= b; wx++) {
    const f = (wx - a) / len, sag = Math.round(9 * Math.sin(Math.PI * f)), thick = 2 + Math.round(4 * Math.sin(Math.PI * f));
    const wyTop = y - 22 + sag - thick;
    px(c, C.outline, L(wx), T(wyTop - 1));
    for (let k = 0; k < thick; k++) px(c, cols[Math.floor((wx - a) / 3) % 4], L(wx), T(wyTop + k));
    px(c, C.outline, L(wx), T(wyTop + thick));
  }
}

function drawPost(c: Ctx): void {
  rect(c, C.outline, 0, 0, 6, 32); rect(c, C.wood, 1, 1, 4, 30); rect(c, C.woodLight, 1, 1, 1, 30);
}

function drawMixer(c: Ctx): void {
  rect(c, C.outline, 0, 4, 44, 18); rect(c, C.woodDark, 1, 5, 42, 16); rect(c, "#ff6f91", 1, 14, 42, 1);
  rect(c, C.speaker, 4, 1, 12, 5); rect(c, C.speaker, 28, 1, 12, 5);
  rect(c, "#c9ccd6", 9, 2, 2, 1); rect(c, "#c9ccd6", 33, 2, 2, 1);
  rect(c, "#9aa0a8", 18, 0, 8, 4); rect(c, "#3d86a8", 19, 1, 6, 2);
}

function drawTable(c: Ctx): void {
  rect(c, C.outline, 2, 0, 28, 12); rect(c, C.outline, 0, 2, 32, 8);
  rect(c, C.woodLight, 3, 1, 26, 10); rect(c, C.woodLight, 1, 3, 30, 6);
  rect(c, "#c8905c", 5, 2, 18, 2);
  rect(c, C.wood, 3, 9, 26, 2);
  rect(c, C.outline, 14, 12, 4, 16); rect(c, C.woodDeep, 15, 12, 2, 16);
  rect(c, C.outline, 9, 27, 14, 3); rect(c, C.woodDark, 10, 28, 12, 1);
  rect(c, "#f4f1ea", 8, 3, 3, 3); rect(c, "#7a4a2a", 9, 4, 1, 1);
  rect(c, "#f4f1ea", 20, 4, 3, 3); rect(c, "#7a4a2a", 21, 5, 1, 1);
}

function drawBoard(c: Ctx): void {
  rect(c, C.outline, 3, 18, 3, 16); rect(c, C.outline, 22, 18, 3, 16);
  rect(c, C.woodDark, 4, 18, 1, 16); rect(c, C.woodDark, 23, 18, 1, 16);
  rect(c, C.outline, 0, 0, 28, 22); rect(c, C.wood, 1, 1, 26, 20); rect(c, C.woodLight, 2, 2, 24, 18);
  rect(c, C.paper, 4, 4, 8, 7); rect(c, C.paper, 15, 3, 9, 6); rect(c, "#f6c945", 5, 13, 7, 5); rect(c, C.paper, 15, 11, 8, 7);
  rect(c, "#b5566f", 7, 6, 3, 1); rect(c, "#3d86a8", 17, 5, 5, 1); rect(c, "#3d86a8", 17, 13, 4, 1);
}

function drawSign(c: Ctx): void {
  rect(c, C.outline, 7, 10, 4, 16); rect(c, C.wood, 8, 10, 2, 16);
  rect(c, C.outline, 0, 0, 18, 12); rect(c, C.woodLight, 1, 1, 16, 10);
  // tiny pixel fish
  ["..####...", ".######.#", "########.", ".######.#", "..####..."].forEach((r, j) => {
    for (let i = 0; i < r.length; i++) if (r.charAt(i) === "#") px(c, "#3d86a8", 4 + i, 3 + j);
  });
  px(c, C.white, 6, 5);
}

function drawBanana(c: Ctx): void {
  rect(c, "#6e8f3a", 19, 18, 3, 18);
  const leaves: Array<[number, number, boolean]> = [[-1, -0.9, true], [1, -0.8, true], [-1, -0.2, true], [1, -0.1, true], [0.2, -1, false]];
  for (const [dx, dy, droop] of leaves) {
    for (let s = 0; s < 16; s++) {
      const x = 20 + dx * s, y = 20 + dy * s + (droop ? s * s * 0.04 : 0);
      px(c, "#3f7f2e", x, y);
      for (let k = 1; k < 4; k++) { px(c, "#6fbf4a", x, y - k); px(c, "#4f9a38", x, y + k * 0.6); }
    }
  }
}

function drawLightPole(c: Ctx): void {
  rect(c, C.outline, 1, 2, 4, 40); rect(c, C.woodDark, 2, 2, 2, 40);
  rect(c, C.outline, 0, 0, 6, 3); rect(c, C.goldLight, 1, 1, 4, 1);
}

function drawProp(c: Ctx, p: PropPlacement): void {
  switch (p.kind) {
    case "palm": return drawPalm(c, p.h, p.lean, p.seed);
    case "hammock": return drawHammock(c, p.x, p.y, p.x2);
    case "post": return drawPost(c);
    case "mixer": return drawMixer(c);
    case "table": return drawTable(c);
    case "board": return drawBoard(c);
    case "sign": return drawSign(c);
    case "banana": return drawBanana(c);
    case "lightpole": return drawLightPole(c);
  }
}

function propSprite(p: PropPlacement): PropSprite {
  const f = propFrame(p);
  const canvas = makeCanvas(f.w, f.h);
  drawProp(ctx2d(canvas), p);
  return { canvas, x: p.x - f.ox, y: p.y - f.oy, sortY: p.y };
}

// ---------------------------------------------------------------- public

/** Paint the hall once. Throws "canvas-2d-unavailable" when the browser has no 2D canvas. */
export function paintHall(map: GameMap): HallArt {
  const background = makeCanvas(HALL_W, HALL_H);
  const g = ctx2d(background);
  paintGround(g);
  paintRiverDetails(g);
  paintBamboo(g);
  paintStage(g);
  paintCounter(g);
  const props = map.props.map(propSprite);

  const drawAnimated = (c: Ctx, t: number, camX: number, camY: number, reducedMotion: boolean) => {
    const pulse = reducedMotion ? 0 : Math.sin(t / 110) > 0.2 ? 1 : 0;
    for (const sx of [250, 374]) {
      const x = sx - camX, y = 58 - camY;
      rect(c, C.cone, x + 5, y + 4, 6, 5); rect(c, C.coneCenter, x + 7, y + 6, 2, 2);
      rect(c, C.speakerFace, x + 2, y + 13, 12, 12);
      rect(c, C.cone, x + 3 - pulse, y + 14 - pulse, 10 + pulse * 2, 10 + pulse * 2);
      rect(c, C.coneCenter, x + 6, y + 17, 4, 4);
    }
    if (reducedMotion) return;
    for (let i = 0; i < 70; i++) {
      const sx = (i * 37 + Math.floor(t / 45)) % HALL_W;
      const sy = Math.round(hallShoreY(sx)) + 4 + ((i * 7) % 56);
      if (sy >= HALL_H) continue;
      px(c, C.sparkle, sx - camX, sy - camY);
      px(c, C.sparkle2, sx + 1 - camX, sy - camY);
    }
  };

  const drawOverhead = (c: Ctx, t: number, camX: number, camY: number, reducedMotion: boolean) => {
    const bulbs = ["#ff6f91", "#ffd166", "#06d6a0", "#4cc9f0"];
    LIGHT_STRINGS.forEach(([x1, y1, x2, y2, sag], si) => {
      const n = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
      for (let i = 0; i <= n; i++) {
        const f = i / n;
        const x = x1 + (x2 - x1) * f, y = y1 + (y2 - y1) * f + sag * Math.sin(Math.PI * f);
        px(c, C.outline, x - camX, y - camY);
        if (i % 7 === 3) {
          const k = Math.floor(i / 7);
          const on = reducedMotion || (k + Math.floor(t / 380) + si) % 3 !== 0;
          const col = on ? bulbs[k % 4] : "#8a7a6a";
          px(c, col, x - camX, y + 1 - camY);
          px(c, col, x - camX, y + 2 - camY);
        }
      }
    });
  };

  return { background, props, drawAnimated, drawOverhead };
}
