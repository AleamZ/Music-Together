// v20 Võ đài: how a rig pose is written (shared by poses.ts and v20.2's style-poses.ts). A pose is 14 integer joints in
// a 48 × 64 box, facing right, the feet on row 63; a Spec gives them relative to the hip, the chest and the shoulders.

export const RIG_W = 48;
export const RIG_H = 64;

/** Joint order. "F" is the near side (toward the viewer when facing right), "B" the far side. */
export const J = {
  head: 0, neck: 1, chest: 2, hip: 3, shF: 4, elF: 5, hnF: 6, shB: 7, elB: 8, hnB: 9, knF: 10, ftF: 11, knB: 12, ftB: 13,
} as const;
export const JOINTS = 14;
export type Pose = readonly (readonly [number, number])[];

export type Pt = [number, number];
export type Limb = [number, number, number, number];
export interface Spec {
  /** Hip position. */
  hip: Pt;
  /** Chest (shoulder line) relative to the hip. */
  chest: Pt;
  /** Head centre relative to the chest. */
  head?: Pt;
  /** Near arm: elbow and hand relative to the near shoulder. */
  aF: Limb;
  aB: Limb;
  /** Near leg: knee and foot relative to the hip. */
  lF: Limb;
  lB: Limb;
}

export function build(p: Spec): Pose {
  const fit = (pt: Pt): Pt => [Math.max(1, Math.min(RIG_W - 2, pt[0])), Math.max(1, Math.min(RIG_H - 1, pt[1]))];
  return raw(p).map(fit);
}

function raw(p: Spec): Pt[] {
  const [hx, hy] = p.hip;
  const cx = hx + p.chest[0], cy = hy + p.chest[1];
  const [hdx, hdy] = p.head ?? [1, -9];
  const shF: Pt = [cx + 1, cy + 1], shB: Pt = [cx - 1, cy + 1];
  return [
    [cx + hdx, cy + hdy],
    [cx, cy - 2],
    [cx, cy],
    [hx, hy],
    shF, [shF[0] + p.aF[0], shF[1] + p.aF[1]], [shF[0] + p.aF[2], shF[1] + p.aF[3]],
    shB, [shB[0] + p.aB[0], shB[1] + p.aB[1]], [shB[0] + p.aB[2], shB[1] + p.aB[3]],
    [hx + 1 + p.lF[0], hy + p.lF[1]], [hx + 1 + p.lF[2], hy + p.lF[3]],
    [hx - 1 + p.lB[0], hy + p.lB[1]], [hx - 1 + p.lB[2], hy + p.lB[3]],
  ];
}

// stances: the fists up by the chin; legs apart
export const GUARD_F: Limb = [4, 6, 8, -1];
export const GUARD_B: Limb = [3, 7, 6, 1];
export const STANCE_F: Limb = [4, 11, 5, 23];
export const STANCE_B: Limb = [-4, 11, -6, 23];
export const std = (more: Partial<Spec> = {}): Spec => ({ hip: [23, 40], chest: [1, -15], aF: GUARD_F, aB: GUARD_B, lF: STANCE_F, lB: STANCE_B, ...more });
export const crouchBase = (more: Partial<Spec> = {}): Spec => ({
  hip: [22, 50], chest: [3, -13], aF: GUARD_F, aB: GUARD_B, lF: [8, 4, 6, 13], lB: [-3, 6, -7, 13], ...more,
});
export const air = (more: Partial<Spec> = {}): Spec => ({
  hip: [23, 34], chest: [1, -15], aF: GUARD_F, aB: GUARD_B, lF: [6, 7, 2, 16], lB: [-2, 9, -7, 15], ...more,
});
