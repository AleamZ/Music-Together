// v20 Võ đài, a prototype (opt-in, fighter-art.ts): the fighters drawn in the world's chibi style instead of the
// 48 × 64 rig. The head is the world chibi's own — the bald head, face, hair, hairpin and clip composed by the world
// painter (compose.ts `composeHeadMatrix`, side view) — and the body wears the world's colours for the look and the
// style's võ phục (compose.ts `resolveWear`, uniforms.ts), with its belt in the rank's colour. The body is posed by the
// rig's own keyframes (poses.ts), mapped to chibi proportions: a short torso and stubby limbs, the head a third of the
// height. So every pose the rig has (every style's specials included) exists here too, and the pose stays a pure
// function of the state. To keep the action readable (the owner's worry about chibi fighting), a limb that strikes
// reaches further than a resting one, and an active strike frame draws speed streaks behind the fist or foot.
// All original pixel art, drawn in code; the same 48 × 64 box as the rig, so the scene places it the same way.

import { composeHeadMatrix, lookKey, resolveWear } from "@/lib/game/art/compose";
import { OUTLINE, SKIN } from "@/lib/game/art/palettes";
import type { Look } from "@/lib/game/types";
import { martialById } from "../dojo";
import { K_NONE, M_KIND, MOVES_PER_STYLE, STYLE_COUNT, mv } from "../moves";
import { J, JOINTS, RIG_H, RIG_W, moveKeys, poseData, type Pose, type PoseId } from "./poses";
import { UNIFORMS, type FighterLook, type PixelCtx } from "./rig";
import { STYLE_ART, styleRef } from "./style-poses";

// ---------- the pose mapping (pure) ----------

/** The feet's row in the box (the rig's too). */
const GROUND = RIG_H - 1;
/** Leg bones and the hip's height over the ground (the rig's 23 px legs → 18). */
export const K_LEG = 0.78;
/** A kicking leg (extended, off the ground or sweeping far) reaches further. */
export const K_KICK = 0.92;
/** Hip → shoulders (the rig's 15 px torso → 12). */
export const K_TORSO = 0.8;
/** Arm bones at rest (the rig's ~15 px arm → 10: the world chibi's stubby arms). */
export const K_ARM = 0.66;
/** A punching arm (straight and long) reaches further. */
export const K_REACH = 0.88;
/** The torso's half width (9 px wide, like the world chibi's side view with its outline). */
export const TORSO_R = 4;
/** How far above the shoulder line the chin sits (the torso's rounded top). */
const CHIN_UP = 2;
/** Half the world chibi's head with its hair, across (the head is 16 px, the hair a little wider). */
const HEAD_HALF = 10;
/** The joints above the hips, lifted together when a lying body is raised off the floor. */
const UPPER = [J.head, J.neck, J.chest, J.hip, J.shF, J.elF, J.hnF, J.shB, J.elB, J.hnB] as const;

export type Pt = readonly [number, number];

export interface ChibiPose {
  /** The rig's 14 joints (J order) in chibi proportions: J.neck is the chin, J.head the head's centre. */
  joints: Pt[];
  /** The head's rotation: 0 upright, −1 a quarter turn anticlockwise (lying, head to the left), 1 clockwise. */
  turn: -1 | 0 | 1;
  /** The limb that reaches (its end joint: J.hnF, J.hnB, J.ftF or J.ftB), else −1. */
  reach: number;
  /** An active strike frame: the reaching limb draws speed streaks. */
  strike: boolean;
}

const dist = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** A straight, long arm (a punch, an uppercut, a raised fist). */
function armReaches(p: Pose, sh: number, el: number, hn: number): boolean {
  const reach = dist(p[sh], p[hn]), len = dist(p[sh], p[el]) + dist(p[el], p[hn]);
  return len > 0 && reach >= 12 && reach / len > 0.92;
}
/** A straight leg thrown out: off the ground, or sweeping far along it. */
function legReaches(p: Pose, kn: number, ft: number): boolean {
  const hip = p[J.hip], foot = p[ft];
  const reach = dist(hip, foot), len = dist(hip, p[kn]) + dist(p[kn], foot);
  const dx = Math.abs(foot[0] - hip[0]);
  return len > 0 && reach / len > 0.85 && dx >= 10 && (foot[1] <= GROUND - 5 || dx >= 15);
}

