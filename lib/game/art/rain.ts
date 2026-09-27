import { handPoint } from "@/lib/game/fishing/geometry";
import type { UmbrellaKind } from "@/lib/game/rain/model";
import type { Facing, Vec } from "@/lib/game/types";
import type { WeatherFx } from "./weather";
import { OUTLINE } from "./palettes";

// v18.9 Ô và ướt sũng + sét đánh: an umbrella held over the character (4 facings; on a bike or a scooter too), the
// soaked look, the cold look (pale cheeks, a runny nose, shivers and a sneeze) and a lightning strike (the bolt, the
// flash, the charred look with the hair on end). Original pixel art at 1:1 world pixels, fillRect only. `t` is ms. A
// character frame is 24×48 drawn at (feet.x − 12, feet.y − 46).

type Ctx = CanvasRenderingContext2D;

function rect(c: Ctx, x: number, y: number, w: number, h: number, col: string): void {
  if (w <= 0 || h <= 0) return;
  c.fillStyle = col;
  c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}
const px = (c: Ctx, col: string, x: number, y: number) => rect(c, x, y, 1, 1, col);

interface UmbrellaColors { main: string; light: string; dark: string; rib: string; trim: string; handle: string }
export const UMBRELLA_COLORS: Readonly<Record<UmbrellaKind, UmbrellaColors>> = {
  // ô giấy: oiled amber paper on bamboo ribs, a red band
  o_giay: { main: "#e8a13a", light: "#f6cf7a", dark: "#b86a22", rib: "#7a4a1e", trim: "#c0392b", handle: "#a8763c" },
  // ô vải: navy fabric
  o_vai: { main: "#2f5fa8", light: "#5a88cc", dark: "#1e3f78", rib: "#15294f", trim: "#1e3f78", handle: "#3a2418" },
  // ô gập cao cấp: burgundy with a gold trim, a wooden crook
  o_gap: { main: "#7a2344", light: "#a8406a", dark: "#4e1229", rib: "#2a0a18", trim: "#e0b33c", handle: "#8a5a2e" },
};

/** Half widths of the canopy's rows, top to bottom. */
const DOME = [1, 4, 7, 10, 12, 13, 14, 15] as const;
/** The canopy leans toward where the character faces. */
const LEAN: Readonly<Record<Facing, number>> = { down: 1, up: -1, left: -3, right: 3 };

/** Where the canopy's centre top is for a character standing at `feet` (`lift` raises it, e.g. on a scooter). */
export function canopyTop(feet: Vec, facing: Facing, t: number, reduced: boolean, lift = 0): Vec {
  const sway = reduced ? 0 : Math.round(Math.sin(t / 420));
  return { x: Math.round(feet.x) + LEAN[facing] + sway, y: Math.round(feet.y) - 61 - lift };
}

/**
 * The umbrella of `kind` held open by a character at `feet`. Drawn in two layers around the body: "back" (the shaft,
 * which the head and shoulders hide) before the character, "front" (the canopy and the hand's grip) after it. Seen from
 * behind the grip is hidden too.
 */
