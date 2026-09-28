// v20 Võ đài: the fighter's poses (spec §v20.1 "Rendering"). A pose is 14 integer joints in a 48 × 64 box, facing
// right, the feet on row 63. `poseFor(state, side)` is a pure function of the state — (action, move, action frame) —
// so a rollback redraws correctly with no bookkeeping. The shared poses below are every style's; v20.2 adds each
// style's own stance and special keyframes (style-poses.ts), picked here the same way.

import {
  A_ATTACK, A_BLOCKSTUN, A_CGUARD, A_CROUCH, A_FALL, A_GUARD, A_HITSTUN, A_IDLE, A_JATTACK, A_JUMP, A_KNOCKDOWN, A_LAND,
  A_PREJUMP, A_TECHED, A_THROW, A_THROWN, A_WALKB, A_WALKF, F_ACT, F_AF, F_HITMV, F_KDOWN, F_MOVE, F_SC, F_STUNK, F_STYLE,
  F_VY, G_FRAME, G_LAST, G_PHASE, PH_END, PH_OVER, G_RESULT, fb, type State,
} from "../engine";
import {
  B_HK, B_K, H_HIGH, K_DODGE, K_GRAB, K_PARRY, M_A, M_BTN, M_HEIGHT, M_KIND, M_MOTION, M_R, M_S, M_SLOT, MO_DP,
  MOVES_PER_STYLE, MV_CHK, MV_CHP, MV_CLK, MV_CLP, MV_HK, MV_HP, MV_JHK, MV_JHP, MV_JLK, MV_JLP, MV_LK, MV_LP, MV_THROW, mv,
} from "../moves";
import { air, build, crouchBase, std, type Pose, type Spec } from "./pose-kit";
import { STYLE_ART, styleRef, type SpecialKeys } from "./style-poses";