/** Maps a rig pose to the chibi's proportions. `strike`: the pose is a move's active frame. */
export function chibiPose(p: Pose, strike = false): ChibiPose {
  const hipR = p[J.hip], chestR = p[J.chest];
  const q: [number, number][] = Array.from({ length: JOINTS }, () => [0, 0]);
  /** `base` plus the rig's bone from → to, scaled. */
  const at = (base: Pt, from: Pt, to: Pt, k: number): [number, number] => [base[0] + (to[0] - from[0]) * k, base[1] + (to[1] - from[1]) * k];

  const hip: [number, number] = [hipR[0], GROUND - (GROUND - hipR[1]) * K_LEG];
  const chest = at(hip, hipR, chestR, K_TORSO);
  q[J.hip] = hip;
  q[J.chest] = chest;
  const arms = [[J.shF, J.elF, J.hnF], [J.shB, J.elB, J.hnB]] as const;
  const legs = [[J.knF, J.ftF], [J.knB, J.ftB]] as const;
  let reach = -1, best = 0;
  for (const [sh, el, hn] of arms) {
    const long = armReaches(p, sh, el, hn);
    const k = long ? K_REACH : K_ARM;
    q[sh] = at(chest, chestR, p[sh], 1);
    q[el] = at(q[sh], p[sh], p[el], k);
    q[hn] = at(q[el], p[el], p[hn], k);
    const d = dist(p[sh], p[hn]);
    if (long && d > best) { best = d; reach = hn; }
  }
  for (const [kn, ft] of legs) {
    const long = legReaches(p, kn, ft);
    const k = long ? K_KICK : K_LEG;
    q[kn] = at(hip, hipR, p[kn], k);
    q[ft] = at(q[kn], p[kn], p[ft], k);
    // a kick is the bigger event: it wins over a straight arm (a flying kick's arms fly out too)
    const d = dist(hipR, p[ft]) + 100;
    if (long && d > best) { best = d; reach = ft; }
  }
  // the head: on the torso's rounded top, following the rig's head offset a little; turned when lying down
  const vx = chest[0] - hip[0], vy = chest[1] - hip[1];
  const len = Math.hypot(vx, vy) || 1;
  const ux = vx / len, uy = vy / len;
  const lying = Math.abs(vx) > Math.abs(vy);
  const hd = [p[J.head][0] - chestR[0], p[J.head][1] - chestR[1]];
  const chin: [number, number] = lying
    ? [chest[0] + ux * (CHIN_UP + 1), chest[1] + uy * (CHIN_UP + 1)]
    : [chest[0] + ux * CHIN_UP + (hd[0] - 1) * 0.6, chest[1] + uy * CHIN_UP + (hd[1] + 9) * 0.5];
  const turn: -1 | 0 | 1 = lying ? (vx < 0 ? -1 : 1) : 0;
  q[J.neck] = chin;
  if (lying) {
    // the chibi's head is big: a lying body's upper half rests on the floor with the whole head (and hair) above it,
    // and the figure slides along the floor so the head stays in the box (the legs keep their places)
    const lift = Math.min(0, GROUND - HEAD_HALF - 1 - chin[1], GROUND - TORSO_R - 1 - Math.max(hip[1], chest[1]));
    for (const k of UPPER) q[k][1] += lift;
    const lo = turn < 0 ? chin[0] - 2 * HEAD_HALF : chin[0] - 1, hi = turn < 0 ? chin[0] + 1 : chin[0] + 2 * HEAD_HALF;
    const slide = lo < 0 ? -lo : hi > RIG_W - 1 ? RIG_W - 1 - hi : 0;
    for (const pt of q) pt[0] += slide;
  }
  q[J.head] = turn === 0 ? [chin[0], chin[1] - 8] : [chin[0] + turn * 8, chin[1]];

  const fit = ([x, y]: readonly [number, number]): Pt => [
    Math.max(1, Math.min(RIG_W - 2, Math.round(x))), Math.max(1, Math.min(RIG_H - 1, Math.round(y))),
  ];
  return { joints: q.map(fit), turn, reach, strike: strike && reach >= 0 };
}