export function drawUmbrella(c: Ctx, feet: Vec, facing: Facing, kind: UmbrellaKind, t: number, reduced: boolean,
                             layer: "back" | "front", lift = 0): void {
  const col = UMBRELLA_COLORS[kind];
  const top = canopyTop(feet, facing, t, reduced, lift);
  const hand = handPoint({ x: Math.round(feet.x), y: Math.round(feet.y) - lift }, facing);
  const rimY = top.y + DOME.length;
  if (layer === "back") {
    // the shaft from the canopy's middle down to the hand
    const n = Math.max(1, Math.abs(hand.y - rimY));
    for (let k = 0; k <= n; k++) px(c, OUTLINE, top.x + ((hand.x - top.x) * k) / n, rimY + ((hand.y - rimY) * k) / n);
    return;
  }
  // the canopy: an outlined dome, lit on the left, shaded on the right, with ribs and a scalloped rim
  DOME.forEach((hw, r) => rect(c, top.x - hw - 1, top.y + r, hw * 2 + 3, 1, OUTLINE));
  DOME.forEach((hw, r) => {
    const y = top.y + r;
    rect(c, top.x - hw, y, hw * 2 + 1, 1, col.main);
    rect(c, top.x - hw, y, Math.max(1, Math.round(hw * 0.6)), 1, col.light);
    rect(c, top.x + Math.round(hw * 0.5), y, Math.max(1, hw - Math.round(hw * 0.5) + 1), 1, col.dark);
    // ribs fan out from the tip
    if (r >= 2) for (const f of [-0.7, -0.3, 0.3, 0.7]) px(c, col.rib, top.x + Math.round(f * hw), y);
  });
  // the trim band two rows above the rim, and the scallops under it
  const hwB = DOME[DOME.length - 1];
  rect(c, top.x - hwB, rimY - 2, hwB * 2 + 1, 1, col.trim);
  for (let x = -hwB - 1; x <= hwB + 1; x++) {
    const inGap = (x + hwB + 1) % 6 === 3;
    px(c, inGap ? OUTLINE : col.dark, top.x + x, rimY);
    if (!inGap && (x + hwB + 1) % 6 !== 0) px(c, OUTLINE, top.x + x, rimY + 1);
  }
  if (kind === "o_giay") for (let x = -9; x <= 9; x += 6) px(c, col.trim, top.x + x, top.y + 4);  // painted dots
  // the tip
  rect(c, top.x, top.y - 2, 1, 2, OUTLINE);
  px(c, col.trim, top.x, top.y - 3);
  // raindrops splashing off the canopy
  if (!reduced) {
    for (let i = 0; i < 3; i++) {
      const k = ((t + i * 310) % 900) / 900;
      if (k < 0.35) {
        const sx = top.x + (i - 1) * 8 + Math.round((i - 1) * k * 8), sy = top.y + 2 + i - Math.round(Math.sin(k / 0.35 * Math.PI) * 3);
        px(c, "#dff3fb", sx, sy);
      }
    }
  }
  // the hand's grip (a crook for the premium one)
  if (facing !== "up") {
    rect(c, hand.x, hand.y - 1, 1, 3, col.handle);
    if (kind === "o_gap") { px(c, col.handle, hand.x + 1, hand.y + 2); px(c, col.handle, hand.x + 2, hand.y + 1); }
    else px(c, OUTLINE, hand.x, hand.y + 2);
  }
}

const DROP = "#8fcbe6";
const DROP_HI = "#e6f6fc";
const PUDDLE = "rgba(90, 150, 190, 0.35)";

/**
 * Soaked: a puddle at the feet, rain bouncing off the head, water running off the hair and the clothes. Reduced motion:
 * still drops.
 */
export function drawSoaked(c: Ctx, feet: Vec, t: number, reduced: boolean): void {
  const x = Math.round(feet.x), y = Math.round(feet.y);
  rect(c, x - 10, y, 20, 2, PUDDLE);
  rect(c, x - 7, y + 2, 14, 1, PUDDLE);
  // wet sheen on the clothes
  for (const [dx, dy] of [[-4, -30], [3, -27], [-2, -23], [5, -21], [-5, -18], [1, -15], [-3, -10], [3, -8]] as const) px(c, DROP_HI, x + dx, y + dy);
  // hair plastered: streaks on the top of the head
  for (const dx of [-5, -2, 2, 5]) { px(c, DROP_HI, x + dx, y - 43); px(c, DROP, x + dx, y - 42); }
  // drips down the sides of the body
  const xs = [-8, -4, 3, 7, 0];
  xs.forEach((dx, i) => {
    const top = y - 36 + (i % 3) * 7;
    const k = reduced ? 0.3 + i * 0.1 : ((t + i * 197) % 640) / 640;
    const dy = Math.round(k * k * (y - 1 - top));
    rect(c, x + dx, top + dy, 1, 2, DROP);
    px(c, DROP_HI, x + dx, top + dy);
    if (!reduced && k > 0.9) { px(c, DROP, x + dx - 1, y); px(c, DROP, x + dx + 1, y); }
  });
  // raindrops bouncing off the head
  if (!reduced) {
    for (let i = 0; i < 2; i++) {
      const k = ((t + i * 450) % 700) / 700;
      if (k < 0.4) px(c, DROP_HI, x - 4 + i * 8 + Math.round((i * 2 - 1) * k * 6), y - 47 - Math.round(Math.sin((k / 0.4) * Math.PI) * 3));
    }
  }
}

