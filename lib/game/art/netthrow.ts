import { netFrame, type NetState } from "@/lib/game/fishing/netcast";
import type { Facing, SkinTone, Vec } from "@/lib/game/types";
import type { PixelCtx } from "./net";
import { OUTLINE, SKIN } from "./palettes";
import { armsOfFrame } from "./raster";
import { darker, limb } from "./road";

// v18.2 Quăng lưới (chài) in the world, as everyone sees it (world px, 1:1). v2: the thrower's own body and arms are
// redrawn per phase (the sprite's hanging arms dropped, like the warm-up stretch), and the net is a real cast net:
// aim — the folded chài draped over the forearm, lead weights along the hem, the rope coiled in the other hand, swaying;
// charge — the body twists and both arms swing the net back and up; throw — a spinning release: the net flies as an
// opening, rotating disc of criss-cross mesh with the leads spreading on its rim, tilted (an ellipse), its shadow on the
// water and the rope trailing back to the hand, the thrower following through; sunk — a splash burst and droplets, then
// the mesh fading as it sinks, ripples, bubbles rising and the cork floats bobbing; pull — the rope taut and shivering,
// hand over hand, the body leaning back, the ring gathering in with the mesh bunching and the water churning with fish
// flicking silver; won — the dripping bag lifted beside the head, fish flapping inside (silver, a golden one in a big
// haul), drips falling. Reduced motion: still key frames. Original art; fillRect (+ drawImage for the body) only.

const MESH: [number, number, number] = [236, 228, 204];
const MESH_DK: [number, number, number] = [176, 164, 140];
const LEAD = "#5d646c";
const LEAD_HI = "#a3acb5";
const ROPE = "#c89a5c";
const ROPE_DK = "#8a6434";
const CORK = "#d9822b";
const CORK_TOP = "#f5c96e";
const CORK_DK = "#8f4e17";
const SILVER = "#d6dbe4";
const SILVER_DK = "#7d8791";
const GOLD = "#f0b429";
const GOLD_DK = "#a8741a";

