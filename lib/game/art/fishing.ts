import { FACE_V, bobberPoint, handPoint } from "@/lib/game/fishing/geometry";
import type { FishPhase } from "@/lib/game/net/protocol";
import type { Facing, SkinTone, Vec } from "@/lib/game/types";
import { FISH_ICONS } from "./fish";
import { pixelIconMatrix } from "./icons";
import { OUTLINE, SKIN } from "./palettes";

// Fishing, drawn in world pixels (spec §11): the rod, the line, the bobber with its ripples / dip / splashes, and a
// fish held in the hands. Browser only (canvas). Original art.

type Ctx = CanvasRenderingContext2D;

const ROD = "#5a381e";
const ROD_TIP = "#c8905c";
const LINE = "rgba(240, 240, 232, 0.85)";
const RIPPLE = "#a6d6e8";
const SPLASH = "#e8f4f8";
const BOBBER_TOP = "#d8433a";
const BOBBER_BOTTOM = "#f4f1ea";
const LAMP_GLOW = "rgba(255, 224, 138, 0.4)";
const ROD_DARK = "#3e2614";
const GRIP = "#c89a5c";
const GRIP_SHADE = "#9a7040";
const GUIDE = "#d8d8d0";
const REEL = "#a8b0b8";
const REEL_DARK = "#5e666e";
const REEL_HANDLE = "#f0e6c8";
const FISH_SHADOW = "rgba(24, 44, 64, 0.5)";
const FISH_FLASH = "#b8c8d4";

export interface RodLook {
  /** 0 = the rod alone (the cast swing), 1 line out, 2 bite, 3 reeling. */
  phase: FishPhase;
  /** The rod's swing: 0 held back over the shoulder … 1 out over the water. */
  swing: number;
  /** Bobber top at the bite: the rarity colour when the bobber reveals it; null = red. */
  tint: string | null;
  /** Phao đèn glows. */
  glow: boolean;
  t: number;
  reducedMotion: boolean;
  /** The angler's skin, for the hands on the rod. */
  skin?: SkinTone;
  /** ms since this phase began (the strike plays over the first STRIKE_MS of reeling); unknown = no strike. */
  since?: number;
}

function px(c: Ctx, col: string, x: number, y: number): void {
  c.fillStyle = col;
  c.fillRect(Math.round(x), Math.round(y), 1, 1);
}

/** A 1-px line from a to b that sags `sag` px in the middle. */
function line(c: Ctx, col: string, a: Vec, b: Vec, sag: number): void {
  const n = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    px(c, col, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t + sag * 4 * t * (1 - t));
  }
}

/** An ellipse ring of 1-px dots (water ripples). */
function ring(c: Ctx, col: string, at: Vec, rad: number, n = 14): void {
  for (let a = 0; a < n; a++) {
    const ang = (a / n) * Math.PI * 2;
    px(c, col, at.x + Math.cos(ang) * rad, at.y + 1 + Math.sin(ang) * rad * 0.45);
  }
}

/** A fist gripping the rod: 3×3 skin with a 1-px outline (corners cut), a shaded knuckle row. */
function fist(c: Ctx, at: Vec, skin: { s: string; S: string }): void {
  const x = Math.round(at.x), y = Math.round(at.y);
  c.fillStyle = OUTLINE;
  c.fillRect(x - 1, y - 2, 3, 5);
  c.fillRect(x - 2, y - 1, 5, 3);
  c.fillStyle = skin.s;
  c.fillRect(x - 1, y - 1, 3, 3);
  c.fillStyle = skin.S;
  c.fillRect(x - 1, y + 1, 3, 1);
}

/** The strike (giật cần): the rod whips back and the fish breaks the surface, over this many ms of reeling. */
export const STRIKE_MS = 480;

/** The drawn rod's tip (longer than the geometry's rodTip, and angled out to the side facing up/down so it reads):
 *  swing 0 = raised back over the shoulder, 1 = out over the water; `bend` bows it down. */
