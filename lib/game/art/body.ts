import type { Gender } from "@/lib/game/types";
import { R, SPRITE_H, SPRITE_W, type Dir3, type Frame } from "./layers";

// Chibi body templates, 24×48, about 2.3 heads tall. Region codes (colours come from the look, see compose.ts):
//   . transparent · o outline · s/S skin/shade · e eyes+lashes · w eye shine · b blush · m mouth
//   t/T/u/K top main/shade/highlight (collar)/detail (buttons, pockets) · a/A sleeve main/shade (cuff)
//   q/Q scarf band · r/R scarf tails (front, inside the torso) · v/V scarf tails (side view, outside the torso) · n (unused, kept)
//   p/P/l bottom main/shade/stripe · j hem · g/G lower leg · k sock · f/F shoe main/sole
// The silhouette's outer outline is not in the templates: compose.ts traces it (1 px) around whatever is drawn, so a
// template only carries its inner lines.

export const BODY_CODES = ".osSebmwtTuKaAqQrRvVnpPljgGkfF";

/** How a frame moves the figure: `dy` shifts head, torso and hips (feet stay planted); `tip` is where the hair tips and
 *  the skirt hem sit (a pixel behind the body, so they lag); `lift` raises each foot; `arm` lengthens (+1, swung
 *  forward) or shortens (−1, swung back) each arm; `stride` spreads the legs in the side view (+1 near leg forward). */
export interface Pose {
  dy: number;
  tip: number;
  lift: readonly [left: number, right: number];
  arm: readonly [left: number, right: number];
  stride: -1 | 0 | 1;
}
export const POSES: Record<Frame, Pose> = {
  0: { dy: 0, tip: 0, lift: [0, 0], arm: [0, 0], stride: 0 },
  1: { dy: 0, tip: -1, lift: [1, 0], arm: [-1, 1], stride: 1 },
  2: { dy: -1, tip: 0, lift: [0, 1], arm: [0, 0], stride: 0 },
  3: { dy: 0, tip: -1, lift: [0, 1], arm: [1, -1], stride: -1 },
  4: { dy: -1, tip: 0, lift: [1, 0], arm: [0, 0], stride: 0 },
  5: { dy: 1, tip: 1, lift: [0, 0], arm: [0, 0], stride: 0 },
};

export type Lower = "pants" | "skirt" | "pleated" | "maxi" | "robe";
export type Sleeve = "long" | "short" | "none";
export type ShoeShape = "dep" | "shoe" | "sneakers" | "boots" | "sandals";
export interface BodyOpts {
  lower?: Lower;
  sleeve?: Sleeve;
  shoe?: ShoeShape;
  /** Knee-length shorts: this many leg rows in the bottom's fabric (with a pocket flap), then a hem. */
  thigh?: number;
  /** Rolled cuffs: a turned-up band in the stripe colour above a bare ankle. */
  cuff?: boolean;
}

/** Where each body type's parts sit (front view columns), shared with the garment overlays. */
export interface Geo {
  /** torso columns at the shoulders */ tL: number; tR: number;
  /** torso fill below the armpits (inside the arm separators) */ bL: number; bR: number;
  /** waist fill (nữ is narrower) */ wL: number; wR: number;
  /** hips (the bottom's waistband) */ hL: number; hR: number;
  armL: number; armR: number; armLen: number;
  legX: readonly [number, number]; legW: number;
}
export const GEO: Record<Gender, Geo> = {
  nam: { tL: 5, tR: 18, bL: 6, bR: 17, wL: 6, wR: 17, hL: 6, hR: 17, armL: 3, armR: 19, armLen: 9, legX: [7, 13], legW: 4 },
  nu: { tL: 6, tR: 17, bL: 7, bR: 16, wL: 8, wR: 15, hL: 7, hR: 16, armL: 4, armR: 18, armLen: 8, legX: [8, 13], legW: 3 },
};
/** Row layout (unposed): head 0–20 (chin line 20) · torso 21–30 · hips 31–35 · legs 36–44 (soles on 44). */
export const ROW = { torso: 21, hips: 31, hem: 35, legs: 36, sole: 44, lag: 16 } as const;

