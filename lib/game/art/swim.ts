import type { Facing, SkinTone, Vec } from "@/lib/game/types";
import { OUTLINE, SKIN } from "./palettes";

// v18.1 Ao sống động: a swimmer in the pond, the drips after climbing out, and the fish that leap from the water.
// Original pixel art at 1:1 world pixels, fillRect + drawImage only (crisp when scaled up pixelated). `t` is ms.

type Ctx = CanvasRenderingContext2D;

const FOAM = "#e3f5fa";
const FOAM_DIM = "rgba(227, 245, 250, 0.55)";
const DEEP = "#2f6e8f";
const UNDER = "rgba(28, 72, 98, 0.5)";
const BUBBLE = "#e8f7fc";
const DROP = "#8fd0ea";
const DROP_HI = "#dff3fa";
const FISH_BACK = "#5f7c8a";
const FISH_BODY = "#c3d3da";
const FISH_BELLY = "#eef5f7";
const FISH_EYE = "#1d2a30";

/** The sprite rows shown above the water: the head and the top of the chest (the chin is row 20). */
export const SHOWN_ROWS = 26;
/** How long one leap takes in the air (spec: about 600 ms), and how long its rings linger after. */
export const LEAP_MS = 600;
export const LEAP_TAIL_MS = 700;

function rect(c: Ctx, x: number, y: number, w: number, h: number, col: string): void {
  if (w <= 0 || h <= 0) return;
  c.fillStyle = col;
  c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

/** An ellipse outline, one pixel per step (a ripple ring on flat water). */
export function ring(c: Ctx, cx: number, cy: number, rx: number, ry: number, col: string): void {
  if (rx < 1) return;
  c.fillStyle = col;
  const seen = new Set<number>();
  const steps = Math.max(12, Math.round(rx * 5));
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const x = Math.round(cx + Math.cos(a) * rx), y = Math.round(cy + Math.sin(a) * ry);
    const k = x * 4096 + y;
    if (seen.has(k)) continue;
    seen.add(k);
    c.fillRect(x, y, 1, 1);
  }
}

/** A filled ellipse (the body's shadow under the surface, a puddle). */
function blob(c: Ctx, cx: number, cy: number, rx: number, ry: number, col: string): void {
  c.fillStyle = col;
  for (let dy = -ry; dy <= ry; dy++) {
    const w = Math.round(rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / ((ry + 0.5) * (ry + 0.5)))));
    c.fillRect(Math.round(cx - w), Math.round(cy + dy), w * 2 + 1, 1);
  }
}

/** A forearm out of the water: `h` px tall from the waterline at (x, wl), with a hand on top. */
export function forearm(c: Ctx, x: number, wl: number, h: number, skin: { s: string; S: string }, lean: number): void {
  if (h <= 0) return;
  for (let i = 0; i < h; i++) {
    const xx = x + Math.round((lean * i) / Math.max(1, h));
    rect(c, xx - 1, wl - i, 1, 1, OUTLINE);
    rect(c, xx, wl - i, 2, 1, i === 0 ? skin.S : skin.s);
    rect(c, xx + 2, wl - i, 1, 1, OUTLINE);
  }
  const hx = x + lean;
  rect(c, hx - 1, wl - h - 2, 4, 1, OUTLINE);
  rect(c, hx - 1, wl - h - 1, 1, 1, OUTLINE);
  rect(c, hx + 2, wl - h - 1, 1, 1, OUTLINE);
  rect(c, hx, wl - h - 1, 2, 1, skin.s);
}

/** A small splash: a few drops flung up around (x, y); `k` 0…1 is its age. */
export function splash(c: Ctx, x: number, y: number, k: number, size: number): void {
  if (k < 0 || k > 1) return;
  const spread = [-3, -1.5, 0, 1.5, 3];
  const lift = [3, 5, 6, 5, 3];
  spread.forEach((s, i) => {
    const px = x + s * size * (0.4 + k);
    const py = y - Math.sin(k * Math.PI) * lift[i] * size;
    rect(c, px, py, 1, i === 2 ? 2 : 1, i % 2 ? FOAM : DROP_HI);
  });
  if (k < 0.5) rect(c, x - 2 * size, y, 4 * size + 1, 1, FOAM_DIM);
}

/**
 * A swimmer whose feet (the point it y-sorts by) are at `feet`: `frame` is the character's 24×48 frame for `facing`;
 * the body is sunk to the chest, with a foam collar at the waterline, arms stroking, bubbles, and a V wake while
 * moving. `reduced` draws it still (no bob, one arm up, a single ring, no moving wake).
 */