export { J, JOINTS, RIG_H, RIG_W, type Pose } from "./pose-kit";
const SPECS = {
  idle0: std(),
  idle1: std({ hip: [23, 41], chest: [1, -15] }),
  idle2: std({ hip: [23, 41], chest: [1, -14] }),
  idle3: std({ hip: [23, 40], chest: [1, -14] }),
  walk0: std({ lF: [5, 11, 8, 23], lB: [-3, 11, -7, 23] }),
  walk1: std({ hip: [23, 39], lF: [3, 11, 2, 24], lB: [0, 11, -1, 24] }),
  walk2: std({ lF: [1, 11, -3, 23], lB: [2, 11, 6, 23] }),
  walk3: std({ hip: [23, 39], lF: [2, 11, 1, 24], lB: [1, 11, 1, 24] }),
  crouch: crouchBase(),
  prejump: crouchBase({ hip: [23, 46], chest: [2, -14] }),
  jump0: air({ lF: [5, 10, 3, 20], lB: [-1, 11, -3, 21], aF: [3, -5, 6, -11] }),
  jump1: air({ hip: [23, 36], lF: [7, 5, 3, 13], lB: [-1, 6, -6, 12] }),
  jump2: air({ lF: [5, 9, 5, 19], lB: [-2, 10, -5, 19] }),
  land: crouchBase({ hip: [23, 47] }),
  guard: std({ aF: [3, 4, 5, -3], aB: [3, 5, 5, -1], chest: [-1, -15], head: [0, -9] }),
  cguard: crouchBase({ aF: [3, 4, 5, -3], aB: [3, 5, 5, -1], chest: [1, -13] }),
  hit_high: std({ chest: [-4, -14], head: [-2, -9], aF: [-2, 7, 2, 12], aB: [-5, 6, -8, 11] }),
  hit_mid: std({ chest: [-2, -13], head: [2, -8], aF: [-1, 8, 3, 14], aB: [-4, 8, -6, 14], hip: [21, 41] }),
  hit_low: crouchBase({ chest: [-2, -12], head: [-1, -8], aF: [-2, 7, 1, 12], aB: [-4, 7, -7, 11] }),
  block: std({ chest: [-2, -15], aF: [3, 3, 5, -4], aB: [3, 4, 5, -2], head: [-1, -9] }),
  cblock: crouchBase({ chest: [0, -13], aF: [3, 3, 5, -4], aB: [3, 4, 5, -2] }),
  fall: { hip: [24, 36], chest: [-10, -8], head: [-7, -5], aF: [-2, -6, -5, -12], aB: [2, -7, 0, -13], lF: [7, 4, 14, 3], lB: [6, 6, 12, 8] },
  down0: { hip: [26, 60], chest: [-12, -1], head: [-8, 0], aF: [3, 1, 7, 1], aB: [2, 2, 6, 2], lF: [8, -2, 16, 1], lB: [7, 0, 15, 2] },
  down1: { hip: [26, 61], chest: [-13, 0], head: [-8, 0], aF: [3, 1, 7, 1], aB: [2, 2, 6, 2], lF: [8, 0, 17, 2], lB: [7, 1, 16, 2] },
  getup0: crouchBase({ hip: [22, 54], chest: [5, -10], head: [2, -8], aF: [2, 8, 4, 13], aB: [1, 8, 2, 13] }),
  getup1: crouchBase({ hip: [23, 48], chest: [3, -14] }),
  throw0: std({ aF: [6, 1, 12, 2], aB: [5, 2, 11, 3], chest: [2, -15] }),
  throw1: std({ aF: [-3, -6, -6, -12], aB: [-2, -5, -5, -11], chest: [-3, -14], head: [-1, -9] }),
  thrown: std({ chest: [4, -13], head: [3, -8], aF: [5, 6, 8, 10], aB: [4, 7, 6, 11], hip: [24, 42] }),
  win: std({ aF: [2, -7, 3, -15], aB: [-4, 6, -3, 12], chest: [0, -16], head: [0, -9], lF: [3, 11, 3, 23], lB: [-3, 11, -3, 23] }),
  lose: std({ chest: [3, -12], head: [3, -7], aF: [1, 9, 2, 16], aB: [0, 9, 0, 16], hip: [23, 43], lF: [3, 10, 4, 20], lB: [-2, 10, -3, 20] }),
  // normals: a wind-up, the strike, and (heavies) a recovery
  lp0: std({ aF: [2, 5, 4, -1] }),
  lp1: std({ aF: [6, 0, 13, -1], chest: [2, -15] }),
  hp0: std({ aF: [-3, 5, -2, 0], chest: [-1, -15] }),
  hp1: std({ aF: [7, 0, 15, -1], chest: [4, -14], head: [2, -9], lF: [6, 11, 9, 23] }),
  hp2: std({ aF: [5, 3, 9, 0], chest: [2, -15] }),
  lk0: std({ lF: [5, 7, 3, 14] }),
  lk1: std({ lF: [8, 4, 16, 8], chest: [-2, -15] }),
  hk0: std({ lF: [4, 5, -1, 12], chest: [-1, -15] }),
  hk1: std({ lF: [7, -4, 17, -8], lB: [-2, 11, -3, 23], chest: [-5, -13], head: [-2, -9] }),
  hk2: std({ lF: [6, 4, 10, 12], chest: [-2, -15] }),
  clp0: crouchBase({ aF: [3, 5, 6, 1] }),
  clp1: crouchBase({ aF: [6, 2, 13, 2] }),
  chp0: crouchBase({ aF: [2, 6, 4, 2] }),
  chp1: crouchBase({ hip: [23, 44], chest: [3, -15], aF: [4, -6, 7, -15] }),
  clk0: crouchBase({ lF: [8, 6, 10, 13] }),
  clk1: crouchBase({ lF: [9, 8, 18, 13] }),
  chk0: crouchBase({ lF: [6, 7, 6, 13], chest: [2, -12] }),
  chk1: crouchBase({ hip: [21, 51], chest: [-2, -11], lF: [10, 9, 21, 12], lB: [-4, 6, -8, 12] }),
  jlp: air({ aF: [6, 3, 12, 5] }),
  jhp: air({ aF: [6, 5, 13, 9], chest: [3, -14] }),
  jlk: air({ lF: [7, 6, 14, 10] }),
  jhk: air({ lF: [8, 3, 18, 6], lB: [-3, 8, -7, 13], chest: [-3, -14] }),
  // specials (every style until v20.2 gives its own keyframes)
  sp_punch0: std({ aF: [-3, 5, -3, 1], aB: [-3, 6, -5, 2], chest: [-1, -15] }),
  sp_punch1: std({ aF: [7, 0, 16, 0], aB: [6, 1, 14, 1], chest: [4, -14], head: [2, -9], lF: [7, 11, 10, 23] }),
  sp_kick0: std({ lF: [5, 3, 0, 10], chest: [-2, -15] }),
  sp_kick1: std({ lF: [8, -2, 18, -2], lB: [-2, 11, -3, 23], chest: [-6, -13], head: [-3, -9] }),
  sp_rise0: crouchBase({ aF: [2, 5, 3, 1] }),
  sp_rise1: std({ hip: [23, 37], chest: [2, -16], aF: [3, -8, 5, -17], lF: [5, 8, 3, 18], lB: [-2, 11, -4, 22] }),
  sp_grab0: std({ aF: [6, 2, 11, 1], aB: [6, 3, 10, 2], chest: [3, -14] }),
  sp_grab1: std({ aF: [-3, -5, -5, -12], aB: [-2, -4, -4, -11], chest: [-3, -14], head: [-1, -9] }),
  sp_parry: std({ aF: [5, -2, 9, -8], aB: [4, 2, 9, 0], chest: [-1, -15], head: [-1, -9] }),
  sp_dodge: crouchBase({ hip: [20, 47], chest: [-5, -12], head: [-2, -8] }),
  super0: std({ aF: [-2, 6, -1, 12], aB: [-3, 6, -2, 12], chest: [0, -16], lF: [6, 10, 9, 23], lB: [-6, 10, -9, 23] }),
} satisfies Record<string, Spec>;