function longTip(h: Vec, facing: Facing, swing: number, bend: number): Vec {
  const s = Math.min(1, Math.max(0, swing));
  let out: Vec, back: Vec;
  if (facing === "down") { out = { x: h.x + 12, y: h.y + 12 + bend }; back = { x: h.x + 7, y: h.y - 24 }; }
  else if (facing === "up") { out = { x: h.x + 10, y: h.y - 26 + bend }; back = { x: h.x + 14, y: h.y - 4 }; }
  else {
    const d = facing === "left" ? -1 : 1;
    out = { x: h.x + d * 24, y: h.y - 14 + bend };
    back = { x: h.x - d * 8, y: h.y - 24 };
  }
  return { x: Math.round(back.x + (out.x - back.x) * s), y: Math.round(back.y + (out.y - back.y) * s) };
}

const easeOut =(k: number) => 1 - (1 - k) * (1 - k);

/** Rod — and, once it is out, line and bobber — for a character whose feet are at `feet` (world px minus the camera). */
export function drawRod(c: Ctx, feet: Vec, facing: Facing, r: RodLook): void {
  const motion = !r.reducedMotion;
  const skin = SKIN[r.skin ?? "warm"] ?? SKIN.warm;
  const since = r.since ?? STRIKE_MS;
  const striking = r.phase === 3 && motion && since < STRIKE_MS;
  const k = striking ? since / STRIKE_MS : 1;
  const v = FACE_V[facing];
  // the rod's pose: the strike whips it back over the shoulder, then it bows under the fish's pull
  let swing = r.phase === 0 ? r.swing : 1;
  let bend = 0;
  if (r.phase === 2) bend = motion ? 1 + (Math.sin(r.t / 70) > 0.3 ? 2 : 0) : 2;
  if (r.phase === 3) {
    if (striking) {
      swing = 1 - 0.75 * Math.sin(Math.PI * Math.min(1, k * 1.4));
      bend = Math.round(6 * easeOut(k));
    } else bend = motion ? Math.round(5 + 2 * Math.sin(r.t / 110)) : 5;
  }
  const hand = handPoint(feet, facing);
  const tip = longTip(hand, facing, swing, bend);
  // the butt sits behind and below the front hand, where the back hand holds it
  const butt = { x: hand.x - v.x * 4 - (v.x === 0 ? 2 : 0), y: hand.y + 4 - v.y * 2 };
  const ctrl = { x: (butt.x + tip.x) / 2, y: (butt.y + tip.y) / 2 + bend * 1.3 };
  const at = (s: number): Vec => ({
    x: (1 - s) * (1 - s) * butt.x + 2 * s * (1 - s) * ctrl.x + s * s * tip.x,
    y: (1 - s) * (1 - s) * butt.y + 2 * s * (1 - s) * ctrl.y + s * s * tip.y,
  });
  const len = Math.max(8, Math.ceil(Math.hypot(tip.x - butt.x, tip.y - butt.y) * 1.2));
  for (let i = 0; i <= len; i++) {
    const s = i / len, p = at(s);
    const col = s < 0.22 ? GRIP : s > 0.9 ? ROD_TIP : ROD;
    px(c, col, p.x, p.y);
    // thick butt section (2 px), a highlight line along it
    if (s < 0.65) px(c, s < 0.22 ? GRIP_SHADE : ROD_DARK, p.x + (v.x === 0 ? 1 : 0), p.y + (v.x === 0 ? 0 : 1));
  }
  // line guides along the blank
  for (const s of [0.55, 0.72, 0.86]) { const g = at(s); px(c, GUIDE, g.x, g.y - 1); }
  // the reel under the front hand, its handle turning while reeling
  const reel = at(0.3);
  const rx = Math.round(reel.x), ry = Math.round(reel.y) + 2;
  c.fillStyle = OUTLINE;
  c.fillRect(rx - 2, ry - 1, 5, 4);
  c.fillStyle = REEL;
  c.fillRect(rx - 1, ry, 3, 2);
  px(c, REEL_DARK, rx + 1, ry + 1);
  const spin = r.phase === 3 && motion ? r.t / 55 : 0.6;
  px(c, REEL_HANDLE, rx + Math.round(Math.cos(spin) * 2.4), ry + 1 + Math.round(Math.sin(spin) * 2.4));
  // the hands: the back hand on the butt, the front hand just above the reel (cranking while reeling)
  fist(c, at(0.08), skin);
  const crank = r.phase === 3 && motion ? { x: Math.cos(spin) * 1.5, y: Math.sin(spin) * 1 } : { x: 0, y: 0 };
  const front = at(0.36);
  fist(c, { x: front.x + crank.x, y: front.y + crank.y }, skin);

  if (r.phase === 0) return;
  const b = bobberPoint(feet, facing);
  const fishAt = { x: b.x + (motion && r.phase === 3 ? Math.round(Math.sin(r.t / 150) * 3) : 0), y: b.y };

  // underwater: the fish's dark shape thrashing at the hook while reeling
  if (r.phase === 3 && !striking) {
    c.fillStyle = FISH_SHADOW;
    const fx = Math.round(fishAt.x), fy = Math.round(fishAt.y);
    const flip = motion && Math.floor(r.t / 120) % 2 === 0 ? 1 : -1;
    c.fillRect(fx - 4, fy, 8, 3);
    c.fillRect(fx - 3, fy - 1, 6, 5);
    c.fillRect(fx + 4 * flip - (flip < 0 ? 1 : 0), fy - 1 + (motion ? Math.floor(r.t / 90) % 2 : 0), 2, 3);
  }

  // the line: slack while waiting, jumping taut at the strike, humming under tension while reeling
  const lineEnd = r.phase === 3 ? fishAt : b;
  if (r.phase === 3) {
    const hum = motion ? Math.sin(r.t / 25) * 0.6 : 0;
    line(c, LINE, tip, lineEnd, striking ? -2 * (1 - k) : hum);
  } else line(c, LINE, tip, b, r.phase === 2 ? 1 : 3);

  if (striking) {
    // the strike: a splash crown bursting up from the hook, droplets arcing out, a ring spreading
    const e = easeOut(k);
    ring(c, RIPPLE, b, 2 + e * 11, 18);
    if (k < 0.7) ring(c, SPLASH, b, 1 + e * 6, 10);
    for (let d = 0; d < 10; d++) {
      const ang = Math.PI * (0.1 + 0.8 * (d / 9));
      const reach = 3 + e * (6 + (d % 3) * 3);
      const lift = Math.sin(Math.PI * k) * (5 + (d % 4) * 2);
      px(c, d % 3 === 0 ? "#ffffff" : SPLASH, b.x + Math.cos(ang) * reach * (d % 2 ? 1 : -1), b.y - lift - Math.sin(ang) * 2 + k * 3);
    }
    // the fish breaks the surface for a moment, arching
    if (k > 0.15 && k < 0.8) {
      const q = (k - 0.15) / 0.65;
      const h = Math.round(Math.sin(Math.PI * q) * 7);
      const fx = Math.round(b.x), fy = Math.round(b.y) - 2 - h;
      const up = q < 0.5 ? -1 : 1; // nose up while leaping, down as it falls back
      // body (outlined), belly shine, eye, and a flicking tail
      c.fillStyle = OUTLINE;
      c.fillRect(fx - 3, fy - 1, 7, 4);
      c.fillRect(fx - 2, fy - 2 + (up < 0 ? 0 : 1), 5, 1);
      c.fillStyle = FISH_FLASH;
      c.fillRect(fx - 2, fy, 5, 2);
      px(c, "#ffffff", fx - 1, fy);
      px(c, "#ffffff", fx, fy);
      px(c, OUTLINE, fx + 2, fy);
      c.fillStyle = OUTLINE;
      const tail = Math.floor(since / 60) % 2;
      c.fillRect(fx - 5, fy - 1 + tail, 2, 1);
      c.fillRect(fx - 5, fy + 2 - tail, 2, 1);
      c.fillStyle = FISH_FLASH;
      px(c, FISH_FLASH, fx - 4, fy + (tail ? 1 : 0));
    }
    return;
  }

  if (r.phase === 3) {
    // reeling: rings and spray around the thrashing fish
    if (motion) {
      ring(c, RIPPLE, fishAt, 4 + ((r.t / 90) % 5), 14);
      for (let d = 0; d < 6; d++) {
        const ph = (r.t / 260 + d / 6) % 1;
        const side = d % 2 ? 1 : -1;
        px(c, d % 3 ? SPLASH : "#ffffff", fishAt.x + side * (2 + ph * 6), fishAt.y - Math.sin(Math.PI * ph) * (4 + (d % 3)) );
      }
    } else ring(c, RIPPLE, fishAt, 5, 14);
    return;
  }

  // waiting: a slow bob and a ripple now and then; at the bite the bobber plunges (a steady dip under reduced motion)
  const dip = r.phase === 2 ? (motion ? (Math.sin(r.t / 90) > 0 ? 2 : 0) : 1) : motion && Math.sin(r.t / 600) > 0.6 ? 1 : 0;
  if (motion && (r.phase === 2 || Math.floor(r.t / 1200) % 2 === 0)) {
    const period = r.phase === 2 ? 60 : 150;
    ring(c, RIPPLE, b, 3 + ((r.t / period) % 4), 12);
    if (r.phase === 2) ring(c, RIPPLE, b, 1 + ((r.t / period + 2) % 4), 10);
  }
  if (r.glow) {
    c.fillStyle = LAMP_GLOW;
    c.fillRect(Math.round(b.x) - 4, Math.round(b.y) - 5 + dip, 9, 9);
  }
  const x = Math.round(b.x), y = Math.round(b.y);
  c.fillStyle = OUTLINE;
  c.fillRect(x - 2, y - 3 + dip, 5, 5 - Math.min(dip, 1));
  c.fillStyle = r.tint && r.phase >= 2 ? r.tint : BOBBER_TOP;
  c.fillRect(x - 1, y - 2 + dip, 3, 2);
  px(c, "#ffffff", x - 1, y - 2 + dip);
  if (dip === 0) {
    c.fillStyle = BOBBER_BOTTOM;
    c.fillRect(x - 1, y, 3, 1);
  }
}

