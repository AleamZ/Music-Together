// v20 Võ đài: arena backgrounds, 384 × 216, drawn in code (all original). v20.1 has the practice street: Chợ Lớn at
// dusk — a banded sky, shophouse silhouettes with lit windows, a string of lanterns, the pavement and the punching bag
// hanging at the side. v20.2 adds the dojo: a wood floor, a drum, a banner that reads "VÕ ĐƯỜNG". Bãi đất trống and the hầm plug in here (v20.3–v20.4).

import { ARENA_H, ARENA_W } from "./hud";
import { GROUND_Y } from "./fx";
import { drawText, textWidth } from "./font";
import type { PixelCtx } from "./rig";

export type ArenaKind = "practice" | "dojo" | "bai_dat" | "ham_ngam";

const SKY = ["#2b2150", "#3d2a5e", "#5a3468", "#7d3f67", "#a8515f", "#d06f55", "#e99a5a"];
const HOUSE = ["#241a2c", "#2c2034", "#221828"];
const WINDOW_ON = "#f4c25e";
const WINDOW_OFF = "#3a2c42";

/** A small integer hash so the windows are fixed (no Math.random). */
const h = (n: number): number => {
  let x = (n * 2654435761) >>> 0;
  x ^= x >>> 15;
  return x;
};

export function paintArena(c: PixelCtx, kind: ArenaKind, frame: number, reduced: boolean): void {
  if (kind === "dojo") {
    paintDojo(c, frame, reduced);
    return;
  }
  if (kind === "bai_dat") {
    paintBaiDat(c, frame, reduced);
    return;
  }
  if (kind === "ham_ngam") {
    paintHam(c, frame, reduced);
    return;
  }
  c.fillStyle = SKY[SKY.length - 1];
  c.fillRect(0, 0, ARENA_W, ARENA_H);
  // sky bands
  const band = Math.ceil(120 / SKY.length);
  SKY.forEach((col, i) => {
    c.fillStyle = col;
    c.fillRect(0, i * band, ARENA_W, band);
  });
  // a low sun behind the houses
  c.fillStyle = "#f7c46b";
  for (let dy = -10; dy <= 10; dy++) {
    const w = Math.round(Math.sqrt(100 - dy * dy));
    c.fillRect(300 - w, 112 + dy, 2 * w, 1);
  }
  // shophouses
  let x = -6, i = 0;
  while (x < ARENA_W) {
    const w = 44 + (h(i) % 3) * 10, top = 58 + (h(i + 7) % 4) * 9;
    c.fillStyle = HOUSE[i % HOUSE.length];
    c.fillRect(x, top, w, GROUND_Y - 16 - top);
    // roof lip and a balcony rail
    c.fillStyle = "#170f1d";
    c.fillRect(x - 2, top - 3, w + 4, 3);
    c.fillRect(x + 2, top + 30, w - 4, 2);
    for (let wy = top + 8; wy < GROUND_Y - 34; wy += 16) {
      for (let wx = x + 5; wx < x + w - 9; wx += 12) {
        const on = h(i * 97 + wx + wy) % 3 !== 0;
        c.fillStyle = on ? WINDOW_ON : WINDOW_OFF;
        c.fillRect(wx, wy, 6, 8);
        if (on) {
          c.fillStyle = "#c98a3a";
          c.fillRect(wx, wy + 6, 6, 2);
        }
      }
    }
    x += w + 2;
    i++;
  }
  // the lantern string
  c.fillStyle = "#1c1420";
  for (let lx = 0; lx < ARENA_W; lx++) c.fillRect(lx, 60 + Math.round(Math.sin(lx / 30) * 3), 1, 1);
  for (let lx = 20; lx < ARENA_W; lx += 40) {
    const ly = 61 + Math.round(Math.sin(lx / 30) * 3);
    const sway = reduced ? 0 : Math.round(Math.sin((frame + lx) / 25));
    c.fillStyle = "#b8231e";
    c.fillRect(lx - 3 + sway, ly + 2, 7, 8);
    c.fillStyle = "#e8443a";
    c.fillRect(lx - 2 + sway, ly + 3, 5, 6);
    c.fillStyle = "#f5c04a";
    c.fillRect(lx - 1 + sway, ly + 10, 3, 1);
  }
  // the pavement: kerb, tiles and the road's edge
  c.fillStyle = "#4b3d45";
  c.fillRect(0, GROUND_Y - 16, ARENA_W, 16);
  c.fillStyle = "#5b4b52";
  for (let tx = 0; tx < ARENA_W; tx += 24) c.fillRect(tx, GROUND_Y - 16, 23, 7);
  c.fillStyle = "#3a2e36";
  c.fillRect(0, GROUND_Y, ARENA_W, ARENA_H - GROUND_Y);
  c.fillStyle = "#6e5c60";
  c.fillRect(0, GROUND_Y, ARENA_W, 2);
  c.fillStyle = "#2c232b";
  for (let tx = 8; tx < ARENA_W; tx += 32) c.fillRect(tx, GROUND_Y + 8, 16, 2);
  // the punching bag hanging from a bracket at the right edge
  c.fillStyle = "#1c1420";
  c.fillRect(360, 96, 20, 3);
  c.fillRect(366, 99, 1, 14);
  c.fillStyle = "#1c1420";
  c.fillRect(359, 112, 16, 46);
  c.fillStyle = "#8a3b2a";
  c.fillRect(360, 113, 14, 44);
  c.fillStyle = "#a64e36";
  c.fillRect(361, 114, 4, 42);
  c.fillStyle = "#5a2a20";
  c.fillRect(360, 124, 14, 2);
  c.fillRect(360, 146, 14, 2);
}

