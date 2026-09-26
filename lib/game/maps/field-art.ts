import { paintBed, paintHole } from "@/lib/game/art/gather-art";
import {
  BRIDGES, CANAL, COOP, CRAB_HOLES, DRYING_SQUARES, DRYING_YARD, FARM_SHOP, FIELD_H, FIELD_PLOTS, FIELD_W, RAT_HOLES, RICE_DEPOT,
  SNAIL_BEDS,
} from "./field";
import { propSprite } from "./props";
import { C, ctx2d, hexToRgb, makeCanvas, px, rect, rng, type Ctx, type SceneArt } from "./scene-art";
import type { GameMap, Rect } from "./types";

// Procedural painters for the field ("Đồng ruộng"). Browser only (canvas). Props live in props.ts, the layout in
// field.ts; the rice on each plot is drawn by the engine from field_state (art/crops.ts) — here the plots are bare
// stubble — and so are the cues on the crab holes and snail beds painted here (art/gather-art.ts). Original art in the
// approved Miền Tây style — no copied images.

/** Field-only colours (the shared ones are in scene-art.ts). */
const F = {
  soil: "#8a6a3f", soilDark: "#735632", stubble: "#d8c07a", stubbleDark: "#b89a58",
  dike: "#86b04e", dikeDark: "#6f9a3c", dikeEdge: "#5a7f30",
  concrete: "#c9c5b8", concreteDark: "#aaa698", concreteLight: "#dedacd",
  plaster: "#efe4c8", plasterDark: "#d8c9a4", tile: "#b5463a", tileDark: "#8e3a30", tileLight: "#cf6a52",
  tin: "#8fa3ad", tinDark: "#71858f", tinLight: "#b3c4cc", awningA: "#3f7f2e", awningB: "#f4f1ea",
  plank: "#b88a52", plankDark: "#8b5a33",
};

const inRect = (x: number, y: number, r: Rect) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
const inPlot = (x: number, y: number) => FIELD_PLOTS.some((p) => inRect(x, y, p.rect));
/** The farmed area: plots and the dikes between them (west of the buildings, north of the south road). */
const inFarm = (x: number, y: number) => x >= 64 && x < 516 ? y >= 40 && y < 412 : x >= 516 && x < 664 && y >= 40 && y < 176;

function onRoad(x: number, y: number): boolean {
  const wob = Math.sin(y * 0.13) * 1.5 + Math.sin(x * 0.21);
  if (x < 60 + wob) return true;                                  // Đường làng along the west edge
  if (y > 416 + wob && x < 560) return true;                      // the south road
  if (x >= 512 + wob && x < 586 && y >= 208) return true;         // the lane south from the east bridge
  if (y >= 212 + wob && y < 262 && x >= 586) return true;         // east to Cầu khỉ
  if (y >= 330 && y < 388 && x >= 586) return true;               // in front of the shop and the depot
  return x >= 660 && y >= 136 + wob && y < 176;                   // in front of the Hợp tác xã
}

// ---------------------------------------------------------------- ground

