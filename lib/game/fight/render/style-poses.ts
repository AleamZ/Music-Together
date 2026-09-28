// v20.2 Võ đường: each style's own look on the rig (spec §v20.1 "Poses": 2 stance frames per style and 3–5 keyframes
// per special and super; plan ruling P20). Muay Thai's high guard bounce, Boxing's bob, Karate's front stance,
// Taekwondo's side bounce, Judo's grip stance, Vịnh Xuân's centre-line hands, Vovinam's trung bình tấn; and every special
// drawn as what it is (a flying knee, a shoulder throw, chain punches…). Boxing's kicks are body punches in the engine,
// so its kick normals are drawn as punches. poses.ts picks these by (action, move, action frame) — still a pure
// function of the state. A name starting with "~" is a shared pose of poses.ts.

import { MV_HK, MV_JHK, MV_JLK, MV_LK } from "../moves";
import { air, crouchBase, std, type Spec } from "./pose-kit";

/** A special's keyframes over its startup, active and recovery frames (spread evenly; `cycle`: the active keys loop
 *  every `cycle` frames — chain punches, a flurry). */
export interface SpecialKeys { s: string[]; a: string[]; r: string[]; cycle?: number }

export interface StyleArt {
  poses: Record<string, Spec>;
  /** The two idle frames. */
  stance: [string, string];
  /** By special slot (1–4, 5 = Tuyệt kỹ). */
  specials: Record<number, SpecialKeys>;
  /** Normals drawn differently (by move index): startup, active, recovery. */
  normals?: Partial<Record<number, [string, string, string]>>;
}

const vovinam: StyleArt = {
  poses: {
    st0: { hip: [23, 43], chest: [1, -15], aF: [5, 4, 10, -1], aB: [-2, 7, 1, 9], lF: [7, 9, 10, 20], lB: [-7, 9, -10, 20] },
    st1: { hip: [23, 44], chest: [1, -15], aF: [5, 4, 10, 0], aB: [-2, 7, 1, 9], lF: [7, 9, 10, 19], lB: [-7, 9, -10, 19] },
    s1a: std({ hip: [22, 42], chest: [-1, -15], aF: [-3, 5, -4, 1], lF: [6, 10, 9, 21], lB: [-6, 10, -9, 21] }),
    s1b: { hip: [27, 43], chest: [4, -14], head: [2, -9], aF: [8, -1, 16, -1], aB: [-3, 6, -6, 9], lF: [8, 8, 13, 20], lB: [-8, 9, -15, 20] },
    s2a: std({ chest: [-3, -15], head: [-2, -9], lF: [6, 4, 2, 12], lB: [-3, 11, -4, 23] }),
    s2b: std({ hip: [22, 40], chest: [-6, -13], head: [-3, -8], lF: [8, -2, 18, -4], lB: [-2, 11, -3, 23], aF: [-3, 4, -6, 8], aB: [-4, 5, -8, 6] }),
    s3a: crouchBase({ aF: [3, 4, 5, -1] }),
    s3b: std({ hip: [23, 37], chest: [2, -16], aF: [3, -8, 5, -18], aB: [-2, 5, -4, 8], lF: [5, 9, 4, 20], lB: [-2, 11, -4, 26] }),
    s4a: air({ hip: [23, 30], lF: [7, 4, 4, 12], lB: [-1, 6, -5, 12], aF: [3, -6, 6, -12], aB: [2, -5, 4, -11] }),
    s4b: air({ hip: [22, 32], chest: [-8, -10], head: [-5, -6], lF: [9, -2, 19, -1], lB: [8, 3, 18, 4], aF: [-4, -4, -8, -2], aB: [-3, -3, -7, -1] }),
    tka: crouchBase({ hip: [23, 48], chest: [2, -13], aF: [2, -4, 4, -10], aB: [1, -4, 3, -9] }),
    tkb: air({ hip: [20, 28], chest: [-7, -11], head: [-4, -7], lF: [9, -5, 19, -7], lB: [9, -1, 19, -2], aF: [-4, -2, -9, -1], aB: [-3, -1, -8, 0] }),
  },
  stance: ["st0", "st1"],
  specials: {
    1: { s: ["s1a"], a: ["s1b"], r: ["s1b", "st0"] },
    2: { s: ["s2a"], a: ["s2b"], r: ["~hk2"] },
    3: { s: ["s3a"], a: ["s3b"], r: ["~land"] },
    4: { s: ["s4a"], a: ["s4b"], r: ["s4b", "~land"] },
    5: { s: ["tka"], a: ["tkb"], r: ["tkb", "~land"] },
  },
};

