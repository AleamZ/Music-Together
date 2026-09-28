// v20 Võ đài: the fighter painter (spec §v20.1 "Rendering"): a procedural pose rig in a 48 × 64 box. Limbs are
// rasterised as 3 px (arms) and 4 px (legs) lines with a 1 px outline, filled with the uniform's colours; a 16 × 16
// chibi-style head carries the player's own skin, hair style and hair colour (palettes.ts); the belt (armband, sash,
// waistband) is the rank colour. All original pixel art, drawn in code. The painter writes plain fillRects to any
// PixelCtx, so tests and the preview harness can use a fake one; sprites are cached per (look, style, rank, pose,
// facing) as offscreen canvases in the browser.

import { HAIR_COLOR, OUTLINE, SKIN } from "@/lib/game/art/palettes";
import type { HairStyle, Look } from "@/lib/game/types";
import { J, RIG_H, RIG_W, poseData, type Pose, type PoseId } from "./poses";

export interface PixelCtx {
  fillStyle: string | CanvasGradient | CanvasPattern;
  fillRect(x: number, y: number, w: number, h: number): void;
}

export interface Uniform {
  top: string;
  topDark: string;
  pants: string;
  pantsDark: string;
  /** Sleeves reach the wrist (gi, dobok, judogi, võ phục), the elbow (a tee), or nothing (tank tops). */
  sleeves: "long" | "short" | "none";
  /** Trousers reach the ankle, or shorts stop at the knee. */
  legs: "long" | "shorts";
  feet: "bare" | "shoes";
  hands: "bare" | "gloves" | "wraps";
  /** The rank colour is drawn as a belt, an armband (Muay Thai's prajioud), a sash or a waistband. */
  belt: "belt" | "armband" | "sash" | "waistband" | "none";
  collar?: string;
}

/** Per style id (moves.ts order). v20.1 fights as Tự do; the rest are drawn for v20.2's uniforms. */
export const UNIFORMS: readonly Uniform[] = [
  { top: "#c7473b", topDark: "#94302a", pants: "#3f5683", pantsDark: "#2b3c5e", sleeves: "short", legs: "long", feet: "shoes", hands: "bare", belt: "none" },
  { top: "#2f5fb8", topDark: "#21438a", pants: "#2f5fb8", pantsDark: "#21438a", sleeves: "long", legs: "long", feet: "bare", hands: "bare", belt: "belt" },
  { top: "#c9302c", topDark: "#8f1f1c", pants: "#c9302c", pantsDark: "#8f1f1c", sleeves: "none", legs: "shorts", feet: "bare", hands: "wraps", belt: "armband" },
  { top: "#f3f0e7", topDark: "#c9c2b1", pants: "#f3f0e7", pantsDark: "#c9c2b1", sleeves: "long", legs: "long", feet: "bare", hands: "bare", belt: "belt" },
  { top: "#f4f4f2", topDark: "#c8c8c4", pants: "#f4f4f2", pantsDark: "#c8c8c4", sleeves: "long", legs: "long", feet: "bare", hands: "bare", belt: "belt", collar: "#1d1d22" },
  { top: "#d8332d", topDark: "#9c211d", pants: "#e2b33a", pantsDark: "#b0851f", sleeves: "none", legs: "shorts", feet: "shoes", hands: "gloves", belt: "waistband" },
  { top: "#1f4ea6", topDark: "#153677", pants: "#1f4ea6", pantsDark: "#153677", sleeves: "long", legs: "long", feet: "bare", hands: "bare", belt: "belt" },
  { top: "#26262e", topDark: "#131318", pants: "#26262e", pantsDark: "#131318", sleeves: "long", legs: "long", feet: "shoes", hands: "bare", belt: "sash" },
];

/** Rank colours (0–4) per style (spec §v20.2 "Belts"). */
export const RANK_COLORS: readonly (readonly string[])[] = [
  ["#8a6a3a", "#8a6a3a", "#8a6a3a", "#8a6a3a", "#8a6a3a"],
  ["#9fd3f0", "#2d62c9", "#e8c43a", "#d0342c", "#f6f6f2"],
  ["#f6f6f2", "#e8c43a", "#3f9b43", "#d0342c", "#1b1b1f"],
  ["#f6f6f2", "#e8c43a", "#3f9b43", "#7a4a26", "#1b1b1f"],
  ["#f6f6f2", "#e8c43a", "#3f9b43", "#d0342c", "#1b1b1f"],
  ["#f6f6f2", "#2d62c9", "#d0342c", "#e8c43a", "#d9a92a"],
  ["#f6f6f2", "#e8c43a", "#e8862e", "#3f9b43", "#1b1b1f"],
  ["#f6f6f2", "#2d62c9", "#d0342c", "#e8c43a", "#1b1b1f"],
];

