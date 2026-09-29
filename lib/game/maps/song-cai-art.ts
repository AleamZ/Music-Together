import { RIVER, RIVER_H, RIVER_W, riverWater } from "@/lib/game/river/geometry";
import { JETTY } from "./song-cai";
import { propSprite } from "./props";
import { C, ctx2d, makeCanvas, px, rect, rng, type Ctx, type SceneArt, type SceneLight } from "./scene-art";
import type { GameMap } from "./types";

// Procedural painter for Sông Cái (v22): grassy banks with reeds (lau sậy) and a muddy lip, the wide brown-green river
// (deeper in the middle), four mossy rocks and a small island with a palm, the three shoals (lighter water), the west
// jetty with its lantern. Animated: the current's streaks drifting downstream, lục bình clumps floating by, bubbles over
// the shoals. Browser only (canvas). Original pixel art in the approved Miền Tây style.

const R = {
  water: "#4f8a8c", waterDeep: "#3f7478", waterMid: "#46807f", waterLight: "#6aa6a4", streak: "#8cc4bc", foam: "#d6ece4",
  shoal: "#74b0a2", shoalHi: "#a6d8c6", mud: "#8a6a3f", mudDark: "#6e5230",
  reed: "#9aa84a", reedDark: "#6e7a2e", reedTip: "#d8c878",
  rock: "#7a7468", rockDark: "#56514a", rockHi: "#a39c8e", moss: "#5a8a3a",
  hyacinth: "#3f7a2e", hyacinthHi: "#6aaa4a", hyacinthFlower: "#b58ae0",
};

/** The water's colour at (x, y): darker towards the middle of the band. */
function waterAt(y: number): string {
  const mid = (RIVER.y0 + RIVER.y1) / 2, half = (RIVER.y1 - RIVER.y0) / 2;
  const k = Math.abs(y - mid) / half;
  return k < 0.35 ? R.waterDeep : k < 0.7 ? R.waterMid : R.water;
}

function paintGround(c: Ctx): void {
  const r = rng(8601);
  rect(c, C.grass, 0, 0, RIVER_W, RIVER_H);
  for (let k = 0; k < 5200; k++) px(c, r() < 0.5 ? C.grassLight : C.grassDark, Math.floor(r() * RIVER_W), Math.floor(r() * RIVER_H));
  // the water, row by row, with a muddy lip that wanders a little into the land
  for (let y = 0; y < RIVER_H; y++) {
    for (let x = 0; x < RIVER_W; x++) {
      if (riverWater(x, y)) px(c, waterAt(y), x, y);
    }
  }
  for (let x = 0; x < RIVER_W; x++) {
    const n = Math.round(2 + 2 * Math.sin(x / 37) + Math.sin(x / 11));
    rect(c, R.mud, x, RIVER.y0 - n - 2, 1, n + 2);
    rect(c, R.mudDark, x, RIVER.y0 - 1, 1, 1);
    rect(c, R.mud, x, RIVER.y1 + 1, 1, n + 2);
    rect(c, R.mudDark, x, RIVER.y1 + 1, 1, 1);
  }
  for (let y = RIVER.y0 - 6; y < RIVER.y1 + 6; y++) {
    const n = Math.round(2 + Math.sin(y / 23) * 2);
    rect(c, R.mud, RIVER.x0 - n - 2, y, n + 2, 1);
    rect(c, R.mud, RIVER.x1 + 1, y, n + 2, 1);
  }
  // reeds along both banks
  for (let k = 0; k < 150; k++) {
    const x = Math.floor(r() * RIVER_W), north = k % 2 === 0;
    const base = north ? RIVER.y0 - 3 : RIVER.y1 + 10;
    const h = 6 + Math.floor(r() * 8);
    rect(c, R.reedDark, x, base - h, 1, h);
    rect(c, R.reed, x + 1, base - h + 2, 1, h - 2);
    if (r() < 0.4) rect(c, R.reedTip, x, base - h - 2, 2, 3);
  }
  // ripples in the water
  for (let k = 0; k < 700; k++) {
    const x = Math.floor(r() * RIVER_W), y = Math.floor(r() * RIVER_H);
    if (riverWater(x, y) && riverWater(x + 3, y)) rect(c, R.waterLight, x, y, 3, 1);
  }
}

function paintShoals(c: Ctx): void {
  const r = rng(8602);
  for (const [sx, sy, sr] of RIVER.shoals) {
    for (let k = 0; k < 520; k++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * sr;
      const x = Math.round(sx + Math.cos(a) * d), y = Math.round(sy + Math.sin(a) * d * 0.8);
      if (riverWater(x, y)) px(c, d < sr * 0.6 ? R.shoal : R.waterLight, x, y);
    }
    for (let k = 0; k < 18; k++) {
      const a = r() * Math.PI * 2, d = r() * sr * 0.7;
      const x = Math.round(sx + Math.cos(a) * d), y = Math.round(sy + Math.sin(a) * d * 0.8);
      if (riverWater(x, y)) rect(c, R.shoalHi, x, y, 2, 1);
    }
  }
}