/** A pose's id: a shared pose ("idle0", "hk1", …) or a style's own ("s3.s4b": Karate's brick chop). */
export type PoseId = string;
type SharedId = keyof typeof SPECS;
/** Every pose: the shared ones, then each style's (v20.2). */
export const POSE_IDS: readonly PoseId[] = [
  ...Object.keys(SPECS),
  ...Object.entries(STYLE_ART).flatMap(([style, art]) => Object.keys(art?.poses ?? {}).map((n) => styleRef(Number(style), n))),
];
export const POSES: Readonly<Record<PoseId, Pose>> = Object.fromEntries([
  ...Object.entries(SPECS).map(([k, sp]): [string, Pose] => [k, build(sp)]),
  ...Object.entries(STYLE_ART).flatMap(([style, art]) =>
    Object.entries(art?.poses ?? {}).map(([n, sp]: [string, Spec]): [string, Pose] => [styleRef(Number(style), n), build(sp)])),
]);

const NORMAL_KEYS: Record<number, [SharedId, SharedId, SharedId]> = {
  [MV_LP]: ["lp0", "lp1", "lp0"],
  [MV_HP]: ["hp0", "hp1", "hp2"],
  [MV_LK]: ["lk0", "lk1", "lk0"],
  [MV_HK]: ["hk0", "hk1", "hk2"],
  [MV_CLP]: ["clp0", "clp1", "clp0"],
  [MV_CHP]: ["chp0", "chp1", "chp0"],
  [MV_CLK]: ["clk0", "clk1", "clk0"],
  [MV_CHK]: ["chk0", "chk1", "chk0"],
  [MV_JLP]: ["jump1", "jlp", "jump2"],
  [MV_JHP]: ["jump1", "jhp", "jump2"],
  [MV_JLK]: ["jump1", "jlk", "jump2"],
  [MV_JHK]: ["jump1", "jhk", "jump2"],
  [MV_THROW]: ["sp_grab0", "sp_grab0", "idle0"],
};

/** The three keyframes (startup, active, recovery) of a move record. */
export function moveKeys(id: number): [PoseId, PoseId, PoseId] {
  const style = Math.trunc(id / MOVES_PER_STYLE);
  const own = STYLE_ART[style]?.normals?.[id % MOVES_PER_STYLE];
  if (own) return [styleRef(style, own[0]), styleRef(style, own[1]), styleRef(style, own[2])];
  const idx = id % MOVES_PER_STYLE;
  const n = NORMAL_KEYS[idx];
  if (n) return n;
  const kind = mv(id, M_KIND);
  if (kind === K_GRAB) return ["sp_grab0", "sp_grab0", "sp_grab1"];
  if (kind === K_PARRY) return ["sp_parry", "sp_parry", "guard"];
  if (kind === K_DODGE) return ["sp_dodge", "sp_dodge", "sp_dodge"];
  if (mv(id, M_MOTION) === MO_DP) return ["sp_rise0", "sp_rise1", "land"];
  const btn = mv(id, M_BTN);
  if (btn === B_K || btn === B_HK) return ["sp_kick0", "sp_kick1", "hk2"];
  return ["sp_punch0", "sp_punch1", "hp2"];
}