export function drawSwimmer(
  c: Ctx, feet: Vec, facing: Facing, frame: HTMLCanvasElement, skinTone: SkinTone, t: number, moving: boolean, reduced: boolean,
): void {
  const skin = SKIN[skinTone];
  const x = Math.round(feet.x), wl = Math.round(feet.y) - 3;
  const anim = !reduced;
  const bob = anim ? Math.round(Math.sin(t / 280)) : 0;
  const stroke = anim ? ((t / (moving ? 520 : 900)) % 1) : 0.25;

  // the wake behind the swimmer (on the water, under everything else)
  if (moving) wake(c, x, wl, facing, anim ? t : 0);
  // the ripple ring around a swimmer treading water, and the body's shadow under the surface
  if (!moving) {
    if (anim) {
      const k = (t % 1300) / 1300;
      ring(c, x, wl + 1, 9 + k * 6, 3 + k * 2, `rgba(227, 245, 250, ${(0.6 * (1 - k)).toFixed(3)})`);
    } else {
      ring(c, x, wl + 1, 11, 4, FOAM_DIM);
    }
  }
  blob(c, x, wl + 3, 8, 2, UNDER);

  // arms behind the head (facing up, the strokes are seen past the back of the head: draw them first)
  const side = facing === "left" || facing === "right";
  const dir = facing === "left" ? -1 : 1;
  const armsFront = () => {
    if (side) {
      // one arm reaches forward over the water in an arc and pulls back under
      const a = stroke * Math.PI * 2;
      const up = Math.sin(a);
      if (up > -0.15) {
        // from the shoulder (just in front of the chest), reaching at most 3 px ahead as it comes over
        const reach = Math.round((1 - Math.cos(a)) * 1.5);
        forearm(c, x + dir * (3 + reach) - (dir < 0 ? 2 : 0), wl, Math.round(1 + Math.max(0, up) * 5), skin, dir * 2);
        if (anim && up < 0.25 && Math.cos(a) > 0) splash(c, x + dir * (5 + reach), wl, 0.5, 1);
      }
      return;
    }
    // front/back: the two arms take turns
    const l = Math.sin(stroke * Math.PI * 2), r = -l;
    // out of the water right at the shoulders (the chest spans x−7…x+6), the hand tipping outward as it rises
    forearm(c, x - 8, wl, Math.round(Math.max(0, l) * 5), skin, -1);
    forearm(c, x + 6, wl, Math.round(Math.max(0, r) * 5), skin, 1);
    if (anim) {
      if (l > 0 && l < 0.35) splash(c, x - 8, wl, 0.4, 1);
      if (r > 0 && r < 0.35) splash(c, x + 8, wl, 0.4, 1);
    }
  };
  if (facing === "up") armsFront();

  // the head and the top of the chest (sprite rows 0…25), the waterline across the chest
  c.drawImage(frame, 0, 0, 24, SHOWN_ROWS, x - 12, wl - SHOWN_ROWS + 1 + bob, 24, SHOWN_ROWS);
  rect(c, x - 8, wl + bob, 17, 1, DEEP);
  // the foam collar: a broken bright line, shifting while the swimmer moves
  const shift = anim ? Math.floor(t / 160) % 3 : 0;
  for (let i = -9; i <= 9; i++) {
    if ((i + shift) % 3 === 0) continue;
    rect(c, x + i, wl + bob - (Math.abs(i) > 7 ? 0 : 1), 1, 1, Math.abs(i) > 7 ? FOAM_DIM : FOAM);
  }
  if (facing !== "up") armsFront();

  // bubbles rising by the head
  const offs = [-7, 6, -3];
  for (let i = 0; i < (anim ? 3 : 2); i++) {
    const k = anim ? ((t + i * 470) % 1400) / 1400 : 0.3 + i * 0.3;
    const bx = x + offs[i] + (anim ? Math.round(Math.sin(k * 6 + i)) : 0);
    const by = wl - 2 - Math.round(k * 9);
    c.globalAlpha = anim ? 1 - k : 0.8;
    if (i === 0 && k > 0.3 && k < 0.7) {
      rect(c, bx, by, 2, 2, BUBBLE);
      rect(c, bx, by, 1, 1, "#ffffff");
    } else {
      rect(c, bx, by, 1, 1, BUBBLE);
    }
    c.globalAlpha = 1;
  }
}

/** The V wake behind a swimmer moving toward `facing`: dashes spreading out and fading behind it. */
function wake(c: Ctx, x: number, wl: number, facing: Facing, t: number): void {
  const drift = Math.floor(t / 110) % 3;
  for (let k = 1; k <= 5; k++) {
    const d = k * 3 + drift, spread = 5 + k * 2;
    const a = (0.75 * (1 - k / 6)).toFixed(3);
    const col = `rgba(227, 245, 250, ${a})`;
    switch (facing) {
      case "down": // moving toward the viewer: the wake trails up the screen
        rect(c, x - spread, wl - Math.round(d * 0.5), 2, 1, col);
        rect(c, x + spread - 1, wl - Math.round(d * 0.5), 2, 1, col);
        break;
      case "up": // moving away: the wake trails down, in front of the swimmer
        rect(c, x - spread, wl + 2 + Math.round(d * 0.5), 2, 1, col);
        rect(c, x + spread - 1, wl + 2 + Math.round(d * 0.5), 2, 1, col);
        break;
      case "right":
      case "left": {
        const back = facing === "right" ? -1 : 1;
        rect(c, x + back * (8 + d) - 1, wl - 1 - Math.round(k * 0.8), 3, 1, col);
        rect(c, x + back * (8 + d) - 1, wl + 2 + Math.round(k * 0.8), 3, 1, col);
        break;
      }
    }
  }
}

