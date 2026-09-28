import { BAI_H, BAI_W, BRIDGE, BROKEN_WALL, RING_RECTS, TAP, TIRES } from "./bai-dat";
import { drawText } from "./khu-nha-art";
import { propSprite } from "./props";
import { C, ctx2d, makeCanvas, px, rect, rng, type Ctx, type SceneArt, type SceneLight } from "./scene-art";
import type { GameMap, Rect } from "./types";

// Procedural painter for Bãi đất trống (v20.3): packed dirt with weeds and tyre ruts, the canal and its little bridge to
// the north, four rings on raised plank floors with canvas mats, ropes and corner pads (red on the west, blue on the
// east) under corrugated tin roofs, a stack of old tyres, a dripping water tap, a broken brick wall on the east and a
// sheet-iron fence along the south. Browser only (canvas). Original art in the approved Miền Tây style.

const B = {
  dirt: "#b99468", dirtDark: "#a3805a", dirtLight: "#cda77a", rut: "#94734e",
  weed: "#6a8f3a", weedLight: "#88ac48",
  canal: "#2f5e7a", canalLight: "#4a7e9a", plank: "#9a6a3c", plankDark: "#6e4a28",
  mat: "#d9cfb4", matDark: "#bfb394", matLine: "#a89c7c", apron: "#7a5a3a",
  rope: "#f1ece0", ropeShade: "#b8b2a4", red: "#c0392b", redDark: "#8e2a1f", blue: "#2f5fb8", blueDark: "#1f3f86",
  tin: "#9aa3ad", tinDark: "#6f7882", tinLight: "#c2c9d0", rust: "#9a5a32",
  brick: "#a8523a", brickDark: "#7e3a28", mortar: "#c9b89a",
  tire: "#2a2a2e", tireLight: "#4a4a52", fence: "#7d8690", fenceDark: "#59616a",
};

function paintGround(c: Ctx): void {
  const r = rng(2003);
  rect(c, B.dirt, 0, 0, BAI_W, BAI_H);
  for (let k = 0; k < 2600; k++) {
    const x = Math.floor(r() * BAI_W), y = Math.floor(r() * BAI_H);
    px(c, r() < 0.5 ? B.dirtDark : B.dirtLight, x, y);
  }
  // tyre ruts from the bridge to the rings
  for (let y = 26; y < 384; y += 2) {
    const wob = Math.round(Math.sin(y / 23) * 3);
    px(c, B.rut, 392 + wob, y); px(c, B.rut, 408 + wob, y);
  }
  // weeds in clumps along the edges and between the rings
  for (let k = 0; k < 140; k++) {
    const edge = r() < 0.5;
    const x = edge ? (r() < 0.5 ? 6 + r() * 60 : 690 + r() * 50) : 320 + r() * 160;
    const y = 30 + r() * 350;
    const col = r() < 0.5 ? B.weed : B.weedLight;
    px(c, col, x, y); px(c, col, x + 1, y - 1); px(c, col, x - 1, y - 1); px(c, col, x, y - 2);
  }
  // the canal and its bridge to the north
  rect(c, B.canal, 0, 0, BAI_W, 22);
  for (let x = 0; x < BAI_W; x += 10) rect(c, B.canalLight, x + Math.floor(r() * 5), 6 + Math.floor(r() * 12), 5, 1);
  rect(c, C.outline, 0, 22, BAI_W, 2);
  rect(c, B.plankDark, BRIDGE.x - 2, 0, BRIDGE.w + 4, BRIDGE.h);
  for (let y = 0; y < BRIDGE.h; y += 4) rect(c, B.plank, BRIDGE.x, y, BRIDGE.w, 3);
  rect(c, C.outline, BRIDGE.x - 3, 0, 1, BRIDGE.h); rect(c, C.outline, BRIDGE.x + BRIDGE.w + 2, 0, 1, BRIDGE.h);
  // the sheet-iron fence along the south
  rect(c, C.outline, 0, 383, BAI_W, 1);
  for (let x = 0; x < BAI_W; x += 14) {
    rect(c, x % 28 ? B.fence : B.fenceDark, x, 384, 13, 16);
    rect(c, B.tinLight, x + 2, 386, 1, 12);
    if (r() < 0.3) rect(c, B.rust, x + 4 + Math.floor(r() * 6), 388 + Math.floor(r() * 8), 3, 2);
  }
}