/** Every pose shown on a move's active frames (a normal's strike key, a special's active keys). */
export const STRIKE_POSES: ReadonlySet<PoseId> = new Set<PoseId>([
  ...Array.from({ length: STYLE_COUNT * MOVES_PER_STYLE }, (_, id) => id)
    .filter((id) => mv(id, M_KIND) !== K_NONE)
    .map((id) => moveKeys(id)[1]),
  ...Object.entries(STYLE_ART).flatMap(([style, art]) =>
    Object.values(art?.specials ?? {}).flatMap((k) => k.a.map((n) => styleRef(Number(style), n)))),
]);

const poseCache = new Map<PoseId, ChibiPose>();
/** The chibi pose of a rig pose id (cached; an unknown id is the idle pose, as on the rig). */
export function chibiPoseOf(id: PoseId, style = 0): ChibiPose {
  let cp = poseCache.get(id);
  if (!cp) {
    cp = chibiPose(poseData(id, style), STRIKE_POSES.has(id));
    poseCache.set(id, cp);
  }
  return cp;
}

// ---------- the look (what is worn) ----------

const GLOVE = "#b21f1f";
const GLOVE_HI = "#e0504a";
const WRAP = "#f2efe6";
const FLASH = "#ffffff";
/** A placeholder for the torso's pixels while they are coloured. */
const BODY = "torso";
const STREAK = ["#ffffffe6", "#ffffffa0", "#ffffff60"] as const;

interface ChibiWear {
  head: string[][];
  skin: { s: string; S: string };
  pal: Record<string, string | null>;
  /** The uniform's own codes: 1 the belt (the rank's colour), 2 a darker line, 3 a collar, 4 a trim. */
  code: Record<string, string>;
  uniform: string | null;
  sleeve: "long" | "short" | "none";
  feet: "bare" | "shoes";
  hands: "bare" | "gloves" | "wraps";
}

const wearCache = new Map<string, ChibiWear>();
const MAX_WEAR = 64;

/** What the fighter wears: the style's võ phục in the rank's belt (Tự do: the look's own clothes). No hat in a fight. */
function wearOf(fl: FighterLook): ChibiWear {
  const m = martialById(fl.style);
  const rank = Math.max(0, Math.min(4, Math.trunc(fl.rank)));
  const look: Look = { ...fl.look, hat: null, ...(m ? { outfit: m.uniform, belt: rank } : {}) };
  const key = `${lookKey(look)}|${fl.style}`;
  const hit = wearCache.get(key);
  if (hit) return hit;
  const skin = SKIN[look.skin] ?? SKIN.warm;
  const wear = resolveWear(look);
  const outfit = wear.garments.find((g) => g.slot === "outfit");
  const code: Record<string, string> = {};
  for (const [k, v] of Object.entries(outfit?.colors ?? {})) if (k >= "0" && k <= "9") code[k] = v;
  const u = m ? UNIFORMS[fl.style] : null;
  const w: ChibiWear = {
    head: composeHeadMatrix(look, "right"),
    skin,
    pal: wear.pal,
    code,
    uniform: m?.uniform ?? null,
    sleeve: wear.opts.sleeve ?? "long",
    feet: u?.feet ?? "shoes",
    hands: u?.hands ?? "bare",
  };
  wearCache.set(key, w);
  if (wearCache.size > MAX_WEAR) {
    const oldest = wearCache.keys().next().value;
    if (oldest !== undefined) wearCache.delete(oldest);
  }
  return w;
}

// ---------- the painter ----------

