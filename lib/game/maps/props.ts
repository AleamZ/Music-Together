import { C, ctx2d, makeCanvas, px, rect, rng, type Ctx, type PropFrame, type PropSprite } from "./scene-art";
import type { CardGame } from "@/lib/game/cards/deck";
import type { PropPlacement, SignIcon, StallGoods } from "./types";
import { drawGhe, drawMachineShed, GHE_FRAME, MACHINE_SHED_FRAME } from "@/lib/game/fishing/extras-art";

// Every depth-sorted prop of every map: its sprite frame (pure) and its painter (browser only).

export function propFrame(p: PropPlacement): PropFrame {
  switch (p.kind) {
    case "palm": return { w: 100, h: p.h + 40, ox: 50, oy: p.h + 38 };
    case "hammock": return { w: p.x2 - p.x + 8, h: 34, ox: 4, oy: 32 };
    case "post": return { w: 6, h: 32, ox: 3, oy: 32 };
    case "mixer": return { w: 44, h: 22, ox: 22, oy: 22 };
    case "table": return { w: 32, h: 30, ox: 16, oy: 30 };
    case "board": return { w: 28, h: 34, ox: 14, oy: 34 };
    case "news_stand": return { w: 30, h: 36, ox: 15, oy: 36 };
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
    case "market_stall": return { w: 84, h: 30, ox: 42, oy: 30 };
    case "eat_table": return { w: 40, h: 22, ox: 20, oy: 22 };
    case "lantern_post": return { w: 12, h: 46, ox: 6, oy: 46 };
    case "shop_counter": return { w: 84, h: 18, ox: 42, oy: 18 };
    case "city_map_post": return CITY_MAP_POST_FRAME;
    case "punch_bag": return PUNCH_BAG_FRAME;
    case "ghe": return GHE_FRAME;                                                // v21 (0076)
    case "machine_shed": return MACHINE_SHED_FRAME;                              // v21 (0076)
  }
}

/** v20.1: the punching bag's sprite; the base point is the foot of its stand. */
export const PUNCH_BAG_FRAME: PropFrame = { w: 26, h: 36, ox: 13, oy: 36 };

/** A red leather bag on a chain, hanging from a wooden gallows on a small stone base. Original pixel art. */
function drawPunchBag(c: Ctx): void {
  // the post and the arm
  rect(c, C.outline, 19, 0, 5, 34); rect(c, C.wood, 20, 1, 3, 32); rect(c, C.woodLight, 20, 1, 1, 32);
  rect(c, C.outline, 6, 0, 16, 4); rect(c, C.woodDark, 7, 1, 14, 2);
  // the base
  rect(c, C.outline, 15, 32, 11, 4); rect(c, "#8d8a86", 16, 33, 9, 2);
  // the chain
  for (let y = 4; y < 9; y++) px(c, y % 2 ? "#9aa0a6" : "#5d6166", 10, y);
  // the bag
  rect(c, C.outline, 5, 8, 11, 24); rect(c, "#9c3a26", 6, 9, 9, 22);
  rect(c, "#c0543a", 7, 10, 3, 20); rect(c, "#6d2518", 13, 10, 2, 20);
  rect(c, "#3a2a24", 6, 13, 9, 1); rect(c, "#3a2a24", 6, 26, 9, 1);
  rect(c, C.outline, 7, 31, 7, 2);
}