const rgba = (c: [number, number, number], a: number) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${Math.max(0, Math.min(1, a)).toFixed(3)})`;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const easeOut = (k: number) => 1 - (1 - clamp01(k)) ** 3;
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

const FWD: Record<Facing, Vec> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
/** How flat the net lies on the water (an ellipse r across, r·FLAT deep). */
const FLAT = 0.5;

function px(c: PixelCtx, col: string, x: number, y: number, w = 1, h = 1): void {
  c.fillStyle = col;
  c.fillRect(Math.round(x), Math.round(y), w, h);
}

// ---------------------------------------------------------------------------------------------------------------- pose

/** A pose point: `fx` ahead of the feet (along the facing), `lat` to the net hand's side, `uy` above the feet. */
type P3 = [number, number, number];

/** Where a pose point is on screen for a character whose feet are at `feet`. */
function at(feet: Vec, facing: Facing, [fx, lat, uy]: P3): Vec {
  const x = Math.round(feet.x), y = Math.round(feet.y);
  switch (facing) {
    case "right": return { x: x + Math.round(fx), y: y - Math.round(uy) };
    case "left": return { x: x - Math.round(fx), y: y - Math.round(uy) };
    case "down": return { x: x + Math.round(lat), y: y - Math.round(uy - fx * 0.35) };
    case "up": return { x: x + Math.round(lat), y: y - Math.round(uy + fx * 0.35) };
  }
}

const lerp3 = (a: P3, b: P3, k: number): P3 => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];

const AIM_N: P3 = [5, 6, 20];
const AIM_O: P3 = [2, -6, 19];
const BACK_N: P3 = [-7, 9, 31];
const OUT_N: P3 = [12, 4, 23];

export interface NetPose {
  /** The net hand and the rope hand. */
  n: Vec;
  o: Vec;
  /** The upper body's shift (px) and the charge's wind-up (0 … 1). */
  shift: Vec;
  wind: number;
}

/** The thrower's hands and body shift `since` ms into the phase. */
export function netPose(feet: Vec, facing: Facing, s: NetState, since: number, t: number, reduced: boolean): NetPose {
  const fr = netFrame(s.show, since, reduced);
  const f = FWD[facing];
  let n: P3 = AIM_N, o: P3 = AIM_O, push = 0, side = 0;
  switch (s.show) {
    case "aim":
      break;
    case "charge": {
      const w = fr.wind;
      n = lerp3(AIM_N, BACK_N, w);
      n = [n[0], n[1], n[2] + 3 * Math.sin(Math.PI * w)];
      o = lerp3(AIM_O, [-2, -3, 24], w);
      push = -2 * w;
      side = w;
      break;
    }
    case "throw": {
      const ft = reduced ? 1 : easeOut(since / 220);
      n = lerp3(BACK_N, OUT_N, ft);
      o = [4, -5, 20];
      push = 2 * ft - fr.flight;
      break;
    }
    case "sunk":
      n = [9, 3, 20];
      o = [6, -3, 21];
      break;
    case "pull": {
      // hand over hand: one reaches out along the rope while the other draws in to the chest
      const a = reduced ? 0.5 : (1 - Math.cos((2 * Math.PI * t) / 700)) / 2;
      n = [11 - 8 * a, 3, 21 + a];
      o = [3 + 8 * a, -3, 22 - a];
      push = -fr.lean;
      break;
    }
    case "won": {
      const bob = reduced ? 0 : Math.round(Math.sin(t / 180));
      n = [12, 11, 42 + bob];
      o = [10, 9, 37 + bob];
      break;
    }
  }
  const shift = { x: Math.round(f.x * push + (f.x === 0 ? side : 0)), y: Math.round(f.y * push) };
  return { n: at(feet, facing, n), o: at(feet, facing, o), shift, wind: fr.wind };
}

// ------------------------------------------------------------------------------------------------------- net pieces

/** The folded chài hanging from `h` (the forearm across its top): mesh widening to the hem, a row of lead weights. */
function drape(c: PixelCtx, h: Vec, dir: number, hem: number, sway: number): void {
  const rows = 12;
  for (let j = 0; j <= rows; j++) {
    const half = 2 + Math.floor(j * 0.4);
    const cx = h.x + dir + Math.round(((hem + sway) * j) / rows);
    const y = h.y + j;
    for (let i = -half; i <= half; i++) {
      if (j === 0) { px(c, i % 2 === 0 ? ROPE : ROPE_DK, cx + i, y); continue; }
      const edge = Math.abs(i) === half;
      const line = (i + j + 30) % 3 === 0 || (i - j + 30) % 3 === 0;
      px(c, edge ? OUTLINE : line ? rgba(MESH_DK, 1) : rgba(MESH, 1), cx + i, y);
    }
  }
  // the hem: lead sinkers hanging 2 px, staggered
  const half = 2 + Math.floor(rows * 0.4) + 1;
  const cx = h.x + dir + hem + sway;
  for (let i = -half; i <= half; i += 2) {
    const drop = (i + half) % 4 === 0 ? 1 : 0;
    px(c, LEAD, cx + i, h.y + rows + 1 + drop, 1, 2);
    px(c, LEAD_HI, cx + i, h.y + rows + 1 + drop);
  }
}

/** The rope coiled in the other hand. */
function coil(c: PixelCtx, h: Vec): void {
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    px(c, i % 3 === 0 ? ROPE_DK : ROPE, h.x + Math.cos(a) * 2.5, h.y + 2 + Math.sin(a) * 1.6);
  }
  px(c, ROPE, h.x - 1, h.y + 5);
  px(c, ROPE, h.x - 1, h.y + 6);
}

function rope(c: PixelCtx, a: Vec, b: Vec, sag: number, shiver = 0): void {
  const n = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 1.5));
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    const v = i > 1 && i < n - 1 ? (i % 2 === 0 ? shiver : -shiver) : 0;
    px(c, i % 4 === 0 ? ROPE_DK : ROPE, a.x + (b.x - a.x) * k + nx * v, a.y + (b.y - a.y) * k + Math.sin(k * Math.PI) * sag + ny * v);
  }
}

/** A filled ellipse (r across, r·flat deep) as rows. */
function blob(c: PixelCtx, col: string, cx: number, cy: number, r: number, flat: number): void {
  const ry = Math.max(1, r * flat);
  for (let dy = -Math.floor(ry); dy <= Math.floor(ry); dy++) {
    const w = Math.round(r * Math.sqrt(Math.max(0, 1 - (dy / ry) ** 2)));
    if (w > 0) px(c, col, cx - w, cy + dy, w * 2 + 1, 1);
  }
}

function ellipse(c: PixelCtx, col: string, cx: number, cy: number, r: number, flat: number, step = 1.6): void {
  const n = Math.max(8, Math.ceil((Math.PI * 2 * r) / step));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    px(c, col, cx + Math.cos(a) * r, cy + Math.sin(a) * r * flat);
  }
}

/** The open net: two families of criss-cross lines at `rot`, the rim, and `leads` sinkers spread `spread` px out. */
function disc(c: PixelCtx, cx: number, cy: number, r: number, rot: number, flat: number, alpha: number, sp: number, spread: number): void {
  if (r < 2) return;
  const line = rgba(MESH, alpha), dark = rgba(MESH_DK, alpha);
  for (const th of [rot, rot + Math.PI / 2]) {
    const dx = Math.cos(th), dy = Math.sin(th), nx = -dy, ny = dx;
    for (let u = -r + sp / 2; u < r; u += sp) {
      const L = Math.sqrt(Math.max(0, r * r - u * u));
      for (let v = -L; v <= L; v += 1) {
        const x = nx * u + dx * v, y = ny * u + dy * v;
        px(c, line, cx + x, cy + y * flat);
      }
    }
  }
  ellipse(c, dark, cx, cy, r, flat, 1.2);
  const leads = Math.max(8, Math.min(18, Math.round(r * 0.7)));
  for (let i = 0; i < leads; i++) {
    const a = rot + (i / leads) * Math.PI * 2;
    const x = cx + Math.cos(a) * (r + spread), y = cy + Math.sin(a) * (r + spread) * flat;
    px(c, LEAD, x, y, 1, 2);
    px(c, LEAD_HI, x, y);
  }
}

function corks(c: PixelCtx, cx: number, cy: number, r: number, tt: number, still: boolean): void {
  const n = Math.max(8, Math.round(r * 0.55));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.2;
    const bob = still ? 0 : Math.round(Math.sin(tt / 320 + i * 1.3) * 0.8);
    const x = Math.round(cx + Math.cos(a) * r), y = Math.round(cy + Math.sin(a) * r * FLAT) + bob;
    px(c, "rgba(20, 50, 70, 0.3)", x - 1, y + 2, 3, 1);
    px(c, CORK_DK, x - 1, y + 1, 2, 1);
    px(c, CORK, x - 1, y, 2, 1);
    px(c, CORK_TOP, x - 1, y - 1, 1, 1);
  }
}

/** A splash at (cx, cy) `p` (0 … 1) through: a ring bursting out and droplets flung up and falling. */
function splash(c: PixelCtx, cx: number, cy: number, r: number, p: number): void {
  const a = 1 - p;
  ellipse(c, `rgba(232, 244, 248, ${(0.9 * a).toFixed(3)})`, cx, cy, r + 2 + 10 * easeOut(p), FLAT, 2);
  ellipse(c, `rgba(166, 214, 232, ${(0.7 * a).toFixed(3)})`, cx, cy, r * 0.6 + 6 * easeOut(p), FLAT, 2.4);
  for (let i = 0; i < 14; i++) {
    const ang = (i / 14) * Math.PI * 2 + i * 0.37;
    const out = r + 2 + (6 + (i % 3) * 3) * p;
    const h = (10 + (i % 4) * 3) * p - 20 * p * p;
    px(c, `rgba(240, 250, 252, ${a.toFixed(3)})`, cx + Math.cos(ang) * out, cy + Math.sin(ang) * out * FLAT - h, 1, i % 2 ? 1 : 2);
  }
}

/** One fish: a 4×2 body, eye and flicking tail; `dir` ±1. */
function fish(c: PixelCtx, x: number, y: number, dir: number, gold: boolean, flick: boolean): void {
  const body = gold ? GOLD : SILVER, dk = gold ? GOLD_DK : SILVER_DK;
  px(c, body, x - 2, y, 4, 1);
  px(c, dk, x - 2, y + 1, 4, 1);
  px(c, OUTLINE, x + dir * 1, y);
  px(c, body, x - dir * 3, y + (flick ? -1 : 1));
  px(c, dk, x - dir * 3, y);
}

// ----------------------------------------------------------------------------------------------------------- world

/** Is the throw drawn after (in front of) the body? Facing away the hands and water are behind it — except the bundle
 *  held up beside the head. */
export function netInFront(facing: Facing, s: NetState): boolean {
  return facing !== "up" || s.show === "won";
}

/** Where the body is drawn while pulling: leaning back against the rope. */
export function leanFeet(feet: Vec, facing: Facing, s: NetState, since: number, reduced: boolean): Vec {
  const lean = netFrame(s.show, since, reduced).lean;
  const f = FWD[facing];
  return { x: feet.x - f.x * lean, y: feet.y - f.y * lean };
}

/** The net (held, flying, sunk, pulled or lifted), `since` ms into its phase, for the character with feet at `feet`. */
export function drawNetThrow(c: PixelCtx, feet: Vec, facing: Facing, s: NetState, since: number, t: number, reduced: boolean): void {
  const fr = netFrame(s.show, since, reduced);
  const pose = netPose(feet, facing, s, since, t, reduced);
  const target = { x: Math.round(feet.x + s.dx), y: Math.round(feet.y + s.dy) };
  const tt = reduced ? 0 : t;
  const r = Math.max(4, s.r);
  const dir = facing === "left" ? -1 : 1;
  const fwdX = FWD[facing].x;
  switch (s.show) {
    case "aim": {
      const sway = reduced ? 0 : Math.round(Math.sin(tt / 450) * 1.2);
      rope(c, pose.o, pose.n, 2);
      drape(c, pose.n, dir, 0, sway);
      coil(c, pose.o);
      return;
    }
    case "charge": {
      // the hem trails behind the swing
      const lag = Math.round(3 * Math.sin(Math.PI * pose.wind));
      rope(c, pose.o, pose.n, 2);
      drape(c, pose.n, dir, fwdX !== 0 ? fwdX * lag : lag, 0);
      coil(c, pose.o);
      return;
    }
    case "throw": {
      const k = reduced ? (fr.flight < 0.5 ? 0.5 : 1) : fr.flight;
      const ke = 1 - (1 - k) ** 2;
      const dist = Math.hypot(target.x - pose.n.x, target.y - pose.n.y);
      const arc = (10 + dist * 0.12) * Math.sin(Math.PI * k);
      const cx = lerp(pose.n.x, target.x, ke), cy = lerp(pose.n.y, target.y, ke) - arc;
      const gx = lerp(pose.n.x, target.x, ke), gy = lerp(feet.y + FWD[facing].y * 4, target.y, ke);
      const open = easeOut((k - 0.08) / 0.85);
      const rr = 2 + (r - 2) * open;
      // the shadow on the water, sharpening as it comes down
      blob(c, `rgba(15, 40, 60, ${(0.12 + 0.18 * k).toFixed(3)})`, gx, gy, rr * (0.55 + 0.45 * k), FLAT);
      rope(c, pose.o, { x: cx, y: cy }, 4 * (1 - k));
      // speed streaks behind the spinning net
      if (!reduced && k < 0.75) {
        for (let i = 1; i <= 3; i++) {
          const b = Math.max(0, ke - i * 0.06);
          px(c, `rgba(255, 255, 255, ${(0.5 - i * 0.13).toFixed(3)})`, lerp(pose.n.x, target.x, b), lerp(pose.n.y, target.y, b) - (10 + dist * 0.12) * Math.sin(Math.PI * b), 2, 1);
        }
      }
      const rot = Math.PI * 2.6 * ke;
      if (rr < 4) {
        blob(c, rgba(MESH, 1), cx, cy, 2.5, 0.8);
        px(c, LEAD, cx - 2, cy + 2);
        px(c, LEAD, cx + 2, cy + 2);
      } else disc(c, cx, cy, rr, rot, 0.28 + 0.22 * k, 1, rr > 18 ? 4 : 3, 1 + 2 * open);
      return;
    }
    case "sunk": {
      const sn = reduced ? 900 : since;
      if (sn < 600) splash(c, target.x, target.y, r, sn / 600);
      for (let i = 0; i < 2; i++) {
        const q = reduced ? 0.4 + i * 0.3 : ((tt + i * 700) % 1400) / 1400;
        ellipse(c, `rgba(166, 214, 232, ${(0.6 * (1 - q)).toFixed(3)})`, target.x, target.y, r + 2 + 8 * q, FLAT, 2);
      }
      const sink = Math.min(2, sn / 600);
      disc(c, target.x, target.y + sink, r * 0.95, Math.PI * 2.6, FLAT, Math.max(0.28, 1 - sn / 1600), r > 18 ? 4 : 3, 1);
      for (let i = 0; i < 6; i++) {
        const q = reduced ? (i % 3) / 3 : ((tt + i * 190) % 1100) / 1100;
        const a = i * 2.1;
        const bx = target.x + Math.cos(a) * r * 0.5, by = target.y + Math.sin(a) * r * 0.25 - 5 * q;
        const col = `rgba(232, 247, 252, ${(1 - q).toFixed(3)})`;
        if (q > 0.85) { px(c, col, bx - 1, by); px(c, col, bx + 1, by); } else px(c, col, bx, by);
      }
      corks(c, target.x, target.y, r, tt, reduced);
      const d = Math.hypot(pose.o.x - target.x, (pose.o.y - target.y) / FLAT) || 1;
      rope(c, pose.o, { x: target.x + ((pose.o.x - target.x) / d) * r, y: target.y + ((pose.o.y - target.y) / d) * r * FLAT }, 3);
      return;
    }
    case "pull": {
      const hand = pose.n;
      const ring = { x: target.x + (hand.x - target.x) * fr.drawn, y: target.y + (feet.y - target.y) * fr.drawn };
      const rr = Math.max(4, r * (1 - 0.6 * fr.drawn));
      blob(c, "rgba(20, 60, 90, 0.25)", ring.x, ring.y, rr, FLAT);
      disc(c, ring.x, ring.y, rr * 0.85, Math.PI * 2.6 + (reduced ? 0 : Math.sin(tt / 300) * 0.15), FLAT, 0.6, 2, 0);
      // churning foam around the ring
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2 + tt / 900;
        const on = reduced ? i % 2 === 0 : Math.sin(tt / 120 + i * 1.7) > 0.2;
        if (on) px(c, "rgba(240, 250, 252, 0.85)", ring.x + Math.cos(a) * (rr + 1), ring.y + Math.sin(a) * (rr + 1) * FLAT);
      }
      // fish flicking up inside the ring, silver flashes
      for (let i = 0; i < 3; i++) {
        const q = reduced ? 0.25 : ((tt + i * 300) % 900) / 900;
        if (q > 0.5) continue;
        const a = i * 2.2 + tt / 1000;
        const fx = ring.x + Math.cos(a) * rr * 0.4, fy = ring.y + Math.sin(a) * rr * 0.2;
        const h = Math.round(4 * Math.sin((Math.PI * q) / 0.5));
        fish(c, fx, fy - h, i % 2 ? 1 : -1, false, q > 0.25);
        if (q > 0.1 && q < 0.2) px(c, "#ffffff", fx, fy - h - 1);
        if (q < 0.08 || q > 0.42) { px(c, "rgba(240, 250, 252, 0.9)", fx - 2, fy - 1); px(c, "rgba(240, 250, 252, 0.9)", fx + 2, fy - 1); }
      }
      corks(c, ring.x, ring.y, rr, tt * 2, reduced);
      const shiver = reduced ? 0 : Math.sin(tt / 35) > 0 ? 1 : 0;
      const d = Math.hypot(hand.x - ring.x, (hand.y - ring.y) / FLAT) || 1;
      rope(c, hand, { x: ring.x + ((hand.x - ring.x) / d) * rr, y: ring.y + ((hand.y - ring.y) / d) * rr * FLAT }, 0, shiver);
      rope(c, pose.o, hand, 1);
      return;
    }
    case "won": {
      drawBag(c, pose.n, s.k, tt, reduced);
      return;
    }
  }
}

/** The dripping bag hanging from `neck` with `k` fish flapping in it. */
function drawBag(c: PixelCtx, neck: Vec, k: number, tt: number, reduced: boolean): void {
  const W = [1, 1, 2, 3, 4, 5, 5, 6, 6, 6, 6, 5, 5, 4, 2];
  const top = neck.y + 1, cx = neck.x;
  // the gathered neck, the rope loops over the hand
  px(c, ROPE_DK, cx, neck.y - 2, 1, 3);
  px(c, ROPE, cx - 1, neck.y - 3, 3, 1);
  W.forEach((half, j) => {
    for (let i = -half; i <= half; i++) {
      const edge = Math.abs(i) === half || j === W.length - 1;
      const line = (i + j + 30) % 3 === 0 || (i - j + 30) % 3 === 0;
      px(c, edge ? OUTLINE : line ? rgba(MESH_DK, 1) : "rgba(120, 150, 150, 0.55)", cx + i, top + j);
    }
  });
  const n = Math.min(5, k);
  const slots: Array<[number, number]> = [[-2, 6], [2, 8], [-2, 10], [2, 11], [0, 12]];
  for (let i = 0; i < n; i++) {
    const [sx, sy] = slots[i];
    const flap = reduced ? 0 : Math.round(Math.sin(tt / 90 + i * 1.7));
    const flick = reduced ? false : Math.sin(tt / 70 + i * 2.3) > 0;
    fish(c, cx + sx + flap, top + sy, i % 2 ? 1 : -1, i === 0 && k >= 4, flick);
    if (!reduced && (tt / 120 + i * 5) % 9 < 1) px(c, "#ffffff", cx + sx + flap, top + sy - 1);
  }
  // the mesh over the fish
  W.forEach((half, j) => {
    for (let i = -half + 1; i < half; i++) if ((i - j + 30) % 3 === 0 && j > 4) px(c, rgba(MESH, 0.7), cx + i, top + j);
  });
  // lead weights along the bottom and water dripping off
  for (let i = -2; i <= 2; i += 2) px(c, LEAD, cx + i, top + W.length, 1, 2);
  for (let i = 0; i < 4; i++) {
    const q = reduced ? 0.3 + i * 0.15 : ((tt + i * 175) % 700) / 700;
    const x = cx - 3 + i * 2, y = top + W.length + 1 + Math.round(22 * q * q);
    px(c, `rgba(166, 214, 232, ${(1 - q).toFixed(3)})`, x, y, 1, 2);
  }
}

// ----------------------------------------------------------------------------------------------------------- thrower

/**
 * The thrower and the net: the character frame (24×48, feet at row 46) redrawn with its upper body twisting/leaning and
 * new arms from the shoulders to the pose's hands (sleeve and skin from the frame's tags), and the net layered around
 * it (behind the body facing up, except the lifted bag and the charge's swing over the shoulder).
 */
export function drawNetThrower(
  c: CanvasRenderingContext2D, feet: Vec, facing: Facing, frame: HTMLCanvasElement, skinTone: SkinTone,
  s: NetState, since: number, t: number, reduced: boolean,
): void {
  const pose = netPose(feet, facing, s, since, t, reduced);
  const x = Math.round(feet.x), y = Math.round(feet.y);
  const left = x - 12, topY = y - 46;
  const sh = pose.shift;
  const tagged = armsOfFrame(frame);
  const sleeve = tagged?.sleeve ?? SKIN[skinTone].s, hand = tagged?.skin ?? SKIN[skinTone].s;
  const side = facing === "left" || facing === "right";
  const shoulder = (lat: number): Vec => side
    ? { x: x + sh.x + (lat < 0 ? (facing === "right" ? 1 : -1) : 0), y: y - 24 + sh.y - (lat < 0 ? 1 : 0) }
    : { x: x + sh.x + (lat > 0 ? 6 : -7), y: y - 24 + sh.y };
  const arm = (from: Vec, to: Vec, sl: string, sk: string) => {
    const mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2;
    const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    let nx = -(to.y - from.y) / len, ny = (to.x - from.x) / len;
    if (ny < 0) { nx = -nx; ny = -ny; }
    const bend = len > 9 ? 1 : 2;
    const elbow = { x: Math.round(mx + nx * bend), y: Math.round(my + ny * bend) };
    limb(c, [from, elbow], [sl], 2);
    limb(c, [elbow, to], [sk], 2);
    c.fillStyle = OUTLINE;
    c.fillRect(to.x - 2, to.y - 2, 4, 4);
    c.fillStyle = sk;
    c.fillRect(to.x - 1, to.y - 1, 2, 2);
  };
  const body = () => {
    c.fillStyle = "rgba(40, 25, 10, 0.28)";
    c.fillRect(x - 7, y - 1, 14, 2);
    c.fillRect(x - 5, y + 1, 10, 1);
    c.drawImage(frame, 0, 30, 24, 18, left, topY + 30, 24, 18);
    const hx = Math.round(sh.x / 2), hy = Math.round(sh.y / 2);
    if (side) c.drawImage(frame, 0, 20, 24, 10, left + hx, topY + 20 + hy, 24, 10);
    else c.drawImage(frame, 6, 20, 12, 12, left + 6 + hx, topY + 20 + hy, 12, 12);
    c.drawImage(frame, 0, 0, 24, 20, left + sh.x, topY + sh.y, 24, 20);
  };
  const net = () => drawNetThrow(c, feet, facing, s, since, t, reduced);
  const armN = () => arm(shoulder(1), pose.n, sleeve, hand);
  const armO = (dim: boolean) => arm(shoulder(-1), pose.o, dim ? darker(sleeve) : sleeve, dim ? darker(hand) : hand);

  if (s.show === "won") {
    // the far/other arm passes behind the head, only its hand shows on the bag; the net arm reaches up beside the head
    armO(true);
    body();
    armN();
    net();
    return;
  }
  if (facing === "up") {
    const over = (s.show === "charge" && pose.wind > 0.45);
    if (!over) { net(); armN(); armO(false); body(); return; }
    body();
    armO(false);
    armN();
    net();
    return;
  }
  if (side) {
    armO(true);
    body();
    armN();
    net();
    return;
  }
  body();
  armO(false);
  armN();
  net();
}