const fishCache = new Map<string, HTMLCanvasElement | null>();

/** A species icon as a 16×16 canvas, mirrored for characters facing right; null for an unknown id. */
function fishCanvas(speciesId: string, mirror: boolean): HTMLCanvasElement | null {
  const key = `${speciesId}|${mirror ? 1 : 0}`;
  const hit = fishCache.get(key);
  if (hit !== undefined) return hit;
  const icon = FISH_ICONS[speciesId];
  const cv = icon ? document.createElement("canvas") : null;
  const c = cv?.getContext("2d") ?? null;
  if (!cv || !c || !icon) {
    fishCache.set(key, null);
    return null;
  }
  cv.width = 16;
  cv.height = 16;
  pixelIconMatrix(icon).forEach((row, y) => row.forEach((col, x) => {
    if (!col) return;
    c.fillStyle = col;
    c.fillRect(mirror ? 15 - x : x, y, 1, 1);
  }));
  fishCache.set(key, cv);
  return cv;
}

/** The fish in a character's hands at 1:1: in front of the belly facing down, at the side facing left/right, hidden
 *  (behind the body) facing up. */
export function drawHeldFish(c: Ctx, feet: Vec, facing: Facing, speciesId: string): void {
  if (facing === "up") return;
  const cv = fishCanvas(speciesId, facing === "right");
  if (!cv) return;
  const x = Math.round(feet.x), y = Math.round(feet.y);
  if (facing === "down") c.drawImage(cv, x - 8, y - 27);
  else if (facing === "left") c.drawImage(cv, x - 15, y - 28);
  else c.drawImage(cv, x - 1, y - 28);
}