// ---------------------------------------------------------------- v20.2: the dojo
const WOOD = ["#7a4a2a", "#6a3e22", "#86542f"];
const PLANK = ["#b27a45", "#a36d3c", "#bf8750"];

/** The hall of Võ đường Chợ Lớn: wooden wall panels under a beam, the red banner "VÕ ĐƯỜNG" in gold, a rack of staffs,
 *  the big drum on its stand, paper lanterns, and a polished plank floor. */
function paintDojo(c: PixelCtx, frame: number, reduced: boolean): void {
  const floor = GROUND_Y - 30;
  // the wall: vertical panels with posts
  c.fillStyle = WOOD[0];
  c.fillRect(0, 0, ARENA_W, floor);
  for (let x = 0; x < ARENA_W; x += 32) {
    c.fillStyle = WOOD[(x / 32) % 2 === 0 ? 1 : 2];
    c.fillRect(x + 2, 22, 28, floor - 30);
    c.fillStyle = "#4a2a16";
    c.fillRect(x, 16, 3, floor - 16);
  }
  // the beam and its shadow
  c.fillStyle = "#3a2010";
  c.fillRect(0, 12, ARENA_W, 8);
  c.fillStyle = "#5a321a";
  c.fillRect(0, 12, ARENA_W, 2);
  // the banner: red cloth, gold border and letters, hanging from the beam
  const text = "VO DUONG", sc = 2, tw = textWidth(text, sc);
  const bx = Math.round((ARENA_W - tw) / 2) - 10, bw = tw + 20;
  c.fillStyle = "#1c0e08";
  c.fillRect(bx - 1, 19, bw + 2, 30);
  c.fillStyle = "#a8201c";
  c.fillRect(bx, 20, bw, 28);
  c.fillStyle = "#e0b33c";
  c.fillRect(bx + 2, 22, bw - 4, 1);
  c.fillRect(bx + 2, 45, bw - 4, 1);
  const tx = bx + 10, ty = 29;
  drawText(c, text, tx, ty, "#f4cf5a", sc, "#5a0e0c");
  // the diacritics: Õ's tilde, Đ's bar, Ư's and Ờ's horns, Ờ's grave accent
  c.fillStyle = "#f4cf5a";
  const col = (i: number) => tx + i * 4 * sc;
  c.fillRect(col(1), ty - 4, 2, 2); c.fillRect(col(1) + 2, ty - 3, 2, 2); c.fillRect(col(1) + 4, ty - 4, 2, 2);
  c.fillRect(col(3) - 2, ty + 4, 4, 2);
  c.fillRect(col(4) + 6, ty - 2, 2, 2);
  c.fillRect(col(5) + 6, ty - 2, 2, 2);
  c.fillRect(col(5) + 1, ty - 5, 2, 2);
  // tassels
  for (const x of [bx + 2, bx + bw - 4]) { c.fillStyle = "#e0b33c"; c.fillRect(x, 48, 2, 6); }
  // a rack of staffs on the left
  c.fillStyle = "#3a2010";
  c.fillRect(24, 70, 60, 4);
  c.fillRect(24, 120, 60, 4);
  for (let i = 0; i < 5; i++) {
    c.fillStyle = i % 2 ? "#c8a36a" : "#a8834a";
    c.fillRect(30 + i * 11, 58, 3, 100);
  }
  // the drum on its stand, on the right
  const dx = 318, dy = 104;
  c.fillStyle = "#3a2010";
  c.fillRect(dx - 22, dy + 18, 4, floor - dy - 18);
  c.fillRect(dx + 18, dy + 18, 4, floor - dy - 18);
  c.fillRect(dx - 22, dy + 30, 44, 3);
  for (let yy = -20; yy <= 20; yy++) {
    const w = Math.round(Math.sqrt(400 - yy * yy) * 1.05);
    c.fillStyle = Math.abs(yy) > 17 ? "#1c0e08" : Math.abs(yy) > 12 ? "#8a1e18" : "#b12a20";
    c.fillRect(dx - w, dy + yy, 2 * w, 1);
  }
  c.fillStyle = "#e8d8b0";
  c.fillRect(dx - 12, dy - 3, 24, 6);
  c.fillStyle = "#e0b33c";
  for (let k = -16; k <= 16; k += 4) c.fillRect(dx + k, dy - 15, 1, 1);
  // two lanterns swaying a little
  for (const lx of [132, 252]) {
    const sway = reduced ? 0 : Math.round(Math.sin((frame + lx) / 30));
    c.fillStyle = "#1c0e08";
    c.fillRect(lx, 20, 1, 30);
    c.fillStyle = "#c8281e";
    c.fillRect(lx - 5 + sway, 50, 11, 14);
    c.fillStyle = "#f4a23a";
    c.fillRect(lx - 3 + sway, 52, 7, 10);
    c.fillStyle = "#e0b33c";
    c.fillRect(lx - 1 + sway, 64, 3, 3);
  }
  // the floor: planks running away, lighter toward the viewer
  for (let y = floor; y < ARENA_H; y++) {
    const band = Math.min(2, Math.trunc((y - floor) / 16));
    c.fillStyle = PLANK[band];
    c.fillRect(0, y, ARENA_W, 1);
  }
  c.fillStyle = "#6e4422";
  c.fillRect(0, floor, ARENA_W, 2);
  for (let y = floor + 8; y < ARENA_H; y += 9) {
    c.fillStyle = "#8a5a30";
    c.fillRect(0, y, ARENA_W, 1);
    for (let x = ((y / 9) % 2) * 24; x < ARENA_W; x += 48) c.fillRect(x, y - 8, 1, 8);
  }
  // the fighters' line
  c.fillStyle = "#d9c08a";
  c.fillRect(0, GROUND_Y + 1, ARENA_W, 1);
}
// ---------------------------------------------------------------- v20.3: Bãi đất trống
/** The ring on the empty lot at dusk: a violet sky over the corrugated roofs of Chợ Lớn's back row, a stack of tyres and
 *  the broken brick wall on the right, the tin roof's edge and a hanging bulb above, the ring's ropes behind the
 *  fighters and a canvas mat on packed dirt. `night` darkens the sky (the room's day or night). */
