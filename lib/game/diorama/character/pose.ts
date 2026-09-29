// Pure: the chibi's poses on its joint chains (hips, shoulders, elbows, knees, ankles). A pose is a handful of
// joint angles (radians) and offsets (world units) that the rig applies to its pivots; every action is a closed-form
// function of time, so it is testable and cheap. Joints stay within JOINT_LIMITS.

import type { FaceExpr } from "./voxel-face";

export type CharAct = "idle" | "walk" | "run" | "sit" | "cast" | "reel" | "swim" | "ride" | "wave" | "chop" | "cook";
export const CHAR_ACTS: readonly CharAct[] = ["idle", "walk", "run", "sit", "cast", "reel", "swim", "ride", "wave", "chop", "cook"];

/** Limb swing: `x` = pitch (forward +), `z` = roll (outward +). */
export interface Limb { x: number; z: number }
export interface Pose {
  /** Whole body up/down (world units), forward lean (pitch, radians; + = forward) and side roll (hip sway). */
  bob: number;
  lean: number;
  roll: number;
  /** Body sink (sitting/swimming lowers the hips; measured on the default leg length). */
  drop: number;
  /** Squash (−) / stretch (+) of the body, subtle (±0.05). */
  squash: number;
  headX: number;
  headZ: number;
  armL: Limb;
  armR: Limb;
  /** Elbow bend (forearm pitch, + = forward); knee bend (+ = the shin folds back); ankle (+ = toes down). */
  elbowL: number;
  elbowR: number;
  legL: Limb;
  legR: Limb;
  kneeL: number;
  kneeR: number;
  ankleL: number;
  ankleR: number;
  /** A rod in the right hand (cast/reel), 0 = hidden. */
  rod: number;
  /** The face: eyes open, a blink, or happy (^ ^). */
  face: FaceExpr;
}

export const REST: Pose = {
  bob: 0, lean: 0, roll: 0, drop: 0, squash: 0, headX: 0, headZ: 0,
  armL: { x: 0, z: 0.07 }, armR: { x: 0, z: 0.07 }, elbowL: 0, elbowR: 0,
  legL: { x: 0, z: 0.03 }, legR: { x: 0, z: 0.03 }, kneeL: 0, kneeR: 0, ankleL: 0, ankleR: 0, rod: 0, face: "open",
};

/** Joint limits (radians) every pose stays within: elbows and knees only fold one way. */
export const JOINT_LIMITS = { elbow: [0, 2.4], knee: [0, 2.5], ankle: [-0.7, 0.9] } as const;

/** Blinks for 0.14 s every ~3.6 s (per-character phase). */
export function blinking(s: number): boolean {
  const k = ((s % 3.6) + 3.6) % 3.6;
  return k > 3.46;
}

const TAU = Math.PI * 2;
const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.max(lo, Math.min(hi, v));

/** One leg's stride at gait phase `a` (radians): hip swing, knee (folds on the forward swing, soft on contact) and
 *  ankle (heel strike toes-up, push-off toes-down). `amp` = hip swing, `lift` = the swing knee's fold. */
function stride(a: number, amp: number, lift: number, soft: number): { hip: number; knee: number; ankle: number } {
  const hip = Math.sin(a) * amp;
  const swing = Math.cos(a);                                                   // > 0: the leg is travelling forward
  const knee = soft + Math.max(0, swing) * lift * Math.max(0, 1 - Math.sin(a) * 0.6);
  const ankle = Math.sin(a) > 0.7 ? -0.25 * (Math.sin(a) - 0.7) / 0.3 : Math.sin(a) < -0.5 ? 0.35 * (-Math.sin(a) - 0.5) / 0.5 : 0;
  return { hip, knee, ankle };
}

