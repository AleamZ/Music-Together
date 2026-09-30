// Pure: the chibi's poses on its joint chains (hips, shoulders, elbows, knees, ankles). A pose is a handful of
// joint angles (radians) and offsets (world units) that the rig applies to its pivots; every action is a closed-form
// function of time, so it is testable and cheap. Joints stay within JOINT_LIMITS.

import type { FaceExpr } from "./voxel-face";

export type CharAct = "idle" | "walk" | "run" | "sit" | "cast" | "bite" | "reel" | "swim" | "ride" | "pedal" | "wave" | "chop" | "cook" | "stretch" | "net_hold" | "net_throw" | "net_pull" | "net_won";
export const CHAR_ACTS: readonly CharAct[] = ["idle", "walk", "run", "sit", "cast", "bite", "reel", "swim", "ride", "pedal", "wave", "chop", "cook", "stretch", "net_hold", "net_throw", "net_pull", "net_won"];
/** Actions that play once from their start (the caller passes the time since the action began, not a running clock):
 *  the cast's throw, then the rod held out while the line waits. */
export const ONE_SHOT_ACTS: ReadonlySet<CharAct> = new Set<CharAct>(["cast", "reel", "net_throw"]);
/** The cast's throw (s): wind-up, snap, follow-through; then the hold. */
export const CAST_S = 0.95;

/** The net's throw (s): the wind-up and twist, the fling (the net leaves the hands at NET_RELEASE_S), then the hold. */
export const NET_THROW_S = 1.0;
export const NET_RELEASE_S = 0.5;

/** The strike (giật cần) when the reel begins, like the 2D rod's STRIKE_MS: whipped back over the shoulder, then down. */
export const STRIKE_S = 0.48;

/** Both hands on the rod (the 2D angler's grip): the left fist follows the right one along the rod, reaching across the
 *  body to the butt behind it, bent a little more; `crank` turns it in a small circle (winding the reel). */
function twoHands(p: Pose, crank = 0): void {
  p.armL.x = p.armR.x + 0.35 + Math.sin(crank) * 0.08;
  p.armL.z = -0.85 + Math.cos(crank) * 0.05;
  p.elbowL = Math.min(2.2, p.elbowR + 0.95 + Math.cos(crank) * 0.15);
}

/** A preview's clock for an action (the dev lab, the wardrobe): a one-shot action replays every 3 s. */
export function previewTime(act: CharAct, t: number): number {
  return ONE_SHOT_ACTS.has(act) ? t % 3 : t;
}