const PALE = "rgba(190, 220, 245, 0.6)";
const NOSE = "#d97a7a";
const SNOT = "#bfe3f0";
const SPRAY = "#f2fbff";

/** The sneeze's phase at `t` (every 3.6 s: 0 no, 1 wind-up, 2 the sneeze). Reduced motion never sneezes. */
export function sneezePhase(t: number, reduced: boolean): 0 | 1 | 2 {
  if (reduced) return 0;
  const k = t % 3600;
  return k < 300 ? 1 : k < 700 ? 2 : 0;
}

/**
 * Cảm lạnh over a character whose frame's row 0 is at `top`: pale cheeks, a red nose with a drip, shiver marks either
 * side, and now and then a sneeze (a spray in front of the face).
 */
export function drawCold(c: Ctx, feet: Vec, top: number, facing: Facing, t: number, reduced: boolean): void {
  const x = Math.round(feet.x) - 12, y = Math.round(top);
  const ph = sneezePhase(t, reduced);
  if (facing === "down") {
    rect(c, x + 6, y + 15, 3, 2, PALE);
    rect(c, x + 15, y + 15, 3, 2, PALE);
    px(c, NOSE, x + 12, y + 15);
    rect(c, x + 12, y + 16, 1, reduced ? 1 : 1 + Math.round(((t % 1800) / 1800) * 2), SNOT);
  } else if (facing !== "up") {
    const nx = facing === "right" ? x + 18 : x + 5;
    rect(c, facing === "right" ? x + 13 : x + 8, y + 15, 3, 2, PALE);
    px(c, NOSE, nx, y + 15);
    px(c, SNOT, nx, y + 16);
  }
  // shivers: little brackets either side of the chest, jittering
  const j = reduced ? 0 : Math.round(Math.sin(t / 45));
  for (const [sx, d] of [[x + 2 + j, -1], [x + 21 - j, 1]] as const) {
    px(c, PALE, sx, y + 24); px(c, PALE, sx + d, y + 25); px(c, PALE, sx, y + 26);
  }
  if (ph === 2 && facing !== "up") {
    const dir = facing === "left" ? -1 : facing === "right" ? 1 : 0;
    const k = ((t % 3600) - 300) / 400;
    for (let i = 0; i < 6; i++) {
      const sx = x + 12 + dir * (6 + Math.round(k * 6)) + (dir === 0 ? (i - 3) * 2 : (i % 3) - 1);
      const sy = y + 15 + (dir === 0 ? 2 + Math.round(k * 5) + (i % 2) : (i % 3) - 1);
      px(c, SPRAY, sx, sy);
    }
  }
}

const BOLT = "#fff7c2";
const BOLT_CORE = "#ffffff";
const BOLT_GLOW = "rgba(255, 240, 150, 0.45)";
const SOOT = "rgba(30, 24, 20, 0.55)";
const SMOKE = "rgba(80, 76, 72, 0.55)";
const SPARK = "#ffd23a";

/** The bolt shows for this long; the charred look lasts the rest of STRIKE_MS. */
export const BOLT_MS = 400;

