import { C, ctx2d, makeCanvas, px, rect, rng, type Ctx, type PropFrame, type PropSprite } from "./scene-art";
import type { CardGame } from "@/lib/game/cards/deck";
import type { PropPlacement, SignIcon } from "./types";

// Every depth-sorted prop of every map: its sprite frame (pure) and its painter (browser only).

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
    case "stall_front": return { w: 108, h: 30, ox: 54, oy: 30 };
    case "hut_front": return { w: 108, h: 26, ox: 54, oy: 26 };
    case "records": return { w: 28, h: 34, ox: 14, oy: 34 };
    case "namepost": return { w: 10, h: 18, ox: 5, oy: 18 };
    case "coop_front": return { w: 112, h: 30, ox: 56, oy: 30 };
    case "farmshop_front": return { w: 92, h: 26, ox: 46, oy: 26 };
    case "ricedepot_front": return { w: 96, h: 26, ox: 48, oy: 26 };
    case "pump": return { w: 36, h: 48, ox: 18, oy: 48 };
    case "haystack": return { w: 30, h: 26, ox: 15, oy: 25 };
    case "scarecrow": return { w: 20, h: 34, ox: 10, oy: 34 };
    case "card_table": return CARD_TABLE_FRAMES[p.game];
  }
}

/** The card tables' sprites (v16 spec §15): the base point is the bottom of the south stools. */
const CARD_TABLE_FRAMES: Record<CardGame, PropFrame> = {
  tienlen: { w: 44, h: 30, ox: 22, oy: 30 },
  cao: { w: 56, h: 28, ox: 28, oy: 28 },
  poker: { w: 54, h: 31, ox: 27, oy: 31 },
};

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

type SignGlyph = { rows: string[]; color: string; x: number; y: number };
const SIGN_ICONS: Record<SignIcon, SignGlyph[]> = {
  fish: [{ rows: ["..####...", ".######.#", "########.", ".######.#", "..####..."], color: "#3d86a8", x: 4, y: 3 }],
  note: [{ rows: ["...##.", "...#.#", "...#..", ".###..", "####..", ".##..."], color: C.red, x: 6, y: 2 }],
  rice: [{ rows: ["..#.#..", ".#.#.#.", "..#.#..", ".#.#.#.", "...#...", "...#..."], color: C.gold, x: 5, y: 2 }],
  cards: [
    { rows: ["..#..", ".###.", "#####", "#####", "..#..", ".###."], color: C.outline, x: 3, y: 2 },
    { rows: [".#.#.", "#####", "#####", ".###.", "..#.."], color: C.red, x: 10, y: 3 },
  ],
};

/** A signpost with a pixel icon: a fish (to the pond), a music note (to the hall), a rice panicle (to the field) or ♠♥
 *  (the card corner). */
function drawSign(c: Ctx, icon: SignIcon): void {
  rect(c, C.outline, 7, 10, 4, 16); rect(c, C.wood, 8, 10, 2, 16);
  rect(c, C.outline, 0, 0, 18, 12); rect(c, C.woodLight, 1, 1, 16, 10);
  for (const ic of SIGN_ICONS[icon]) {
    ic.rows.forEach((r, j) => {
      for (let i = 0; i < r.length; i++) if (r.charAt(i) === "#") px(c, ic.color, ic.x + i, ic.y + j);
    });
  }
  if (icon === "fish") px(c, C.white, 6, 5);
}

const STOOL_BLUE = "#3d6fd1", STOOL_BLUE_LIGHT = "#6f9be8", STOOL_BLUE_DARK = "#2a4f9c";

/** A blue plastic stool (ghế nhựa) seen from the front: its seat's top-left at (x, y). */
function drawStool(c: Ctx, x: number, y: number): void {
  rect(c, C.outline, x, y, 8, 4); rect(c, STOOL_BLUE, x + 1, y + 1, 6, 2); rect(c, STOOL_BLUE_LIGHT, x + 1, y + 1, 6, 1);
  rect(c, C.outline, x + 1, y + 4, 2, 4); rect(c, C.outline, x + 5, y + 4, 2, 4);
  px(c, STOOL_BLUE_DARK, x + 1, y + 4); px(c, STOOL_BLUE_DARK, x + 6, y + 4);
}

/** A cushion (gối ngồi) on the floor. */
function drawCushion(c: Ctx, x: number, y: number, col: string): void {
  rect(c, C.outline, x + 1, y, 6, 6); rect(c, C.outline, x, y + 1, 8, 4);
  rect(c, col, x + 1, y + 1, 6, 4); rect(c, C.goldLight, x + 3, y + 2, 2, 2);
}