export function paintBaiDat(c: PixelCtx, frame: number, reduced: boolean, night = false): void {
  const mat = GROUND_Y - 22;
  const sky = night ? ["#0f1024", "#161836", "#1e2046", "#282a56"] : ["#3a2c5e", "#5a3a6a", "#8a4e6a", "#c46a5a"];
  const band = Math.ceil(mat / sky.length);
  sky.forEach((col, i) => {
    c.fillStyle = col;
    c.fillRect(0, i * band, ARENA_W, band);
  });
  // the back row of roofs (corrugated tin), a few lit windows
  let x = -8, i = 0;
  while (x < ARENA_W) {
    const w = 40 + (h(i + 31) % 3) * 12, top = 70 + (h(i + 5) % 4) * 8;
    c.fillStyle = i % 2 ? "#2a2433" : "#231e2c";
    c.fillRect(x, top, w, mat - top);
    c.fillStyle = "#57606c";
    c.fillRect(x - 2, top - 4, w + 4, 4);
    c.fillStyle = "#77818d";
    for (let k = x; k < x + w; k += 3) c.fillRect(k, top - 4, 1, 4);
    if (h(i * 7) % 2) {
      c.fillStyle = night ? "#f4c25e" : "#b98a4a";
      c.fillRect(x + 8, top + 10, 6, 7);
    }
    x += w + 3;
    i++;
  }
  // the broken brick wall on the right and the tyre stack on the left
  for (let yy = 96; yy < mat; yy += 5) {
    c.fillStyle = "#c9b89a";
    c.fillRect(318, yy, 60, 1);
    for (let xx = 318 + ((yy / 5) % 2) * 4; xx < 378; xx += 8) {
      c.fillStyle = (xx + yy) % 3 ? "#a8523a" : "#7e3a28";
      c.fillRect(xx, yy + 1, 7, 4);
    }
  }
  c.fillStyle = sky[sky.length - 1];
  for (let k = 0; k < 60; k += 4) c.fillRect(318 + k, 96, 4, (h(k) % 12) + 2);
  for (let k = 0; k < 3; k++) {
    const ty = mat - 12 - k * 11;
    c.fillStyle = "#161618";
    c.fillRect(14 + k * 2, ty, 44 - k * 4, 11);
    c.fillStyle = "#3a3a42";
    c.fillRect(17 + k * 2, ty + 2, 38 - k * 4, 2);
  }
  // the ring: posts and three ropes behind the fighters
  c.fillStyle = "#c0392b";
  c.fillRect(20, mat - 58, 5, 58);
  c.fillStyle = "#2f5fb8";
  c.fillRect(ARENA_W - 25, mat - 58, 5, 58);
  for (const ry of [mat - 52, mat - 38, mat - 24]) {
    c.fillStyle = "#f1ece0";
    c.fillRect(25, ry, ARENA_W - 50, 2);
    c.fillStyle = "#b8b2a4";
    c.fillRect(25, ry + 2, ARENA_W - 50, 1);
  }
  // the tin roof's edge and a bulb that swings a little
  c.fillStyle = "#1c1a22";
  c.fillRect(0, 0, ARENA_W, 12);
  c.fillStyle = "#8a939d";
  for (let k = 0; k < ARENA_W; k += 4) c.fillRect(k, 0, 3, 10);
  const sway = reduced ? 0 : Math.round(Math.sin(frame / 40) * 2);
  c.fillStyle = "#1c1a22";
  c.fillRect(ARENA_W / 2, 12, 1, 18);
  c.fillStyle = "#f7e08a";
  c.fillRect(ARENA_W / 2 - 3 + sway, 30, 7, 7);
  c.fillStyle = "#fff6c8";
  c.fillRect(ARENA_W / 2 - 1 + sway, 32, 3, 3);
  // the mat and the dirt in front
  c.fillStyle = "#d9cfb4";
  c.fillRect(0, mat, ARENA_W, GROUND_Y - mat + 4);
  c.fillStyle = "#bfb394";
  for (let k = 0; k < ARENA_W; k += 48) c.fillRect(k, mat, 1, GROUND_Y - mat + 4);
  c.fillStyle = "#a89c7c";
  c.fillRect(0, GROUND_Y + 1, ARENA_W, 1);
  c.fillStyle = "#8a6a46";
  c.fillRect(0, GROUND_Y + 5, ARENA_W, ARENA_H - GROUND_Y - 5);
  c.fillStyle = "#b99468";
  for (let k = 0; k < 90; k++) c.fillRect(h(k * 13) % ARENA_W, GROUND_Y + 6 + (h(k * 7) % (ARENA_H - GROUND_Y - 7)), 2, 1);
}