const muaythai: StyleArt = {
  poses: {
    st0: std({ chest: [0, -15], aF: [4, 3, 6, -6], aB: [3, 4, 4, -5], lF: [4, 11, 6, 23], lB: [-4, 11, -5, 23] }),
    st1: std({ hip: [23, 39], chest: [0, -15], aF: [4, 3, 6, -6], aB: [3, 4, 4, -5], lF: [5, 10, 7, 22], lB: [-4, 11, -5, 24] }),
    s1a: std({ chest: [-1, -15], aF: [1, -8, -3, -4], aB: [3, 4, 4, -5] }),
    s1b: std({ hip: [24, 41], chest: [4, -13], head: [2, -8], aF: [6, -3, 3, 3], aB: [3, 4, 4, -5], lF: [5, 10, 7, 22], lB: [-5, 10, -7, 22] }),
    s2a: std({ hip: [23, 42], aF: [4, -4, 6, -10], lF: [5, 9, 7, 21], lB: [-5, 9, -7, 21] }),
    s2b: air({ hip: [25, 30], chest: [2, -15], lF: [8, -3, 6, 6], lB: [-2, 9, -6, 15], aF: [3, -6, 6, -12], aB: [2, -6, 5, -11] }),
    s3a: crouchBase({ aF: [2, 5, 3, 0] }),
    s3b: std({ hip: [23, 38], chest: [1, -16], aF: [3, -9, -1, -5], lF: [5, 10, 5, 25], lB: [-3, 11, -4, 25] }),
    s4a: std({ chest: [3, -15], aF: [6, -3, 11, -6], aB: [5, -2, 10, -5] }),
    s4b: std({ chest: [4, -14], aF: [6, -3, 11, -6], aB: [5, -2, 10, -5], lF: [8, -2, 7, 7], lB: [-3, 11, -4, 23] }),
    tka: std({ chest: [2, -15], aF: [5, -4, 10, -7], aB: [4, -3, 9, -6], lF: [8, -1, 6, 8] }),
    tkb: std({ hip: [24, 40], chest: [4, -14], aF: [6, -4, 2, 1], aB: [3, 4, 4, -5], lB: [-4, 11, -5, 23] }),
  },
  stance: ["st0", "st1"],
  specials: {
    1: { s: ["s1a"], a: ["s1b"], r: ["s1b", "st0"] },
    2: { s: ["s2a"], a: ["s2b"], r: ["~land"] },
    3: { s: ["s3a"], a: ["s3b"], r: ["~land"] },
    4: { s: ["s4a"], a: ["s4b"], r: ["s4b", "s4a", "st0"] },
    5: { s: ["~super0"], a: ["tka", "tkb"], r: ["tka", "tkb", "tka", "st0"], cycle: 3 },
  },
};