/** The screen flash's strength for the viewer's weather-effects level (4 full, 3 dim, 2 and below none). */
export function strikeFlashK(fx: WeatherFx): number {
  return fx === 4 ? 1 : fx === 3 ? 0.4 : 0;
}

/** The bolt's flicker at `age` ms: on 0–120, off, on again 180–260, a last glow to BOLT_MS. */
export function boltOn(age: number): boolean {
  return (age >= 0 && age < 120) || (age >= 180 && age < 260) || (age >= 320 && age < BOLT_MS);
}

/** The zigzag from the sky to the head (deterministic per strike: `seed`). */
export function boltPath(feet: Vec, seed: number): Vec[] {
  const x = Math.round(feet.x), head = Math.round(feet.y) - 44;
  const pts: Vec[] = [];
  let bx = x + ((seed % 7) - 3) * 3;
  for (let y = head - 150, i = 0; y < head; y += 14, i++) {
    pts.push({ x: bx, y });
    bx += ((seed * 31 + i * 17) % 11) - 5;
    bx = Math.round(bx + (x - bx) * 0.25);
  }
  pts.push({ x, y: head });
  return pts;
}

/**
 * A lightning strike on the character at `feet`, `age` ms after it: the bolt (flickering, with a glow and a branch),
 * then soot on the body, the hair standing on end, sparks and smoke rising. Drawn over the character.
 */
export function drawStrike(c: Ctx, feet: Vec, age: number, seed: number, reduced: boolean): void {
  const x = Math.round(feet.x), y = Math.round(feet.y);
  if (age < 0) return;
  if (boltOn(age) || (reduced && age < BOLT_MS)) {
    const pts = boltPath(feet, seed);
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      const n = Math.max(1, Math.abs(b.y - a.y));
      for (let k = 0; k <= n; k++) {
        const qx = a.x + ((b.x - a.x) * k) / n, qy = a.y + ((b.y - a.y) * k) / n;
        rect(c, qx - 2, qy, 5, 1, BOLT_GLOW);
        rect(c, qx - 1, qy, 2, 1, BOLT);
        px(c, BOLT_CORE, qx, qy);
      }
      if (i === 3) for (let k = 0; k < 10; k++) px(c, BOLT, a.x + k * (seed % 2 ? 1 : -1), a.y + k);  // a branch
    }
    // the ground lights up
    rect(c, x - 10, y - 1, 20, 3, BOLT_GLOW);
  }
  // charred: soot over the body and face, the hair on end
  for (let dy = -40; dy < -12; dy++) {
    const hw = dy < -29 ? 5 : 6;
    for (let dx = -hw; dx <= hw; dx++) if (((dx + dy + seed) & 1) === 0 || (dy > -36 && dy < -32)) px(c, SOOT, x + dx, y + dy);
  }
  for (let i = -3; i <= 3; i++) {
    const h = 3 + ((i + 3) * 5 + seed) % 3;
    rect(c, x + i * 2, y - 46 - h, 1, h, OUTLINE);
  }
  // sparks and smoke rising
  if (!reduced) {
    for (let i = 0; i < 4; i++) {
      const k = ((age + i * 170) % 700) / 700;
      px(c, SPARK, x - 8 + i * 5 + Math.round(Math.sin(age / 60 + i) * 2), y - 30 - Math.round(k * 12));
      rect(c, x - 4 + i * 3, y - 50 - Math.round(k * 14), 2, 2, SMOKE);
    }
  } else {
    rect(c, x - 2, y - 54, 2, 2, SMOKE);
    rect(c, x + 2, y - 58, 2, 2, SMOKE);
  }
}

/** The scorch mark on the ground where lightning struck. */
export function drawScorch(c: Ctx, at: Vec): void {
  const x = Math.round(at.x), y = Math.round(at.y);
  rect(c, x - 7, y - 1, 14, 3, "rgba(30, 24, 20, 0.45)");
  rect(c, x - 4, y - 2, 8, 5, "rgba(30, 24, 20, 0.35)");
}
