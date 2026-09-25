import { DIG_MOUNDS, inDirtPatch, inPond, onPlatform, POND_CX, POND_CY, POND_H, POND_PLATFORM, POND_RX, POND_RY, POND_W, pondEdge } from "./pond";
import { propSprite } from "./props";
import { C, ctx2d, hexToRgb, makeCanvas, px, rect, rng, type Ctx, type SceneArt } from "./scene-art";
import type { GameMap } from "./types";

// Procedural painters for the pond ("Ao cá"). Browser only (canvas). Props live in props.ts, shared helpers in
// scene-art.ts, the layout in pond.ts. Original art in the approved Miền Tây style — no copied images.

/** Pond-only colours (the shared ones are in scene-art.ts). */
const P = {
  soil: "#6e4a2a", soilDark: "#5a3a1e", soilLight: "#8a6038", mound: "#7a5230", worm: "#f29bb5", wormDark: "#c9687a",
  lily: "#4f9a3a", lilyDark: "#3a7a2c", lilyLight: "#6fbf4a", pink: "#f29bb5", pinkDark: "#d4758f", yellow: "#f6c945",
  reed: "#6a9a38", reedLight: "#8fb84e", reedTip: "#7a4a2a",
  thatch: "#c9a55a", thatchDark: "#a8843f", thatchLight: "#e0c27a",
  bambooBack: "#4f8a30", bambooDots: "#44792a",
};

/** Dirt paths: [x1, y1, x2, y2, half width]. */
const PATHS: ReadonlyArray<readonly [number, number, number, number, number]> = [
  [300, 286, 300, 400, 11],  // the entrance up to the platform
  [300, 322, 600, 322, 9],   // east to the shop
  [498, 322, 498, 150, 8],   // north past the records board
  [498, 150, 600, 150, 8],   // to the depot
  [300, 306, 96, 306, 9],    // west to the worm patch
];

function segDist(x: number, y: number, x1: number, y1: number, x2: number, y2: number): number {
  const vx = x2 - x1, vy = y2 - y1, l2 = vx * vx + vy * vy;
  const t = Math.max(0, Math.min(1, ((x - x1) * vx + (y - y1) * vy) / l2));
  return Math.hypot(x - (x1 + t * vx), y - (y1 + t * vy));
}

function onPath(x: number, y: number): boolean {
  const n = Math.sin(x * 0.21) * 1.2 + Math.sin(y * 0.17) * 1.2;
  return PATHS.some(([x1, y1, x2, y2, w]) => segDist(x, y, x1, y1, x2, y2) < w + n);
}

/** Lily pads (bông súng): x, y, has a flower. */
const LILIES: ReadonlyArray<readonly [number, number, boolean]> = [
  [170, 150, true], [196, 116, false], [238, 98, true], [382, 100, false], [432, 148, true], [456, 196, false],
  [168, 240, false], [222, 262, true], [376, 256, true], [424, 238, false], [330, 124, false], [262, 146, false],
];

// ---------------------------------------------------------------- ground