const karate: StyleArt = {
  poses: {
    st0: std({ hip: [22, 42], chest: [1, -15], aF: [6, 2, 11, 1], aB: [-2, 7, 0, 9], lF: [8, 8, 12, 21], lB: [-6, 10, -11, 21] }),
    st1: std({ hip: [22, 43], chest: [1, -15], aF: [6, 2, 11, 1], aB: [-2, 7, 0, 9], lF: [8, 8, 12, 20], lB: [-6, 10, -11, 20] }),
    s1a: std({ hip: [21, 42], chest: [-1, -15], aF: [-3, 6, -4, 2], aB: [3, 5, 6, 1], lF: [6, 10, 9, 21], lB: [-6, 10, -9, 21] }),
    s1b: { hip: [27, 43], chest: [3, -14], head: [2, -9], aF: [8, 0, 17, 0], aB: [-3, 6, -5, 9], lF: [9, 8, 14, 20], lB: [-9, 9, -15, 20] },
    s2a: std({ chest: [-2, -15], lF: [7, 3, 4, 11], lB: [-3, 11, -4, 23] }),
    s2b: std({ hip: [22, 40], chest: [-5, -13], head: [-3, -8], lF: [9, -5, 18, -9], lB: [-2, 11, -3, 23], aF: [-2, 5, -5, 9] }),
    s3a: crouchBase({ aF: [3, 5, 5, 2] }),
    s3b: std({ hip: [23, 37], chest: [3, -16], aF: [4, -7, 7, -16], lF: [5, 10, 4, 26], lB: [-3, 11, -4, 26] }),
    s4a: std({ hip: [22, 43], chest: [0, -15], aF: [-1, -9, 3, -17], aB: [-3, 6, -5, 9], lF: [7, 9, 10, 20], lB: [-7, 9, -10, 20] }),
    s4b: std({ hip: [23, 46], chest: [4, -13], head: [2, -8], aF: [6, -1, 12, 6], aB: [-3, 5, -6, 8], lF: [7, 8, 11, 17], lB: [-7, 8, -11, 17] }),
    tka: std({ hip: [21, 43], chest: [-2, -15], aF: [-5, 3, -8, -1], aB: [4, 4, 8, 1], lF: [7, 9, 10, 20], lB: [-7, 9, -11, 20] }),
    tkb: { hip: [27, 44], chest: [5, -13], head: [3, -8], aF: [8, -1, 18, -1], aB: [-4, 6, -6, 9], lF: [10, 7, 15, 19], lB: [-10, 8, -17, 19] },
  },
  stance: ["st0", "st1"],
  specials: {
    1: { s: ["s1a"], a: ["s1b"], r: ["s1b", "st0"] },
    2: { s: ["s2a"], a: ["s2b"], r: ["~hk2"] },
    3: { s: ["s3a"], a: ["s3b"], r: ["~land"] },
    4: { s: ["s4a"], a: ["s4b"], r: ["s4b", "st0"] },
    5: { s: ["tka"], a: ["tkb"], r: ["tkb", "tkb", "st0"] },
  },
};

