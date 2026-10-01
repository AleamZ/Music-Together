// Pure: the Võ đài fight poses on the 3D chibi rig (3D wave 2). Every 2D rig pose (fight/render/poses.ts: the shared
// stances, normals, hits, knockdowns, throws, win/lose, and each style's own stance, normals and special keyframes)
// is converted 1:1 to a 3D `Pose` by reading its joint angles: the 2D rig faces right with y down, so a limb's angle
// from straight-down is its pitch (+ = forward), the near side ("F") is the chibi's right. A fight is then played by
// easing between key poses (`fightPoseAt`).

import { J, POSES, POSE_IDS, type Pose as Pose2D, type PoseId } from "@/lib/game/fight/render/poses";
import { JOINT_LIMITS, REST, type Pose } from "./pose";
import type { FaceExpr } from "./voxel-face";

/** 2D rig: the standing hip row and the leg's height in px (feet on row 63). */
const HIP_ROW = 40, LEG_PX = 23;
/** 3D: the default hip height (14 voxels of 0.06). */
const HIP_3D = 14 * 0.06;

const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.max(lo, Math.min(hi, v));
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/** The angle of a → b from straight down (+ = forward, toward +x in 2D). */
const ang = (p: Pose2D, a: number, b: number) => Math.atan2(p[b][0] - p[a][0], p[b][1] - p[a][1]);

function faceOf(id: PoseId): FaceExpr {
  if (id === "win") return "happy";
  if (/^(hit_|down|fall|thrown|lose)/.test(id)) return "blink";
  if (/^(sp_|super|s\d\.)/.test(id) && !/stance|idle/.test(id)) return "surprised";
  return "open";
}

/** The 3D pose of one 2D pose. */
export function convertPose(p: Pose2D, id: PoseId = ""): Pose {
  const lean = clamp(wrap(Math.atan2(p[J.chest][0] - p[J.hip][0], p[J.hip][1] - p[J.chest][1])), [-1.57, 1.2]);
  const arm = (sh: number, el: number, hn: number) => {
    const up = ang(p, sh, el), fo = ang(p, el, hn);
    return { x: wrap(up - lean), elbow: clamp(wrap(fo - up), JOINT_LIMITS.elbow) };
  };
  const leg = (kn: number, ft: number) => {
    const th = ang(p, J.hip, kn), sh = ang(p, kn, ft);
    const knee = clamp(wrap(th - sh), JOINT_LIMITS.knee);
    // the foot stays flat: the ankle counters the shin's world angle
    return { x: wrap(th - lean), knee, ankle: clamp(th - knee, JOINT_LIMITS.ankle) };
  };
  const aR = arm(J.shF, J.elF, J.hnF), aL = arm(J.shB, J.elB, J.hnB);
  const lR = leg(J.knF, J.ftF), lL = leg(J.knB, J.ftB);
  const headTilt = wrap(Math.atan2(p[J.head][0] - p[J.neck][0], p[J.neck][1] - p[J.head][1]) - Math.atan2(1, 7));
  const guard = aR.elbow > 1.2 ? 0.16 : 0.08;
  return {
    ...REST,
    bob: Math.max(Math.abs(lean) > 1 ? -0.6 : -0.8, ((HIP_ROW - p[J.hip][1]) / LEG_PX) * HIP_3D),
    lean, roll: 0, drop: 0, squash: 0,
    headX: clamp(headTilt - lean * 0.3, [-0.6, 0.6]), headZ: 0,
    armR: { x: aR.x, z: guard }, armL: { x: aL.x, z: guard },
    elbowR: aR.elbow, elbowL: aL.elbow,
    legR: { x: lR.x, z: 0.06 }, legL: { x: lL.x, z: 0.06 },
    kneeR: lR.knee, kneeL: lL.knee, ankleR: lR.ankle, ankleL: lL.ankle,
    face: faceOf(id),
  };
}

/** Every 2D pose id → its 3D pose (1:1 with POSE_IDS). */
export const FIGHT_POSES_3D: Readonly<Record<PoseId, Pose>> = Object.fromEntries(POSE_IDS.map((id) => [id, convertPose(POSES[id], id)]));

/** The 3D pose of a 2D pose id (unknown ids: the idle stance). */
export function fightPose3D(id: PoseId): Pose {
  return FIGHT_POSES_3D[id] ?? FIGHT_POSES_3D.idle0;
}

const mix = (a: number, b: number, k: number) => a + (b - a) * k;
const mixL = (a: { x: number; z: number }, b: { x: number; z: number }, k: number) => ({ x: mix(a.x, b.x, k), z: mix(a.z, b.z, k) });

/** Between two poses (`k` 0…1); the face switches halfway. */
export function lerpPose(a: Pose, b: Pose, k: number): Pose {
  return {
    bob: mix(a.bob, b.bob, k), lean: mix(a.lean, b.lean, k), roll: mix(a.roll, b.roll, k), drop: mix(a.drop, b.drop, k),
    squash: mix(a.squash, b.squash, k), headX: mix(a.headX, b.headX, k), headZ: mix(a.headZ, b.headZ, k),
    armL: mixL(a.armL, b.armL, k), armR: mixL(a.armR, b.armR, k), elbowL: mix(a.elbowL, b.elbowL, k), elbowR: mix(a.elbowR, b.elbowR, k),
    legL: mixL(a.legL, b.legL, k), legR: mixL(a.legR, b.legR, k), kneeL: mix(a.kneeL, b.kneeL, k), kneeR: mix(a.kneeR, b.kneeR, k),
    ankleL: mix(a.ankleL, b.ankleL, k), ankleR: mix(a.ankleR, b.ankleR, k), rod: 0, face: k < 0.5 ? a.face : b.face,
  };
}

/** A sequence of key poses played at `keyS` seconds each (looping): each key holds a little, then eases into the
 *  next. `reduced` shows the middle key, still. */
export function fightPoseAt(ids: readonly PoseId[], t: number, keyS = 0.18, reduced = false): Pose {
  if (ids.length === 0) return fightPose3D("idle0");
  if (reduced) return fightPose3D(ids[Math.floor(ids.length / 2)]);
  const u = Math.max(0, t) / keyS, i = Math.floor(u), f = u - i;
  const a = fightPose3D(ids[i % ids.length]), b = fightPose3D(ids[(i + 1) % ids.length]);
  const h = Math.max(0, Math.min(1, (f - 0.3) / 0.7));
  return lerpPose(a, b, h * h * (3 - 2 * h));
}