/** The box's pixels (RIG_H rows × RIG_W columns of CSS colours, "" = transparent), facing right. */
export type ChibiMatrix = string[][];

/** Paints one pose of the chibi fighter as a colour matrix, facing right. */
export function chibiMatrix(cp: ChibiPose, fl: FighterLook): ChibiMatrix {
  const w = wearOf(fl);
  const pal = (k: string, fb: string) => w.pal[k] ?? fb;
  const m: ChibiMatrix = Array.from({ length: RIG_H }, () => new Array<string>(RIG_W).fill(""));
  const put = (x: number, y: number, color: string) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && x < RIG_W && y >= 0 && y < RIG_H) m[y][x] = color;
  };
  const blob = (x: number, y: number, t: number, color: string) => {
    const r0 = -Math.floor((t - 1) / 2);
    for (let dy = r0; dy < r0 + t; dy++) for (let dx = r0; dx < r0 + t; dx++) put(x + dx, y + dy, color);
  };
  /** A rounded blob (the corners cut) for fists and knees. */
  const bead = (x: number, y: number, t: number, color: string) => {
    const r0 = -Math.floor((t - 1) / 2), r1 = r0 + t - 1;
    for (let dy = r0; dy <= r1; dy++) for (let dx = r0; dx <= r1; dx++) {
      if ((dx === r0 || dx === r1) && (dy === r0 || dy === r1) && t > 3) continue;
      put(x + dx, y + dy, color);
    }
  };
  const line = (a: Pt, b: Pt, t: number, color: string, brush = blob) => {
    let [x0, y0] = a;
    const [x1, y1] = b;
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let guard = 0; guard < 200; guard++) {
      brush(x0, y0, t, color);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  };
  const limb = (a: Pt, b: Pt, t: number, color: string) => {
    line(a, b, t + 2, OUTLINE);
    line(a, b, t, color);
  };
  const j = cp.joints;
  const skinOf = (far: boolean) => (far ? w.skin.S : w.skin.s);

  const arm = (sh: number, el: number, hn: number, far: boolean) => {
    const cloth = far ? pal("A", w.skin.S) : pal("a", w.skin.s);
    const upper = w.sleeve === "none" ? skinOf(far) : cloth;
    const fore = w.sleeve === "long" ? cloth : skinOf(far);
    limb(j[sh], j[el], 3, upper);
    limb(j[el], j[hn], 3, fore);
    if (w.uniform === "vp_muaythai" && w.code[1]) {
      // the prajioud round the upper arm
      put((j[sh][0] + j[el][0]) / 2, (j[sh][1] + j[el][1]) / 2, w.code[1]);
      put((j[sh][0] + j[el][0]) / 2 + 1, (j[sh][1] + j[el][1]) / 2, w.code[1]);
    }
    const [hx, hy] = j[hn];
    if (w.hands === "gloves") { bead(hx, hy, 7, OUTLINE); bead(hx, hy, 5, far ? GLOVE : GLOVE_HI); put(hx + 1, hy - 1, "#ffffff"); }
    else if (w.hands === "wraps") { bead(hx, hy, 6, OUTLINE); bead(hx, hy, 4, WRAP); }
    else { bead(hx, hy, 6, OUTLINE); bead(hx, hy, 4, skinOf(far)); put(hx + 1, hy + 1, far ? OUTLINE : w.skin.S); }
  };
  const leg = (kn: number, ft: number, far: boolean) => {
    const thigh = far ? pal("P", w.skin.S) : pal("p", w.skin.s);
    const shin = far ? pal("G", w.skin.S) : pal("g", w.skin.s);
    limb(j[J.hip], j[kn], 4, thigh);
    limb(j[kn], j[ft], 4, shin);
    const [fx, fy] = j[ft];
    const toe = cp.turn === 0 ? 1 : 0;
    const foot = w.feet === "shoes" ? (far ? pal("F", OUTLINE) : pal("f", OUTLINE)) : skinOf(far);
    const sole = w.feet === "shoes" ? pal("F", OUTLINE) : w.skin.S;
    for (let x = fx - 2; x <= fx + 3 + toe; x++) for (let y = fy - 2; y <= fy + 1; y++) put(x, y, OUTLINE);
    for (let x = fx - 1; x <= fx + 2 + toe; x++) { put(x, fy - 1, foot); put(x, fy, sole); }
  };

  /** The torso: a rounded body in the top's colour (a highlight in front, a shade behind), the bottom's colour over the
   *  hips, and the uniform's details (lapels, collar, belt and its tails, a waistband). */
  const torso = () => {
    const hip = j[J.hip], chest = j[J.chest];
    const vx = chest[0] - hip[0], vy = chest[1] - hip[1];
    const L = Math.hypot(vx, vy) || 1;
    const ux = vx / L, uy = vy / L, nx = -uy, ny = ux;
    const a: Pt = [Math.round(hip[0] + ux), Math.round(hip[1] + uy)];
    const b: Pt = [Math.round(hip[0] + ux * (L - CHIN_UP)), Math.round(hip[1] + uy * (L - CHIN_UP))];
    const disc = (r: number) => (x: number, y: number, _t: number, color: string) => {
      for (let dy = -r - 1; dy <= r + 1; dy++) for (let dx = -r - 1; dx <= r + 1; dx++) {
        if (dx * dx + dy * dy <= r * r + r * 0.8) put(x + dx, y + dy, color);
      }
    };
    line(a, b, 0, OUTLINE, disc(TORSO_R + 1));
    line(a, b, 0, BODY, disc(TORSO_R));
    const u = w.uniform;
    const gi = u === "vp_vovinam" || u === "vp_karate" || u === "vp_taekwondo" || u === "vp_judo";
    for (let y = 0; y < RIG_H; y++) for (let x = 0; x < RIG_W; x++) {
      if (m[y][x] !== BODY) continue;
      const s = (x - hip[0]) * ux + (y - hip[1]) * uy;
      const d = (x - hip[0]) * nx + (y - hip[1]) * ny;
      let c: string;
      if (s < 2.5) c = d < -2 ? pal("P", OUTLINE) : pal("p", OUTLINE);
      else c = d > 3 ? pal("u", pal("t", OUTLINE)) : d < -2.5 ? pal("T", OUTLINE) : pal("t", OUTLINE);
      // the uniform's bands round the waist (bottom-up, as the world chibi draws them)
      if ((gi || u === "vp_vinhxuan") && s >= 2.5 && s < 3.5) c = w.code[2] ?? c;
      if ((gi || u === "vp_vinhxuan") && s >= 3.5 && s < 4.5) c = w.code[1] ?? c;
      if (u === "vp_muaythai" && s >= 1.5 && s < 2.5) c = w.code[2] ?? c;
      if (u === "vp_boxing" && s >= 0.5 && s < 1.5) c = w.code[2] ?? c;
      if (u === "vp_boxing" && s >= 1.5 && s < 2.5) c = w.code[1] ?? c;
      // lapels / collar down the front edge
      if (gi && s >= 4.5 && d > 2.5) c = (u === "vp_taekwondo" ? w.code[3] : u === "vp_judo" ? w.code[4] : w.code[2]) ?? c;
      if (u === "vp_judo" && s >= 4.5 && d > 1.5 && d <= 2.5) c = w.code[4] ?? c;
      if (u === "vp_vinhxuan" && s >= L - 1) c = w.code[4] ?? c;
      if (u === "vp_vinhxuan" && s >= 5 && d > 2.5 && Math.round(s) % 2 === 0) c = w.code[4] ?? c;
      m[y][x] = c;
    }
    // the belt's tails hang in front (the sash's behind)
    if ((gi || u === "vp_vinhxuan") && w.code[1]) {
      const side = u === "vp_vinhxuan" ? -1 : 1;
      const bx = hip[0] + nx * side * (TORSO_R + 1), by = hip[1] + ny * side * (TORSO_R + 1);
      put(bx + ux * 4, by + uy * 4, w.code[1]);
      put(bx + ux * 3, by + uy * 3, w.code[1]);
      put(bx + ux * 2, by + uy * 2, w.code[1]);
      put(bx + ux * 1, by + uy * 1, w.code[2] ?? w.code[1]);
    }
  };

  const head = () => {
    const [cx, cy] = j[J.neck];
    const H = w.head;
    for (let y = 0; y < H.length; y++) for (let x = 0; x < H[y].length; x++) {
      const c = H[y][x];
      if (!c) continue;
      const dx = x - 12, dy = y - 20;
      if (cp.turn === 0) put(cx + dx, cy + dy, c);
      else if (cp.turn === -1) put(cx + dy, cy - dx, c);
      else put(cx - dy, cy + dx, c);
    }
  };

  arm(J.shB, J.elB, J.hnB, true);
  leg(J.knB, J.ftB, true);
  torso();
  leg(J.knF, J.ftF, false);
  head();
  arm(J.shF, J.elF, J.hnF, false);
  if (cp.strike) streaks(m, cp);
  return m;
}