const S16 = "s".repeat(16);
const EMPTY = R(0);

/** Rows 0–20: bald head and face (hair and hats are separate layers). */
export const HEAD_FRONT: readonly string[] = [
  EMPTY, EMPTY, EMPTY, EMPTY, EMPTY,
  R(7, "ssssssssss"),
  R(5, "ssssssssssssss"),
  R(4, S16), R(4, S16), R(4, S16), R(4, S16), R(4, S16), R(4, S16),
  R(4, "sss" + "ee" + "ssssss" + "ee" + "sss"),
  R(4, "sss" + "we" + "ssssss" + "we" + "sss"),
  R(4, "sss" + "ee" + "ssssss" + "ee" + "sss"),
  R(4, "s" + "bb" + "ssssssssss" + "bb" + "s"),
  R(4, "sssssss" + "mm" + "ssssss" + "S"),
  R(5, "sssssssssssssS"),
  R(6, "ssssssssssSS"),
  R(8, "oooooooo"),
];
/** Facing left; "right" is drawn mirrored. One eye near the front, an ear in the middle. */
export const HEAD_SIDE: readonly string[] = [
  ...HEAD_FRONT.slice(0, 13),
  R(4, "ss" + "ee" + "ssssssssssss"),
  R(4, "ss" + "we" + "ssss" + "SS" + "ssssss"),
  R(4, "ss" + "ee" + "ssss" + "SS" + "ssssss"),
  R(4, "s" + "bb" + "sssssssssssss"),
  R(4, "sm" + "sssssssssssssS"),
  ...HEAD_FRONT.slice(18),
];
export const HEAD_BACK: readonly string[] = [
  ...HEAD_FRONT.slice(0, 13),
  R(4, S16), R(4, S16), R(4, S16), R(4, S16), R(4, "sssssssssssssssS"),
  ...HEAD_FRONT.slice(18),
];
export const HEADS: Record<Dir3, readonly string[]> = { down: HEAD_FRONT, up: HEAD_BACK, left: HEAD_SIDE };

// Rows 21–30, arms not included (they are drawn over, see armsFront/armSide).
const TORSO_FRONT_NAM = [
  R(5, "tuuqQqQqQqQuut"),
  R(5, "ttuuttRrttuuTT"),
  R(5, "tttuttrRttutTT"),
  R(5, "ottttKRrKttTTo"),
  R(5, "ottttKrRKttTTo"),
  R(5, "ottttKRrKttTTo"),
  R(5, "otKKKttttKKKTo"),
  R(5, "otKtKttttKtKTo"),
  R(5, "otKKKttttKKKTo"),
  R(5, "TTTTTTTTTTTTTT"),
];
/** nữ: a rounded collar, a bust (a highlight on top, shaded under-curve) and a waist a pixel narrower each side. */
const TORSO_FRONT_NU = [
  R(6, "uuqQqQqQqQuu"),
  R(6, "tuuttRrttuuT"),
  R(6, "ttuutrRtuutT"),
  R(6, "otuttRrttuTo"),
  R(6, "otTTtrRtTTto"),
  R(6, "ootttRrttToo"),
  R(6, "ootttKKttToo"),
  R(6, "otttttttttTo"),
  R(6, "otttttttttTo"),
  R(6, "TTTTTTTTTTTT"),
];
const TORSO_BACK_NAM = [
  R(5, "tttqQqQqQqQttT"),
  R(5, "tttttttttttTTT"), R(5, "tttttttttttTTT"),
  ...Array.from({ length: 6 }, () => R(5, "o" + "t".repeat(10) + "TT" + "o")),
  R(5, "T".repeat(14)),
];
const TORSO_BACK_NU = [
  R(6, "ttqQqQqQqQtT"),
  R(6, "ttttttttttTT"), R(6, "ttttttttttTT"),
  R(6, "o" + "t".repeat(9) + "T" + "o"), R(6, "o" + "t".repeat(9) + "T" + "o"),
  R(6, "oo" + "t".repeat(7) + "T" + "oo"), R(6, "oo" + "t".repeat(7) + "T" + "oo"),
  R(6, "o" + "t".repeat(9) + "T" + "o"), R(6, "o" + "t".repeat(9) + "T" + "o"),
  R(6, "T".repeat(12)),
];
const TORSO_SIDE_NAM = [
  R(8, "tqQqQqQt"),
  R(8, "uuttttTT" + "vV"),
  R(8, "uttttttT" + "Vv"),
  R(8, "uttttttT" + "vV"),
  R(8, "uttttttT" + "V"),
  R(8, "uttttttT"), R(8, "uttttttT"), R(8, "uttttttT"), R(8, "uttttttT"),
  R(8, "TTTTTTTT"),
];
const TORSO_SIDE_NU = [
  R(8, "tqQqQqQt"),
  R(8, "uuttttTT" + "vV"),
  R(7, "tuttttttT" + "Vv"),
  R(7, "TuttttttT" + "vV"),
  R(8, "uttttttT" + "V"),
  R(9, "ttttttT"), R(9, "ttttttT"),
  R(8, "uttttttT"), R(8, "uttttttT"),
  R(8, "TTTTTTTT"),
];

