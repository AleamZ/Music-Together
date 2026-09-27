import type { Facing, SkinTone, Vec } from "@/lib/game/types";
import { OUTLINE, SKIN } from "./palettes";
import { forearm, ring, SHOWN_ROWS, splash } from "./swim";
import { armsOfFrame } from "./raster";
import { limb } from "./road";

// v18.10 Sốc nhiệt & bơi chủ động: the heat-shocked face (red cheeks, sweat, a shimmer over the head), the warm-up
// stretch on the shore, and a cramping swimmer who struggles and sinks. Original pixel art at 1:1 world pixels,
// fillRect + drawImage only. `t` is ms. A character frame is 24×48 with its feet at row 46.

type Ctx = CanvasRenderingContext2D;

const FLUSH = "rgba(226, 58, 46, 0.55)";
const FLUSH_HOT = "rgba(236, 40, 30, 0.75)";
const SWEAT = "#9fdcf2";
const SWEAT_HI = "#f2fbff";
const SHIMMER = "rgba(255, 170, 60, 0.7)";
const FOAM = "#e3f5fa";
const DEEP = "#2f6e8f";
const UNDER = "rgba(28, 72, 98, 0.55)";
const BUBBLE = "#e8f7fc";

function rect(c: Ctx, x: number, y: number, w: number, h: number, col: string): void {
  if (w <= 0 || h <= 0) return;
  c.fillStyle = col;
  c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

/**
 * The heat-shocked look over a character whose frame's top-left row 0 is at (x − 12, top): flushed red cheeks (none from
 * behind), sweat drops running down the temples, one flicked off, and a heat shimmer over the head. Reduced motion:
 * still drops, no shimmer.
 */
export function drawHeatFace(c: Ctx, feet: Vec, top: number, facing: Facing, t: number, reduced: boolean): void {
  const x = Math.round(feet.x) - 12, y = Math.round(top);
  const pulse = reduced ? 0 : Math.round((Math.sin(t / 260) + 1) / 2);
  // cheeks (frame rows 15–17)
  if (facing === "down") {
    rect(c, x + 6, y + 15, 3, 2, FLUSH);
    rect(c, x + 15, y + 15, 3, 2, FLUSH);
    if (pulse) { rect(c, x + 7, y + 15, 1, 1, FLUSH_HOT); rect(c, x + 16, y + 15, 1, 1, FLUSH_HOT); }
    rect(c, x + 9, y + 12, 6, 1, "rgba(226, 58, 46, 0.3)");              // a red forehead
  } else if (facing !== "up") {
    const cx = facing === "right" ? x + 14 : x + 7;
    rect(c, cx, y + 15, 3, 2, FLUSH);
    if (pulse) rect(c, cx + 1, y + 15, 1, 1, FLUSH_HOT);
  }
  // sweat: two drops sliding down the temples, and one flicked into the air
  const sides = facing === "up" ? [4, 19] : facing === "left" ? [4, 17] : facing === "right" ? [6, 19] : [4, 19];
  sides.forEach((sx, i) => {
    const k = reduced ? 0.4 : ((t + i * 520) % 1100) / 1100;
    const dy = Math.round(k * 7);
    rect(c, x + sx, y + 9 + dy, 1, 2, SWEAT);
    rect(c, x + sx, y + 9 + dy, 1, 1, SWEAT_HI);
  });
  if (!reduced) {
    const k = (t % 1500) / 1500;
    if (k < 0.6) {
      const f = k / 0.6, dir = (Math.floor(t / 1500) % 2) * 2 - 1;
      rect(c, x + 12 + dir * (8 + f * 5), y + 5 - Math.sin(f * Math.PI) * 5, 1, 1, SWEAT);
    }
    // the shimmer: two wavy orange strokes rising over the head
    for (let i = 0; i < 2; i++) {
      const s = ((t / 700 + i * 0.5) % 1);
      const sy = y - 1 - Math.round(s * 6);
      c.globalAlpha = 1 - s;
      for (let j = 0; j < 5; j++) rect(c, x + 8 + i * 5 + (j % 2), sy - j, 1, 1, SHIMMER);
      c.globalAlpha = 1;
    }
  } else {
    rect(c, x + 9, y - 3, 1, 1, SHIMMER);
    rect(c, x + 14, y - 4, 1, 1, SHIMMER);
  }
}

/** The warm-up's phase at `t`: 0 lean left, 1 up, 2 lean right, 3 squat (each 625 ms; reduced motion holds "up"). */
export function stretchPhase(t: number, reduced: boolean): 0 | 1 | 2 | 3 {
  return reduced ? 1 : (Math.floor(t / 625) % 4) as 0 | 1 | 2 | 3;
}

/**
 * Khởi động: a character (frame `frame`, feet at `feet`) doing side bends and squats. The body above the hips (rows
 * 0–29) leans or drops as a slice, the legs stay planted, hands meet over the head in the "up" beats, and small motion
 * marks flick at the sides.
 */
export function drawStretch(c: Ctx, feet: Vec, facing: Facing, frame: HTMLCanvasElement, skinTone: SkinTone, t: number, reduced: boolean): void {
  const skin = SKIN[skinTone];
  const x = Math.round(feet.x), y = Math.round(feet.y);
  const phase = stretchPhase(t, reduced);
  const left = x - 12, topY = y - 46;
  c.fillStyle = "rgba(40, 25, 10, 0.28)";
  c.fillRect(x - 7, y - 1, 14, 2);
  if (facing === "left" || facing === "right") {
    // side view: the sprite's own arm stays (it lies over the torso); bend forward, up on the toes, lean back, squat
    const f = facing === "right" ? 1 : -1;
    const bx = phase === 0 ? 2 * f : phase === 2 ? -f : 0;
    const by = phase === 0 ? 2 : phase === 1 ? -2 : phase === 3 ? 3 : 0;
    const legs = phase === 1 ? -2 : 0;
    c.drawImage(frame, 0, 30, 24, 18, left, topY + 30 + legs, 24, 18);
    c.drawImage(frame, 0, 20, 24, 10, left + Math.round(bx / 2), topY + 20 + by, 24, 10);
    c.drawImage(frame, 0, 0, 24, 20, left + bx, topY + by, 24, 20);
    return;
  }
  const lean = phase === 0 ? -2 : phase === 2 ? 2 : 0;
  const drop = phase === 3 ? 2 : 0;
  // legs (rows 30–47) planted; a squat squeezes them by dropping the body over them
  c.drawImage(frame, 0, 30, 24, 18, left, topY + 30, 24, 18);
  // the chest (rows 20–31) without the sprite's own arms (columns 6–17 only), leaning half as far; the head and
  // shoulders (rows 0–19) the full lean
  const cx = left + Math.round(lean / 2), cy = topY + 20 + drop;
  c.drawImage(frame, 6, 20, 12, 12, cx + 6, cy, 12, 12);
  c.drawImage(frame, 0, 0, 24, 20, left + lean, topY + drop, 24, 20);
  // new arms from the shoulders (frame coords, then placed): a side bend reaches one arm over the head with the other
  // hand on the hip, the "up" beat spreads both arms wide, the squat holds them forward
  const tagged = armsOfFrame(frame);
  const sleeve = tagged?.sleeve ?? skin.s, hand = tagged?.skin ?? skin.s;
  const at = (px: number, py: number) => ({ x: cx + px, y: cy + py - 20 });
  const arm = (pts: [number, number][]) => {
    const p = pts.map(([px, py]) => at(px, py));
    limb(c, p, p.slice(1).map(() => sleeve), 2);
    const h = p[p.length - 1];
    rect(c, h.x - 2, h.y - 2, 4, 4, OUTLINE);
    rect(c, h.x - 1, h.y - 1, 2, 2, hand);
  };
  const hipL: [number, number][] = [[5, 22], [3, 26], [6, 29]];
  const hipR: [number, number][] = [[18, 22], [20, 26], [17, 29]];
  if (phase === 0) { arm(hipL); arm([[18, 22], [21, 15], [21, 8], [18, 2], [14, 0]]); }
  else if (phase === 2) { arm(hipR); arm([[5, 22], [2, 15], [2, 8], [5, 2], [9, 0]]); }
  else if (phase === 1) { arm([[5, 22], [-1, 21], [-4, 21]]); arm([[18, 22], [24, 21], [27, 21]]); }
  else { arm([[5, 22], [5, 26], [8, 26]]); arm([[18, 22], [18, 26], [15, 26]]); }
  if (!reduced) {
    const k = (t % 625) / 625;
    if (k < 0.4) {
      const side = lean < 0 ? 1 : -1;
      rect(c, x + side * 13, topY + 14 + drop, 1, 3, "rgba(255, 255, 255, 0.8)");
      rect(c, x + side * 15, topY + 16 + drop, 1, 2, "rgba(255, 255, 255, 0.6)");
    }
  }
}

/**
 * Chuột rút: a swimmer (feet at `feet`) cramping with `left` ms of `total` left. The head sinks as the countdown runs
 * (up to 12 px), one arm flails high, the water splashes around and bubbles boil up. Reduced motion: a still sinking
 * head, one arm up, one ring.
 */
export function drawCramp(
  c: Ctx, feet: Vec, facing: Facing, frame: HTMLCanvasElement, skinTone: SkinTone, t: number, left: number, total: number, reduced: boolean,
): void {
  const skin = SKIN[skinTone];
  const x = Math.round(feet.x), wl = Math.round(feet.y) - 3;
  const k = Math.max(0, Math.min(1, 1 - left / total));
  const sink = Math.round(k * 12);
  const jerk = reduced ? 0 : Math.round(Math.sin(t / 70) * (1 + k));
  const shown = Math.max(6, SHOWN_ROWS - sink);
  // rings and the dark water around the struggle
  if (reduced) ring(c, x, wl + 1, 11, 4, FOAM);
  else for (let i = 0; i < 2; i++) {
    const r = ((t + i * 350) % 700) / 700;
    ring(c, x, wl + 1, 8 + r * 8, 3 + r * 2, `rgba(227, 245, 250, ${(0.8 * (1 - r)).toFixed(3)})`);
  }
  rect(c, x - 9, wl + 1, 19, 3, UNDER);
  // the head, lower and lower
  c.drawImage(frame, 0, 0, 24, shown, x - 12 + jerk, wl - shown + 1, 24, shown);
  rect(c, x - 8, wl, 17, 1, DEEP);
  for (let i = -9; i <= 9; i += 2) rect(c, x + i, wl - 1, 1, 1, FOAM);
  // one arm up high, waving
  const wave = reduced ? 0 : Math.round(Math.sin(t / 110) * 2);
  const side = facing === "left" ? -1 : 1;
  forearm(c, x + (side > 0 ? 6 : -8), wl, 9 - Math.round(k * 3), skin, wave);
  if (!reduced) {
    forearm(c, x + (side > 0 ? -8 : 6), wl, Math.max(0, Math.round(Math.sin(t / 150) * 4)), skin, -side);
    splash(c, x - 8, wl, (t % 400) / 400, 1.2);
    splash(c, x + 8, wl, ((t + 200) % 400) / 400, 1.2);
    for (let i = 0; i < 4; i++) {
      const b = ((t + i * 260) % 900) / 900;
      rect(c, x - 6 + i * 4, wl - 1 - Math.round(b * 6), 1, 1, BUBBLE);
    }
  }
}