/** Speed streaks behind the reaching fist or foot (drawn only where the body is not). */
function streaks(m: ChibiMatrix, cp: ChibiPose): void {
  const end = cp.joints[cp.reach];
  const base = cp.joints[cp.reach === J.hnF ? J.shF : cp.reach === J.hnB ? J.shB : J.hip];
  const dx = end[0] - base[0], dy = end[1] - base[1];
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
  const foot = cp.reach === J.ftF || cp.reach === J.ftB;
  const spread = foot ? 5 : 4;
  // two long streaks either side of the limb, two short ones further out
  const lines: [number, number, number][] = [[-spread, 2, 12], [spread, 2, 12], [-spread - 2, 5, 9], [spread + 2, 5, 9]];
  for (const [off, t0, t1] of lines) for (let t = t0; t <= t1; t++) {
    const x = Math.round(end[0] - ux * t + nx * off), y = Math.round(end[1] - uy * t + ny * off);
    if (x < 0 || x >= RIG_W || y < 0 || y >= RIG_H || m[y][x]) continue;
    m[y][x] = STREAK[t < 6 ? 0 : t < 9 ? 1 : 2];
  }
}

/** Paints one pose at (ox, oy) (the box's top-left); `flip` faces left, `flash` paints it all white — rig.ts's
 *  `paintFighter`, by pose id. Runs of one colour go as one fillRect. */