const taekwondo: StyleArt = {
  poses: {
    st0: std({ hip: [23, 39], chest: [0, -15], aF: [4, 6, 7, 2], aB: [2, 7, 3, 4], lF: [5, 11, 7, 24], lB: [-5, 11, -7, 24] }),
    st1: std({ hip: [23, 41], chest: [0, -15], aF: [4, 6, 7, 2], aB: [2, 7, 3, 4], lF: [5, 10, 7, 22], lB: [-5, 10, -7, 22] }),
    s1a: std({ chest: [-2, -15], lF: [6, 3, 3, 11], lB: [-3, 11, -4, 23] }),
    s1b: std({ chest: [-5, -14], head: [-3, -9], lF: [7, -2, 17, -2], lB: [-2, 11, -3, 23], aF: [2, 6, 4, 2] }),
    s2a: std({ chest: [-3, -15], head: [-3, -9], aF: [-3, 5, -6, 8], lF: [5, 5, 1, 13] }),
    s2b: std({ hip: [22, 40], chest: [-7, -12], head: [-4, -8], lF: [7, -7, 17, -13], lB: [-1, 11, -2, 23], aF: [-4, 4, -8, 7] }),
    s3a: crouchBase({ lF: [7, 5, 6, 13] }),
    s3b: std({ hip: [22, 38], chest: [-5, -14], head: [-3, -9], lF: [4, -10, 8, -20], lB: [-2, 11, -3, 25], aF: [-3, 4, -6, 7] }),
    s4a: std({ chest: [-2, -15], lF: [7, 1, 6, 11] }),
    s4b: std({ chest: [-5, -14], lF: [8, -1, 17, -1] }),
    s4c: std({ chest: [-6, -13], head: [-3, -9], lF: [7, -6, 16, -11] }),
    s4d: std({ chest: [-3, -15], lF: [8, 6, 16, 12] }),
    tka: crouchBase({ hip: [23, 48], aF: [3, -3, 5, -9] }),
    tkb: air({ hip: [21, 28], chest: [-7, -11], head: [-4, -7], lF: [9, -3, 19, -5], lB: [-3, 8, -7, 14], aF: [-4, -2, -8, 0] }),
    tkc: air({ hip: [21, 28], chest: [-7, -11], head: [-4, -7], lF: [-3, 8, -7, 14], lB: [9, -3, 19, -5], aF: [-4, -2, -8, 0] }),
  },
  stance: ["st0", "st1"],
  specials: {
    1: { s: ["s1a"], a: ["s1b"], r: ["~hk2"] },
    2: { s: ["s2a"], a: ["s2b"], r: ["s2b", "~hk2"] },
    3: { s: ["s3a"], a: ["s3b"], r: ["~land"] },
    4: { s: ["s4a"], a: ["s4b", "s4c", "s4d"], r: ["~hk2"], cycle: 4 },
    5: { s: ["tka"], a: ["tkb", "tkc"], r: ["tkb", "~land"], cycle: 4 },
  },
};

const boxing: StyleArt = {
  poses: {
    st0: std({ hip: [23, 41], chest: [2, -15], aF: [4, 4, 6, -4], aB: [3, 5, 4, -3], lF: [4, 11, 5, 22], lB: [-4, 11, -6, 22] }),
    st1: std({ hip: [23, 43], chest: [3, -13], head: [1, -8], aF: [4, 4, 6, -4], aB: [3, 5, 4, -3], lF: [5, 10, 6, 20], lB: [-4, 10, -6, 20] }),
    jab0: std({ hip: [23, 42], chest: [2, -14], aF: [3, 5, 5, 1], lF: [5, 10, 7, 21], lB: [-5, 10, -7, 21] }),
    jab1: std({ hip: [23, 42], chest: [3, -14], aF: [6, 3, 13, 4], lF: [5, 10, 7, 21], lB: [-5, 10, -7, 21] }),
    bhook0: std({ hip: [23, 42], chest: [-1, -14], aF: [-2, 6, -3, 3], lF: [5, 10, 7, 21], lB: [-5, 10, -7, 21] }),
    bhook1: std({ hip: [23, 43], chest: [4, -13], head: [2, -8], aF: [6, 1, 10, 6], lF: [5, 10, 7, 20], lB: [-5, 10, -7, 20] }),
    jpunch: air({ aF: [6, 4, 12, 6] }),
    jhpunch: air({ aF: [6, 6, 13, 10], chest: [3, -14] }),
    s1a: std({ hip: [22, 42], chest: [-1, -15], aF: [-3, 5, -3, 1], lF: [5, 10, 7, 21], lB: [-5, 10, -7, 21] }),
    s1b: { hip: [27, 43], chest: [5, -13], head: [3, -8], aF: [8, -2, 17, -2], aB: [3, 5, 4, -3], lF: [9, 8, 14, 20], lB: [-8, 9, -14, 20] },
    s2a: std({ hip: [22, 44], chest: [-6, -12], head: [-3, -8], aF: [2, 4, 4, -4], aB: [1, 5, 2, -3], lF: [6, 9, 9, 19], lB: [-4, 9, -6, 19] }),
    s2b: std({ hip: [23, 46], chest: [4, -11], head: [3, -7], lF: [6, 8, 9, 17], lB: [-4, 8, -6, 17] }),
    s3a: crouchBase({ chest: [3, -12], aF: [2, 6, 4, 3] }),
    s3b: std({ hip: [23, 39], chest: [3, -16], aF: [5, 2, 8, -10], lF: [5, 10, 5, 24], lB: [-3, 11, -5, 24] }),
    s4a: std({ chest: [4, -14], aF: [7, -1, 11, -4], aB: [3, 5, 4, -3] }),
    s4b: std({ chest: [-2, -14], aF: [3, 5, 5, 1], aB: [7, 0, 12, -3] }),
    tka: std({ hip: [21, 42], chest: [-4, -14], head: [-2, -9], aF: [-5, 3, -8, -2], lF: [6, 10, 9, 21], lB: [-6, 10, -9, 21] }),
    tkb: { hip: [27, 43], chest: [6, -12], head: [3, -8], aF: [8, -5, 17, -3], aB: [2, 6, 3, 1], lF: [10, 8, 15, 20], lB: [-8, 9, -14, 20] },
  },
  stance: ["st0", "st1"],
  specials: {
    1: { s: ["s1a"], a: ["s1b"], r: ["s1b", "st0"] },
    // the slip has no active frames: its recovery weaves (the "active" keys cover it)
    2: { s: ["s2a"], a: ["s2a", "s2b"], r: ["st0"], cycle: 5 },
    3: { s: ["s3a"], a: ["s3b"], r: ["~land"] },
    4: { s: ["st0"], a: ["s4a", "s4b"], r: ["st0"], cycle: 4 },
    5: { s: ["tka"], a: ["tkb"], r: ["tkb", "tkb", "st0"] },
  },
  normals: {
    [MV_LK]: ["jab0", "jab1", "jab0"],
    [MV_HK]: ["bhook0", "bhook1", "bhook0"],
    [MV_JLK]: ["~jump1", "jpunch", "~jump2"],
    [MV_JHK]: ["~jump1", "jhpunch", "~jump2"],
  },
};

