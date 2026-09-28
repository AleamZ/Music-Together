// v20 Võ đài: arena backgrounds, 384 × 216, drawn in code (all original). v20.1 has the practice street: Chợ Lớn at
// dusk — a banded sky, shophouse silhouettes with lit windows, a string of lanterns, the pavement and the punching bag
// hanging at the side. v20.2 adds the dojo: a wood floor, a drum, a banner that reads "VÕ ĐƯỜNG". Bãi đất trống and the hầm plug in here (v20.3–v20.4).

import { ARENA_H, ARENA_W } from "./hud";
import { GROUND_Y } from "./fx";
import { drawText, textWidth } from "./font";
import type { PixelCtx } from "./rig";

export type ArenaKind = "practice" | "dojo";

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