// ---------------------------------------------------------------- v20.4: the hầm's cage
/** Inside the cage of the Hầm đấu ngầm: a raw concrete wall with a pipe run and caged bulbs, a crowd in silhouette behind
 *  the chain-link (heads bob a little; still under reduced motion), a padded red floor with a worn circle, and the cage's
 *  posts at the edges. */
export function paintHam(c: PixelCtx, frame: number, reduced: boolean): void {
  const floor = GROUND_Y - 18;
  // the wall: poured concrete bands, stains
  c.fillStyle = "#3e3b38";
  c.fillRect(0, 0, ARENA_W, floor);
  for (let y = 8; y < floor; y += 22) {
    c.fillStyle = "#34312e";
    c.fillRect(0, y, ARENA_W, 2);
  }
  for (let k = 0; k < 40; k++) {
    c.fillStyle = h(k * 17) % 2 ? "#47433f" : "#2f2c2a";
    c.fillRect(h(k * 31) % ARENA_W, h(k * 7) % floor, 3 + (h(k) % 5), 2);
  }
  c.fillStyle = "#5a4430";
  c.fillRect(0, 16, ARENA_W, 4);
  c.fillStyle = "#7a5a3a";
  c.fillRect(0, 16, ARENA_W, 1);
  // the crowd behind the fence: shoulders and heads in silhouette, two rows
  for (let row = 0; row < 2; row++) {
    for (let x = -6 + row * 9; x < ARENA_W + 8; x += 18) {
      const bob = reduced ? 0 : Math.round(Math.sin((frame + x * 7 + row * 40) / 18) * 1.5);
      const top = floor - 44 + row * 12 + (h(x + row) % 5) + bob;
      c.fillStyle = row === 0 ? "#1c1a20" : "#24212a";
      c.fillRect(x - 7, top + 9, 15, floor - top - 9);
      c.fillRect(x - 4, top, 9, 9);
      if (h(x * 3 + row) % 4 === 0) c.fillRect(x + 6, top + 2 - (reduced ? 0 : Math.abs(bob)), 3, 9);   // a raised fist
    }
  }
  // the chain-link over the crowd: a diamond mesh
  c.fillStyle = "#8a939a";
  for (let y = 26; y < floor; y += 6) {
    for (let x = (y / 6) % 2 ? 3 : 0; x < ARENA_W; x += 6) c.fillRect(x, y, 1, 1);
  }
  c.fillStyle = "#6a7278";
  c.fillRect(0, 26, ARENA_W, 2);
  // caged bulbs on the wall
  for (const bx of [64, 192, 320]) {
    const flick = reduced || h(Math.floor(frame / 9) + bx) % 23 !== 0;
    c.fillStyle = "#1a1a1c";
    c.fillRect(bx - 4, 4, 9, 9);
    c.fillStyle = flick ? "#ffe9a0" : "#8a7a4a";
    c.fillRect(bx - 2, 6, 5, 5);
    if (flick) {
      c.fillStyle = "#fff7d8";
      c.fillRect(bx - 1, 7, 2, 2);
    }
  }
  // the cage's posts at both edges
  for (const px0 of [6, ARENA_W - 12]) {
    c.fillStyle = "#3b4148";
    c.fillRect(px0, 20, 6, floor - 20);
    c.fillStyle = "#8a939c";
    c.fillRect(px0, 20, 1, floor - 20);
  }
  // the padded floor with a worn circle
  c.fillStyle = "#7d2a26";
  c.fillRect(0, floor, ARENA_W, ARENA_H - floor);
  c.fillStyle = "#5e1f1c";
  for (let y = floor + 6; y < ARENA_H; y += 10) c.fillRect(0, y, ARENA_W, 1);
  c.fillStyle = "#a4403a";
  for (let x = 60; x < ARENA_W - 60; x += 2) c.fillRect(x, GROUND_Y + 6 + Math.round(Math.sin(((x - 60) / (ARENA_W - 120)) * Math.PI) * 6), 1, 1);
  c.fillStyle = "#c9b89a";
  c.fillRect(0, GROUND_Y + 1, ARENA_W, 1);
}