const judo: StyleArt = {
  poses: {
    st0: std({ hip: [23, 42], chest: [3, -14], aF: [6, 4, 11, 3], aB: [5, 5, 10, 5], lF: [5, 10, 6, 21], lB: [-5, 10, -7, 21] }),
    st1: std({ hip: [23, 42], chest: [3, -14], aF: [6, 3, 11, 2], aB: [5, 4, 10, 4], lF: [5, 10, 7, 21], lB: [-5, 10, -6, 21] }),
    s1a: std({ chest: [4, -14], aF: [6, 1, 12, 0], aB: [6, 2, 11, 1] }),
    s1b: std({ hip: [25, 44], chest: [-2, -12], head: [-2, -8], aF: [-3, -5, -6, -11], aB: [-2, -4, -5, -10], lF: [6, 8, 9, 19], lB: [-5, 8, -8, 19] }),
    s1c: std({ hip: [24, 43], chest: [7, -10], head: [4, -6], aF: [6, 4, 10, 9], aB: [5, 5, 9, 10], lF: [6, 9, 9, 20], lB: [-6, 9, -9, 20] }),
    s2a: std({ chest: [-2, -15], aF: [5, 3, 9, 2], lF: [5, 9, 6, 21] }),
    s2b: std({ hip: [22, 41], chest: [-5, -14], head: [-3, -9], aF: [6, 2, 11, 3], lF: [9, 9, 17, 21], lB: [-3, 11, -4, 22] }),
    s3: std({ chest: [-1, -15], aF: [5, -2, 10, -6], aB: [5, 1, 10, -1] }),
    s4a: std({ hip: [23, 44], chest: [4, -13], aF: [6, 1, 12, 0], aB: [6, 2, 11, 1], lF: [6, 9, 8, 19], lB: [-6, 9, -8, 19] }),
    s4b: { hip: [22, 54], chest: [-11, -5], head: [-7, -4], aF: [-3, -5, -6, -10], aB: [-2, -4, -5, -9], lF: [6, -6, 11, -13], lB: [6, -2, 12, -6] },
  },
  stance: ["st0", "st1"],
  specials: {
    1: { s: ["s1a"], a: ["s1b"], r: ["s1c", "s1c", "st0"] },
    2: { s: ["s2a"], a: ["s2b"], r: ["s2b", "~hk2"] },
    3: { s: ["s3"], a: ["s1b"], r: ["s1c", "st0"] },
    4: { s: ["s4a"], a: ["s4b"], r: ["s4b", "~getup0", "~getup1"] },
    5: { s: ["~super0", "s1a"], a: ["s1b"], r: ["s1c", "s1b", "s1c", "st0"] },
  },
};

