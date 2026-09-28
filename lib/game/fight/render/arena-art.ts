// v20 Võ đài: arena backgrounds, 384 × 216, drawn in code (all original). v20.1 has the practice street: Chợ Lớn at
// dusk — a banded sky, shophouse silhouettes with lit windows, a string of lanterns, the pavement and the punching bag
// hanging at the side. The dojo, Bãi đất trống and the hầm plug in here (v20.2–v20.4).

import { ARENA_H, ARENA_W } from "./hud";
import { GROUND_Y } from "./fx";
import type { PixelCtx } from "./rig";

export type ArenaKind = "practice";

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
  void kind;
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