/** A tiny card lying on a table: a white face with a red or black pip, or a burgundy back. */
function drawTinyCard(c: Ctx, x: number, y: number, face: "red" | "black" | "back"): void {
  rect(c, C.outline, x, y, 5, 6);
  rect(c, face === "back" ? "#8e2a3f" : C.white, x + 1, y + 1, 3, 4);
  if (face === "back") px(c, C.gold, x + 2, y + 2);
  else px(c, face === "red" ? C.red : C.outline, x + 2, y + 2);
}

/** Tiến lên: a low square table with a red-checked cloth, a fan of cards and 4 blue plastic stools. */
function drawTienLenTable(c: Ctx): void {
  drawStool(c, 2, 12); drawStool(c, 34, 12);
  // the table: cloth top, a checked apron, two legs
  rect(c, C.outline, 9, 5, 26, 17);
  for (let y = 6; y < 18; y++) for (let x = 10; x < 34; x++) {
    const check = (Math.floor((x - 10) / 3) + Math.floor((y - 6) / 3)) % 2 === 0;
    px(c, check ? C.red : C.white, x, y);
  }
  rect(c, C.redDark, 10, 18, 24, 3);
  for (let x = 10; x < 34; x += 3) px(c, C.white, x, 19);
  rect(c, C.outline, 11, 21, 3, 4); rect(c, C.outline, 30, 21, 3, 4);
  rect(c, C.woodDark, 12, 21, 1, 3); rect(c, C.woodDark, 31, 21, 1, 3);
  // a fan of cards and the pile
  drawTinyCard(c, 15, 9, "black"); drawTinyCard(c, 18, 8, "red"); drawTinyCard(c, 21, 9, "black");
  drawTinyCard(c, 27, 10, "back");
  drawStool(c, 12, 22); drawStool(c, 24, 22);
}

/** Cào: a round straw mat (chiếu cói) with a red envelope, a stack of cards and 6 cushions. */
function drawCaoMat(c: Ctx): void {
  drawCushion(c, 2, 4, C.red); drawCushion(c, 47, 4, "#5caa4a");
  const cx = 28, cy = 12, rx = 18, ry = 7;
  for (let y = cy - ry - 1; y <= cy + ry + 1; y++) for (let x = cx - rx - 1; x <= cx + rx + 1; x++) {
    const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
    if (d > 1.16) continue;
    if (d > 0.9) px(c, d > 1.02 ? C.outline : "#a8843f", x, y);
    else px(c, (x + y) % 4 === 0 ? "#c4a85e" : (x - y) % 6 === 0 ? "#e8d28a" : "#d8c07a", x, y);
  }
  // the red envelope (lì xì) and the stack of cards
  rect(c, C.outline, 17, 8, 8, 6); rect(c, C.red, 18, 9, 6, 4); rect(c, C.gold, 20, 10, 2, 2);
  drawTinyCard(c, 30, 8, "back"); drawTinyCard(c, 31, 7, "back");
  drawCushion(c, 4, 14, C.gold); drawCushion(c, 45, 14, C.blue);
  drawCushion(c, 17, 21, "#b5566f"); drawCushion(c, 32, 21, C.red);
}

/** Poker: an oval table with green felt, a wooden rim, a stack of chips and 6 stools. */
function drawPokerTable(c: Ctx): void {
  drawStool(c, 2, 11); drawStool(c, 44, 11);
  rect(c, C.outline, 24, 20, 7, 6); rect(c, C.woodDeep, 25, 20, 5, 5);
  const cx = 27, cy = 14, rx = 17, ry = 7;
  for (let y = cy - ry - 1; y <= cy + ry + 1; y++) for (let x = cx - rx - 1; x <= cx + rx + 1; x++) {
    const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
    if (d > 1.14) continue;
    if (d > 1.0) px(c, C.outline, x, y);
    else if (d > 0.72) px(c, y > cy ? C.woodDark : C.wood, x, y);
    else px(c, d < 0.25 && y < cy ? "#3f9a62" : "#2f7d4f", x, y);
  }
  // the chips: red, white and blue coins
  for (const [x, col] of [[22, C.red], [26, C.white], [30, C.blue]] as const) {
    rect(c, C.outline, x - 1, 11, 5, 5);
    for (let k = 0; k < 3; k++) rect(c, k % 2 === 0 ? col : C.goldLight, x, 12 + k, 3, 1);
  }
  drawTinyCard(c, 14, 10, "back"); drawTinyCard(c, 36, 11, "back");
  for (const x of [11, 19, 27, 35]) drawStool(c, x, 23);
}