/** Rows 31–35 for trousers/shorts (the legs below take the trouser colour when they are long). */
function pantsRows(dir: Dir3, g: Geo): string[] {
  if (dir === "left") {
    return [R(8, "pppppppP"), R(8, "pppplppP"), R(8, "pppplppP"), R(8, "pppplppP"), R(8, "jjjjjjjj")];
  }
  const w = g.hR - g.hL + 1;
  const gs = g.legX[0] + g.legW - g.hL, gap = g.legX[1] - g.legX[0] - g.legW;
  const crotch = "l" + "p".repeat(gs - 1) + "o".repeat(gap) + "p".repeat(w - gs - gap - 2) + "Pl";
  return [
    R(g.hL, "p".repeat(w - 1) + "P"),
    R(g.hL, "l" + "p".repeat(w - 3) + "Pl"),
    R(g.hL, crotch),
    R(g.hL, crotch),
    R(g.legX[0], "j".repeat(g.legW) + "o".repeat(gap) + "j".repeat(g.legW)),
  ];
}

/** A pleated skirt row `n` wide: a fold shade every third pixel, the right two pixels in shade. */
function pleats(n: number, fill = "p"): string {
  let s = "";
  for (let i = 0; i < n; i++) s += i >= n - 2 ? "P" : i % 3 === 2 ? "P" : fill;
  return s;
}

/** Rows a skirt-like lower body takes from row 31: A-line 5, pleated (knee) 7, maxi and robe 12 (to the ankles). */
export function skirtLength(lower: Lower): number {
  return lower === "maxi" || lower === "robe" ? 12 : lower === "pleated" ? 7 : 5;
}
/** The columns row `i` (from 31) of a skirt covers. */
export function skirtSpan(dir: Dir3, g: Geo, lower: Lower, i: number): [number, number] {
  if (dir === "left") {
    if (lower === "robe") return [8, 15];
    const flare = lower === "maxi" ? Math.floor(i / 4) : Math.min(2, Math.floor((i + 1) / 2));
    return [8 - flare, 15 + Math.floor(flare / 2) + (i > 1 ? 1 : 0)];
  }
  const flare = lower === "robe" ? (i > 6 ? 1 : 0) : lower === "maxi" ? Math.floor(i / 3) : Math.min(lower === "pleated" ? 3 : 2, i);
  return [g.hL - flare, g.hR + flare];
}
/** An A-line or pleated skirt, a maxi skirt or a straight robe, from row 31. */
function skirtRows(dir: Dir3, g: Geo, lower: Lower): string[] {
  const long = lower === "maxi" || lower === "robe";
  const n = skirtLength(lower);
  const rows: string[] = [];
  for (let i = 0; i < n; i++) {
    const [l, r] = skirtSpan(dir, g, lower, i);
    const w = r - l + 1;
    const hem = i === n - 1;
    const body = lower === "pleated" ? [...Array(w)].map((_, k) => (k >= w - 2 || k % 2 ? "P" : "p")).join("") : pleats(w);
    rows.push(R(l, i === 0 ? "p".repeat(w - 1) + "P" : hem ? (long ? "P".repeat(w) : "l".repeat(w)) : body));
  }
  return rows;
}