function paintGround(c: Ctx): void {
  const R = rng(17);
  const img = c.createImageData(POND_W, POND_H);
  const d = img.data;
  const pal = {
    water: hexToRgb(C.water), waterDeep: hexToRgb(C.waterDeep), waterLight: hexToRgb(C.waterLight),
    mud: hexToRgb(C.mud), bank: hexToRgb(C.bank), sand: hexToRgb(C.sand),
    soil: hexToRgb(P.soil), soilDark: hexToRgb(P.soilDark), soilLight: hexToRgb(P.soilLight),
    dirt: hexToRgb(C.dirt), dirtDark: hexToRgb(C.dirtDark), dirtLight: hexToRgb(C.dirtLight),
    grass: hexToRgb(C.grass), grassLight: hexToRgb(C.grassLight), grassDark: hexToRgb(C.grassDark),
  };
  for (let y = 0; y < POND_H; y++) for (let x = 0; x < POND_W; x++) {
    const r = R();
    let col: [number, number, number];
    if (inPond(x, y)) {
      const wob = 3 * Math.sin(x * 0.19 + y * 0.07) + 2 * Math.sin(y * 0.31);
      if (r < 0.035 || !inPond(x, y, -9 + wob * 0.5)) col = pal.waterLight;
      else col = inPond(x, y, -46 + wob) ? pal.waterDeep : pal.water;
    } else if (inPond(x, y, 1)) col = pal.mud;
    else if (inPond(x, y, 2)) col = pal.bank;
    else if (inPond(x, y, 3)) col = pal.sand;
    else if (inDirtPatch(x, y)) col = r < 0.14 ? pal.soilDark : r < 0.24 ? pal.soilLight : pal.soil;
    else if (onPath(x, y)) col = r < 0.12 ? pal.dirtDark : r < 0.2 ? pal.dirtLight : pal.dirt;
    else col = r < 0.1 ? pal.grassLight : r < 0.17 ? pal.grassDark : pal.grass;
    const i = (y * POND_W + x) * 4;
    d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  // grass tufts and a few flowers
  for (let i = 0; i < 560; i++) {
    const x = Math.floor(R() * POND_W), y = Math.floor(R() * POND_H);
    if (inPond(x, y, 8) || onPath(x, y) || inDirtPatch(x, y) || y < 46) continue;
    px(c, C.grassDeep, x, y); px(c, C.grassDeep, x - 1, y - 1); px(c, C.grassTip, x + 1, y - 1); px(c, C.grassDark, x, y - 1);
    if (R() < 0.16) px(c, R() < 0.5 ? P.yellow : P.pink, x + 2, y - 2);
  }
}

function paintBamboo(c: Ctx): void {
  const R = rng(29);
  // a ragged leafy band along the north edge
  for (let x = 0; x < POND_W; x++) {
    const edge = 44 + Math.round(3 * Math.sin(x * 0.31) + 2 * Math.sin(x * 0.9));
    for (let y = 0; y < edge; y++) px(c, y > edge - 2 ? C.leafDark : P.bambooBack, x, y);
  }
  for (let y = 0; y < 44; y++) for (let x = 0; x < POND_W; x++) if (R() < 0.08) px(c, P.bambooDots, x, y);
  for (let i = 0; i < 150; i++) {
    const x = 2 + i * 4 + Math.floor(R() * 2), top = Math.floor(R() * 8), bot = 36 + Math.floor(R() * 8);
    if (x > 512 && x < 636) continue; // the depot's awning covers this stretch
    for (let y = top; y < bot; y++) {
      px(c, C.bamboo, x, y); px(c, C.bambooDark, x + 1, y);
      if ((y - top) % 9 === 0) { px(c, C.bambooNode, x, y); px(c, C.bambooNode, x + 1, y); }
    }
    for (let l = 0; l < 3; l++) {
      const ly = top + Math.floor(R() * (bot - top - 6)), dir = R() < 0.5 ? -1 : 1;
      for (let k = 0; k < 5; k++) px(c, k < 2 ? C.leafLight : C.leaf, x + dir * (k + 1), ly + Math.floor(k / 2));
    }
  }
}

function paintPondDetails(c: Ctx): void {
  const R = rng(41);
  // reeds along the shore
  for (const a of [2.6, 3.0, 3.6, 5.6, 6.0, 0.5, 1.2, 2.1]) {
    const e = pondEdge(a);
    const bx = POND_CX + Math.cos(a) * (POND_RX + 2) * e, by = POND_CY + Math.sin(a) * (POND_RY + 2) * e;
    for (let k = 0; k < 7; k++) {
      const x = Math.round(bx + (k - 3) * 2 + (R() - 0.5) * 2), h = 6 + Math.floor(R() * 6);
      for (let j = 0; j < h; j++) px(c, j < h - 2 ? P.reed : P.reedLight, x, by - j);
      if (R() < 0.6) { px(c, P.reedTip, x, by - h - 1); px(c, P.reedTip, x, by - h - 2); }
    }
  }
  // lily pads (their flowers bob in drawAnimated)
  for (const [x, y] of LILIES) {
    for (let j = -2; j <= 2; j++) for (let i = -4; i <= 4; i++) {
      if ((i * i) / 18 + (j * j) / 5 > 1) continue;
      if (i > 0 && j === 0) continue; // the notch
      px(c, j === 2 || (j === 1 && Math.abs(i) >= 3) ? P.lilyDark : i < -1 && j < 0 ? P.lilyLight : P.lily, x + i, y + j);
    }
  }
  // xuồng ba lá moored in the north-east
  for (let by = 0; by < 8; by++) {
    const inset = Math.abs(3.5 - by) * 3;
    rect(c, by === 0 || by === 7 ? C.outline : C.woodDark, 404 + inset, 110 + by, 40 - inset * 2, 1);
  }
  rect(c, C.woodLight, 414, 113, 20, 2);
  rect(c, C.outline, 424, 100, 1, 11); rect(c, C.wood, 425, 100, 4, 2);
}

function paintPlatform(c: Ctx): void {
  const [bar, stem] = POND_PLATFORM;
  // posts into the water
  const posts: Array<[number, number]> = [
    [bar.x, bar.y + bar.h], [bar.x + bar.w - 3, bar.y + bar.h], [bar.x + 60, bar.y + bar.h], [bar.x + bar.w - 63, bar.y + bar.h],
    [stem.x - 1, stem.y + 30], [stem.x + stem.w - 2, stem.y + 30],
  ];
  for (const [x, y] of posts) rect(c, C.woodDeep, x, y, 3, 4);
  rect(c, C.outline, bar.x - 1, bar.y - 1, bar.w + 2, bar.h + 2);
  rect(c, C.outline, stem.x - 1, stem.y - 1, stem.w + 2, stem.h + 1);
  for (let y = bar.y; y < bar.y + bar.h; y += 4) { rect(c, C.woodLight, bar.x, y, bar.w, 3); rect(c, C.wood, bar.x, y + 3, bar.w, 1); }
  for (let x = bar.x + 23; x < bar.x + bar.w; x += 36) rect(c, C.woodDark, x, bar.y, 1, bar.h);
  for (let x = stem.x; x < stem.x + stem.w; x += 4) { rect(c, C.woodLight, x, stem.y, 3, stem.h); rect(c, C.wood, x + 3, stem.y, 1, stem.h); }
  rect(c, C.woodDark, stem.x, stem.y, stem.w, 1);
}

function paintDigPatch(c: Ctx): void {
  for (const m of DIG_MOUNDS) {
    for (let j = -4; j <= 3; j++) for (let i = -9; i <= 9; i++) {
      const e = (i * i) / 81 + (j * j) / 16;
      if (e > 1) continue;
      const col = e > 0.8 && j > 0 ? C.outline : j <= -2 ? P.soilLight : j >= 1 ? P.soilDark : P.mound;
      px(c, col, m.x + i, m.y + j);
    }
    px(c, "#a8784a", m.x - 3, m.y - 3); px(c, "#a8784a", m.x + 2, m.y - 3);
    // a worm peeking out
    px(c, P.worm, m.x - 4, m.y - 1); px(c, P.worm, m.x - 3, m.y - 1); px(c, P.wormDark, m.x - 2, m.y);
    px(c, P.worm, m.x + 4, m.y + 1); px(c, P.worm, m.x + 5, m.y);
  }
  // a shovel stuck in the soil
  rect(c, C.woodDark, 98, 184, 1, 11); rect(c, C.silver, 96, 195, 5, 4); rect(c, C.outline, 96, 199, 5, 1);
}

function paintStallBack(c: Ctx): void {
  rect(c, C.outline, 519, 58, 110, 50);
  rect(c, C.woodDark, 520, 59, 108, 48);
  rect(c, C.woodDeep, 520, 76, 108, 1); rect(c, C.woodDeep, 520, 92, 108, 1);
  // dried fish (khô) hanging on the back wall
  for (let x = 530; x < 622; x += 14) {
    rect(c, C.outline, x + 3, 61, 1, 3);
    rect(c, "#c9a06a", x, 64, 7, 3); px(c, "#8a6a3f", x + 7, 65); px(c, "#8a6a3f", x + 8, 64); px(c, "#8a6a3f", x + 8, 66);
  }
  // price board
  rect(c, C.outline, 596, 78, 26, 12); rect(c, C.paper, 597, 79, 24, 10);
  rect(c, C.red, 599, 81, 10, 1); rect(c, C.outline, 599, 84, 18, 1); rect(c, C.outline, 599, 86, 14, 1);
}

function paintHutBack(c: Ctx): void {
  rect(c, C.outline, 519, 226, 110, 48);
  rect(c, "#b88a52", 520, 227, 108, 46);
  for (let x = 520; x < 628; x += 5) rect(c, "#a8784a", x, 227, 1, 46);
  // rod rack
  rect(c, C.woodDeep, 528, 236, 36, 2);
  for (let i = 0; i < 5; i++) {
    const x = 531 + i * 7;
    for (let y = 230; y < 270; y++) px(c, i % 2 ? "#b7c65a" : C.wood, x + Math.floor((y - 230) / 14), y);
  }
  // a net and a bait jar
  for (let y = 234; y < 262; y += 3) for (let x = 590; x < 620; x += 3) px(c, "#e8e4d8", x + ((y / 3) % 2), y);
  rect(c, C.outline, 574, 250, 8, 10); rect(c, "#e98a9a", 575, 252, 6, 7);
}

// ---------------------------------------------------------------- public

export function paintPond(map: GameMap): SceneArt {
  const background = makeCanvas(POND_W, POND_H);
  const g = ctx2d(background);
  paintGround(g);
  paintPondDetails(g);
  paintPlatform(g);
  paintDigPatch(g);
  paintBamboo(g);
  paintStallBack(g);
  paintHutBack(g);
  const props = map.props.map(propSprite);

  const drawAnimated = (c: Ctx, t: number, camX: number, camY: number, reducedMotion: boolean) => {
    // lily flowers bob a pixel (still under reduced motion)
    LILIES.forEach(([x, y, flower], i) => {
      if (!flower) return;
      const b = reducedMotion ? 0 : Math.sin(t / 700 + i * 1.7) > 0.3 ? -1 : 0;
      const fx = x - camX, fy = y + b - camY;
      px(c, P.pinkDark, fx - 1, fy - 2); px(c, P.pink, fx, fy - 3); px(c, P.pink, fx - 2, fy - 3); px(c, P.pink, fx - 1, fy - 4);
      px(c, P.yellow, fx - 1, fy - 3);
    });
    if (reducedMotion) return;
    for (let i = 0; i < 90; i++) {
      const sx = POND_CX - POND_RX + ((i * 53 + Math.floor(t / 60)) % (POND_RX * 2));
      const sy = POND_CY - POND_RY + ((i * 29) % (POND_RY * 2));
      if (!inPond(sx, sy, -4) || onPlatform(sx, sy)) continue;
      px(c, C.sparkle, sx - camX, sy - camY);
      px(c, C.sparkle2, sx + 1 - camX, sy - camY);
    }
  };

  const drawOverhead = (c: Ctx, _t: number, camX: number, camY: number) => {
    // the depot's awning: blue and white stripes with a scalloped edge
    const ax = 512 - camX, ay = 36 - camY;
    rect(c, C.outline, ax, ay, 124, 20);
    for (let x = 0; x < 122; x += 6) rect(c, (x / 6) % 2 === 0 ? C.blue : C.white, ax + 1 + x, ay + 1, 6, 17);
    for (let x = 0; x < 122; x += 6) rect(c, (x / 6) % 2 === 0 ? C.blue : C.white, ax + 2 + x, ay + 18, 4, 2);
    rect(c, C.outline, ax, ay + 20, 1, 3); rect(c, C.outline, ax + 123, ay + 20, 1, 3);
    // the hut's thatched roof (lá dừa nước)
    const rx = 508 - camX, ry = 190 - camY;
    for (let j = 0; j < 40; j++) {
      const inset = Math.max(0, 20 - j);
      rect(c, j === 39 ? C.outline : j % 4 === 3 ? P.thatchDark : j % 4 === 0 ? P.thatchLight : P.thatch, rx + inset, ry + j, 132 - inset * 2, 1);
    }
    for (let x = 0; x < 132; x += 3) px(c, P.thatchDark, rx + x, ry + 38 + (x % 2));
    rect(c, C.outline, rx + 20, ry, 92, 1);
  };

  return { background, props, edge: C.grassDark, drawAnimated, drawOverhead };
}