const vinhxuan: StyleArt = {
  poses: {
    st0: std({ hip: [23, 42], chest: [1, -15], aF: [6, 1, 12, 0], aB: [5, 2, 9, 1], lF: [3, 10, 5, 21], lB: [-3, 10, -5, 21] }),
    st1: std({ hip: [23, 42], chest: [1, -15], aF: [5, 2, 9, 1], aB: [6, 1, 12, 0], lF: [3, 10, 5, 21], lB: [-3, 10, -5, 21] }),
    pF: std({ hip: [23, 42], chest: [3, -14], aF: [7, 0, 15, 0], aB: [4, 3, 7, 1], lF: [4, 10, 6, 21], lB: [-3, 10, -5, 21] }),
    pB: std({ hip: [23, 42], chest: [3, -14], aF: [4, 3, 7, 1], aB: [7, 0, 15, 0], lF: [4, 10, 6, 21], lB: [-3, 10, -5, 21] }),
    s2a: std({ chest: [-1, -15], aF: [6, 1, 12, 0], lF: [6, 5, 4, 13] }),
    s2b: std({ chest: [-3, -15], aF: [6, 1, 12, 0], aB: [5, 2, 9, 1], lF: [8, 9, 15, 22], lB: [-3, 10, -5, 21] }),
    s3: std({ hip: [23, 42], chest: [0, -15], aF: [5, -4, 10, 1], aB: [5, 2, 9, -1], lF: [3, 10, 5, 21], lB: [-3, 10, -5, 21] }),
    s4a: std({ hip: [23, 42], aF: [6, 2, 10, 1], lF: [4, 10, 6, 21], lB: [-4, 10, -6, 21] }),
    s4b: std({ hip: [25, 42], chest: [4, -14], aF: [7, 1, 13, 0], lF: [5, 10, 8, 21], lB: [-4, 10, -6, 21] }),
    tka: std({ hip: [23, 42], aF: [5, 0, 11, -3], aB: [4, 4, 8, 2], lF: [3, 10, 5, 21], lB: [-3, 10, -5, 21] }),
    tkb: std({ hip: [23, 42], aF: [4, 2, 9, 3], aB: [6, 0, 12, -1], lF: [3, 10, 5, 21], lB: [-3, 10, -5, 21] }),
  },
  stance: ["st0", "st1"],
  specials: {
    1: { s: ["st0"], a: ["pF", "pB"], r: ["st1"], cycle: 2 },
    2: { s: ["s2a"], a: ["s2b"], r: ["s2b", "st0"] },
    3: { s: ["s3"], a: ["pF", "pB"], r: ["pF", "pB", "st0"], cycle: 2 },
    4: { s: ["s4a"], a: ["s4b"], r: ["s4b", "st0"] },
    5: { s: ["~super0"], a: ["tka", "pF", "tkb", "pB"], r: ["pF", "st0"], cycle: 3 },
  },
};

/** By engine style id (1–7); Tự do (0) uses the shared poses only. */
export const STYLE_ART: Readonly<Partial<Record<number, StyleArt>>> = {
  1: vovinam, 2: muaythai, 3: karate, 4: taekwondo, 5: boxing, 6: judo, 7: vinhxuan,
};

/** The pose id of a style's pose name ("~land" → the shared "land"). */
export const styleRef = (style: number, name: string): string => (name.startsWith("~") ? name.slice(1) : `s${style}.${name}`);