export function paintChibiFighter(c: PixelCtx, pose: PoseId, fl: FighterLook, ox: number, oy: number, flip: boolean, flash = false): void {
  const m = chibiMatrix(chibiPoseOf(pose, fl.style), fl);
  for (let y = 0; y < RIG_H; y++) {
    const row = flip ? [...m[y]].reverse() : m[y];
    let x = 0;
    while (x < RIG_W) {
      const col = row[x];
      let e = x + 1;
      while (e < RIG_W && row[e] === col) e++;
      if (col) {
        c.fillStyle = flash ? FLASH : col;
        c.fillRect(ox + x, oy + y, e - x, 1);
      }
      x = e;
    }
  }
}

// ---------- browser: cached sprites ----------
const cache = new Map<string, HTMLCanvasElement>();
const MAX = 400;

/** A 48 × 64 canvas of the pose (browser only), cached — rig.ts's `fighterSprite`. */
export function chibiSprite(fl: FighterLook, pose: PoseId, flip: boolean, flash = false): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const key = `${lookKey(fl.look)}|${fl.style}|${fl.rank}|${pose}|${flip ? 1 : 0}|${flash ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const cv = document.createElement("canvas");
  cv.width = RIG_W;
  cv.height = RIG_H;
  const ctx = cv.getContext("2d");
  if (!ctx) return null;
  paintChibiFighter(ctx, pose, fl, 0, 0, flip, flash);
  cache.set(key, cv);
  if (cache.size > MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return cv;
}