function drawCardTable(c: Ctx, game: CardGame): void {
  if (game === "tienlen") drawTienLenTable(c);
  else if (game === "cao") drawCaoMat(c);
  else drawPokerTable(c);
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

/** Vựa cá counter: woven baskets of fish, a scale and an ice box. */
function drawStallFront(c: Ctx): void {
  rect(c, C.outline, 0, 12, 108, 18);
  rect(c, C.woodPale, 1, 13, 106, 4); rect(c, "#e0b27a", 1, 13, 106, 1);
  for (let x = 1; x < 107; x += 7) { rect(c, C.woodLight, x, 17, 6, 12); rect(c, C.wood, x + 6, 17, 1, 12); }
  for (const bx of [10, 38]) {
    rect(c, C.outline, bx, 4, 22, 10); rect(c, "#c9a55a", bx + 1, 5, 20, 8);
    for (let x = bx + 2; x < bx + 21; x += 3) rect(c, "#a8843f", x, 5, 1, 8);
    for (let i = 0; i < 4; i++) { rect(c, C.silver, bx + 3 + i * 4, 2 + (i % 2), 4, 3); px(c, C.outline, bx + 3 + i * 4, 3 + (i % 2)); }
  }
  // the scale (cân đòn)
  rect(c, C.outline, 74, 0, 2, 13); rect(c, C.outline, 66, 2, 18, 1);
  rect(c, C.silver, 64, 8, 8, 2); rect(c, C.outline, 64, 10, 8, 1);
  rect(c, C.silver, 78, 6, 8, 2); rect(c, C.outline, 78, 8, 8, 1);
  px(c, C.outline, 67, 3); px(c, C.outline, 68, 4); px(c, C.outline, 81, 3); px(c, C.outline, 82, 4);
  rect(c, C.outline, 90, 3, 14, 10); rect(c, "#e8f4f8", 91, 4, 12, 8); rect(c, "#a6d6e8", 91, 4, 12, 2);
}

/** Tiệm đồ câu counter: bamboo slats, a tackle box and bait jars. */
function drawHutFront(c: Ctx): void {
  rect(c, C.outline, 0, 6, 108, 20);
  rect(c, C.woodPale, 1, 7, 106, 4); rect(c, "#e0b27a", 1, 7, 106, 1);
  for (let x = 1; x < 107; x += 4) { rect(c, "#b7c65a", x, 11, 3, 14); rect(c, "#8a9a3a", x + 3, 11, 1, 14); }
  rect(c, C.outline, 12, 0, 18, 7); rect(c, C.red, 13, 1, 16, 5); rect(c, C.gold, 20, 2, 2, 2);
  for (const [jx, col] of [[40, "#e98a9a"], [50, "#f29a6a"], [60, C.red]] as const) {
    rect(c, C.outline, jx, 0, 7, 7); rect(c, "#e8f4f8", jx + 1, 1, 5, 5); rect(c, col, jx + 1, 3, 5, 3);
  }
  rect(c, C.outline, 80, 2, 16, 5); rect(c, C.blue, 81, 3, 14, 3);
}

/** Bảng kỷ lục: a board on two posts with a trophy. */
function drawRecords(c: Ctx): void {
  rect(c, C.outline, 3, 18, 3, 16); rect(c, C.outline, 22, 18, 3, 16);
  rect(c, C.woodDark, 4, 18, 1, 16); rect(c, C.woodDark, 23, 18, 1, 16);
  rect(c, C.outline, 0, 0, 28, 22); rect(c, C.wood, 1, 1, 26, 20); rect(c, C.woodLight, 2, 2, 24, 18);
  rect(c, C.red, 2, 2, 24, 4);
  for (let x = 4; x < 24; x += 3) px(c, C.goldLight, x, 3);
  rect(c, C.gold, 9, 8, 10, 5); rect(c, C.goldLight, 10, 8, 3, 2);
  px(c, C.gold, 8, 9); px(c, C.gold, 19, 9);
  rect(c, C.gold, 13, 13, 2, 2); rect(c, C.gold, 11, 15, 6, 2); rect(c, C.outline, 11, 17, 6, 1);
}

/** A plot's name post: a stake with a small board (the owner's name is drawn over it as a label). */
function drawNamePost(c: Ctx): void {
  rect(c, C.outline, 4, 6, 3, 12); rect(c, C.wood, 5, 6, 1, 12);
  rect(c, C.outline, 0, 0, 10, 8); rect(c, C.woodPale, 1, 1, 8, 6); rect(c, C.woodDark, 2, 3, 6, 1);
}

const HTX: ReadonlyArray<readonly [number, readonly string[]]> = [
  [7, ["#..#", "#..#", "####", "#..#", "#..#"]],
  [13, ["####", ".##.", ".##.", ".##.", ".##."]],
  [19, ["#..#", ".##.", ".##.", ".##.", "#..#"]],
];

/** Hợp tác xã: the office's front wall, a window with chú Tám's desk and the red "HTX" board. */
function drawCoopFront(c: Ctx): void {
  rect(c, C.outline, 0, 4, 112, 26);
  rect(c, "#e8dcc0", 1, 5, 110, 24);
  for (let y = 8; y < 29; y += 4) rect(c, "#d6c8a6", 1, y, 110, 1);
  // the window and the desk behind it
  rect(c, C.outline, 36, 8, 40, 14); rect(c, "#a6d6e8", 37, 9, 38, 12); rect(c, C.woodDark, 37, 17, 38, 4);
  rect(c, C.paper, 42, 15, 8, 2); rect(c, C.blue, 58, 14, 3, 3);
  // the HTX board
  rect(c, C.outline, 4, 0, 24, 12); rect(c, C.red, 5, 1, 22, 10);
  for (const [x, rows] of HTX) {
    rows.forEach((r, j) => {
      for (let i = 0; i < r.length; i++) if (r.charAt(i) === "#") px(c, C.goldLight, x + i, 4 + j);
    });
  }
  // a door and a bench
  rect(c, C.outline, 86, 10, 18, 20); rect(c, C.wood, 87, 11, 16, 19); px(c, C.gold, 100, 20);
  rect(c, C.outline, 8, 24, 22, 3); rect(c, C.woodLight, 9, 24, 20, 1);
}

/** Tiệm vật tư nông nghiệp: a counter with fertilizer sacks and pesticide bottles. */
function drawFarmShopFront(c: Ctx): void {
  rect(c, C.outline, 0, 10, 92, 16);
  rect(c, C.woodPale, 1, 11, 90, 3); rect(c, "#e0b27a", 1, 11, 90, 1);
  for (let x = 1; x < 91; x += 6) { rect(c, C.woodLight, x, 14, 5, 11); rect(c, C.wood, x + 5, 14, 1, 11); }
  for (const [x, bag, band] of [[6, C.paper, C.water], [20, C.paper, C.red], [34, "#e8dcc0", C.leafLight]] as const) {
    rect(c, C.outline, x, 1, 12, 11); rect(c, bag, x + 1, 2, 10, 9); rect(c, band, x + 1, 5, 10, 3);
  }
  for (const [x, col] of [[56, C.blue], [63, "#d9534f"], [70, "#6fbf4a"]] as const) {
    rect(c, C.outline, x, 3, 6, 8); rect(c, col, x + 1, 5, 4, 5); rect(c, C.white, x + 2, 3, 2, 2);
  }
  rect(c, C.outline, 80, 4, 9, 7); rect(c, C.paper, 81, 5, 7, 5); rect(c, C.outline, 82, 7, 5, 1);
}

/** Vựa lúa: rice sacks stacked by the counter, a platform scale (cân bàn) and a basket of paddy. */
function drawRiceDepotFront(c: Ctx): void {
  rect(c, C.outline, 0, 10, 96, 16);
  rect(c, C.woodPale, 1, 11, 94, 3); rect(c, "#e0b27a", 1, 11, 94, 1);
  for (let x = 1; x < 95; x += 6) { rect(c, "#b88a52", x, 14, 5, 11); rect(c, "#a8784a", x + 5, 14, 1, 11); }
  for (const [x, y] of [[4, 2], [17, 2], [10, -1]] as const) {
    rect(c, C.outline, x, y + 1, 14, 11); rect(c, "#e8d8a8", x + 1, y + 2, 12, 9); rect(c, "#c9a55a", x + 1, y + 8, 12, 1);
    px(c, C.gold, x + 6, y + 4); px(c, C.gold, x + 7, y + 5);
  }
  rect(c, C.outline, 62, 0, 3, 12); rect(c, C.outline, 54, 8, 22, 4); rect(c, C.silver, 55, 9, 20, 2);
  rect(c, C.outline, 58, 0, 11, 5); rect(c, C.paper, 59, 1, 9, 3); px(c, C.red, 63, 2);
  rect(c, C.outline, 78, 3, 14, 9); rect(c, "#c9a55a", 79, 4, 12, 7);
  for (let x = 80; x < 90; x += 2) px(c, C.goldLight, x, 4);
}

/** The pump house (cống) at the canal's west end: a brick hut, its roof and a valve on the pipe. */
function drawPump(c: Ctx): void {
  rect(c, C.outline, 2, 16, 30, 30);
  for (let y = 17; y < 45; y += 4) {
    for (let x = 3; x < 31; x += 7) {
      const o = (y - 17) % 8 === 0 ? 0 : 3;
      rect(c, "#b5566f", x + o, y, 6, 3); rect(c, "#8e3a4a", x + o, y + 3, 6, 1);
    }
  }
  for (let j = 0; j < 12; j++) rect(c, j === 11 ? C.outline : j % 3 === 0 ? "#6e8f3a" : "#8fb84e", 12 - j, 4 + j, 10 + j * 2, 1);
  rect(c, C.outline, 12, 3, 10, 1);
  rect(c, C.outline, 12, 30, 10, 16); rect(c, C.woodDark, 13, 31, 8, 15);
  rect(c, C.outline, 28, 38, 8, 5); rect(c, C.silver, 29, 39, 7, 3);
  rect(c, C.outline, 30, 30, 5, 5); rect(c, C.red, 31, 31, 3, 3);
}

/** A haystack (đống rơm) by the drying yard. */
function drawHaystack(c: Ctx): void {
  for (let j = 0; j < 22; j++) {
    const half = Math.round(Math.sin(((j + 2) / 24) * Math.PI) * 13);
    rect(c, C.outline, 15 - half - 1, 2 + j, half * 2 + 2, 1);
    rect(c, j % 4 === 1 ? "#c9a55a" : j % 4 === 3 ? "#a8843f" : "#e0c27a", 15 - half, 2 + j, half * 2, 1);
  }
  rect(c, C.outline, 2, 24, 26, 1);
  rect(c, C.woodDark, 14, 0, 2, 4);
}

/** Bù nhìn: a straw scarecrow in a nón lá with outstretched sleeves. */
function drawScarecrow(c: Ctx): void {
  rect(c, C.outline, 9, 10, 2, 24); rect(c, C.woodDark, 9, 10, 1, 24);
  rect(c, C.outline, 1, 14, 18, 3); rect(c, C.woodLight, 2, 15, 16, 1);
  rect(c, C.outline, 5, 15, 10, 11); rect(c, C.blue, 6, 16, 8, 9); rect(c, "#2f63a0", 6, 22, 8, 1);
  rect(c, "#e0c27a", 1, 16, 3, 3); rect(c, "#e0c27a", 16, 16, 3, 3);
  rect(c, C.outline, 7, 6, 6, 6); rect(c, "#e8d8a8", 8, 7, 4, 4);
  for (let j = 0; j < 5; j++) rect(c, j === 4 ? "#b89758" : "#f3e3b0", 10 - j * 2, 2 + j, j * 4 + 1, 1);
}

export function drawProp(c: Ctx, p: PropPlacement): void {
  switch (p.kind) {
    case "palm": return drawPalm(c, p.h, p.lean, p.seed);
    case "hammock": return drawHammock(c, p.x, p.y, p.x2);
    case "post": return drawPost(c);
    case "mixer": return drawMixer(c);
    case "table": return drawTable(c);
    case "board": return drawBoard(c);
    case "sign": return drawSign(c, p.icon ?? "fish");
    case "banana": return drawBanana(c);
    case "lightpole": return drawLightPole(c);
    case "stall_front": return drawStallFront(c);
    case "hut_front": return drawHutFront(c);
    case "records": return drawRecords(c);
    case "namepost": return drawNamePost(c);
    case "coop_front": return drawCoopFront(c);
    case "farmshop_front": return drawFarmShopFront(c);
    case "ricedepot_front": return drawRiceDepotFront(c);
    case "pump": return drawPump(c);
    case "haystack": return drawHaystack(c);
    case "scarecrow": return drawScarecrow(c);
    case "card_table": return drawCardTable(c, p.game);
  }
}

export function propSprite(p: PropPlacement): PropSprite {
  const f = propFrame(p);
  const canvas = makeCanvas(f.w, f.h);
  drawProp(ctx2d(canvas), p);
  return { canvas, x: p.x - f.ox, y: p.y - f.oy, sortY: p.y };
}