function shoeShaft(shoe: ShoeShape): number {
  return shoe === "boots" ? 3 : shoe === "sneakers" || shoe === "sandals" ? 1 : 0;
}
function shaftRow(shoe: ShoeShape, w: number, i: number): string {
  if (shoe === "boots") return i === 0 ? "F".repeat(w) : "f".repeat(w - 1) + "F";
  if (shoe === "sneakers") return "k".repeat(w);
  return "g" + "f".repeat(w - 2) + "G"; // sandals: an ankle strap
}
/** The two foot rows, `W` wide, toe on the left. */
function footRows(shoe: ShoeShape, W: number): [string, string] {
  switch (shoe) {
    case "dep": return ["s" + "f".repeat(W - 2) + "s", "F".repeat(W)];
    case "sandals": return [("sf".repeat(W)).slice(0, W), "F".repeat(W)];
    case "sneakers": return [("fF".repeat(W)).slice(0, W - 1) + "f", "F".repeat(W)];
    case "boots": return ["f".repeat(W), "F".repeat(W)];
    default: return ["f".repeat(W - 1) + "F", "F".repeat(W)];
  }
}
const FAR: Record<string, string> = { g: "G", f: "F", s: "S", k: "G", p: "P" };

type Grid = string[][];
function grid(): Grid {
  return Array.from({ length: SPRITE_H }, () => new Array<string>(SPRITE_W).fill("."));
}
function stamp(gr: Grid, rows: readonly string[], top: number, dx = 0): void {
  rows.forEach((row, i) => {
    const y = top + i;
    if (y < 0 || y >= SPRITE_H) return;
    for (let x = 0; x < row.length; x++) {
      const ch = row[x], X = x + dx;
      if (ch !== "." && X >= 0 && X < SPRITE_W) gr[y][X] = ch;
    }
  });
}

/** One leg from `top` to its sole on `bottom`, sliding from `xTop` to `xBot` (a stride); the foot sticks out `ext`
 *  pixels on the toe side (−1 left, +1 right). `far` draws it in shade (the leg behind). */
interface LegSpec {
  xTop: number; xBot: number; top: number; bottom: number; w: number;
  shoe: ShoeShape; toe: -1 | 1; ext: number; far?: boolean; thigh?: number; cuff?: boolean;
}
function drawLeg(gr: Grid, o: LegSpec): void {
  const n = o.bottom - o.top + 1;
  const shaft = Math.min(shoeShaft(o.shoe), Math.max(0, n - 3));
  const upper = n - 2;
  const shin = upper - shaft;
  const put = (x: number, y: number, ch: string) => {
    if (y < 0 || y >= SPRITE_H || x < 0 || x >= SPRITE_W) return;
    gr[y][x] = o.far ? (FAR[ch] ?? ch) : ch;
  };
  const thigh = Math.min(o.thigh ?? 0, Math.max(0, shin - 2));
  const outer = o.toe === -1 ? 0 : o.w - 1;
  const shinRow = (i: number): string => {
    if (i < thigh) {
      const row = "p".repeat(o.w - 1) + "P";
      return i >= 1 ? row.slice(0, outer) + "l" + row.slice(outer + 1) : row; // the cargo pocket on the outside
    }
    if (thigh && i === thigh) return "P".repeat(o.w);
    if (o.cuff && shin >= 4 && i === shin - 2) return "l".repeat(o.w);
    if (o.cuff && shin >= 4 && i === shin - 1) return "s".repeat(o.w - 1) + "S";
    return "g".repeat(o.w - 1) + "G";
  };
  for (let i = 0; i < upper; i++) {
    const x = Math.round(o.xTop + ((o.xBot - o.xTop) * i) / Math.max(1, upper - 1));
    const row = i >= shin ? shaftRow(o.shoe, o.w, i - shin) : shinRow(i);
    for (let k = 0; k < o.w; k++) put(x + k, o.top + i, row[k]);
  }
  const W = o.w + o.ext;
  const feet = footRows(o.shoe, W);
  feet.forEach((row, j) => {
    const s = o.toe === -1 ? row : [...row].reverse().join("");
    const x0 = o.toe === -1 ? o.xBot - o.ext : o.xBot;
    for (let k = 0; k < W; k++) put(x0 + k, o.top + upper + j, s[k]);
  });
}