/** The pose a fighter shows in this state (pure). */
export function poseFor(s: State, side: number): PoseId {
  const b = fb(side);
  const a = s[b + F_ACT], af = s[b + F_AF], f = s[G_FRAME];
  const phase = s[G_PHASE];
  if ((phase === PH_END || phase === PH_OVER) && a <= A_CGUARD) {
    const last = phase === PH_OVER ? (s[G_RESULT] === 3 ? 0 : s[G_RESULT]) : s[G_LAST] & 3;
    if (last === side + 1) return "win";
    if (last !== 0) return "lose";
  }
  switch (a) {
    case A_IDLE: {
      const st = STYLE_ART[s[b + F_STYLE]]?.stance;
      if (st) return styleRef(s[b + F_STYLE], st[Math.trunc(f / 16) % 2]);
      return (["idle0", "idle1", "idle2", "idle3"] as const)[Math.trunc(f / 12) % 4];
    }
    case A_WALKF:
    case A_WALKB: return (["walk0", "walk1", "walk2", "walk3"] as const)[Math.trunc(af / 7) % 4];
    case A_CROUCH: return "crouch";
    case A_GUARD: return "guard";
    case A_CGUARD: return "cguard";
    case A_PREJUMP: return "prejump";
    case A_JUMP: {
      const vy = s[b + F_VY];
      return vy > 500 ? "jump0" : vy > -500 ? "jump1" : "jump2";
    }
    case A_LAND: return "land";
    case A_ATTACK:
    case A_JATTACK: {
      const id = s[b + F_MOVE] - 1;
      if (id < 0) return "idle0";
      const st = mv(id, M_S) + 2 * s[b + F_SC], act = mv(id, M_A);
      const own = specialKeysOf(id);
      if (own) return pickSpecial(Math.trunc(id / MOVES_PER_STYLE), own, af, st, act, mv(id, M_R));
      const keys = moveKeys(id);
      if (id % MOVES_PER_STYLE === 17 && af <= st) return "super0";
      if (af <= st) return keys[0];
      if (af <= st + act || act === 0) return keys[1];
      return keys[2];
    }
    case A_HITSTUN: {
      if (s[b + F_STUNK] === 2) return "hit_low";
      const by = s[b + F_HITMV] - 1;
      return by >= 0 && mv(by, M_HEIGHT) === H_HIGH ? "hit_high" : "hit_mid";
    }
    case A_BLOCKSTUN: return s[b + F_STUNK] === 2 ? "cblock" : "block";
    case A_FALL: return "fall";
    case A_KNOCKDOWN: {
      const k = s[b + F_KDOWN];
      if (k > 20) return k % 16 < 8 || k > 100 ? "down0" : "down1";
      return k > 10 ? "getup0" : "getup1";
    }
    case A_THROW: return af < 8 ? "throw0" : "throw1";
    case A_THROWN: return "thrown";
    case A_TECHED: return "block";
    default: return "idle0";
  }
}

/** A style's own keyframes of special move `id` (null: the shared ones). */
function specialKeysOf(id: number): SpecialKeys | null {
  const slot = mv(id, M_SLOT);
  return slot > 0 ? STYLE_ART[Math.trunc(id / MOVES_PER_STYLE)]?.specials[slot] ?? null : null;
}

const spread = (keys: readonly string[], i: number, len: number): string =>
  keys[Math.max(0, Math.min(keys.length - 1, Math.trunc((i * keys.length) / Math.max(1, len))))];

/** Startup keys over the startup, active keys over the active frames (or looping every `cycle` frames — a move with no
 *  active frames, like the slip, loops them through its recovery), recovery keys over the recovery. */
function pickSpecial(style: number, k: SpecialKeys, af: number, st: number, act: number, rec: number): PoseId {
  let name: string;
  if (af <= st) name = spread(k.s, af - 1, st);
  else if (af <= st + act || act === 0) {
    const i = af - st - 1;
    name = k.cycle ? k.a[Math.trunc(i / k.cycle) % k.a.length] : spread(k.a, i, act);
  } else name = spread(k.r, af - st - act - 1, rec);
  return styleRef(style, name);
}

/** The keyframes a special shows, in order (the dojo panel's looping preview). */
export function specialPoseIds(style: number, slot: number): PoseId[] {
  const k = STYLE_ART[style]?.specials[slot];
  if (k) return [...k.s, ...k.a, ...(k.cycle ? k.a : []), ...k.r].map((n) => styleRef(style, n));
  const id = style * MOVES_PER_STYLE + 12 + slot;
  return [...moveKeys(id)];
}

/** A style's stance frames (shared idle for Tự do). */
export function stancePoseIds(style: number): PoseId[] {
  const st = STYLE_ART[style]?.stance;
  return st ? st.map((n) => styleRef(style, n)) : ["idle0", "idle1", "idle2", "idle3"];
}

/** The pose itself (an unknown id draws the idle pose). */
export function poseData(id: PoseId, style: number): Pose {
  void style;
  return POSES[id] ?? POSES.idle0;
}