function paintRing(c: Ctx, r: Rect, n: number): void {
  const { x, y, w, h } = r;
  // the raised plank floor (an apron round the mat), the mat with its seams
  rect(c, C.outline, x - 1, y - 1, w + 2, h + 2);
  rect(c, B.apron, x, y, w, h);
  rect(c, B.mat, x + 5, y + 5, w - 10, h - 10);
  for (let yy = y + 20; yy < y + h - 6; yy += 20) rect(c, B.matLine, x + 5, yy, w - 10, 1);
  for (let xx = x + 5; xx < x + w - 5; xx += 3) if ((xx + y) % 7 === 0) px(c, B.matDark, xx, y + 5 + ((xx * 13) % (h - 12)));
  // the ring's number in the middle of the mat
  drawText(c, B.matLine, `SAN ${n}`, x + w / 2 - 12, y + h / 2 - 2);
  // the red corner pad (west) and the blue one (east)
  rect(c, B.red, x + 6, y + h / 2 - 10, 4, 20); rect(c, B.redDark, x + 6, y + h / 2 + 8, 4, 2);
  rect(c, B.blue, x + w - 10, y + h / 2 - 10, 4, 20); rect(c, B.blueDark, x + w - 10, y + h / 2 + 8, 4, 2);
  // three ropes round the edge (the near side is drawn lower: it reads as height)
  for (const k of [0, 2, 4]) {
    rect(c, B.rope, x + 3, y + 2 + k, w - 6, 1);
    rect(c, B.ropeShade, x + 3, y + h - 3 - k, w - 6, 1);
    rect(c, B.rope, x + 2 + k / 2, y + 3, 1, h - 6);
    rect(c, B.rope, x + w - 3 - k / 2, y + 3, 1, h - 6);
  }
  // corner posts: red on the west, blue on the east
  for (const [px0, py0, col] of [[x, y, B.red], [x, y + h - 6, B.red], [x + w - 6, y, B.blue], [x + w - 6, y + h - 6, B.blue]] as const) {
    rect(c, C.outline, px0, py0 - 8, 6, 14);
    rect(c, col, px0 + 1, py0 - 7, 4, 12);
    rect(c, B.tinLight, px0 + 1, py0 - 7, 1, 12);
  }
  // the corrugated tin roof's far eave over the back rope (the roof itself is drawn as seen from below: its shadow)
  rect(c, C.outline, x - 4, y - 16, w + 8, 9);
  for (let xx = x - 3; xx < x + w + 4; xx += 3) rect(c, (xx / 3) % 2 ? B.tin : B.tinLight, xx, y - 15, 2, 7);
  rect(c, B.tinDark, x - 3, y - 9, w + 6, 1);
  for (let k = 0; k < 5; k++) rect(c, B.rust, x + 12 + k * 41, y - 13, 3, 2);
  c.globalAlpha = 0.12;
  rect(c, "#000000", x - 2, y - 7, w + 4, h + 6);
  c.globalAlpha = 1;
}

function paintTires(c: Ctx): void {
  const { x, y, w } = TIRES;
  for (let k = 0; k < 3; k++) {
    const ty = y + 10 - k * 6, tw = w - k * 2, tx = x + k;
    rect(c, C.outline, tx - 1, ty - 1, tw + 2, 8);
    rect(c, B.tire, tx, ty, tw, 6);
    rect(c, B.tireLight, tx + 2, ty + 1, tw - 4, 1);
    rect(c, "#161618", tx + tw / 2 - 5, ty + 2, 10, 2);
  }
}

function paintTap(c: Ctx): void {
  const { x, y } = TAP;
  rect(c, C.outline, x - 3, y - 18, 6, 18); rect(c, B.fenceDark, x - 2, y - 17, 4, 17);
  rect(c, C.outline, x - 1, y - 20, 7, 3); rect(c, C.silver, x, y - 19, 5, 1);
  rect(c, C.silver, x + 4, y - 18, 1, 3);
  rect(c, B.canalLight, x + 2, y + 1, 5, 2); rect(c, B.canal, x + 3, y + 2, 3, 1);   // a puddle below the spout
}

function paintBrokenWall(c: Ctx): void {
  for (const w of BROKEN_WALL) {
    rect(c, C.outline, w.x - 1, w.y - 1, w.w + 2, w.h + 2);
    for (let yy = w.y; yy < w.y + w.h; yy += 5) {
      const off = ((yy - w.y) / 5) % 2 ? 3 : 0;
      rect(c, B.mortar, w.x, yy, w.w, 1);
      for (let xx = w.x - off; xx < w.x + w.w; xx += 6) rect(c, (xx + yy) % 4 ? B.brick : B.brickDark, Math.max(w.x, xx), yy + 1, Math.min(5, w.x + w.w - Math.max(w.x, xx)), 4);
    }
    // a jagged broken top
    for (let k = 0; k < w.w; k += 3) rect(c, B.dirt, w.x + k, w.y, 2, 1 + ((k * 7) % 4));
  }
  // rubble at the wall's foot
  const r = rng(2004);
  for (let k = 0; k < 60; k++) px(c, r() < 0.5 ? B.brick : B.mortar, 736 + r() * 40, 60 + r() * 310);
}

export function paintBaiDat(map: GameMap): SceneArt {
  const background = makeCanvas(BAI_W, BAI_H);
  const g = ctx2d(background);
  paintGround(g);
  RING_RECTS.forEach((r, i) => paintRing(g, r, i + 1));
  paintTires(g);
  paintTap(g);
  paintBrokenWall(g);
  const props = map.props.map(propSprite);
  const drawAnimated = (c: Ctx, t: number, camX: number, camY: number, reducedMotion: boolean) => {
    if (reducedMotion) return;
    // ripples on the canal, and the tap's drip
    for (let k = 0; k < 5; k++) {
      const x = ((t / 45 + k * 170) % (BAI_W + 20)) - 10;
      rect(c, B.canalLight, x - camX, 8 + (k % 3) * 4 - camY, 6, 1);
    }
    const ph = (t / 700) % 1;
    px(c, B.canalLight, TAP.x + 4 - camX, TAP.y - 16 + Math.floor(ph * 16) - camY);
  };
  const drawOverhead = () => {};
  return { background, props, edge: B.fenceDark, drawAnimated, drawOverhead, lights: BAI_LIGHTS };
}

/** v18.8 night lights: a bulb under each ring's roof. */
const BAI_LIGHTS: ReadonlyArray<SceneLight> = RING_RECTS.map((r): SceneLight => ({ x: r.x + r.w / 2, y: r.y + 12, r: 60, hue: "warm" }));