function drawLegs(gr: Grid, dir: Dir3, pose: Pose, g: Geo, opts: BodyOpts): void {
  const top = ROW.legs + pose.dy;
  const base = { top, shoe: opts.shoe ?? "dep", thigh: opts.thigh, cuff: opts.cuff } as const;
  if (dir !== "left") {
    // seen from the back, the character's left leg is on the viewer's right
    const [liftL, liftR] = dir === "down" ? pose.lift : [pose.lift[1], pose.lift[0]];
    drawLeg(gr, { ...base, xTop: g.legX[0], xBot: g.legX[0], bottom: ROW.sole - liftL, w: g.legW, toe: -1, ext: 1 });
    drawLeg(gr, { ...base, xTop: g.legX[1], xBot: g.legX[1], bottom: ROW.sole - liftR, w: g.legW, toe: 1, ext: 1 });
    return;
  }
  const side = { ...base, w: 4, toe: -1, ext: 2 } as const;
  if (pose.stride === 1) {
    drawLeg(gr, { ...side, xTop: 11, xBot: 13, bottom: ROW.sole - 1, far: true });
    drawLeg(gr, { ...side, xTop: 10, xBot: 8, bottom: ROW.sole });
  } else if (pose.stride === -1) {
    drawLeg(gr, { ...side, xTop: 10, xBot: 8, bottom: ROW.sole, far: true });
    drawLeg(gr, { ...side, xTop: 10, xBot: 12, bottom: ROW.sole - 1 });
  } else {
    const lifted = Math.max(pose.lift[0], pose.lift[1]);
    if (lifted) drawLeg(gr, { ...side, xTop: 11, xBot: 12, bottom: ROW.sole - lifted - 1, far: true });
    drawLeg(gr, { ...side, xTop: 10, xBot: 10, bottom: ROW.sole });
  }
}

/** The front/back arm columns (2 wide) from the shoulder down; `swing` +1 is a pixel longer (forward), −1 shorter. */
function armColumn(g: Geo, sleeve: Sleeve, swing: number, right: boolean): string[] {
  const upper = g.armLen - 4 + swing; // rows between the shoulder and the cuff
  const sl = (i: number) => sleeve === "long" || (sleeve === "short" && i < 2);
  const cloth = right ? "aA" : "aa", skin = right ? "sS" : "ss";
  const rows: string[] = [right ? "a." : ".a"];
  if (sleeve === "none") rows[0] = right ? "s." : ".s";
  for (let i = 0; i < upper; i++) rows.push(sl(i) ? cloth : sleeve === "short" && i === 2 ? "AA" : skin);
  rows.push(sleeve === "long" ? "AA" : skin);
  rows.push("ss", right ? "SS" : "sS");
  return rows;
}
function drawArmsFront(gr: Grid, dir: Dir3, pose: Pose, g: Geo, sleeve: Sleeve): void {
  const [sL, sR] = dir === "down" ? pose.arm : [pose.arm[1], pose.arm[0]];
  stamp(gr, armColumn(g, sleeve, sL, false), ROW.torso + pose.dy, g.armL);
  stamp(gr, armColumn(g, sleeve, sR, true), ROW.torso + pose.dy, g.armR);
}
/** The near arm in the side view (with its own edge lines, since it lies over the torso), swinging along the stride. */
function drawArmSide(gr: Grid, pose: Pose, g: Geo, sleeve: Sleeve): void {
  const upper = g.armLen - 4;
  const cloth = (i: number) => sleeve === "long" || (sleeve === "short" && i < 2);
  const rows = [sleeve === "none" ? ".ss." : ".aa."];
  for (let i = 0; i < upper; i++) rows.push(cloth(i) ? (i === 0 ? "oaao" : "oaAo") : sleeve === "short" && i === 2 ? "oAAo" : "osSo");
  rows.push(sleeve === "long" ? "oAAo" : "osSo", "osso", "osSo", ".oo.");
  const swing = pose.stride * 2;
  rows.forEach((row, i) => {
    const dx = i >= upper ? swing : i >= 3 ? Math.trunc(swing / 2) : 0;
    stamp(gr, [row], ROW.torso + 1 + pose.dy + i, 10 + dx);
  });
}