const SHOE = "#2c2a30";
const GLOVE = "#b21f1f";
const GLOVE_HI = "#e0504a";
const WRAP = "#f2efe6";
const FLASH = "#ffffff";

export interface FighterLook {
  look: Look;
  style: number;
  rank: number;
}

/** Paints one pose at (ox, oy) (the box's top-left); `flip` faces left. `flash` paints it all white. */
export function paintFighter(c: PixelCtx, pose: Pose, fl: FighterLook, ox: number, oy: number, flip: boolean, flash = false): void {
  const u = UNIFORMS[fl.style] ?? UNIFORMS[0];
  const skin = SKIN[fl.look.skin] ?? SKIN.warm;
  const rankCol = (RANK_COLORS[fl.style] ?? RANK_COLORS[0])[Math.max(0, Math.min(4, fl.rank))];
  const col = (x: string) => (flash ? FLASH : x);
  const px = (x: number, y: number, color: string) => {
    const X = flip ? RIG_W - 1 - x : x;
    if (X < 0 || X >= RIG_W || y < 0 || y >= RIG_H) return;
    c.fillStyle = col(color);
    c.fillRect(ox + X, oy + y, 1, 1);
  };
  const blob = (x: number, y: number, t: number, color: string) => {
    const r0 = -Math.floor((t - 1) / 2);
    for (let dy = r0; dy < r0 + t; dy++) for (let dx = r0; dx < r0 + t; dx++) px(x + dx, y + dy, color);
  };
  const line = (a: readonly [number, number], b: readonly [number, number], t: number, color: string) => {
    let [x0, y0] = a;
    const [x1, y1] = b;
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let guard = 0; guard < 200; guard++) {
      blob(x0, y0, t, color);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  };
  const limb = (a: readonly [number, number], b: readonly [number, number], t: number, color: string) => {
    line(a, b, t + 2, OUTLINE);
    line(a, b, t, color);
  };
  const p = (j: number) => pose[j];

  // arms: upper arm and forearm colours from the sleeves
  const arm = (sh: number, el: number, hn: number, dark: boolean) => {
    const upper = u.sleeves === "none" ? (dark ? skin.S : skin.s) : dark ? u.topDark : u.top;
    const fore = u.sleeves === "long" ? (dark ? u.topDark : u.top) : dark ? skin.S : skin.s;
    limb(p(sh), p(el), 3, upper);
    limb(p(el), p(hn), 3, fore);
    if (u.belt === "armband") {
      const [x0, y0] = p(sh), [x1, y1] = p(el);
      blob(Math.round((x0 + x1) / 2), Math.round((y0 + y1) / 2), 3, rankCol);
    }
    const [hx, hy] = p(hn);
    if (u.hands === "gloves") { blob(hx, hy, 6, OUTLINE); blob(hx, hy, 4, dark ? GLOVE : GLOVE_HI); }
    else if (u.hands === "wraps") { blob(hx, hy, 5, OUTLINE); blob(hx, hy, 3, WRAP); }
    else { blob(hx, hy, 5, OUTLINE); blob(hx, hy, 3, dark ? skin.S : skin.s); }
  };
  const leg = (kn: number, ft: number, dark: boolean) => {
    const thigh = dark ? u.pantsDark : u.pants;
    const shin = u.legs === "long" ? thigh : dark ? skin.S : skin.s;
    limb(p(J.hip), p(kn), 4, thigh);
    limb(p(kn), p(ft), 4, shin);
    const [fx, fy] = p(ft);
    const foot = u.feet === "shoes" ? SHOE : dark ? skin.S : skin.s;
    line([fx - 1, fy], [fx + 3, fy], 3, OUTLINE);
    line([fx - 1, fy], [fx + 2, fy], 1, foot);
  };

  arm(J.shB, J.elB, J.hnB, true);
  leg(J.knB, J.ftB, true);
  // torso
  line(p(J.chest), p(J.hip), 10, OUTLINE);
  line(p(J.chest), p(J.hip), 8, u.top);
  line([p(J.chest)[0] - 2, p(J.chest)[1] + 1], [p(J.hip)[0] - 2, p(J.hip)[1] - 1], 2, u.topDark);
  if (u.collar) line(p(J.neck), p(J.chest), 2, u.collar);
  if (u.belt === "belt" || u.belt === "sash" || u.belt === "waistband") {
    const [hx, hy] = p(J.hip);
    for (let x = hx - 4; x <= hx + 4; x++) { px(x, hy - 2, rankCol); px(x, hy - 1, rankCol); }
    if (u.belt === "belt") { px(hx + 2, hy, rankCol); px(hx + 3, hy + 1, rankCol); }
    if (u.belt === "sash") { px(hx - 4, hy, rankCol); px(hx - 5, hy + 1, rankCol); px(hx - 5, hy + 2, rankCol); }
  }
  leg(J.knF, J.ftF, false);
  line(p(J.neck), p(J.chest), 3, skin.S);
  paintHead(px, p(J.head), fl.look);
  arm(J.shF, J.elF, J.hnF, false);
}

