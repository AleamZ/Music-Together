import { CAGE, CRATES, DRUM, HAM_H, HAM_LADDER, HAM_W, HAM_WALL_H, LADDER_DOOR, TU_SEO_TABLE } from "./ham-ngam";
import { drawText } from "./khu-nha-art";
import { propSprite } from "./props";
import { C, ctx2d, makeCanvas, px, rect, rng, type Ctx, type SceneArt, type SceneLight } from "./scene-art";
import type { GameMap } from "./types";

// Procedural painter for the Hầm đấu ngầm (v20.4): a stained concrete floor with drain grates and chalk marks, the north
// wall of raw concrete with pipes, cables and caged bulbs, the iron ladder up to the manhole, the chain-link cage on a
// padded floor with a sand-bag at each corner post, the iron "Cửa thách đấu" on the west wall, crates and an oil drum.
// Browser only (canvas). Original art in the approved Miền Tây style.

const H = {
  floor: "#4a4744", floorDark: "#3c3a38", floorLight: "#575350", stain: "#34302d", chalk: "#b8b0a0",
  wall: "#5d5a55", wallDark: "#46433f", wallLight: "#6e6a64", crack: "#2e2c2a",
  pipe: "#7a5a3a", pipeDark: "#553e28", cable: "#1c1c20",
  iron: "#5b636b", ironDark: "#3b4148", ironLight: "#8a939c", rust: "#8a4a2a",
  mat: "#7d2a26", matDark: "#5e1f1c", matLine: "#a4403a",
  chain: "#9aa3aa", chainDark: "#6a7278", bag: "#8a7a52", bagDark: "#6a5c3c",
  crate: "#8a6238", crateDark: "#5e4224", drum: "#2f5a7a", drumDark: "#1f3f56",
  bulb: "#ffe9a0", bulbHot: "#fff7d8",
};

function paintFloor(c: Ctx): void {
  const r = rng(4004);
  rect(c, H.floor, 0, 0, HAM_W, HAM_H);
  for (let k = 0; k < 1800; k++) px(c, r() < 0.5 ? H.floorDark : H.floorLight, Math.floor(r() * HAM_W), Math.floor(r() * HAM_H));
  // expansion joints every 64 px
  for (let x = 0; x < HAM_W; x += 64) rect(c, H.floorDark, x, HAM_WALL_H, 1, HAM_H - HAM_WALL_H);
  for (let y = HAM_WALL_H + 32; y < HAM_H; y += 64) rect(c, H.floorDark, 0, y, HAM_W, 1);
  // oil stains
  for (let k = 0; k < 14; k++) {
    const x = 30 + r() * 420, y = 60 + r() * 230, w = 6 + Math.floor(r() * 10);
    rect(c, H.stain, x, y, w, 3); rect(c, H.stain, x + 2, y - 1, w - 4, 5);
  }
  // two drain grates
  for (const [gx, gy] of [[120, 120], [360, 200]] as const) {
    rect(c, C.outline, gx - 1, gy - 1, 14, 10); rect(c, H.ironDark, gx, gy, 12, 8);
    for (let k = 1; k < 12; k += 3) rect(c, "#1a1a1c", gx + k, gy + 1, 1, 6);
  }
  // chalk tallies on the floor near the door (the ladder's floors)
  for (let k = 0; k < 10; k++) rect(c, H.chalk, 44 + k * 4, 286, 1, 6);
  rect(c, H.chalk, 43, 289, 41, 1);
}

