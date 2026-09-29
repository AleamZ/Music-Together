// Pure: the chibi's "skeleton-lite" poses. A pose is a handful of joint angles (radians) and offsets (world units)
// that the rig applies to its pivots; every action is a closed-form function of time, so it is testable and cheap.

import type { FaceExpr } from "./voxel-face";

export type CharAct = "idle" | "walk" | "run" | "sit" | "cast" | "reel" | "swim" | "ride" | "wave";
export const CHAR_ACTS: readonly CharAct[] = ["idle", "walk", "run", "sit", "cast", "reel", "swim", "ride", "wave"];

/** Limb swing: `x` = pitch (forward +), `z` = roll (outward +). */
export interface Limb { x: number; z: number }
export interface Pose {
  /** Whole body up/down (world units) and forward lean (pitch, radians; + = forward). */
  bob: number;
  lean: number;
  /** Body sink (sitting/swimming lowers the hips). */
  drop: number;
  headX: number;
  headZ: number;
  armL: Limb;
  armR: Limb;
  /** Elbow bend (forearm pitch, + = forward); knee bend (+ = the calf folds back). */
  elbowL: number;
  elbowR: number;
  legL: Limb;
  legR: Limb;
  kneeL: number;
  kneeR: number;
  /** A rod in the right hand (cast/reel), 0 = hidden. */
  rod: number;
  /** The face: eyes open, a blink, or happy (^ ^). */
  face: FaceExpr;
}

export const REST: Pose = {
  bob: 0, lean: 0, drop: 0, headX: 0, headZ: 0,
  armL: { x: 0, z: 0.07 }, armR: { x: 0, z: 0.07 }, elbowL: 0, elbowR: 0,
  legL: { x: 0, z: 0.03 }, legR: { x: 0, z: 0.03 }, kneeL: 0, kneeR: 0, rod: 0, face: "open",
};

/** Blinks for 0.14 s every ~3.6 s (per-character phase). */
export function blinking(s: number): boolean {
  const k = ((s % 3.6) + 3.6) % 3.6;
  return k > 3.46;
}

const TAU = Math.PI * 2;

/** The pose for an action at time `t` (seconds). `phase` desynchronises characters; `reduced` = no motion. */
export function poseAt(act: CharAct, t: number, phase = 0, reduced = false): Pose {
  if (reduced) t = 0;
  const p: Pose = { ...REST, armL: { ...REST.armL }, armR: { ...REST.armR }, legL: { ...REST.legL }, legR: { ...REST.legR } };
  const s = t + phase;
  switch (act) {
    case "idle": {
      const b = Math.sin(s * TAU * 0.35);
      p.bob = b * 0.012;
      p.armL.z = p.armR.z = 0.07 + b * 0.02;
      p.elbowL = p.elbowR = 0.08;
      p.headX = Math.sin(s * TAU * 0.11) * 0.04;
      p.headZ = Math.sin(s * TAU * 0.07) * 0.03;
      break;
    }
    case "walk":
    case "run": {
      const run = act === "run";
      const w = Math.sin(s * TAU * (run ? 1.9 : 1.4));
      const amp = run ? 0.9 : 0.55;
      p.legL.x = w * amp; p.legR.x = -w * amp;
      p.legL.z = p.legR.z = 0.02;
      p.kneeL = Math.max(0, -w) * (run ? 1.1 : 0.45);
      p.kneeR = Math.max(0, w) * (run ? 1.1 : 0.45);
      p.armL.x = -w * amp * 0.85; p.armR.x = w * amp * 0.85;
      p.armL.z = p.armR.z = 0.06;
      p.elbowL = p.elbowR = run ? 1.2 : 0.2;
      p.bob = Math.abs(w) * (run ? 0.1 : 0.045);
      p.lean = run ? 0.2 : 0.04;
      p.headX = -p.lean * 0.5 + Math.abs(w) * 0.04;
      p.headZ = w * 0.03;
      break;
    }
    case "sit": {
      p.drop = 0.56;
      p.legL.x = p.legR.x = 1.45;
      p.legL.z = p.legR.z = 0.05;
      p.kneeL = p.kneeR = 1.35;
      p.armL.x = p.armR.x = 0.5; p.elbowL = p.elbowR = 0.4;
      p.bob = Math.sin(s * TAU * 0.3) * 0.008;
      p.headZ = Math.sin(s * TAU * 0.12) * 0.05;
      break;
    }
    case "cast": {
      // wind up behind the head, snap forward, hold (1.6 s loop)
      const k = ((s % 1.6) + 1.6) % 1.6 / 1.6;
      const swing = k < 0.45 ? -2.6 * (k / 0.45) : k < 0.6 ? -2.6 + 3.8 * ((k - 0.45) / 0.15) : 1.2;
      p.armR.x = swing; p.armL.x = swing * 0.7;
      p.elbowR = p.elbowL = 0.3;
      p.lean = k < 0.45 ? -0.1 : 0.15;
      p.legL.x = 0.25; p.legR.x = -0.2;
      p.rod = 1;
      break;
    }
    case "reel": {
      const r = Math.sin(s * TAU * 2.2);
      p.armR.x = 0.9 + r * 0.25; p.elbowR = 0.6 + r * 0.3;
      p.armL.x = 1.0; p.elbowL = 0.5;
      p.lean = -0.08;
      p.legL.x = 0.2; p.legR.x = -0.15;
      p.rod = 1;
      break;
    }
    case "swim": {
      const w = Math.sin(s * TAU * 0.9);
      p.drop = 0.85;
      p.lean = 0.5;
      p.armL.x = 2.2 + w * 0.9; p.armR.x = 2.2 - w * 0.9;
      p.armL.z = p.armR.z = 0.5;
      p.legL.x = w * 0.5; p.legR.x = -w * 0.5;
      p.bob = Math.sin(s * TAU * 0.5) * 0.05;
      p.headX = -0.35;
      break;
    }
    case "ride": {
      p.drop = 0.24;
      p.legL.x = p.legR.x = 1.2;
      p.legL.z = p.legR.z = 0.35;
      p.kneeL = p.kneeR = 1.0;
      p.armL.x = p.armR.x = 1.1; p.elbowL = p.elbowR = 0.3;
      p.bob = Math.abs(Math.sin(s * TAU * 1.2)) * 0.05;
      break;
    }
    case "wave": {
      const w = Math.sin(s * TAU * 1.8);
      p.armR.x = 0.2; p.armR.z = 2.5; p.elbowR = 0.4 + w * 0.45;
      p.headZ = w * 0.06;
      p.bob = Math.abs(w) * 0.02;
      p.face = "happy";
      break;
    }
  }
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