/** The bike's crank angle (radians) at pedalling time `t` (the pedal pose's legs and the bike's cranks share it). */
export function pedalAngle(t: number, phase = 0): number {
  return (t + phase) * Math.PI * 2 * 1.1;
}

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
      // ONE SHOT (t = time since the cast began): wind the rod back over the shoulder, snap it forward, follow through,
      // then hold it out over the water — the rod tip up and forward, breathing, the tip nodding with the float
      const k = Math.max(0, t);
      p.rod = 1;
      p.legL.x = 0.3; p.kneeL = 0.25; p.legR.x = -0.2; p.kneeR = 0.08; p.ankleR = 0.15;
      if (k < CAST_S) {
        const wind = Math.min(1, k / 0.45), snap = k < 0.45 ? 0 : Math.min(1, (k - 0.45) / 0.18), settle = k < 0.63 ? 0 : (k - 0.63) / (CAST_S - 0.63);
        const e = settle * settle * (3 - 2 * settle);
        const swing = k < 0.45 ? -2.5 * wind : k < 0.63 ? -2.5 + 3.7 * snap : 1.2 - 0.95 * e;
        p.armR.x = swing + 0.9; p.armR.z = -0.55;
        p.elbowR = k < 0.45 ? 0.3 + 1.1 * wind : k < 0.63 ? 1.4 - 1.3 * snap : 0.1 + 0.2 * e;
        twoHands(p);
        p.lean = k < 0.45 ? -0.12 * wind : k < 0.63 ? 0.16 * snap : 0.16 - 0.12 * e;
        p.squash = k < 0.45 ? -0.02 * wind : 0.02 * (1 - snap);
        p.headX = k < 0.45 ? -0.1 * wind : 0.08;
        break;
      }
      const b = Math.sin(s * TAU * 0.35), nod = Math.sin(s * TAU * 0.6);
      // the grip at the right hip, the long rod out over the water ~30° up; the left hand resting near the reel
      p.armR.x = 0.75 + nod * 0.03; p.armR.z = -0.6; p.elbowR = 0.7;
      twoHands(p);
      p.lean = 0.04;
      p.bob = b * 0.008 - 0.004;
      p.squash = b * 0.01;
      p.headX = 0.12 + Math.sin(s * TAU * 0.09) * 0.03;
      p.headZ = Math.sin(s * TAU * 0.07) * 0.04;
      break;
    }
    case "bite": {
      // a fish on: leaning back, both hands on the rod, the rod jerking up in quick tugs
      const j = Math.sin(s * TAU * 3.2), tug = Math.max(0, Math.sin(s * TAU * 1.3));
      p.rod = 1;
      p.armR.x = 0.95 + tug * 0.3 + j * 0.05; p.armR.z = -0.6; p.elbowR = 0.9 + tug * 0.15;
      twoHands(p);
      p.lean = -0.14 - tug * 0.06;
      p.legL.x = 0.35; p.kneeL = 0.3; p.legR.x = -0.25; p.kneeR = 0.12; p.ankleR = 0.2;
      p.bob = -0.015 + j * 0.006;
      p.squash = -0.015;
      p.headX = -0.05;
      p.roll = j * 0.02;
      p.face = "happy";
      break;
    }
    case "reel": {
      // the rod held up ~45° in the right hand, the left hand cranking the reel's handle in circles
      // ONE SHOT from the strike (t = since the reel began): the rod whipped back over the shoulder and brought down,
      // then held ~45° while the front hand winds the reel; the rod dips and bobs under the fish's pull
      const k = Math.max(0, t);
      p.armR.z = -0.6;
      if (k < STRIKE_S) {
        const w = Math.sin(Math.PI * Math.min(1, (k / STRIKE_S) * 1.4));
        p.armR.x = 0.9 + w * 1.4; p.elbowR = 0.75 + w * 0.4;
        p.lean = -0.1 - w * 0.12;
        twoHands(p);
      } else {
        const a = s * TAU * 2.2, pullDip = Math.sin(s * TAU * 0.9) * 0.08;
        p.armR.x = 0.9 + pullDip; p.elbowR = 0.75;
        twoHands(p, a);
        p.lean = -0.1;
      }
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
    case "pedal": {
      // on a bicycle: the feet go round with the cranks (each thigh rises and the knee folds as its pedal comes over
      // the top), the hands on the bars, the hips rocking a little with each push; still when the bike stands
      const a = pedalAngle(t, phase), aR = a + Math.PI;
      p.drop = 0.24;
      p.legL.x = 1.02 + Math.cos(a) * 0.3; p.legR.x = 1.02 + Math.cos(aR) * 0.3;
      p.kneeL = 1.32 + Math.cos(a - 0.35) * 0.48; p.kneeR = 1.32 + Math.cos(aR - 0.35) * 0.48;
      p.ankleL = 0.15 + Math.sin(a) * 0.2; p.ankleR = 0.15 + Math.sin(aR) * 0.2;
      p.legL.z = p.legR.z = 0.12;
      p.armL.x = p.armR.x = 1.15; p.armL.z = p.armR.z = 0.12;
      p.elbowL = p.elbowR = 0.5;
      p.lean = 0.18;
      p.roll = Math.sin(a) * 0.035;
      p.bob = Math.abs(Math.sin(a)) * 0.012;
      p.headZ = -p.roll * 0.5;
      break;
    }
    case "stretch": {
      // khởi động (the warm-up by the pond, 4 s a round): arms overhead and a side bend each way, then two squats
      // with the arms out in front
      const k = ((s % 4) + 4) % 4;
      if (k < 2) {
        const u = k % 1, side = k < 1 ? 1 : -1, e = Math.sin(u * Math.PI);
        p.armL.z = p.armR.z = 2.55; p.armL.x = p.armR.x = 0.1;
        p.elbowL = p.elbowR = 0.2 + e * 0.15;
        p.roll = side * e * 0.3;
        p.headZ = side * e * 0.12;
        p.legL.z = p.legR.z = 0.1;
        p.bob = e * 0.02;
        p.squash = e * 0.02;
      } else {
        const u = (k - 2) % 1, e = Math.sin(u * Math.PI) ** 2;
        p.legL.x = p.legR.x = 1.0 * e;
        p.kneeL = p.kneeR = 1.7 * e;
        p.ankleL = p.ankleR = -0.7 * e;
        p.legL.z = p.legR.z = 0.06 + e * 0.1;
        p.drop = 0.34 * e;
        p.lean = 0.32 * e;
        p.armL.x = p.armR.x = 1.45 * e; p.armL.z = p.armR.z = 0.07 + e * 0.05;
        p.elbowL = p.elbowR = 0.1;
        p.headX = -0.2 * e;
        p.squash = -0.02 * e;
      }
      break;
    }
    case "net_hold": {
      // quăng lưới, aiming: feet apart, the body rocking side to side
      const w = Math.sin(s * TAU * 0.9);
      p.legL.x = 0.25; p.legR.x = -0.2; p.legL.z = p.legR.z = 0.14; p.kneeL = p.kneeR = 0.28;
      p.drop = 0.05;
      // both fists together in front of the chest holding the net's gathered top (it hangs from them), swinging
      p.armR.x = 0.55 + w * 0.2; p.armR.z = -0.12; p.elbowR = 0.75;
      p.armL.x = 0.55 + w * 0.2; p.armL.z = -0.12; p.elbowL = 0.75;
      p.lean = 0.12;
      p.roll = w * 0.06;
      p.headX = 0.12;
      break;
    }
    case "net_throw": {
      // ONE SHOT (t = since the throw began): twist back with both arms low on the right, then sweep them forward and up
      // (the net leaves at NET_RELEASE_S), then the arms stay out as the net lands
      const k = Math.max(0, t);
      const wind = Math.min(1, k / 0.4), fling = k < 0.4 ? 0 : Math.min(1, (k - 0.4) / 0.2);
      const e = fling * fling * (3 - 2 * fling);
      p.legL.x = 0.35; p.legR.x = -0.3; p.legL.z = p.legR.z = 0.16;
      p.kneeL = 0.3 + 0.2 * wind * (1 - e); p.kneeR = 0.35 * (1 - e);
      p.drop = 0.1 * wind * (1 - e);
      p.armR.x = -0.6 * wind * (1 - e) + 1.5 * e; p.armR.z = 0.35 + 0.45 * e; p.elbowR = 0.3 - 0.2 * e;
      p.armL.x = -0.3 * wind * (1 - e) + 1.4 * e; p.armL.z = 0.2 + 0.5 * e; p.elbowL = 0.6 - 0.45 * e;
      p.lean = -0.12 * wind * (1 - e) + 0.3 * e;
      p.roll = 0.18 * wind * (1 - e) - 0.08 * e;
      p.headX = 0.1 + 0.1 * e;
      p.squash = -0.03 * wind * (1 - e) + 0.02 * e;
      break;
    }
    case "net_pull": {
      // hauling the net in hand over hand: leaning back, knees bent, the hands pulling in turn
      const a = s * TAU * 1.1, pl = Math.sin(a), pr = Math.sin(a + Math.PI);
      p.legL.x = 0.4; p.legR.x = -0.25; p.legL.z = p.legR.z = 0.14; p.kneeL = 0.45; p.kneeR = 0.3; p.ankleL = -0.2;
      p.drop = 0.1;
      p.armL.x = 1.0 + pl * 0.45; p.armR.x = 1.0 + pr * 0.45; p.armL.z = p.armR.z = 0.12;
      p.elbowL = 0.6 - pl * 0.5; p.elbowR = 0.6 - pr * 0.5;
      p.lean = -0.18 + Math.abs(pl) * 0.04;
      p.roll = pl * 0.03;
      p.headX = 0.08;
      break;
    }
    case "net_won": {
      // the dripping bundle held up high with both hands, a happy bounce
      const b = Math.abs(Math.sin(s * TAU * 1.4));
      p.armL.x = p.armR.x = 2.5; p.armL.z = p.armR.z = 0.25; p.elbowL = p.elbowR = 0.5;
      p.bob = b * 0.05; p.squash = b * 0.02;
      p.lean = -0.08;
      p.headX = -0.25;
      p.face = "happy";
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