/** The card tables' sprites (v16 spec §15): the base point is the bottom of the south stools. */
const CARD_TABLE_FRAMES: Record<CardGame, PropFrame> = {
  tienlen: { w: 44, h: 30, ox: 22, oy: 30 },
  cao: { w: 56, h: 28, ox: 28, oy: 28 },
  poker: { w: 54, h: 31, ox: 27, oy: 31 },
  xidach: { w: 50, h: 30, ox: 25, oy: 30 },
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

/** Báo Làng (v18.11): a little wooden kiosk under a red-and-cream striped awning, the day's papers clipped along its front
 *  and a stack of them on the counter. 30 × 36, base at the bottom of its legs. */
function drawNewsStand(c: Ctx): void {
  // the awning: outline, stripes, a scalloped edge
  rect(c, C.outline, 0, 0, 30, 8);
  for (let i = 0; i < 7; i++) rect(c, i % 2 === 0 ? C.red : C.paper, 1 + i * 4, 1, 4, 6);
  rect(c, C.red, 25, 1, 4, 6);
  for (let i = 0; i < 7; i++) { px(c, C.outline, 2 + i * 4, 8); px(c, C.outline, 3 + i * 4, 8); }
  // the posts
  rect(c, C.outline, 1, 8, 3, 28); rect(c, C.woodDark, 2, 8, 1, 28);
  rect(c, C.outline, 26, 8, 3, 28); rect(c, C.woodDark, 27, 8, 1, 28);
  // the back board with three papers clipped on a string
  rect(c, C.wood, 4, 9, 22, 11);
  rect(c, C.woodDark, 4, 11, 22, 1);
  for (const x of [5, 12, 19]) {
    rect(c, C.outline, x, 11, 6, 8); rect(c, C.paper, x + 1, 12, 4, 6);
    rect(c, C.outline, x + 1, 13, 4, 1);                          // the masthead rule
    px(c, "#7a6a58", x + 1, 15); px(c, "#7a6a58", x + 3, 15); px(c, "#7a6a58", x + 2, 16); px(c, "#7a6a58", x + 4, 16);
    px(c, C.gold, x + 2, 11);                                      // the clip
  }
  px(c, C.red, 8, 12); px(c, "#3d86a8", 15, 12);                    // a red and a blue headline
  // the counter with a stack of papers
  rect(c, C.outline, 3, 20, 24, 5); rect(c, C.woodLight, 4, 21, 22, 3);
  rect(c, C.outline, 6, 17, 9, 4); rect(c, C.paper, 7, 18, 7, 2); rect(c, "#e6dcc6", 7, 19, 7, 1);
  rect(c, C.outline, 17, 18, 7, 3); rect(c, C.paper, 18, 19, 5, 1);
  // the cabinet front with the stand's little sign
  rect(c, C.outline, 3, 25, 24, 9); rect(c, C.wood, 4, 26, 22, 7);
  rect(c, C.woodDark, 4, 29, 22, 1);
  rect(c, C.outline, 10, 26, 10, 5); rect(c, C.gold, 11, 27, 8, 3);
  rect(c, C.outline, 12, 28, 6, 1);
  // the feet
  rect(c, C.outline, 4, 34, 3, 2); rect(c, C.outline, 23, 34, 3, 2);
}

type SignGlyph ={ rows: string[]; color: string; x: number; y: number };
const SIGN_ICONS: Record<SignIcon, SignGlyph[]> = {
  fish: [{ rows: ["..####...", ".######.#", "########.", ".######.#", "..####..."], color: "#3d86a8", x: 4, y: 3 }],
  note: [{ rows: ["...##.", "...#.#", "...#..", ".###..", "####..", ".##..."], color: C.red, x: 6, y: 2 }],
  rice: [{ rows: ["..#.#..", ".#.#.#.", "..#.#..", ".#.#.#.", "...#...", "...#..."], color: C.gold, x: 5, y: 2 }],
  cards: [
    { rows: ["..#..", ".###.", "#####", "#####", "..#..", ".###."], color: C.outline, x: 3, y: 2 },
    { rows: [".#.#.", "#####", "#####", ".###.", "..#.."], color: C.red, x: 10, y: 3 },
  ],
  // a red lantern with gold caps and tassel (to Chợ Lớn)
  market: [
    { rows: [".###.", "#####", "#####", "#####", ".###."], color: C.red, x: 7, y: 3 },
    { rows: ["#####", ".....", ".....", ".....", ".....", ".....", "#####", "..#.."], color: C.gold, x: 7, y: 2 },
  ],
  // v19.2: a little house with a red roof (to Khu nhà)
  home: [
    { rows: ["...#...", "..###..", ".#####.", "#######"], color: C.red, x: 5, y: 1 },
    { rows: [".#####.", ".##.##.", ".##.##.", ".#####."], color: C.paper, x: 5, y: 5 },
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

/** Xì Dách: an oval table with burgundy felt, cards and stools. */
function drawXidachTable(c: Ctx): void {
  drawStool(c, 2, 11); drawStool(c, 42, 11);
  rect(c, C.outline, 22, 20, 6, 6); rect(c, C.woodDeep, 23, 20, 4, 5);
  const cx = 25, cy = 13, rx = 16, ry = 7;
  for (let y = cy - ry - 1; y <= cy + ry + 1; y++) for (let x = cx - rx - 1; x <= cx + rx + 1; x++) {
    const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
    if (d > 1.14) continue;
    if (d > 1.0) px(c, C.outline, x, y);
    else if (d > 0.72) px(c, y > cy ? C.woodDark : C.wood, x, y);
    else px(c, d < 0.25 && y < cy ? "#9a3f3f" : "#7d2f2f", x, y);
  }
  drawTinyCard(c, 16, 9, "back"); drawTinyCard(c, 24, 9, "back"); drawTinyCard(c, 32, 9, "back");
  for (const x of [10, 18, 26, 34]) drawStool(c, x, 22);
}

function drawCardTable(c: Ctx, game: CardGame): void {
  if (game === "tienlen") drawTienLenTable(c);
  else if (game === "cao") drawCaoMat(c);
  else if (game === "xidach") drawXidachTable(c);
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

// ---------------------------------------------------------------- Chợ Lớn (v18.4)

const STRIPES: Record<StallGoods, [string, string]> = {
  fruit: ["#e07a2e", "#f4e2b8"], flower: ["#d4758f", "#f4efe0"], lantern: ["#c0392b", "#e0b33c"],
  fish: ["#2e9a94", "#f4efe0"], produce: ["#5caa4a", "#f4e2b8"], umbrella: ["#2f5fa8", "#f4efe0"],
};

/** A fish on its side, head right: a silver or red body, a darker back, an eye and a forked tail. */
function drawLyingFish(c: Ctx, x: number, y: number, len: number, body: string, back: string): void {
  rect(c, C.outline, x + 2, y - 1, len - 3, 5); rect(c, C.outline, x, y - 1, 2, 1); rect(c, C.outline, x, y + 3, 2, 1);
  rect(c, C.outline, x + 1, y, 1, 3);
  rect(c, body, x + 3, y, len - 5, 3); rect(c, back, x + 3, y, len - 5, 1);
  px(c, body, x + len - 2, y + 1);
  px(c, C.outline, x + len - 4, y + 1);
  px(c, back, x + 1, y); px(c, back, x + 1, y + 2);
}

/** A burlap sack of rice, tied at the neck, grains showing at the open top. */
function drawSack(c: Ctx, x: number, y: number): void {
  rect(c, C.outline, x, y + 2, 14, 11); rect(c, C.outline, x + 1, y + 1, 12, 1);
  rect(c, "#c8a468", x + 1, y + 3, 12, 9); rect(c, "#d8b87c", x + 2, y + 3, 4, 8); rect(c, "#a8844c", x + 11, y + 4, 1, 8);
  rect(c, "#f4ecd0", x + 2, y + 1, 10, 2); px(c, "#e0d4b0", x + 4, y + 1); px(c, "#e0d4b0", x + 8, y + 2);
  rect(c, "#a8844c", x + 1, y + 4, 12, 1);
  // a printed band and a red mark
  rect(c, "#3d6fd1", x + 1, y + 9, 12, 1); rect(c, C.red, x + 5, y + 6, 4, 2);
}

/** A market stall's front: a plank counter with its goods heaped on top (the striped awning is drawn overhead). */
function drawMarketStall(c: Ctx, goods: StallGoods): void {
  const [a] = STRIPES[goods];
  // the counter
  rect(c, C.outline, 2, 12, 80, 18);
  rect(c, C.wood, 3, 13, 78, 16);
  for (let y = 16; y < 29; y += 4) rect(c, C.woodDark, 3, y, 78, 1);
  rect(c, C.woodLight, 3, 13, 78, 2);
  rect(c, a, 3, 20, 78, 2); // a painted band
  rect(c, C.woodDeep, 6, 29, 4, 1); rect(c, C.woodDeep, 74, 29, 4, 1);
  if (goods === "fish") {
    // Vựa cá: trays of crushed ice with the day's fish laid out, a price slate on a stick
    const kinds: ReadonlyArray<readonly [string, string]> = [["#c3c8d4", "#6d7a86"], ["#e0704e", "#a83a2a"], ["#b8b08a", "#6e6a4a"]];
    kinds.forEach(([body, back], k) => {
      const bx = 3 + k * 26;
      rect(c, C.outline, bx, 5, 25, 9); rect(c, "#8e9ba8", bx + 1, 6, 23, 7);
      rect(c, "#dcecf0", bx + 2, 6, 21, 6);
      for (let i = 0; i < 9; i++) px(c, i % 2 ? C.white : "#b8d4dc", bx + 3 + ((i * 7) % 19), 7 + ((i * 5) % 5));
      drawLyingFish(c, bx + 2, 7, 11, body, back);
      drawLyingFish(c, bx + 11, 9, 11, body, back);
    });
    // water drips down the front of the counter
    for (const x of [14, 40, 66]) { px(c, "#8fc2d8", x, 23); px(c, "#8fc2d8", x, 25); }
    rect(c, C.outline, 76, 0, 1, 6); rect(c, C.outline, 72, 0, 8, 5); rect(c, "#2f3a36", 73, 1, 6, 3); rect(c, C.white, 74, 2, 4, 1);
  } else if (goods === "produce") {
    // Vựa nông sản: sacks of rice, then baskets of cabbages, pumpkins, carrots and chillies
    drawSack(c, 3, 0); drawSack(c, 18, 1);
    const baskets: ReadonlyArray<readonly [number, string, string]> = [[34, "#5caa4a", "#86c95c"], [50, "#e07a2e", "#f2b233"], [66, C.red, "#e85a47"]];
    baskets.forEach(([bx, col, hi], k) => {
      rect(c, C.outline, bx, 7, 15, 7); rect(c, "#b5874a", bx + 1, 8, 13, 5);
      for (let x = bx + 2; x < bx + 14; x += 3) px(c, "#8a6038", x, 10);
      const n = k === 0 ? 3 : 4;
      for (let i = 0; i < n; i++) {
        const x = bx + 1 + i * (k === 0 ? 4 : 3), y = 3 + (i % 2);
        if (k === 0) { rect(c, C.outline, x - 1, y - 1, 6, 6); rect(c, col, x, y, 4, 4); px(c, hi, x + 1, y + 1); rect(c, C.leafDark, x + 1, y + 3, 2, 1); }
        else if (k === 1) { rect(c, C.outline, x - 1, y, 5, 5); rect(c, col, x, y + 1, 3, 3); px(c, hi, x, y + 1); px(c, C.leafDark, x + 1, y - 1); }
        else { rect(c, C.outline, x, y - 1, 3, 6); rect(c, col, x + 1, y, 1, 4); px(c, hi, x + 1, y); px(c, C.leafLight, x + 1, y - 2); }
      }
    });
  } else if (goods === "fruit") {
    // baskets of mangoes and dragon fruit
    for (const bx of [6, 30, 54]) {
      rect(c, C.outline, bx, 7, 24, 7); rect(c, "#b5874a", bx + 1, 8, 22, 5);
      for (let x = bx + 2; x < bx + 22; x += 3) px(c, "#8a6038", x, 10);
    }
    for (let i = 0; i < 6; i++) { // mangoes
      const x = 8 + i * 3 + (i % 2), y = 3 + (i % 2) * 2;
      rect(c, C.outline, x - 1, y - 1, 5, 5); rect(c, "#f2b233", x, y, 3, 3); px(c, "#f7d36a", x, y); px(c, "#7aa83a", x + 2, y - 1);
    }
    for (let i = 0; i < 5; i++) { // dragon fruit
      const x = 32 + i * 4, y = 3 + (i % 2) * 2;
      rect(c, C.outline, x - 1, y - 1, 5, 6); rect(c, "#d6336c", x, y, 3, 4); px(c, "#f06595", x, y); px(c, "#6fbf4a", x - 1, y + 1); px(c, "#6fbf4a", x + 3, y + 2);
    }
    for (let i = 0; i < 5; i++) { // bananas
      const x = 56 + i * 4, y = 4;
      rect(c, C.outline, x - 1, y - 1, 4, 6); rect(c, "#f6d845", x, y, 2, 4); px(c, "#8a6a3f", x, y - 1);
    }
  } else if (goods === "umbrella") {
    // v18.9 sạp ô dù: two umbrellas open on display, a row of furled ones standing in a bucket, a price slate
    const open: ReadonlyArray<readonly [number, string, string, string]> = [[13, "#e8a13a", "#f6cf7a", "#b86a22"], [38, "#7a2344", "#a8406a", "#4e1229"]];
    for (const [cx, main, light, dark] of open) {
      [1, 4, 7, 9, 10].forEach((hw, r) => {
        rect(c, C.outline, cx - hw - 1, r, hw * 2 + 3, 1);
        rect(c, main, cx - hw, r, hw * 2 + 1, 1);
        rect(c, light, cx - hw, r, Math.max(1, Math.round(hw * 0.6)), 1);
        rect(c, dark, cx + Math.round(hw / 2), r, Math.max(1, hw - Math.round(hw / 2) + 1), 1);
      });
      for (let x = -10; x <= 10; x += 5) px(c, C.outline, cx + x, 5);
      rect(c, C.outline, cx, 5, 1, 8);
    }
    // furled umbrellas in a bucket
    rect(c, C.outline, 58, 7, 22, 7); rect(c, "#6d7a86", 59, 8, 20, 5); rect(c, "#8e9ba8", 59, 8, 20, 1);
    const furled = ["#2f5fa8", "#c0392b", "#5caa4a", "#e0b33c", "#7a2344", "#2e9a94"];
    furled.forEach((col, i) => {
      const x = 60 + i * 3;
      rect(c, C.outline, x - 1, 0, 3, 8); rect(c, col, x, 1, 1, 7);
    });
    rect(c, C.outline, 54, 0, 1, 6); rect(c, C.outline, 51, 1, 7, 5); rect(c, "#2f3a36", 52, 2, 5, 3); rect(c, C.white, 53, 3, 3, 1);
  } else if (goods === "flower") {
    // buckets of flowers: marigolds, roses, lotus
    const cols = ["#f6c945", "#e04a5f", "#f29bb5", "#f4f1ea", "#e07a2e"];
    for (let b = 0; b < 5; b++) {
      const bx = 5 + b * 15;
      rect(c, C.outline, bx, 7, 12, 7); rect(c, "#6d7a86", bx + 1, 8, 10, 5); rect(c, "#8e9ba8", bx + 1, 8, 10, 1);
      for (let k = 0; k < 4; k++) {
        const fx = bx + 2 + k * 2 + (k % 2), fy = 1 + ((k + b) % 3);
        rect(c, C.leafDark, fx + 1, fy + 2, 1, 6 - fy);
        rect(c, C.outline, fx - 1, fy - 1, 4, 4); rect(c, cols[(b + k) % cols.length], fx, fy, 2, 2);
      }
    }
  } else {
    // round paper lanterns lined up on the counter
    const cols = ["#c0392b", "#e0b33c", "#d4758f", "#c0392b", "#e07a2e", "#3d6fd1"];
    cols.forEach((col, i) => {
      const x = 5 + i * 13;
      rect(c, C.outline, x + 1, 2, 9, 11); rect(c, C.outline, x, 3, 11, 9);
      rect(c, col, x + 1, 3, 9, 9); rect(c, col, x + 2, 2, 7, 1);
      rect(c, "#f6d8a8", x + 2, 4, 1, 6);
      for (let y = 5; y < 12; y += 3) rect(c, C.outline, x + 1, y, 9, 1);
      rect(c, C.gold, x + 4, 1, 3, 1); rect(c, C.gold, x + 4, 12, 3, 1);
    });
  }
}

/** A low street-food table with two blue plastic stools. */
function drawEatTable(c: Ctx): void {
  drawStool(c, 0, 12); drawStool(c, 32, 12);
  rect(c, C.outline, 8, 4, 24, 10);
  rect(c, "#d8d4c8", 9, 5, 22, 6); rect(c, "#b8b4a8", 9, 11, 22, 2);
  rect(c, C.outline, 11, 14, 2, 8); rect(c, C.outline, 27, 14, 2, 8);
  // a bowl with chopsticks and a glass of trà đá
  rect(c, C.outline, 12, 5, 7, 4); rect(c, C.white, 13, 5, 5, 3); rect(c, "#c9803a", 14, 5, 3, 1);
  rect(c, C.woodDark, 17, 3, 5, 1);
  rect(c, C.outline, 24, 3, 4, 6); rect(c, "#c98a3a", 25, 5, 2, 3); rect(c, "#e8e4d8", 25, 4, 2, 1);
}

/** A wooden post with a red lantern hanging from its arm. */
function drawLanternPost(c: Ctx): void {
  rect(c, C.outline, 4, 6, 4, 40); rect(c, C.woodDark, 5, 6, 2, 40); rect(c, C.wood, 5, 6, 1, 40);
  rect(c, C.outline, 2, 44, 8, 2);
  rect(c, C.outline, 4, 4, 8, 2);
  rect(c, C.outline, 9, 6, 1, 3);
  rect(c, C.outline, 7, 9, 5, 9); rect(c, C.outline, 6, 10, 7, 7);
  rect(c, C.red, 7, 10, 5, 7); rect(c, "#e85a47", 8, 11, 2, 4); rect(c, C.redDark, 7, 16, 5, 1);
  rect(c, C.gold, 8, 18, 3, 1); rect(c, C.gold, 9, 19, 1, 3);
}

/** A shop's counter: a glossy wooden top over a panelled front. */
function drawShopCounter(c: Ctx): void {
  rect(c, C.outline, 0, 2, 84, 16);
  rect(c, C.woodLight, 1, 3, 82, 3); rect(c, C.woodPale, 1, 3, 82, 1);
  rect(c, C.wood, 1, 6, 82, 11);
  for (let x = 4; x < 80; x += 16) { rect(c, C.woodDark, x, 8, 12, 7); rect(c, C.wood, x + 1, 9, 10, 5); }
  rect(c, C.woodDeep, 1, 16, 82, 1);
}

// ---------------------------------------------------------------- ông Tám's vehicle stall (v18.5)

function line(c: Ctx, col: string, x0: number, y0: number, x1: number, y1: number): void {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= n; i++) px(c, col, Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n));
}

/** A wheel seen from the side: a dark tyre ring, a grey rim and a hub; `spokes` adds four spokes (a bicycle's). */
function wheel(c: Ctx, cx: number, cy: number, r: number, spokes: boolean): void {
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
    const d = Math.hypot(x, y);
    if (d > r + 0.3 || (spokes && d <= r - 1.3)) continue;
    px(c, d > r - 1.3 ? "#1e1a1a" : d > r - 2.2 ? "#8e9ba8" : "#4a4648", cx + x, cy + y);
  }
  if (spokes) {
    line(c, C.silver, cx - r + 2, cy, cx + r - 2, cy); line(c, C.silver, cx, cy - r + 2, cx, cy + r - 2);
    line(c, "#8e9ba8", cx - r + 3, cy - r + 3, cx + r - 3, cy + r - 3); line(c, "#8e9ba8", cx - r + 3, cy + r - 3, cx + r - 3, cy - r + 3);
  }
  px(c, C.silver, cx, cy);
}

/** A small price tag on a string. */
export function drawPriceTag(c: Ctx, x: number, y: number): void {
  px(c, C.outline, x + 2, y - 1);
  rect(c, C.outline, x, y, 6, 4); rect(c, C.white, x + 1, y + 1, 4, 2); px(c, C.red, x + 2, y + 1);
}

// The display vehicles of ông Tám's showroom (market-art.ts draws them in its windows), side views standing on y = 28.

/** Xe đạp (x 4–32): a red frame, a flower basket, spoked wheels. */
export function drawBikeDisplay(c: Ctx): void {
  wheel(c, 9, 23, 5, true); wheel(c, 27, 23, 5, true);
  line(c, C.red, 9, 23, 15, 16); line(c, C.red, 15, 16, 24, 16); line(c, C.red, 15, 16, 18, 23); line(c, C.red, 9, 23, 18, 23);
  line(c, C.red, 24, 16, 18, 23); line(c, C.red, 24, 15, 27, 23);
  line(c, C.outline, 13, 14, 17, 14); rect(c, "#2b2020", 13, 13, 5, 1);
  line(c, C.outline, 23, 12, 25, 15); rect(c, C.outline, 21, 12, 5, 1);
  rect(c, C.outline, 25, 9, 7, 5); rect(c, "#b5874a", 26, 10, 5, 3); px(c, "#e04a5f", 27, 9); px(c, C.gold, 29, 9);
  px(c, C.silver, 18, 23); px(c, C.silver, 19, 24);
}

/** Xe máy (x 33–62): a teal scooter with a cream seat, a front shield and a headlight. */
export function drawScooterDisplay(c: Ctx): void {
  wheel(c, 39, 24, 4, false); wheel(c, 58, 24, 4, false);
  rect(c, C.outline, 35, 15, 17, 8); rect(c, "#2e9a94", 36, 16, 15, 6); rect(c, "#52bcb4", 37, 16, 8, 2);
  rect(c, C.outline, 37, 12, 12, 4); rect(c, "#e8d6b0", 38, 13, 10, 2);
  rect(c, C.outline, 46, 21, 10, 3); rect(c, "#8e9ba8", 47, 22, 8, 1);
  rect(c, C.outline, 54, 9, 5, 15); rect(c, "#2e9a94", 55, 10, 3, 13); px(c, "#52bcb4", 55, 11);
  rect(c, C.outline, 52, 7, 9, 2); rect(c, C.outline, 59, 9, 3, 3); rect(c, C.goldLight, 60, 10, 1, 1);
  rect(c, C.outline, 33, 22, 4, 2); rect(c, C.silver, 34, 22, 2, 1);
  rect(c, C.outline, 56, 17, 5, 3); rect(c, "#1f6e6a", 57, 18, 3, 1);
}

/** Xe hơi (x 64–115): a little red hatchback, light windows, chrome bumpers. */
export function drawCarDisplay(c: Ctx): void {
  rect(c, C.outline, 65, 13, 49, 11); rect(c, C.red, 66, 14, 47, 9); rect(c, "#e85a47", 66, 14, 47, 2); rect(c, C.redDark, 66, 21, 47, 2);
  rect(c, C.outline, 71, 5, 32, 9); rect(c, C.red, 72, 6, 30, 8);
  rect(c, C.outline, 72, 6, 30, 1);
  rect(c, "#bcd6e0", 74, 7, 12, 6); rect(c, "#bcd6e0", 88, 7, 12, 6); rect(c, C.white, 75, 8, 3, 1); rect(c, C.white, 89, 8, 3, 1);
  rect(c, C.redDark, 86, 7, 2, 6);
  rect(c, C.redDark, 87, 15, 1, 6); rect(c, C.outline, 83, 17, 3, 1);
  rect(c, C.silver, 64, 20, 3, 2); rect(c, C.silver, 112, 20, 3, 2);
  rect(c, C.goldLight, 111, 15, 2, 2); rect(c, C.redDark, 66, 15, 2, 2);
  wheel(c, 75, 23, 5, false); wheel(c, 104, 23, 5, false);
}

/** The city-map signpost's sprite: base point at the bottom of the post. */
export const CITY_MAP_POST_FRAME: PropFrame = { w: 22, h: 32, ox: 11, oy: 32 };

/** A wooden post with a little painted town map on its board: water, green blocks, a road cross and a red pin. */
function drawCityMapPost(c: Ctx): void {
  // the post and its foot
  rect(c, C.outline, 9, 16, 4, 16); rect(c, C.wood, 10, 16, 2, 15); rect(c, C.woodLight, 10, 16, 1, 15);
  rect(c, C.outline, 6, 30, 10, 2); rect(c, C.woodDark, 7, 30, 8, 1);
  // the board with a little roof
  rect(c, C.outline, 1, 0, 20, 2); rect(c, C.woodDark, 2, 0, 18, 1);
  rect(c, C.outline, 0, 2, 22, 16); rect(c, C.wood, 1, 3, 20, 14);
  // the painted map
  rect(c, C.paper, 2, 4, 18, 12);
  rect(c, C.water, 2, 13, 18, 3); rect(c, C.waterLight, 4, 14, 3, 1);           // the river along the south
  rect(c, C.grassLight, 3, 5, 5, 3); rect(c, C.gold, 14, 5, 5, 3);               // the pond side, the field
  rect(c, "#c9a8d8", 14, 9, 5, 3); rect(c, C.leafLight, 3, 9, 5, 3);            // the market, the pond
  rect(c, C.dirt, 2, 8, 18, 1); rect(c, C.dirt, 10, 4, 1, 9);                    // the roads
  rect(c, C.outline, 9, 6, 3, 3); rect(c, C.red, 10, 7, 1, 1);                   // the "you are here" pin
  px(c, C.woodLight, 1, 3); px(c, C.woodLight, 20, 3);                           // nails
}

export function drawProp(c: Ctx, p: PropPlacement): void {
  switch (p.kind) {
    case "palm": return drawPalm(c, p.h, p.lean, p.seed);
    case "hammock": return drawHammock(c, p.x, p.y, p.x2);
    case "post": return drawPost(c);
    case "mixer": return drawMixer(c);
    case "table": return drawTable(c);
    case "board": return drawBoard(c);
    case "news_stand": return drawNewsStand(c);
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
    case "market_stall": return drawMarketStall(c, p.goods);
    case "eat_table": return drawEatTable(c);
    case "lantern_post": return drawLanternPost(c);
    case "shop_counter": return drawShopCounter(c);
    case "city_map_post": return drawCityMapPost(c);
    case "punch_bag": return drawPunchBag(c);
    case "ghe": return drawGhe(c);                                               // v21 (0076)
    case "machine_shed": return drawMachineShed(c);                              // v21 (0076)
  }
}

export function propSprite(p: PropPlacement): PropSprite {
  const f = propFrame(p);
  const canvas = makeCanvas(f.w, f.h);
  drawProp(ctx2d(canvas), p);
  return { canvas, x: p.x - f.ox, y: p.y - f.oy, sortY: p.y };
}