/** The pose for an action at time `t` (seconds). `phase` desynchronises characters; `reduced` = no motion. */
export function poseAt(act: CharAct, t: number, phase = 0, reduced = false): Pose {
  if (reduced) t = 0;
  const p: Pose = { ...REST, armL: { ...REST.armL }, armR: { ...REST.armR }, legL: { ...REST.legL }, legR: { ...REST.legR } };
  const s = t + phase;
  switch (act) {
    case "idle": {
      // breathing, a slow weight shift from foot to foot (the loaded knee straight, the other relaxed), soft arms
      const b = Math.sin(s * TAU * 0.35), w = Math.sin(s * TAU * 0.09);
      p.bob = b * 0.01 - 0.004;
      p.squash = b * 0.012;
      p.roll = w * 0.025;
      p.kneeL = 0.06 + Math.max(0, w) * 0.1; p.kneeR = 0.06 + Math.max(0, -w) * 0.1;
      p.legL.x = p.kneeL * 0.35; p.legR.x = p.kneeR * 0.35;
      p.ankleL = -p.legL.x * 0.5; p.ankleR = -p.legR.x * 0.5;
      p.armL.z = p.armR.z = 0.07 + b * 0.02;
      p.armL.x = p.armR.x = 0.04;
      p.elbowL = p.elbowR = 0.14 + b * 0.03;
      p.headX = Math.sin(s * TAU * 0.11) * 0.04;
      p.headZ = Math.sin(s * TAU * 0.07) * 0.03 - p.roll * 0.5;
      break;
    }
    case "walk":
    case "run": {
      const run = act === "run";
      const a = s * TAU * (run ? 1.9 : 1.4);
      const L = stride(a, run ? 0.85 : 0.5, run ? 1.55 : 0.75, run ? 0.2 : 0.06), R = stride(a + Math.PI, run ? 0.85 : 0.5, run ? 1.55 : 0.75, run ? 0.2 : 0.06);
      p.legL.x = L.hip; p.legR.x = R.hip;
      p.kneeL = L.knee; p.kneeR = R.knee;
      p.ankleL = L.ankle; p.ankleR = R.ankle;
      p.legL.z = p.legR.z = 0.02;
      // arms swing against the legs; elbows bent a little walking, ~90° running (pumping)
      const w = Math.sin(a);
      p.armL.x = -w * (run ? 0.8 : 0.45); p.armR.x = w * (run ? 0.8 : 0.45);
      p.armL.z = p.armR.z = run ? 0.12 : 0.06;
      p.elbowL = run ? 1.45 + w * 0.2 : 0.22 + Math.max(0, -w) * 0.25;
      p.elbowR = run ? 1.45 - w * 0.2 : 0.22 + Math.max(0, w) * 0.25;
      const contact = Math.abs(Math.cos(a));                                        // 1 at mid-stride (both feet loaded)
      p.bob = (1 - contact) * (run ? 0.1 : 0.04) - (run ? 0.02 : 0.01);
      p.squash = (run ? 0.04 : 0.018) * ((1 - contact) - 0.5);
      p.lean = run ? 0.22 : 0.05;
      p.roll = w * (run ? 0.02 : 0.03);
      p.headX = -p.lean * 0.5 + (1 - contact) * 0.03;
      p.headZ = -p.roll * 0.6;
      break;
    }
    case "sit": {
      // thighs level, knees at 90°, feet flat, hands resting on the lap
      p.drop = 0.56;
      p.legL.x = p.legR.x = 1.64;
      p.legL.z = p.legR.z = 0.06;
      p.kneeL = p.kneeR = 1.54;
      p.ankleL = p.ankleR = 0;
      p.armL.x = p.armR.x = 0.28; p.armL.z = p.armR.z = 0.14;
      p.elbowL = p.elbowR = 1.0;
      p.bob = Math.sin(s * TAU * 0.3) * 0.006;
      p.squash = Math.sin(s * TAU * 0.3) * 0.01;
      p.headZ = Math.sin(s * TAU * 0.12) * 0.05;
      break;
    }
    case "cast": {
      // wind up behind the head (elbow folded), snap forward (the elbow whips straight), hold (1.6 s loop)
      const k = ((s % 1.6) + 1.6) % 1.6 / 1.6;
      const wind = Math.min(1, k / 0.45), snap = k < 0.45 ? 0 : Math.min(1, (k - 0.45) / 0.15);
      const swing = k < 0.45 ? -2.5 * wind : -2.5 + 3.7 * snap;
      p.armR.x = swing; p.armL.x = 0.4 + swing * 0.25;
      p.elbowR = k < 0.45 ? 0.3 + 1.1 * wind : 1.4 - 1.3 * snap;
      p.elbowL = 0.8;
      p.lean = k < 0.45 ? -0.12 * wind : 0.16 * snap;
      p.legL.x = 0.3; p.kneeL = 0.25; p.legR.x = -0.2; p.kneeR = 0.08; p.ankleR = 0.15;
      p.squash = k < 0.45 ? -0.02 * wind : 0.02 * (1 - snap);
      p.rod = 1;
      break;
    }
    case "reel": {
      // the rod held forward, the right forearm cranking in circles at the elbow
      const r = Math.sin(s * TAU * 2.2), c = Math.cos(s * TAU * 2.2);
      p.armR.x = 0.95 + r * 0.18; p.elbowR = 0.75 + c * 0.35;
      p.armL.x = 1.05; p.elbowL = 0.55;
      p.lean = -0.1;
      p.legL.x = 0.25; p.kneeL = 0.2; p.legR.x = -0.15; p.kneeR = 0.06;
      p.rod = 1;
      break;
    }
    case "swim": {
      // crawl: arms reach straight, pull, recover with a bent elbow; a flutter kick with soft knees and pointed toes
      const w = Math.sin(s * TAU * 0.9), c = Math.cos(s * TAU * 0.9);
      p.drop = 0.85;
      p.lean = 0.5;
      p.armL.x = 2.2 + w * 0.9; p.armR.x = 2.2 - w * 0.9;
      p.elbowL = 0.15 + Math.max(0, c) * 0.9; p.elbowR = 0.15 + Math.max(0, -c) * 0.9;
      p.armL.z = p.armR.z = 0.5;
      const k = Math.sin(s * TAU * 1.8);
      p.legL.x = k * 0.35; p.legR.x = -k * 0.35;
      p.kneeL = 0.15 + Math.max(0, k) * 0.35; p.kneeR = 0.15 + Math.max(0, -k) * 0.35;
      p.ankleL = p.ankleR = 0.7;
      p.bob = Math.sin(s * TAU * 0.5) * 0.05;
      p.headX = -0.35;
      break;
    }
    case "ride": {
      // astride a bike or moto: knees bent up, feet on the pegs, hands forward on the bars
      const b = Math.abs(Math.sin(s * TAU * 1.2));
      p.drop = 0.24;
      p.legL.x = p.legR.x = 1.25;
      p.legL.z = p.legR.z = 0.32;
      p.kneeL = p.kneeR = 1.55;
      p.ankleL = p.ankleR = 0.2;
      p.armL.x = p.armR.x = 1.15; p.armL.z = p.armR.z = 0.12;
      p.elbowL = p.elbowR = 0.5;
      p.lean = 0.12;
      p.bob = b * 0.04;
      p.squash = -b * 0.015;
      break;
    }
    case "wave": {
      // the right arm up and out, the forearm waving from the elbow
      const w = Math.sin(s * TAU * 1.8);
      p.armR.x = 0.25; p.armR.z = 2.45; p.elbowR = 0.55 + w * 0.5;
      p.elbowL = 0.15;
      p.kneeL = 0.08;
      p.roll = 0.03;
      p.headZ = w * 0.06;
      p.bob = Math.abs(w) * 0.02;
      p.face = "happy";
      break;
    }
    case "chop": {
      // 0096 Tiều phu: both arms raised over the right shoulder, then a hard swing down and across (0.8 s a stroke)
      const k = (s / 0.8) % 1;
      const up = k < 0.6 ? k / 0.6 : 1 - (k - 0.6) / 0.4;                   // slow wind-up, fast strike
      const e = up * up * (3 - 2 * up);
      p.armR.x = -0.4 + e * 2.9; p.armR.z = 0.35 - e * 0.1;
      p.armL.x = -0.3 + e * 2.7; p.armL.z = 0.15 + e * 0.2;
      p.elbowR = 0.3 + e * 0.4; p.elbowL = 0.4 + e * 0.4;
      p.lean = 0.28 - e * 0.3;
      p.kneeL = 0.2; p.kneeR = 0.14;
      p.legL.x = 0.18; p.legR.x = -0.12;
      p.bob = -0.02 - (1 - e) * 0.02;
      p.headX = 0.1 - e * 0.12;
      break;
    }
    case "cook": {
      // 0096 Đầu bếp: leaning over the pot, the right hand stirring small circles, the left steadying it
      const a = s * TAU * 1.1;
      p.lean = 0.22;
      p.armR.x = 0.85 + Math.sin(a) * 0.18; p.armR.z = 0.25 + Math.cos(a) * 0.15; p.elbowR = 1.0 + Math.cos(a) * 0.2;
      p.armL.x = 0.7; p.armL.z = 0.2; p.elbowL = 1.1;
      p.kneeL = 0.08; p.kneeR = 0.08;
      p.headX = 0.2;
      p.bob = Math.sin(a * 2) * 0.004;
      break;
    }
  }
  p.elbowL = clamp(p.elbowL, JOINT_LIMITS.elbow); p.elbowR = clamp(p.elbowR, JOINT_LIMITS.elbow);
  p.kneeL = clamp(p.kneeL, JOINT_LIMITS.knee); p.kneeR = clamp(p.kneeR, JOINT_LIMITS.knee);
  p.ankleL = clamp(p.ankleL, JOINT_LIMITS.ankle); p.ankleR = clamp(p.ankleR, JOINT_LIMITS.ankle);
  if (p.face === "open" && !reduced && blinking(s)) p.face = "blink";
  return p;
}
/** The yaw (radians, about +Y) of a model facing +Z that looks along map direction (dx, dy): map +y is world +z. */
export function yawOf(dx: number, dy: number): number {
  return Math.atan2(dx, dy);
}

/** The model's yaw for a 2D facing. */
export const FACING_YAW = { down: 0, right: Math.PI / 2, up: Math.PI, left: -Math.PI / 2 } as const;

/** Wraps an angle to (-π, π]. */
export function wrapAngle(a: number): number {
  a = ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return a === -Math.PI ? Math.PI : a;
}

/** Turns `from` toward `to` the short way round, at most `rate`·dt radians (a smooth turn), exact on arrival. */
export function turnToward(from: number, to: number, dt: number, rate = 12): number {
  const d = wrapAngle(to - from);
  const step = rate * Math.max(0, dt);
  if (Math.abs(d) <= step) return wrapAngle(to);
  return wrapAngle(from + Math.sign(d) * step);
}

/** Picks the locomotion action from a speed (map px/s): idle under 8, run above 1.5× the walk (70 px/s). */
export function locomotion(speedPx: number): CharAct {
  return speedPx < 8 ? "idle" : speedPx > 105 ? "run" : "walk";
}