function paintGround(c: Ctx): void {
  const R = rng(31);
  const img = c.createImageData(FIELD_W, FIELD_H);
  const d = img.data;
  const pal = {
    water: hexToRgb(C.water), waterDeep: hexToRgb(C.waterDeep), waterLight: hexToRgb(C.waterLight),
    mud: hexToRgb(C.mud), bank: hexToRgb(C.bank),
    soil: hexToRgb(F.soil), soilDark: hexToRgb(F.soilDark), stubble: hexToRgb(F.stubble), stubbleDark: hexToRgb(F.stubbleDark),
    dike: hexToRgb(F.dike), dikeDark: hexToRgb(F.dikeDark), dikeEdge: hexToRgb(F.dikeEdge),
    dirt: hexToRgb(C.dirt), dirtDark: hexToRgb(C.dirtDark), dirtLight: hexToRgb(C.dirtLight),
    concrete: hexToRgb(F.concrete), concreteDark: hexToRgb(F.concreteDark),
    grass: hexToRgb(C.grass), grassLight: hexToRgb(C.grassLight), grassDark: hexToRgb(C.grassDark),
  };
  for (let y = 0; y < FIELD_H; y++) for (let x = 0; x < FIELD_W; x++) {
    const r = R();
    let col: [number, number, number];
    if (inRect(x, y, CANAL) && !BRIDGES.some((b) => inRect(x, y, b))) {
      const edge = Math.min(y - CANAL.y, CANAL.y + CANAL.h - 1 - y);
      col = edge === 0 ? pal.mud : edge === 1 ? pal.bank : r < 0.04 ? pal.waterLight : edge > 8 ? pal.waterDeep : pal.water;
    } else if (inPlot(x, y)) {
      const p = FIELD_PLOTS.find((q) => inRect(x, y, q.rect))!.rect;
      const border = x === p.x || y === p.y || x === p.x + p.w - 1 || y === p.y + p.h - 1;
      const row = (y - p.y) % 6;
      col = border ? pal.dikeEdge : row === 3 && (x - p.x) % 3 !== 0 ? (r < 0.5 ? pal.stubble : pal.stubbleDark) : r < 0.15 ? pal.soilDark : pal.soil;
    } else if (inRect(x, y, DRYING_YARD)) col = r < 0.12 ? pal.concreteDark : pal.concrete;
    else if (onRoad(x, y)) col = r < 0.12 ? pal.dirtDark : r < 0.2 ? pal.dirtLight : pal.dirt;
    else if (inFarm(x, y)) col = r < 0.12 ? pal.dikeDark : pal.dike;
    else col = r < 0.1 ? pal.grassLight : r < 0.17 ? pal.grassDark : pal.grass;
    const i = (y * FIELD_W + x) * 4;
    d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  // grass tufts and flowers off the plots, roads and water
  for (let i = 0; i < 700; i++) {
    const x = Math.floor(R() * FIELD_W), y = 42 + Math.floor(R() * (FIELD_H - 42));
    if (inPlot(x, y) || onRoad(x, y) || inRect(x, y, CANAL) || inRect(x, y, DRYING_YARD)) continue;
    px(c, C.grassDeep, x, y); px(c, C.grassDeep, x - 1, y - 1); px(c, C.grassTip, x + 1, y - 1); px(c, C.grassDark, x, y - 1);
    if (R() < 0.12) px(c, R() < 0.5 ? "#f6c945" : "#f4f1ea", x + 2, y - 2);
  }
}

function paintBamboo(c: Ctx): void {
  const R = rng(37);
  for (let x = 0; x < FIELD_W; x++) {
    const edge = 40 + Math.round(3 * Math.sin(x * 0.29) + 2 * Math.sin(x * 0.83));
    for (let y = 0; y < edge; y++) px(c, y > edge - 2 ? C.leafDark : "#4f8a30", x, y);
  }
  for (let y = 0; y < 40; y++) for (let x = 0; x < FIELD_W; x++) if (R() < 0.08) px(c, "#44792a", x, y);
  for (let i = 0; i < 190; i++) {
    const x = 2 + i * 4 + Math.floor(R() * 2), top = Math.floor(R() * 8), bot = 32 + Math.floor(R() * 8);
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

function paintBridges(c: Ctx): void {
  for (const b of BRIDGES) {
    rect(c, C.outline, b.x - 1, b.y + 4, b.w + 2, b.h - 8);
    for (let y = b.y + 5; y < b.y + b.h - 5; y += 4) { rect(c, F.plank, b.x, y, b.w, 3); rect(c, F.plankDark, b.x, y + 3, b.w, 1); }
    rect(c, C.woodDeep, b.x + 1, b.y + 4, 2, b.h - 8); rect(c, C.woodDeep, b.x + b.w - 3, b.y + 4, 2, b.h - 8);
  }
  // Cầu khỉ: a bamboo pole with a handrail leading off the east edge
  for (let x = 788; x < FIELD_W; x++) {
    px(c, C.bamboo, x, 250); px(c, C.bambooDark, x, 251); px(c, C.bambooNode, x, 242);
    if (x % 4 === 0) rect(c, C.bambooDark, x, 242, 1, 9);
  }
}

function paintDryingYard(c: Ctx): void {
  const DIGITS: Record<number, readonly string[]> = {
    1: [".#.", "##.", ".#.", ".#.", "###"], 2: ["##.", "..#", ".#.", "#..", "###"],
    3: ["##.", "..#", ".#.", "..#", "##."], 4: ["#.#", "#.#", "###", "..#", "..#"],
  };
  rect(c, F.concreteDark, DRYING_YARD.x, DRYING_YARD.y, DRYING_YARD.w, 1);
  DRYING_SQUARES.forEach((s, i) => {
    rect(c, F.concreteDark, s.x, s.y, s.w, s.h);
    rect(c, F.concreteLight, s.x + 1, s.y + 1, s.w - 2, s.h - 2);
    DIGITS[i + 1].forEach((row, j) => {
      for (let k = 0; k < 3; k++) if (row.charAt(k) === "#") px(c, F.concreteDark, s.x + 3 + k, s.y + 3 + j);
    });
  });
}

/** A rat hole (v17 §14): a dark 7 × 4 burrow, its lit south rim and three crumbs of dug earth, 11 × 6 px in all around
 *  (x, y). */
function paintRatHole(c: Ctx, x: number, y: number): void {
  rect(c, "#24190f", x - 2, y - 2, 5, 1);
  rect(c, "#24190f", x - 3, y - 1, 7, 2);
  rect(c, "#24190f", x - 2, y + 1, 5, 1);
  rect(c, "#6e5230", x - 2, y + 2, 5, 1);
  px(c, "#8a6a3f", x - 5, y + 2);
  px(c, "#8a6a3f", x + 4, y + 3);
  px(c, "#8a6a3f", x + 5, y + 1);
}

function paintBuildings(c: Ctx): void {
  // Hợp tác xã: plastered walls with two shuttered windows (the front wall is the coop_front prop)
  rect(c, C.outline, COOP.x, COOP.y + 16, COOP.w, COOP.h - 16);
  rect(c, F.plaster, COOP.x + 1, COOP.y + 17, COOP.w - 2, COOP.h - 18);
  rect(c, F.plasterDark, COOP.x + 1, COOP.y + 17, COOP.w - 2, 2);
  for (const wx of [COOP.x + 14, COOP.x + 76]) {
    rect(c, C.outline, wx, COOP.y + 30, 20, 16); rect(c, "#3f7f7a", wx + 1, COOP.y + 31, 18, 14);
    rect(c, "#2f5f5a", wx + 10, COOP.y + 31, 1, 14);
  }
  // Tiệm vật tư: a green-painted back wall with shelves of sacks
  rect(c, C.outline, FARM_SHOP.x, FARM_SHOP.y, FARM_SHOP.w, 36);
  rect(c, "#9ab86a", FARM_SHOP.x + 1, FARM_SHOP.y + 1, FARM_SHOP.w - 2, 34);
  for (let y = FARM_SHOP.y + 10; y < FARM_SHOP.y + 34; y += 12) {
    rect(c, C.woodDark, FARM_SHOP.x + 6, y, FARM_SHOP.w - 12, 2);
    for (let x = FARM_SHOP.x + 8; x < FARM_SHOP.x + FARM_SHOP.w - 12; x += 9) rect(c, x % 2 ? C.paper : "#e8dcc0", x, y - 7, 7, 7);
  }
  // Vựa lúa: plank walls and a big door
  rect(c, C.outline, RICE_DEPOT.x, RICE_DEPOT.y, RICE_DEPOT.w, 36);
  for (let x = RICE_DEPOT.x + 1; x < RICE_DEPOT.x + RICE_DEPOT.w - 1; x += 4) {
    rect(c, F.plank, x, RICE_DEPOT.y + 1, 3, 34); rect(c, F.plankDark, x + 3, RICE_DEPOT.y + 1, 1, 34);
  }
  rect(c, C.outline, RICE_DEPOT.x + 58, RICE_DEPOT.y + 6, 28, 30); rect(c, C.woodDark, RICE_DEPOT.x + 59, RICE_DEPOT.y + 7, 26, 29);
  rect(c, C.woodDeep, RICE_DEPOT.x + 71, RICE_DEPOT.y + 7, 1, 29);
}

// ---------------------------------------------------------------- public

export function paintField(map: GameMap): SceneArt {
  const background = makeCanvas(FIELD_W, FIELD_H);
  const g = ctx2d(background);
  paintGround(g);
  paintBridges(g);
  for (const r of CRAB_HOLES) paintHole(g, r);
  for (const r of SNAIL_BEDS) paintBed(g, r);
  for (const h of RAT_HOLES) paintRatHole(g, h.x, h.y);
  paintDryingYard(g);
  paintBuildings(g);
  paintBamboo(g);
  const props = map.props.map(propSprite);

  const drawAnimated = (c: Ctx, t: number, camX: number, camY: number, reducedMotion: boolean) => {
    if (reducedMotion) return;
    for (let i = 0; i < 70; i++) {
      const sx = CANAL.x + 4 + ((i * 67 + Math.floor(t / 70)) % (CANAL.w - 8));
      const sy = CANAL.y + 5 + ((i * 13) % (CANAL.h - 10));
      if (BRIDGES.some((b) => inRect(sx, sy, b))) continue;
      px(c, C.sparkle, sx - camX, sy - camY);
      px(c, C.sparkle2, sx + 1 - camX, sy - camY);
    }
  };

  const drawOverhead = (c: Ctx, _t: number, camX: number, camY: number) => {
    // the Hợp tác xã's tiled roof
    const rx = COOP.x - 6 - camX, ry = COOP.y - 12 - camY;
    for (let j = 0; j < 30; j++) {
      const inset = Math.max(0, 14 - j);
      rect(c, j === 29 ? C.outline : j % 4 === 3 ? F.tileDark : j % 4 === 0 ? F.tileLight : F.tile, rx + inset, ry + j, COOP.w + 12 - inset * 2, 1);
    }
    rect(c, C.outline, rx + 14, ry, COOP.w - 16, 1);
    // the farm shop's awning: green and white stripes with a scalloped edge
    const ax = FARM_SHOP.x - 6 - camX, ay = FARM_SHOP.y - 14 - camY;
    rect(c, C.outline, ax, ay, FARM_SHOP.w + 12, 18);
    for (let x = 0; x < FARM_SHOP.w + 10; x += 6) rect(c, (x / 6) % 2 === 0 ? F.awningA : F.awningB, ax + 1 + x, ay + 1, 6, 15);
    for (let x = 0; x < FARM_SHOP.w + 10; x += 6) rect(c, (x / 6) % 2 === 0 ? F.awningA : F.awningB, ax + 2 + x, ay + 16, 4, 2);
    // the rice depot's tin roof
    const tx = RICE_DEPOT.x - 6 - camX, ty = RICE_DEPOT.y - 18 - camY;
    for (let j = 0; j < 20; j++) {
      rect(c, j === 19 ? C.outline : j % 2 ? F.tinDark : F.tin, tx, ty + j, RICE_DEPOT.w + 12, 1);
    }
    for (let x = 0; x < RICE_DEPOT.w + 12; x += 5) rect(c, F.tinLight, tx + x, ty, 1, 19);
  };

  return { background, props, edge: C.grassDark, drawAnimated, drawOverhead };
}