function paintWalls(c: Ctx): void {
  const r = rng(4005);
  // the north wall: raw concrete in poured bands, cracks, a pipe and a cable run
  rect(c, H.wall, 0, 0, HAM_W, HAM_WALL_H);
  for (let y = 0; y < HAM_WALL_H; y += 10) rect(c, H.wallDark, 0, y + 9, HAM_W, 1);
  for (let k = 0; k < 500; k++) px(c, r() < 0.5 ? H.wallDark : H.wallLight, Math.floor(r() * HAM_W), Math.floor(r() * HAM_WALL_H));
  for (let k = 0; k < 6; k++) {
    let x = 60 + Math.floor(r() * 380), y = 2;
    for (let s = 0; s < 14; s++) { px(c, H.crack, x, y); y += 1; x += r() < 0.5 ? -1 : 1; }
  }
  rect(c, H.pipeDark, 0, 6, HAM_W, 4); rect(c, H.pipe, 0, 6, HAM_W, 2);
  for (let x = 20; x < HAM_W; x += 60) { rect(c, C.outline, x, 5, 3, 6); }
  for (let x = 0; x < HAM_W; x += 2) px(c, H.cable, x, 14 + Math.round(Math.sin(x / 30) * 2));
  rect(c, C.outline, 0, HAM_WALL_H - 1, HAM_W, 1);
  // the west, east and south walls
  rect(c, H.wallDark, 0, HAM_WALL_H, 20, HAM_H - HAM_WALL_H); rect(c, H.wall, 2, HAM_WALL_H, 16, HAM_H - HAM_WALL_H);
  rect(c, H.wallDark, HAM_W - 12, HAM_WALL_H, 12, HAM_H - HAM_WALL_H); rect(c, H.wall, HAM_W - 10, HAM_WALL_H, 8, HAM_H - HAM_WALL_H);
  rect(c, H.wallDark, 0, HAM_H - 16, HAM_W, 16); rect(c, H.wall, 0, HAM_H - 14, HAM_W, 12);
  for (let x = 0; x < HAM_W; x += 24) rect(c, H.wallDark, x, HAM_H - 14, 1, 12);
}

function paintLadder(c: Ctx): void {
  const { x, y, w, h } = HAM_LADDER;
  // the manhole's shaft, dark, then the rails and rungs
  rect(c, "#141414", x - 2, 0, w + 4, 6);
  rect(c, C.outline, x, y, 2, h); rect(c, C.outline, x + w - 2, y, 2, h);
  rect(c, H.ironLight, x, y, 1, h); rect(c, H.ironLight, x + w - 2, y, 1, h);
  for (let yy = y + 3; yy < y + h; yy += 5) { rect(c, H.iron, x + 2, yy, w - 4, 2); rect(c, H.rust, x + 4, yy + 1, 3, 1); }
}

function paintCage(c: Ctx): void {
  const { x, y, w, h } = CAGE;
  // the padded floor inside, with a painted circle
  rect(c, C.outline, x - 1, y - 1, w + 2, h + 2);
  rect(c, H.mat, x, y, w, h);
  for (let yy = y + 12; yy < y + h; yy += 24) rect(c, H.matDark, x, yy, w, 1);
  const cx = x + w / 2, cy = y + h / 2;
  for (let a = 0; a < 360; a += 3) {
    const t = (a * Math.PI) / 180;
    px(c, H.matLine, Math.round(cx + Math.cos(t) * 30), Math.round(cy + Math.sin(t) * 22));
  }
  // chain-link: a diamond mesh over the edges (the near side lower), posts and a top rail
  for (let k = 0; k < w; k += 4) {
    px(c, H.chain, x + k, y + 2 + (k % 8 === 0 ? 0 : 2)); px(c, H.chain, x + k + 2, y + 4 - (k % 8 === 0 ? 0 : 2));
    px(c, H.chainDark, x + k, y + h - 3 - (k % 8 === 0 ? 0 : 2)); px(c, H.chainDark, x + k + 2, y + h - 5 + (k % 8 === 0 ? 0 : 2));
  }
  for (let k = 0; k < h; k += 4) {
    px(c, H.chain, x + 2 + (k % 8 === 0 ? 0 : 2), y + k); px(c, H.chain, x + w - 3 - (k % 8 === 0 ? 0 : 2), y + k);
  }
  rect(c, H.ironLight, x, y - 10, w, 2); rect(c, C.outline, x, y - 8, w, 1);
  for (const [px0, py0] of [[x, y], [x + w - 5, y], [x, y + h - 6], [x + w - 5, y + h - 6]] as const) {
    rect(c, C.outline, px0 - 1, py0 - 12, 7, 18); rect(c, H.iron, px0, py0 - 11, 5, 16); rect(c, H.ironLight, px0, py0 - 11, 1, 16);
    rect(c, H.bagDark, px0 - 3, py0 + 3, 11, 5); rect(c, H.bag, px0 - 2, py0 + 3, 9, 3);   // a sand-bag at its foot
  }
  // the gate (south side, chained shut)
  rect(c, H.ironDark, cx - 10, y + h - 2, 20, 2); rect(c, H.chain, cx - 2, y + h - 4, 4, 4);
}

