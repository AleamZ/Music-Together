import { SLING, type SlingState } from "../farm/sling";
import { drawRat, ratFrame } from "./rats";

// The SlingGame scene (v17 §12.2), original and drawn in code: a golden paddy lane, the rat at ×2, a crosshair, the ná at
// the bottom with its band pulled back by the draw, and a vertical power bar with its green band.

const PAL = {
  sky: "#f3e6c4",
  paddy: "#d8b24a",
  paddyDark: "#b8902e",
  bund: "#8a6a3f",
  cross: "#c0392b",
  fork: "#8b5a33",
  forkDark: "#6e4424",
  band: "#2e2a2a",
  pouch: "#b0643a",
  pellet: "#a0522d",
  barBack: "#3a2a1c",
  barGreen: "#4caf50",
  barFill: "#f4efe0",
} as const;

const RAT_SCALE = 2;
/** The ná's fork, bottom centre; the band's rest line is at forkY. */
const FORK_X = SLING.width / 2;
const FORK_Y = 150;
const BAR = { x: 300, y: 96, w: 8, h: 76 } as const;

/** One frame of the scene. `reduced`: no shake, and the pellet flies without a trail. */
export function drawSlingScene(c: CanvasRenderingContext2D, s: SlingState, t: number, reduced: boolean): void {
  c.imageSmoothingEnabled = false;
  c.fillStyle = PAL.sky;
  c.fillRect(0, 0, SLING.width, SLING.height);
  // the paddy lane, with rows of stalks
  c.fillStyle = PAL.paddy;
  c.fillRect(0, SLING.laneY - 22, SLING.width, 44);
  c.fillStyle = PAL.paddyDark;
  for (let x = 4; x < SLING.width; x += 8) {
    c.fillRect(x, SLING.laneY - 20 + ((x / 8) % 2) * 3, 1, 6);
    c.fillRect(x + 3, SLING.laneY + 10 - ((x / 8) % 2) * 3, 1, 6);
  }
  c.fillStyle = PAL.bund;
  c.fillRect(0, SLING.laneY + 22, SLING.width, 4);
  // the rat, on the lane at ×2 (its feet's middle a little below the lane line)
  drawRat(c, ratFrame(s.rat.moving, t), s.rat.dir, s.rat.x, SLING.laneY + 4, RAT_SCALE);
  // the crosshair
  const shake = !reduced && s.stage === "draw" && s.power > SLING.bandHigh ? (Math.floor(t / 60) % 2 ? 1 : -1) : 0;
  const ax = Math.round(s.aimX) + shake;
  c.fillStyle = PAL.cross;
  c.fillRect(ax - 6, SLING.laneY, 4, 1);
  c.fillRect(ax + 3, SLING.laneY, 4, 1);
  c.fillRect(ax, SLING.laneY - 6, 1, 4);
  c.fillRect(ax, SLING.laneY + 3, 1, 4);
  // the pellet in flight, from the fork toward the aim at release
  if (s.stage === "flight" && s.shotX !== null) {
    const k = Math.min(1, s.stageMs / SLING.flightMs);
    const px = FORK_X + (s.shotX - FORK_X) * k, py = FORK_Y - 10 + (SLING.laneY - (FORK_Y - 10)) * k;
    if (!reduced) {
      c.fillStyle = PAL.paddyDark;
      c.fillRect(Math.round(FORK_X + (s.shotX - FORK_X) * (k * 0.8)), Math.round(FORK_Y - 10 + (SLING.laneY - FORK_Y + 10) * k * 0.8), 2, 2);
    }
    c.fillStyle = PAL.pellet;
    c.fillRect(Math.round(px) - 1, Math.round(py) - 1, 3, 3);
  }
  // the ná: a Y fork, its band pulled back by the draw
  c.fillStyle = PAL.forkDark;
  c.fillRect(FORK_X - 1, FORK_Y, 3, 26);
  c.fillStyle = PAL.fork;
  c.fillRect(FORK_X - 9, FORK_Y - 12, 3, 14);
  c.fillRect(FORK_X + 7, FORK_Y - 12, 3, 14);
  c.fillRect(FORK_X - 7, FORK_Y, 15, 3);
  const pull = s.stage === "draw" ? Math.round(s.power * 18) : 0;
  c.fillStyle = PAL.band;
  for (let i = 0; i <= 8; i++) {
    const y = FORK_Y - 11 + Math.round((pull * i) / 8);
    c.fillRect(FORK_X - 8 + i, y, 1, 1);
    c.fillRect(FORK_X + 8 - i, y, 1, 1);
  }
  c.fillStyle = PAL.pouch;
  c.fillRect(FORK_X - 2, FORK_Y - 12 + pull, 5, 3);
  if (s.stage === "ready" || s.stage === "draw") {
    c.fillStyle = PAL.pellet;
    c.fillRect(FORK_X - 1, FORK_Y - 13 + pull, 3, 3);
  }
  // the power bar, filling upward, with the green band
  c.fillStyle = PAL.barBack;
  c.fillRect(BAR.x, BAR.y, BAR.w, BAR.h);
  c.fillStyle = PAL.barGreen;
  const g0 = BAR.y + BAR.h - Math.round(BAR.h * SLING.bandHigh), g1 = BAR.y + BAR.h - Math.round(BAR.h * SLING.bandLow);
  c.fillRect(BAR.x, g0, BAR.w, g1 - g0);
  const fill = Math.round(BAR.h * (s.stage === "draw" || s.stage === "flight" ? s.power : 0));
  c.fillStyle = PAL.barFill;
  c.fillRect(BAR.x + 2, BAR.y + BAR.h - fill, BAR.w - 4, fill);
}