export interface BodyParts { base: string[]; arms: string[] }

/** The body for a direction and frame, in two layers: `base` (legs, head, torso, hips) and `arms` (drawn over it, and
 *  over any garment on the torso). */
export function buildBodyParts(dir: Dir3, frame: Frame, gender: Gender = "nam", opts: BodyOpts = {}): BodyParts {
  const pose = POSES[frame];
  const g = GEO[gender];
  const lower = opts.lower ?? "pants";
  const base = grid();
  drawLegs(base, dir, pose, g, opts);
  const head = gender === "nu" ? lashHead(dir) : HEADS[dir];
  const torso = dir === "down" ? (gender === "nu" ? TORSO_FRONT_NU : TORSO_FRONT_NAM)
    : dir === "up" ? (gender === "nu" ? TORSO_BACK_NU : TORSO_BACK_NAM)
      : gender === "nu" ? TORSO_SIDE_NU : TORSO_SIDE_NAM;
  const hips = lower === "pants" ? pantsRows(dir, g) : skirtRows(dir, g, lower);
  stamp(base, head, pose.dy);
  stamp(base, torso, ROW.torso + pose.dy);
  if (lower === "pants") stamp(base, hips, ROW.hips + pose.dy);
  else {
    // the skirt's hem lags a pixel behind the body (it flutters down as the body rises)
    stamp(base, hips.slice(0, -1), ROW.hips + pose.dy);
    stamp(base, hips.slice(-1), ROW.hips + hips.length - 1 + Math.max(pose.dy, pose.tip));
    if (pose.tip > pose.dy) stamp(base, hips.slice(-1), ROW.hips + hips.length - 1 + pose.dy);
  }
  const arms = grid();
  if (dir === "left") drawArmSide(arms, pose, g, opts.sleeve ?? "long");
  else drawArmsFront(arms, dir, pose, g, opts.sleeve ?? "long");
  return { base: base.map((r) => r.join("")), arms: arms.map((r) => r.join("")) };
}

/** Full 24×48 body (arms merged over the base). `gender` "nu" gives the narrower frame, a bust, a waist and lashes. */
export function buildBody(dir: Dir3, frame: Frame, gender: Gender = "nam", opts: BodyOpts = {}): string[] {
  const { base, arms } = buildBodyParts(dir, frame, gender, opts);
  return base.map((row, y) => [...row].map((ch, x) => (arms[y][x] !== "." ? arms[y][x] : ch)).join(""));
}

function setAt(row: string, x: number, ch: string): string {
  return row.slice(0, x) + ch + row.slice(x + 1);
}
/** The nữ head: an eyelash flick at each outer eye corner. */
function lashHead(dir: Dir3): string[] {
  const out = [...HEADS[dir]];
  if (dir === "down") out[13] = setAt(setAt(out[13], 6, "e"), 17, "e");
  else if (dir === "left") out[13] = setAt(out[13], 5, "e");
  return out;
}
