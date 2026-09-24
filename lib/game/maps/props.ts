import { C, ctx2d, makeCanvas, px, rect, rng, type Ctx, type PropFrame, type PropSprite } from "./scene-art";
import type { PropPlacement } from "./types";

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
  }
}

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

const SIGN_ICONS: Record<"fish" | "note", { rows: string[]; color: string; x: number; y: number }> = {
  fish: { rows: ["..####...", ".######.#", "########.", ".######.#", "..####..."], color: "#3d86a8", x: 4, y: 3 },
  note: { rows: ["...##.", "...#.#", "...#..", ".###..", "####..", ".##..."], color: C.red, x: 6, y: 2 },
};

/** A signpost with a pixel icon: a fish (the hall's "Bến câu cá") or a music note (the pond's "Bến vào"). */
function drawSign(c: Ctx, icon: "fish" | "note"): void {
  rect(c, C.outline, 7, 10, 4, 16); rect(c, C.wood, 8, 10, 2, 16);
  rect(c, C.outline, 0, 0, 18, 12); rect(c, C.woodLight, 1, 1, 16, 10);
  const ic = SIGN_ICONS[icon];
  ic.rows.forEach((r, j) => {
    for (let i = 0; i < r.length; i++) if (r.charAt(i) === "#") px(c, ic.color, ic.x + i, ic.y + j);
  });
  if (icon === "fish") px(c, C.white, 6, 5);
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
  }
}

export function propSprite(p: PropPlacement): PropSprite {
  const f = propFrame(p);
  const canvas = makeCanvas(f.w, f.h);
  drawProp(ctx2d(canvas), p);
  return { canvas, x: p.x - f.ox, y: p.y - f.oy, sortY: p.y };
}