function paintRocks(c: Ctx): void {
  const r = rng(8603);
  RIVER.rocks.forEach(([cx, cy, rr], i) => {
    const island = i === RIVER.rocks.length - 1;
    for (let y = -rr; y <= rr; y++) for (let x = -rr; x <= rr; x++) {
      const d = x * x + y * y;
      if (d >= rr * rr) continue;
      const edge = d > (rr - 2) * (rr - 2);
      let col: string;
      if (island) col = edge ? R.mud : d > (rr - 6) * (rr - 6) ? C.sand : r() < 0.5 ? C.grass : C.grassLight;
      else col = edge ? C.outline : y < -rr / 3 && x < 0 ? R.rockHi : y > rr / 3 ? R.rockDark : R.rock;
      px(c, col, cx + x, cy + y);
    }
    if (!island) {
      for (let k = 0; k < rr; k++) px(c, R.moss, cx - rr + 3 + Math.floor(r() * (rr * 2 - 6)), cy - Math.floor(r() * 3));
      // the foam where the current meets it
      for (let y = -rr + 3; y < rr - 3; y += 2) px(c, R.foam, cx - rr - 1, cy + y);
    }
  });
}

function paintJetty(c: Ctx): void {
  const { x, y, w, h } = JETTY;
  for (const px0 of [x + 6, x + 26, x + 46]) { rect(c, C.woodDeep, px0, y + h, 3, 5); rect(c, C.woodDeep, px0, y - 3, 3, 4); }
  rect(c, C.outline, x, y - 1, w + 1, h + 2);
  for (let yy = y; yy < y + h; yy += 4) { rect(c, C.woodLight, x, yy, w, 3); rect(c, C.wood, x, yy + 3, w, 1); }
  for (let xx = x + 14; xx < x + w; xx += 18) rect(c, C.woodDark, xx, y, 1, h);
  // the mooring post and its rope
  rect(c, C.outline, x + w - 4, y - 10, 6, 12); rect(c, C.woodDark, x + w - 3, y - 9, 4, 10);
  rect(c, C.goldLight, x + w - 3, y - 6, 4, 1);
}

/** Lục bình clumps drifting downstream: seeded lanes, positions from the time. */
const HYACINTHS = Array.from({ length: 9 }, (_, i) => ({ y: 100 + ((i * 37) % 290), speed: 6 + (i % 4) * 2, off: i * 211 }));

export function paintSongCai(map: GameMap): SceneArt {
  const background = makeCanvas(RIVER_W, RIVER_H);
  const g = ctx2d(background);
  paintGround(g);
  paintShoals(g);
  paintRocks(g);
  paintJetty(g);
  const props = map.props.map(propSprite);
  const drawAnimated = (c: Ctx, t: number, camX: number, camY: number, reducedMotion: boolean) => {
    if (reducedMotion) return;
    // the current: short light streaks drifting right
    for (let i = 0; i < 80; i++) {
      const lane = RIVER.y0 + 8 + ((i * 61) % (RIVER.y1 - RIVER.y0 - 16));
      const x = RIVER.x0 + ((i * 131 + Math.floor(t / 45)) % (RIVER.x1 - RIVER.x0));
      if (!riverWater(x, lane) || !riverWater(x + 6, lane)) continue;
      rect(c, R.streak, x - camX, lane - camY, 5, 1);
    }
    // bubbles over the shoals
    RIVER.shoals.forEach(([sx, sy], i) => {
      for (let k = 0; k < 4; k++) {
        const ph = (t / 900 + k * 0.25 + i * 0.3) % 1;
        const bx = sx - 20 + ((k * 23 + i * 7) % 40), by = sy + 10 - ph * 20;
        if (ph < 0.8) px(c, R.foam, bx - camX, Math.round(by) - camY);
      }
    });
    // lục bình
    for (const h of HYACINTHS) {
      const span = RIVER.x1 - RIVER.x0 + 40;
      const x = RIVER.x0 - 20 + ((h.off + (t / 1000) * h.speed) % span);
      const y = h.y + Math.round(Math.sin(t / 700 + h.off) * 1.5);
      if (!riverWater(Math.round(x), y)) continue;
      const fx = Math.round(x) - camX, fy = y - camY;
      rect(c, C.outline, fx - 4, fy - 2, 9, 4);
      rect(c, R.hyacinth, fx - 3, fy - 2, 7, 3);
      rect(c, R.hyacinthHi, fx - 2, fy - 3, 3, 2);
      px(c, R.hyacinthFlower, fx + 1, fy - 4);
    }
  };
  const drawOverhead = () => {};
  return { background, props, edge: C.grassDark, drawAnimated, drawOverhead, lights: SC_LIGHTS, moon: { x: 480, y: 250, w: 60 } };
}

/** The jetty's lantern and the island's fisherman's lamp. */
const SC_LIGHTS: ReadonlyArray<SceneLight> = [
  { x: JETTY.x + JETTY.w - 1, y: JETTY.y - 8, r: 70, hue: "lantern" },
  { x: 620, y: 226, r: 40, hue: "warm" },
];