/**
 * "Ướt": water dripping from a character who just climbed out (feet at `feet`), for `left` 0…1 of the wet time left
 * (the drips thin out). Reduced motion: still drops and the puddle.
 */
export function drawWetDrips(c: Ctx, feet: Vec, t: number, left: number, reduced: boolean): void {
  const x = Math.round(feet.x), y = Math.round(feet.y);
  blob(c, x, y + 1, 6, 1, `rgba(70, 140, 180, ${(0.35 * Math.min(1, left * 2)).toFixed(3)})`);
  const xs = [-6, -3, 2, 5, -1];
  const count = Math.max(2, Math.round(xs.length * Math.min(1, left + 0.2)));
  for (let i = 0; i < count; i++) {
    const top = y - 36 + (i % 3) * 6;
    const k = reduced ? 0.35 + i * 0.12 : ((t + i * 230) % 760) / 760;
    const dy = Math.round(k * k * (y - 2 - top));
    rect(c, x + xs[i], top + dy, 1, 2, DROP);
    rect(c, x + xs[i], top + dy, 1, 1, DROP_HI);
    if (!reduced && k > 0.92) rect(c, x + xs[i] - 1, y, 3, 1, FOAM_DIM);
  }
}

/** One leap: from (x0, y0) up in an arc and back in at (x1, y1), `born` = when it left the water. */
export interface Leap { x0: number; y0: number; x1: number; y1: number; born: number }

/** Is a leap over (its rings faded)? */
export const leapDone = (l: Leap, t: number): boolean => t - l.born > LEAP_MS + LEAP_TAIL_MS;

/** The fish in the air (facing right; `dir` -1 mirrors it): tilted up while rising, level at the top, down while
 *  falling. Rows: the dark back, the silver body, the pale belly; the tail forks behind. */
const FISH_ROWS = [   // dx −5…5 (the head on the right), dy −2…2
  ".....kk....",
  "k..kkkkkkk.",
  ".kkbbbbbbeb",
  "k..wwwwwww.",
  "....w......",
];
const FISH_COL: Record<string, string> = { k: FISH_BACK, b: FISH_BODY, w: FISH_BELLY, e: FISH_EYE };

function airFish(c: Ctx, x: number, y: number, dir: number, tilt: -1 | 0 | 1): void {
  FISH_ROWS.forEach((row, ri) => {
    for (let i = 0; i < row.length; i++) {
      const col = FISH_COL[row[i]];
      if (!col) continue;
      const dx = i - 5, dy = ri - 2 + Math.round((-dx * tilt) / 3.5);
      rect(c, x + dir * dx, y + dy, 1, 1, col);
    }
  });
}

/**
 * A fish leaping out of the pond (cosmetic, client-only): an arc of LEAP_MS with a splash and a ring where it leaves
 * the water and where it falls back in. Reduced motion: one still ring where it would land.
 */
export function drawLeap(c: Ctx, l: Leap, t: number, reduced: boolean): void {
  const age = t - l.born;
  if (age < 0 || leapDone(l, t)) return;
  if (reduced) {
    ring(c, l.x1, l.y1, 6, 2, FOAM_DIM);
    return;
  }
  const k = age / LEAP_MS;
  // rings: out at the start, in at the end
  const r0 = age / (LEAP_MS + 200);
  if (r0 <= 1) ring(c, l.x0, l.y0, 2 + r0 * 8, 1 + r0 * 3, `rgba(227, 245, 250, ${(0.8 * (1 - r0)).toFixed(3)})`);
  const r1 = (age - LEAP_MS) / LEAP_TAIL_MS;
  if (r1 >= 0 && r1 <= 1) ring(c, l.x1, l.y1, 2 + r1 * 9, 1 + r1 * 3, `rgba(227, 245, 250, ${(0.85 * (1 - r1)).toFixed(3)})`);
  splash(c, l.x0, l.y0, age / 300, 1);
  splash(c, l.x1, l.y1, (age - LEAP_MS) / 320, 1.2);
  if (k > 1) return;
  const dir = l.x1 >= l.x0 ? 1 : -1;
  const x = l.x0 + (l.x1 - l.x0) * k;
  const y = l.y0 + (l.y1 - l.y0) * k - Math.sin(k * Math.PI) * 14;
  const tilt: -1 | 0 | 1 = k < 0.35 ? 1 : k > 0.65 ? -1 : 0;
  // a glint of water trailing off the tail while rising
  if (k < 0.5) rect(c, x - dir * 7, y + 2, 1, 1, DROP_HI);
  airFish(c, Math.round(x), Math.round(y), dir, tilt);
}