type Px = (x: number, y: number, color: string) => void;

function hairAt(style: HairStyle, x: number, y: number): boolean {
  // x, y in the 16 × 16 head box, facing right; the face is on the right
  const cap = y <= 5 || (x <= 6 && y <= 9);
  switch (style) {
    case "buzz": return y <= 4 || (x <= 5 && y <= 7);
    case "short":
    case "undercut": return cap || (x >= 9 && y === 6 && style === "short");
    case "curly": return y <= 6 || (x <= 7 && y <= 10) || (y === 7 && x % 2 === 0);
    case "bob":
    case "bangs": return cap || (y <= 7 && x >= 8) || (x <= 6 && y <= 13);
    case "long":
    case "twin_braids": return cap || (x <= 6 && y <= 15);
    case "ponytail": return cap || (x <= 2 && y >= 6 && y <= 13);
    case "bun": return cap || (x <= 5 && y <= 2);
    default: return cap;
  }
}

function paintHead(px: Px, center: readonly [number, number], look: Look): void {
  const skin = SKIN[look.skin] ?? SKIN.warm;
  const hair = HAIR_COLOR[look.hairColor] ?? HAIR_COLOR.black;
  const ox = center[0] - 8, oy = center[1] - 8;
  const inHead = (x: number, y: number) => (x - 7.5) ** 2 * 1.1 + (y - 8) ** 2 <= 44;
  for (let y = -1; y < 17; y++) for (let x = -1; x < 17; x++) {
    const inside = inHead(x, y) || (look.hair === "bun" && (x - 3) ** 2 + (y - 1) ** 2 <= 5)
      || (look.hair === "ponytail" && x >= 0 && x <= 2 && y >= 6 && y <= 13);
    if (inside) continue;
    const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
      const nx = x + dx, ny = y + dy;
      return inHead(nx, ny) || (look.hair === "bun" && (nx - 3) ** 2 + (ny - 1) ** 2 <= 5)
        || (look.hair === "ponytail" && nx >= 0 && nx <= 2 && ny >= 6 && ny <= 13);
    });
    if (near) px(ox + x, oy + y, OUTLINE);
  }
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const bun = look.hair === "bun" && (x - 3) ** 2 + (y - 1) ** 2 <= 5;
    const tail = look.hair === "ponytail" && x >= 0 && x <= 2 && y >= 6 && y <= 13;
    if (!inHead(x, y) && !bun && !tail) continue;
    let color = skin.s;
    if (bun || tail || hairAt(look.hair, x, y)) color = y <= 2 && x >= 6 ? hair.H : x <= 3 ? hair.d : hair.h;
    else if (x <= 8 && y >= 12) color = skin.S;
    px(ox + x, oy + y, color);
  }
  // ear, eye, brow, mouth, blush
  if (!hairAt(look.hair, 7, 9)) { px(ox + 7, oy + 9, skin.S); px(ox + 7, oy + 10, skin.S); }
  px(ox + 11, oy + 8, "#2a1a14");
  px(ox + 11, oy + 9, "#2a1a14");
  px(ox + 12, oy + 8, "#ffffff");
  px(ox + 11, oy + 6, hair.d);
  px(ox + 12, oy + 6, hair.d);
  px(ox + 13, oy + 12, skin.m);
  px(ox + 12, oy + 11, skin.b);
}

// ---------- browser: cached sprites ----------
const cache = new Map<string, HTMLCanvasElement>();
const MAX = 400;

/** A 48 × 64 canvas of the pose (browser only), cached. */
export function fighterSprite(fl: FighterLook, pose: PoseId, flip: boolean, flash = false): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const key = `${fl.look.skin}|${fl.look.hair}|${fl.look.hairColor}|${fl.style}|${fl.rank}|${pose}|${flip ? 1 : 0}|${flash ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const cv = document.createElement("canvas");
  cv.width = RIG_W;
  cv.height = RIG_H;
  const ctx = cv.getContext("2d");
  if (!ctx) return null;
  paintFighter(ctx, poseData(pose, fl.style), fl, 0, 0, flip, flash);
  cache.set(key, cv);
  if (cache.size > MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return cv;
}