function paintDoor(c: Ctx): void {
  const { x, y, w, h } = LADDER_DOOR;
  rect(c, C.outline, x + 1, y - 1, w + 1, h + 2);
  rect(c, H.ironDark, x + 2, y, w - 1, h);
  rect(c, H.iron, x + 4, y + 2, w - 5, h - 4);
  for (let yy = y + 6; yy < y + h - 2; yy += 8) rect(c, H.ironLight, x + 4, yy, w - 5, 1);
  rect(c, H.rust, x + 6, y + h - 8, 5, 3); rect(c, H.bulb, x + w - 5, y + h / 2, 2, 2);   // the handle catches the light
  drawText(c, H.chalk, "10", x + 5, y - 7);
}

function paintCrates(c: Ctx): void {
  const { x, y, w, h } = CRATES;
  for (const [cx, cy, cw, ch] of [[x, y + 8, 16, 16], [x + 16, y + 8, 16, 16], [x + 6, y - 6, 16, 14]] as const) {
    rect(c, C.outline, cx - 1, cy - 1, cw + 2, ch + 2); rect(c, H.crate, cx, cy, cw, ch);
    rect(c, H.crateDark, cx, cy + ch / 2, cw, 1); rect(c, H.crateDark, cx + cw / 2, cy, 1, ch);
  }
  void w; void h;
  // the oil drum
  rect(c, C.outline, DRUM.x - 8, DRUM.y - 20, 16, 21); rect(c, H.drum, DRUM.x - 7, DRUM.y - 19, 14, 19);
  rect(c, H.drumDark, DRUM.x - 7, DRUM.y - 14, 14, 1); rect(c, H.drumDark, DRUM.x - 7, DRUM.y - 6, 14, 1);
  rect(c, H.ironLight, DRUM.x - 5, DRUM.y - 19, 2, 19);
}

function paintTable(c: Ctx): void {
  // the ledger and a cash tin on Tư Sẹo's table (the table itself is a prop)
  rect(c, "#e8e0c8", TU_SEO_TABLE.x - 10, TU_SEO_TABLE.y - 26, 8, 5);
  rect(c, H.ironLight, TU_SEO_TABLE.x + 3, TU_SEO_TABLE.y - 26, 6, 4);
}

export function paintHamNgam(map: GameMap): SceneArt {
  const background = makeCanvas(HAM_W, HAM_H);
  const g = ctx2d(background);
  paintFloor(g);
  paintWalls(g);
  paintLadder(g);
  paintCage(g);
  paintDoor(g);
  paintCrates(g);
  paintTable(g);
  const props = map.props.map(propSprite);
  const drawAnimated = (c: Ctx, t: number, camX: number, camY: number, reducedMotion: boolean) => {
    // the bulbs on the wall and over the cage flicker a little (still under reduced motion)
    for (const [bx, by] of BULBS) {
      const on = reducedMotion || Math.sin(t / 170 + bx) > -0.93;
      rect(c, C.outline, bx - 2 - camX, by - 2 - camY, 5, 5);
      rect(c, on ? H.bulb : "#8a7a4a", bx - 1 - camX, by - 1 - camY, 3, 3);
      if (on) px(c, H.bulbHot, bx - camX, by - camY);
    }
  };
  const drawOverhead = () => {};
  return { background, props, edge: H.wallDark, drawAnimated, drawOverhead, lights: HAM_LIGHTS };
}

/** The caged bulbs: along the wall, and three over the cage. */
const BULBS: ReadonlyArray<readonly [number, number]> = [[90, 24], [170, 24], [330, 24], [440, 24], [200, 118], [240, 118], [280, 118]];
const HAM_LIGHTS: ReadonlyArray<SceneLight> = BULBS.map(([x, y]): SceneLight => ({ x, y: y + 20, r: 70, hue: "warm" }));
