import * as THREE from "three";
import type { Gender } from "@/lib/game/types";
import type { ChibiHat, ChibiSpec } from "./spec";
import { EYE_COLOR_HEX, type BodyShape } from "@/lib/game/body";
import { FACE_EXPRS, FACE_H, FACE_W, facePixels, type FaceExpr, type FaceEyes } from "./voxel-face";
import { VoxelModel, around, type Painter, type RGB, type Shape, type Texel } from "./voxel-atlas";
import { lathe, roundBlock, smoothRings, spow, strand, type Ring } from "./voxel-shapes";
import { mix, painted, pixelTexture, rgb, shade, solid, tone, voxelMaterial } from "./voxel-material";
import { bottomPainter, buildHatKind, buildLegPieces, buildNeckPieces, buildSleevePieces, buildTopPieces, legCloth, topPainter } from "./garments3d";

// Browser only (but DOM-free): a ChibiSpec → a sculpted, smooth low-poly chibi in clean flat colours. Every rig
// segment (head, torso, upper arms, forearms, thighs, calves, the rod) is modelled from shaped pieces — a big rounded
// head with a jaw (squarer for boys, softer for girls), a smoothed lathed torso (boys V-shaped, girls with a waist and
// hips), tapered limbs with deltoids, mitten hands with a thumb, chunky soled shoes, hair as smooth shells and locks,
// clothes as shells over the body — merged into one geometry; every piece is painted in flat per-part colours into
// ONE smoothly filtered atlas per look (the light does the shading) from the palette the 2D sprite uses. The face is
// a shared transparent decal of clean shapes (open / blink / happy / surprised) hugging the face. Built once per look,
// shared by every actor wearing it: 12 draw calls a character.

export type Detail = "high" | "low";

/** One model unit ("voxel", one texture pixel is half of it), in world units. The model is ~34 units tall. */
export const VOX = 0.06;

/** Rig measurements (world units; the feet are at y = 0). */
export const RIG = {
  hipY: 14 * VOX,
  /** hips → the head's base (chin). */
  neckY: 10 * VOX,
  /** The head is modelled 8.4×9.5 units and drawn ~1.3× (a big chibi head: ~2.9 heads tall in all; per body type: BODY). */
  headScale: 1.32,
  headH: 9.5 * VOX * 1.34,
  headW: 8.4 * VOX * 1.34,
  shoulderX: 4.5 * VOX,
  shoulderY: 8.2 * VOX,
  upperLen: 5 * VOX,
  foreLen: 4 * VOX,
  legX: 1.75 * VOX,
  thighLen: 6 * VOX,
  calfLen: 6 * VOX,
} as const;

/** Posture a body type adds to every pose (radians): arms out (+), stance width (+), a relaxed elbow. */
export interface Posture { armZ: number; legZ: number; elbow: number }

/** The rig's measurements for one look (world units): where the limbs attach and how long each bone is, the head's
 *  size (uniform, then width/height for the face shape) and the whole body's scale (height). */
export interface BodyDims {
  shoulderX: number; shoulderY: number; legX: number; hipY: number; neckY: number;
  upperLen: number; foreLen: number; thighLen: number; calfLen: number;
  /** Ankle → sole (the foot's height). */
  footH: number;
  headScale: number; headX: number; headY: number;
  scale: number;
  posture: Posture;
}

/** A look's proportions: the rig's dims plus the sculpting factors (torso zones, limb thickness and length, hands,
 *  feet, jaw). The body type sets the base — boys: broad square shoulders, a straight wide torso, a thick neck, big
 *  hands and feet, a square jaw, a wider stance; girls: narrow sloped shoulders, a clear waist and wider hips, slim
 *  limbs, small hands and feet, a round soft chin, a bigger head — and the Look's body sliders (lib/game/body.ts)
 *  scale it within ranges that keep every mix cute and every animation intact. */
export interface Proportions {
  dims: BodyDims;
  shoulders: number; waist: number; hips: number; depth: number; square: number;
  /** The chest's forward volume (units): girls a soft stylised bust (the "Vòng 1" slider), boys the pecs (muscle). */
  chest: number;
  arm: number; leg: number; hand: number; foot: number; neck: number;
  armLen: number; legLen: number;
  jaw: number; headE: number;
}

const BASE: Record<Gender, { shoulders: number; waist: number; hips: number; depth: number; square: number; arm: number; leg: number; hand: number; foot: number;
  neck: number; jaw: number; headE: number; shoulderX: number; shoulderY: number; legX: number; head: number; posture: Posture }> = {
  nam: { shoulders: 1.08, waist: 1.05, hips: 0.96, depth: 1.03, square: 0.64, arm: 1.07, leg: 1.05, hand: 1.14, foot: 1.08, neck: 1.08, jaw: 0.12, headE: 0.56,
    shoulderX: 5.1, shoulderY: 8.35, legX: 1.85, head: 1.28, posture: { armZ: 0.07, legZ: 0.035, elbow: 0.06 } },
  nu: { shoulders: 0.9, waist: 0.88, hips: 1.1, depth: 0.97, square: 0.8, arm: 0.84, leg: 0.9, hand: 0.84, foot: 0.88, neck: 0.86, jaw: 0.2, headE: 0.72,
    shoulderX: 3.95, shoulderY: 7.9, legX: 1.72, head: 1.37, posture: { armZ: -0.01, legZ: -0.02, elbow: 0.18 } },
};

/** The torso splits here (units above the hip joints): above rigid, below the skinned pelvis. */
const HIP_CUT = 0.8;

/** A lathe profile with `n` rings per span (linear): enough rows for skinned cloth to bend smoothly. */
function densify(rings: readonly Ring[], n: number): Ring[] {
  const out: Ring[] = [];
  for (let i = 0; i < rings.length - 1; i++) {
    const a = rings[i], b = rings[i + 1];
    const cap = (a.rx === 0 && a.rz === 0) || (b.rx === 0 && b.rz === 0);
    const m = cap ? 1 : n;
    for (let j = 0; j < m; j++) {
      const t = j / m, L = (p: number, q: number) => p + (q - p) * t;
      out.push({ y: L(a.y, b.y), rx: L(a.rx, b.rx), rz: L(a.rz, b.rz), x: L(a.x ?? 0, b.x ?? 0), z: L(a.z ?? 0, b.z ?? 0) });
    }
  }
  out.push(rings[rings.length - 1]);
  return out;
}

/** Skin weights for a pelvis/skirt point (units, hips space): pelvis, left thigh, right thigh. Lower = more thigh; the
 *  front follows the thighs more than the back (which stays on the seat); left/right blend across the middle. */
export function hipWeights(x: number, y: number, z: number): [number, number, number] {
  const ss = (a: number, b: number, v: number) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  const th = ss(0.4, -2.6, y) * Math.max(0.3, Math.min(1, 0.6 + z / 3.2));
  const wl = 1 / (1 + Math.exp(x / 0.6));
  return [1 - th, th * wl, th * (1 - wl)];
}

/** Adds skinIndex/skinWeight to the hips geometry (positions in world units at `unit` per model unit). */
function skinHips(g: THREE.BufferGeometry, unit: number): void {
  const pos = g.getAttribute("position"), n = pos.count;
  const idx = new Uint16Array(n * 4), wt = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const [p0, l, r] = hipWeights(pos.getX(i) / unit, pos.getY(i) / unit, pos.getZ(i) / unit);
    idx.set([0, 1, 2, 0], i * 4);
    wt.set([p0, l, r, 0], i * 4);
  }
  g.setAttribute("skinIndex", new THREE.BufferAttribute(idx, 4));
  g.setAttribute("skinWeight", new THREE.BufferAttribute(wt, 4));
}

/** Knee → ankle and ankle → sole, in units (the thigh is 6). */
const CALF = 6.2, FOOT = 1.85;

export function proportions(spec: Pick<ChibiSpec, "gender" | "body">): Proportions {
  const g = BASE[spec.gender] ?? BASE.nam, b = spec.body;
  const build = 1 + 0.05 * b.build;
  const armLen = 1 + 0.15 * b.arms, legLen = 1 + 0.16 * b.legs;
  const thigh = 6 * legLen, calf = CALF * legLen;
  return {
    shoulders: g.shoulders * (1 + 0.12 * b.shoulders) * build * (1 + 0.04 * b.muscle),
    waist: g.waist * (1 + 0.15 * b.waist) * build,
    hips: g.hips * (1 + 0.12 * b.hips) * build,
    depth: g.depth * (1 + 0.12 * b.build),
    chest: (spec.gender === "nu" ? 0.5 + 0.3 * b.bust : 0.08 + 0.16 * b.muscle),
    square: g.square,
    arm: g.arm * (1 + 0.15 * b.build) * (1 + 0.14 * b.muscle), leg: g.leg * (1 + 0.15 * b.build),
    hand: g.hand * (1 + 0.06 * b.build), foot: g.foot * (1 + 0.05 * b.build), neck: g.neck * (1 + 0.1 * b.build),
    armLen, legLen, jaw: g.jaw, headE: g.headE,
    dims: {
      shoulderX: g.shoulderX * (1 + 0.12 * b.shoulders) * build * VOX, shoulderY: g.shoulderY * VOX, legX: g.legX * (1 + 0.1 * b.hips) * VOX,
      hipY: (thigh + calf + FOOT * g.foot * (1 + 0.05 * b.build)) * VOX, neckY: 10 * VOX,
      upperLen: 5 * armLen * VOX, foreLen: 4.35 * armLen * VOX, thighLen: thigh * VOX, calfLen: calf * VOX, footH: FOOT * g.foot * (1 + 0.05 * b.build) * VOX,
      headScale: g.head * (1 + 0.1 * b.head), headX: 1 - 0.06 * b.face, headY: 1 + 0.08 * b.face,
      scale: 1 + 0.08 * b.height,
      posture: g.posture,
    },
  };
}

/** Lathe smoothing (extra rings between the sculpted ones) for the model being built: high detail only. */
let SMOOTH = 2;

/** Atlas texels per model unit: high detail (desktop) and low (phones, crowds). */
export const TEX_HIGH = 3, TEX_LOW = 1.5;

/** The ink outline's width (world units). */
const OUTLINE = 0.011;

/** "hips" is the one skinned segment: the pelvis, the pants' seat and any skirt, bound to the pelvis and both thighs
 *  (skinIndex 0 = pelvis, 1 = left thigh, 2 = right thigh) so cloth follows the legs when walking and sitting. */
const SEGS = ["head", "torso", "hips", "upperL", "upperR", "foreL", "foreR", "thighL", "thighR", "calfL", "calfR", "footL", "footR", "rod"] as const;
export type Seg = (typeof SEGS)[number];

export interface ChibiParts extends Record<Seg, THREE.BufferGeometry> {
  /** The look's atlas material (all segments). */
  material: THREE.Material;
  /** The face decal (shared) and its expressions for this body type (shared). */
  faceGeo: THREE.BufferGeometry;
  faces: Record<FaceExpr, THREE.Material>;
  /** This look's bone lengths and attachment points (body type + sliders). */
  dims: BodyDims;
}

type V3 = readonly [number, number, number];
type M = VoxelModel<Seg>;

const isFront = (t: Texel) => t.dir === "pz";
/** A round lathe ring list from (y, r) pairs (rz = r·kz). */
const rings = (pts: readonly (readonly [number, number])[], kz = 1, x = 0, z = 0): Ring[] => pts.map(([y, r]) => ({ y, rx: r, rz: r * kz, x, z }));

// ---- head (head space: chin at y 0, face toward +z) ----

const HEAD = { cy: 4.7, rx: 4.2, ry: 4.8, rz: 4.1, flat: 3.7 } as const;

/** The jaw narrows the lower head; the face is pressed flat. */
function headDeform(jaw: number): (p: THREE.Vector3) => void {
  return (p) => {
    if (p.y < HEAD.cy) {
      const k = (HEAD.cy - p.y) / HEAD.ry;
      p.x *= 1 - jaw * k * k;
      p.z *= 1 - 0.06 * k * k;
    }
    if (p.z > HEAD.flat) p.z = HEAD.flat + (p.z - HEAD.flat) * 0.2;
  };
}

/** The head surface's z at (x, y) on the front (for the face decal), or null off the head. */
export function headFrontZ(x: number, y: number, jaw = BASE.nam.jaw, e = BASE.nam.headE): number | null {
  const k = y < HEAD.cy ? (HEAD.cy - y) / HEAD.ry : 0;
  const jx = 1 - jaw * k * k, jz = 1 - 0.06 * k * k;
  const p = 2 / e;
  const rest = 1 - Math.pow(Math.abs(x / jx / HEAD.rx), p) - Math.pow(Math.abs((y - HEAD.cy) / HEAD.ry), p);
  if (rest <= 0) return null;
  let z = HEAD.rz * Math.pow(rest, 1 / p) * jz;
  if (z > HEAD.flat) z = HEAD.flat + (z - HEAD.flat) * 0.2;
  return z;
}

function hairPainter(s: ChibiSpec): Painter {
  const main = rgb(s.hair.main), hi = rgb(s.hair.hi), dk = rgb(s.hair.shade);
  return (t) => {
    let c: RGB = main;
    if (t.y > 7.9 && t.y < 8.8 && t.n[1] > -0.2 && t.z > -1) c = mix(c, hi, 0.55);  // the anime shine band
    const k = t.v / Math.max(1, t.h - 1);
    if (k > 0.65) c = mix(c, dk, Math.min(1, (k - 0.65) * 1.1));               // a touch darker toward the tips
    return shade(c, tone(t, 0.03));
  };
}

/** The skull cap of hair: a shell over the head whose lower edge follows a hairline (front / side / back heights). */
function hairCap(front: number, side: number, back: number, grow = 1): Shape {
  const cy = HEAD.cy + 0.3, rx = (HEAD.rx + 0.3) * grow, ry = (HEAD.ry + 0.45) * grow, rz = (HEAD.rz + 0.5) * grow, e = 0.62;
  const line = (th: number) => {
    const s = Math.sin(th);
    return s > 0 ? side + (front - side) * s * s : side + (back - side) * s * s;
  };
  const at = (u: number, v: number) => {
    const th = u * Math.PI * 2;
    const yb = Math.min(cy + ry * 0.95, line(th));
    const cmax = spow((yb - cy) / ry, 1 / e);
    const phMax = Math.acos(Math.max(-1, Math.min(1, cmax)));
    const ph = Math.min(1, Math.max(0, v)) * phMax;
    const sp = spow(Math.sin(ph), e);
    return new THREE.Vector3(rx * sp * spow(Math.cos(th), e), cy + ry * spow(Math.cos(ph), e), rz * sp * spow(Math.sin(th), e));
  };
  return { at, center: () => new THREE.Vector3(0, HEAD.cy, 0), sizeU: 2 * Math.PI * rx * 1.1, sizeV: ry * 2.4, segU: 22, segV: 8 };
}

function buildHead(m: M, s: ChibiSpec, P: Proportions): void {
  const skin = rgb(s.skin), skinSh = rgb(s.skinShade);
  m.surface("head", roundBlock([0, HEAD.cy, 0], [HEAD.rx, HEAD.ry, HEAD.rz], P.headE, { seg: [20, 12], deform: headDeform(P.jaw) }),
    painted((t) => (t.n[1] < -0.8 && t.y < 1.2 ? mix(skin, skinSh, 0.35) : skin), 0.02));
  // ears: a rounded shell with a darker inner fold
  for (const sx of [-1, 1]) {
    m.surface("head", roundBlock([sx * 3.95, 4.3, 0.1], [0.5, 0.95, 0.62], 0.8, { seg: [8, 7] }),
      painted((t) => (t.x * sx > 4.2 && Math.abs(t.y - 4.3) < 0.45 && Math.abs(t.z - 0.1) < 0.3 ? mix(skin, skinSh, 0.6) : skin), 0.02));
  }
  const hp = hairPainter(s);
  // under a nón lá the hair is pressed down below the cone (nothing pokes through the palm leaf)
  const ceil = s.hat?.kind === "nonla" ? (r: number) => nonlaY(r) - 0.45 : null;
  const hm = ceil ? ({ surface: (seg: Seg, shape: Shape, paint: Painter, mat?: THREE.Matrix4) => m.surface(seg, underCeiling(shape, ceil), paint, mat) } as unknown as M) : m;
  buildHair(hm, s, hp, !!s.hat);
  if (s.hat) buildHat(m, s.hat);
  buildHairpin(m, s);
}

type Lock = readonly [V3, V3, V3];

function buildHair(m: M, s: ChibiSpec, hp: Painter, hatted: boolean): void {
  const lock = (l: Lock, w: readonly [number, number], t: readonly [number, number], side: V3 = [1, 0, 0]) =>
    m.surface("head", strand(l[0], l[1], l[2], w, t, side, [6, 7]), hp);
  const blob = (c: V3, r: V3, e = 0.75) => m.surface("head", roundBlock(c, r, e, { seg: [10, 6] }), hp);
  /** Forehead locks: x positions and tip heights, swept a little to one side. */
  const fringe = (xs: readonly number[], tips: readonly number[], sweep = 0.4, w = 1.25) => xs.forEach((x, i) => {
    const zf = (headFrontZ(x, tips[i]) ?? 3.3) + 0.45;
    lock([[x * 0.6, 9.9, 1.2], [x * 1.02, 9.8, 4.8], [x + sweep, tips[i], zf]], [w, w * 0.62], [0.55, 0.34]);
  });
  const sideLocks = (tip: number, zf = 2.6, out = 4.55) => {
    for (const sx of [-1, 1]) lock([[sx * 3.6, 9, 1], [sx * (out + 0.4), 7.4, zf], [sx * out, tip, zf + 0.3]], [1.1, 0.6], [0.6, 0.35], [0, 0, 1]);
  };
  const backLocks = (xs: readonly number[], tip: number, out = 5.2, w = 1.5) => xs.forEach((x) => {
    lock([[x * 0.8, 9.4, -2.2], [x * 1.15, 6, -out], [x * 1.2, tip, -out + 0.9]], [w, w * 0.75], [0.7, 0.45]);
  });
  const crownTuft = () => { if (!hatted) lock([[-0.6, 9.6, -1.5], [0.6, 11.4, 0.4], [1.4, 10.2, 2.6]], [1.3, 0.5], [0.6, 0.3]); };
  switch (s.hair.style) {
    case "buzz":
      m.surface("head", hairCap(7.8, 5.6, 3.6, 0.97), hp);
      break;
    case "undercut":
      m.surface("head", hairCap(7.8, 5.6, 3.6, 0.97), hp);
      lock([[-1.8, 9.2, -3], [0.2, 12.2, 0.6], [2.6, 8.8, 4.7]], [2.8, 1.4], [1.2, 0.5], [1, 0, 0.2]);
      if (!hatted) lock([[1.8, 9.4, -2.6], [2.8, 11.6, 0.6], [3.6, 9.6, 3.6]], [1.8, 0.9], [0.9, 0.4]);
      break;
    case "curly": {
      m.surface("head", hairCap(7.4, 4, 2.2, 1.02), hp);
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2, x = Math.cos(a) * 4.7, z = Math.sin(a) * 4.5;
        if (z > 3.2) continue;
        blob([x, i % 2 ? 7.4 : 5.4, z], [1.15, 1.15, 1.15]);
        if (!hatted) blob([x * 0.72, 9.6, z * 0.72], [1.3, 1.2, 1.3]);
      }
      if (!hatted) blob([0, 10.4, 0], [1.6, 1.3, 1.6]);
      for (const x of [-2.8, -0.9, 1.0, 2.9]) blob([x, 7.8, (headFrontZ(x, 7.8) ?? 3) + 0.3], [1.0, 0.95, 0.8]);
      break;
    }
    case "bob":
      m.surface("head", hairCap(7.6, 1.8, 1.2, 1.05), hp);
      for (const sx of [-1, 1]) lock([[sx * 3.4, 8.6, 0.8], [sx * 5.6, 5, 2.4], [sx * 4.3, 1.2, 3.2]], [1.5, 1.2], [0.8, 0.5], [0, 0, 1]);
      backLocks([-2.8, -0.9, 0.9, 2.8], 1.0, 5.3, 1.6);
      fringe([-2.9, -1.1, 0.8, 2.7], [6.2, 5.8, 6.1, 5.9], 0.1, 1.35);
      break;
    case "long":
      m.surface("head", hairCap(7.6, 3, 1.5, 1.04), hp);
      backLocks([-3.2, -1.1, 1.1, 3.2], -8.5, 5.4, 1.7);
      for (const sx of [-1, 1]) {
        lock([[sx * 3.8, 8.4, -0.5], [sx * 6.2, 2, 0.8], [sx * 5, -6.5, 0.2]], [1.6, 1.1], [0.9, 0.5], [0, 0, 1]);
        lock([[sx * 3.4, 8.6, 1.5], [sx * 5.4, 4, 3.3], [sx * 4.6, -2.5, 2.6]], [1.2, 0.8], [0.7, 0.4], [0, 0, 1]);
      }
      fringe([-2.9, -1.0, 1.1, 2.9], [5.9, 6.5, 6.2, 5.6], -0.3);
      break;
    case "ponytail":
      m.surface("head", hairCap(7.6, 4.4, 2.8), hp);
      fringe([-2.9, -1, 1, 2.9], [6.2, 5.8, 6.4, 6]);
      sideLocks(4.6);
      m.surface("head", roundBlock([0, 6.6, -4.9], [0.9, 0.9, 0.7], 0.6, { seg: [8, 6] }), solid(s.hair.shade));
      lock([[0, 6.8, -5.1], [0, 4.5, -8.4], [0.3, -2.6, -6.4]], [1.5, 0.5], [1.2, 0.4], [1, 0, 0]);
      break;
    case "twin_braids":
      m.surface("head", hairCap(7.6, 4, 2.6), hp);
      fringe([-2.9, -1, 1, 2.9], [6, 6.4, 6, 6.4]);
      for (const sx of [-1, 1]) {
        for (let i = 0; i < 5; i++) blob([sx * (4.5 + (i % 2) * 0.15), 4 - i * 1.55, 0.3], [0.95 - i * 0.05, 0.9, 0.95 - i * 0.05], 0.7);
        m.surface("head", roundBlock([sx * 4.55, -3.9, 0.3], [0.6, 0.35, 0.6], 0.6, { seg: [8, 5] }), solid("#e0607a"));
      }
      break;
    case "bun":
      m.surface("head", hairCap(7.6, 4.6, 3), hp);
      fringe([-2.4, 0, 2.4], [6.6, 6.1, 6.5], 0.2, 1.5);
      if (!hatted) {
        blob([0, 10.6, -2.4], [2, 1.7, 2], 0.8);
        m.surface("head", lathe(rings([[9.3, 2.05], [8.8, 2.1]], 1, 0, -2.2), 1, 12), solid(s.hair.shade));
      } else blob([0, 6.4, -5], [1.7, 1.6, 1.2], 0.8);
      break;
    case "bangs":
      m.surface("head", hairCap(7.4, 1.8, 0.6, 1.04), hp);
      backLocks([-2.6, 0, 2.6], 0.4, 5.3, 1.9);
      fringe([-3.2, -1.6, 0, 1.6, 3.2], [5.3, 5.0, 5.3, 5.0, 5.3], 0, 1.1);
      sideLocks(1.6, 2.4, 4.8);
      break;
    case "short":
    default:
      m.surface("head", hairCap(7.6, 4.6, 2.4), hp);
      fringe([-3, -1.3, 0.4, 2.1, 3.4], [6.3, 5.8, 6.4, 6, 6.6], 0.5);
      sideLocks(4.4, 1.6, 4.4);
      crownTuft();
      break;
  }
}

/** The nón lá's size (head units): brim radius, the rim's height (at the brows) and the apex. */
export const NONLA = { R: 9.3, rim: 5.4, top: 5.4 + 1.05 * 9.3 } as const;
/** The nón lá's outer surface height at distance r from the head's axis. */
export const nonlaY = (r: number): number => NONLA.top - (NONLA.top - NONLA.rim) * (r / NONLA.R);

/** A shape with every point pushed down under a ceiling y = ceil(distance from the head's axis). */
function underCeiling(shape: Shape, ceil: (r: number) => number): Shape {
  return { ...shape, at: (u, v) => { const p = shape.at(u, v), c = ceil(Math.hypot(p.x, p.z)); if (p.y > c) p.y = c; return p; } };
}

/** The nón lá's dried palm leaf: a muted, slightly grey warm beige in flat colour, fine leaf strips running from the
 *  apex to the brim (each strip a touch lighter or darker, a thin line between them), four rib rings, a darker brim
 *  edge; the underside in its own shade. */
function strawPainter(main: string, shadeHex: string): Painter {
  const a = mix(mix(rgb(main), [190, 172, 136], 0.55), [0, 0, 0], 0.06), b = mix(rgb(shadeHex), [120, 104, 78], 0.4);
  const STRIPS = 40;
  return (t) => {
    if (t.n[1] < 0) return mix(a, b, 0.4);
    const r = Math.hypot(t.x, t.z), f = ((Math.atan2(t.z, t.x) / (Math.PI * 2)) + 1) * STRIPS, strip = Math.floor(f), edge = f - strip;
    let c: RGB = shade(a, 1 + (((strip * 7919) % 5) - 2) * 0.018);
    if (edge < 0.2 && r > 0.8) c = mix(c, b, 0.26);                                  // the line between two strips
    if ([0.25, 0.45, 0.65, 0.84].some((k) => Math.abs(r - k * NONLA.R) < 0.12)) c = mix(c, b, 0.42);
    if (r > 0.93 * NONLA.R) c = mix(c, b, 0.35);                                     // the brim edge
    return c;
  };
}

/** A crown-and-brim hat profile (lathe), from the top down. */
function hatProfile(crownTop: number, crownR: number, brimY: number, brimR: number, taper = 0.9): Ring[] {
  return rings([[crownTop, 0], [crownTop, crownR * taper * 0.8], [crownTop - 0.5, crownR * taper], [brimY + 0.4, crownR], [brimY + 0.35, brimR * 0.97],
    [brimY + 0.1, brimR], [brimY - 0.2, brimR * 0.97], [brimY - 0.25, crownR * 0.95], [brimY + 0.3, 0]]);
}

/** Paints a band of `band` colour between heights y0..y1 over `base`. */
function banded(base: string, band: string, y0: number, y1: number): Painter {
  const a = rgb(base), b = rgb(band);
  return (t) => shade(t.y >= y0 && t.y <= y1 && t.n[1] < 0.7 ? b : a, tone(t, 0.04));
}

function buildHat(m: M, h: ChibiHat): void {
  if (buildHatKind(m, h)) return;
  const surf = (s: Shape, p: Painter) => m.surface("head", s, p, undefined, h.kind === "nonla" ? 1.5 : 1);
  switch (h.kind) {
    case "nonla": {
      // a real nón lá: a tall pointed cone (height ≈ 1.05× the brim radius, ~45° sides, brim ≈ 2.2× the head's width)
      // sitting deep on the head — the brim at the brows, the whole skull inside — with a thin rolled rim, a few faint
      // rib rings, and a thin chin strap (quai) under the jaw
      const { R, top, rim } = NONLA;
      const cone = (r: number) => nonlaY(r);
      const T = 0.18;                                                             // the leaf's thickness
      surf(lathe([
        { y: top + 0.1, rx: 0, rz: 0 }, { y: top - 0.05, rx: 0.14, rz: 0.14 }, ...[0.1, 0.3, 0.5, 0.7, 0.9].map((k) => ({ y: cone(R * k), rx: R * k, rz: R * k })),
        { y: rim, rx: R, rz: R },
        ...[0.9, 0.6, 0.3, 0.08].map((k) => ({ y: cone(R * k) - T * 1.4, rx: R * k, rz: R * k })), { y: top - 0.5, rx: 0, rz: 0 },
      ], 1, 28), strawPainter(h.main, h.shade));
      // the rolled rim ring
      surf(lathe(rings([[rim + 0.16, R - 0.12], [rim + 0.2, R + 0.05], [rim + 0.02, R + 0.22], [rim - 0.18, R + 0.08], [rim - 0.2, R - 0.12]]), 1, 28),
        solid("#8a7858", 0.02));
      for (const sx of [-1, 1]) {
        m.surface("head", strand([sx * 3.95, 5.6, 0.5], [sx * 5.6, 1.8, 1.9], [sx * 0.35, -0.4, 1.9], [0.14, 0.12], [0.1, 0.08], [0, 0, 1], [4, 8]), solid(h.accent));
      }
      break;
    }
    case "cap":
      surf(roundBlock([0, 8.7, -0.1], [4.75, 2.9, 4.7], 0.75, { seg: [16, 8], deform: (p) => { if (p.y < 7.6) p.y = 7.6; } }), banded(h.main, h.shade, 7.5, 7.9));
      surf(roundBlock([0, 7.85, 5.1], [3.6, 0.28, 2.3], 0.4, { seg: [12, 4] }), solid(h.brim));
      surf(roundBlock([0, 11.55, -0.1], [0.5, 0.3, 0.5], 0.7, { seg: [6, 4] }), solid(h.accent));
      break;
    case "beanie":
      surf(roundBlock([0, 8.7, -0.1], [4.95, 3.7, 4.85], 0.75, { seg: [16, 8], deform: (p) => { if (p.y < 7) p.y = 7; } }),
        solid(h.main, 0.03));
      surf(lathe(rings([[8.5, 5.05], [7.0, 5.05]], 0.99), 0.85, 16), solid(h.brim, 0.03));
      surf(roundBlock([0, 12.6, -0.3], [1.15, 1.05, 1.15], 0.85, { seg: [8, 6] }), solid(h.accent));
      break;
    case "fedora":
      surf(lathe(hatProfile(12.6, 4.2, 9.1, 6.6), 0.9, 16, (p) => { if (p.y > 12 && Math.abs(p.x) < 1) p.y -= 0.5 * (1 - Math.abs(p.x)); }), banded(h.main, h.accent, 9.4, 10.3));
      break;
    case "sunhat":
      surf(lathe(hatProfile(12.2, 4.5, 9.1, 8.6), 1, 22), banded(h.main, h.brim, 9.4, 10.2));
      surf(roundBlock([3.4, 10.1, 3.1], [0.9, 0.9, 0.6], 0.7, { seg: [8, 6] }), solid(h.accent));
      break;
    case "helmet":
      surf(roundBlock([0, 8.3, 0], [5.1, 4.2, 5.1], 0.7, { seg: [16, 8], deform: (p) => { if (p.y < 6.4) p.y = 6.4; } }), solid(h.main));
      surf(roundBlock([0, 12.3, 0], [0.55, 0.5, 4.6], 0.5, { seg: [8, 6] }), solid(h.accent));
      break;
    case "coi":
      surf(lathe(hatProfile(11.8, 4.7, 8.7, 5.6, 0.85), 1, 16), solid(h.main));
      break;
    case "bucket":
      surf(lathe(rings([[12.2, 0], [12.2, 3.8], [11.9, 4.4], [9.4, 4.7], [8.2, 6.4], [7.9, 6.3], [9.3, 4.4], [9.5, 0]]), 0.95, 16), banded(h.main, h.brim, 7.8, 9.35));
      break;
    case "crown": {
      const tri = (p: THREE.Vector3) => {
        if (p.y > 11) { const a = Math.atan2(p.z, p.x) * 8 / (Math.PI * 2); p.y += 1.1 * (1 - Math.abs(2 * (a - Math.floor(a)) - 1)); }
      };
      surf(lathe(rings([[11.4, 3.95], [11.4, 3.6], [9.9, 3.6], [9.9, 3.95], [11.4, 3.95]]), 1, 16, tri), banded(h.main, h.shade, 9.9, 10.3));
      surf(roundBlock([0, 10.7, 3.9], [0.55, 0.55, 0.3], 0.7, { seg: [6, 4] }), solid(h.accent));
      break;
    }
    case "antlers":
      surf(lathe(rings([[10.4, 4.75], [9.6, 4.75]]), 0.9, 16), solid(h.accent));
      for (const sx of [-1, 1]) {
        surf(strand([sx * 2.4, 9.8, 0], [sx * 2.8, 12, 0], [sx * 4.4, 14, -0.4], [0.45, 0.3], [0.45, 0.3], [0, 0, 1]), solid(h.main));
        surf(strand([sx * 2.9, 11.9, 0], [sx * 4.3, 12, 0], [sx * 5.4, 12.9, 0.3], [0.35, 0.22], [0.35, 0.22], [0, 0, 1]), solid(h.main));
        surf(strand([sx * 2.7, 11.2, 0], [sx * 1.8, 12.4, 0.2], [sx * 1.5, 13.4, 0.2], [0.3, 0.2], [0.3, 0.2], [0, 0, 1]), solid(h.shade));
      }
      break;
    case "cowboy":
      surf(lathe(hatProfile(13.2, 3.9, 9.3, 7.2, 0.85), 0.85, 18, (p) => {
        const ax = Math.abs(p.x);
        if (ax > 4) p.y += 0.16 * (ax - 4) * (ax - 4);                                         // the brim curls up at the sides
        if (p.y > 12.6 && Math.abs(p.x) < 1) p.y -= 0.6 * (1 - Math.abs(p.x));                   // the crease
      }), banded(h.main, h.accent, 9.6, 10.5));
      break;
    case "taibeo":
    default: {
      const tilt = around([0, 10, 0], [0.1, 0, -0.16]);
      m.surface("head", roundBlock([0.3, 10.1, 0], [5.1, 1.3, 5.1], 0.8, { seg: [16, 6] }), solid(h.main), tilt);
      m.surface("head", lathe(rings([[9.6, 4.6], [8.9, 4.6]]), 1, 16), solid(h.shade), tilt);
      m.surface("head", roundBlock([0.3, 11.5, 0], [0.3, 0.4, 0.3], 0.8, { seg: [6, 4] }), solid(h.shade), tilt);
      break;
    }
  }
}

function buildHairpin(m: M, s: ChibiSpec): void {
  const hp = s.hairpin;
  const bit = (c: V3, r: V3, color: string, e = 0.6) => m.surface("head", roundBlock(c, r, e, { seg: [8, 6] }), solid(color));
  if (!hp) {
    if (s.gender === "nu" && !s.hat) bit([3.1, 8.6, 3.5], [0.6, 0.35, 0.45], "#d23a67");
    return;
  }
  switch (hp.kind) {
    case "headband":
      m.surface("head", lathe(rings([[0.35, 5.2], [-0.35, 5.2]], 0.35), 0.9, 16), solid(hp.main), around([0, 0, 0], [0, 0, Math.PI / 2], [0, 8.2, -0.4]));
      break;
    case "bandana":
      m.surface("head", lathe(rings([[9.6, 4.75], [8.2, 4.9]], 0.98, 0, 0), 0.8, 16), solid(hp.main));
      bit([0, 7.6, -5.2], [0.7, 0.9, 0.4], hp.main);
      break;
    case "tie":
      bit([0, 6.6, -4.95], [0.7, 0.6, 0.45], hp.main);
      break;
    case "bow":
      bit([2.5, 10.1, 3.4], [0.65, 0.75, 0.5], hp.main);
      bit([4.1, 10.1, 3.1], [0.65, 0.75, 0.5], hp.main);
      bit([3.3, 10.1, 3.35], [0.35, 0.4, 0.45], hp.accent);
      break;
    case "flower":
      bit([3.4, 9.5, 3.4], [0.85, 0.85, 0.5], hp.main, 0.8);
      bit([3.45, 9.55, 3.8], [0.35, 0.35, 0.25], hp.accent, 0.8);
      break;
    case "star":
    default:
      bit([3.4, 9.6, 3.4], [0.7, 0.7, 0.4], hp.main, 0.35);
      bit([3.45, 9.65, 3.75], [0.25, 0.25, 0.2], hp.accent);
      break;
  }
}

// ---- torso (hips space: y 0 = the hip joints; chest 1.5..9, neck to 11) ----

function chestPainter(s: ChibiSpec): Painter {
  const SK = rgb(s.skin);
  const bare = s.torso === s.skin && !s.top3d;
  const cloth = topPainter(s);
  const band = s.band ? rgb(s.band) : null;
  const neck = s.neck && s.neck.kind !== "scarf" ? s.neck : null;
  return (t) => {
    const ax = Math.abs(t.x);
    let c: RGB = SK;
    if (bare) {
      c = SK;
      if (band && t.y > 5.2 && t.y < 7.9) c = t.y < 5.6 ? shade(band, 0.85) : band;
      if (band && t.y >= 7.9 && Math.abs(ax - 1.9) < 0.3) c = band;
      if (!band && isFront(t) && ax < 0.3 && Math.abs(t.y - 3.2) < 0.3) c = rgb(s.skinShade);   // navel
    } else {
      c = cloth(t);
      if (s.sleeve === "none" && t.y > 7.2 && ax > 2.25 && s.top3d !== "maxi") c = SK;  // sleeveless: bare shoulders
      if (t.y > 9.1 && ax < 1.6 && s.top3d !== "aodai" && s.top3d !== "kungfu") c = SK;
    }
    if (neck && t.z > 0) {
      if (ax < 1.8 && Math.abs(t.y - (7.8 + ax * 0.55)) < 0.28) c = rgb(neck.main);
      if (ax < 0.3 && t.y > 7.0 && t.y < 7.6) c = rgb(neck.accent);
    }
    return shade(c, tone(t, 0.04));
  };
}

function hipsPainter(s: ChibiSpec): Painter {
  const p = bottomPainter(s, hipsBase(s));
  if (s.top3d !== "aodai") return p;
  // áo dài: the tunic covers the pelvis front and back down to the panels; only the sides (the slits) show trousers
  const T = rgb(s.torso);
  return (t) => (t.y > 0.2 || (Math.abs(t.n[2]) > 0.55 && Math.abs(t.x) < 2.4) ? T : p(t));
}

function hipsBase(s: ChibiSpec): (t: Texel) => RGB {
  const B = rgb(s.lower === "robe" ? s.torso : s.bottom), BS = rgb(s.lower === "robe" ? s.torsoShade : s.bottomShade);
  const belt = s.belt ? rgb(s.belt) : null;
  const jeans = s.calf !== s.skin && s.lower === "pants";
  return (t) => {
    const ax = Math.abs(t.x);
    let c: RGB = t.y > 1 ? BS : B;
    if (belt && t.y > 0.3 && t.y < 1.5) c = isFront(t) && ax < 0.7 ? shade(belt, 0.75) : belt;
    else if (jeans && t.y > 0.8) c = isFront(t) && ax < 0.55 ? rgb("#cdb77a") : shade(B, 0.7);
    else if (isFront(t) && ax < 0.08 && t.y < 0.8 && t.y > -1.2 && s.lower === "pants") c = shade(B, 0.8);
    return c;
  };
}

function skirtPainter(base: string, shadeHex: string, pleats: boolean, placket?: string, denim = false): Painter {
  const a = rgb(base), b = rgb(shadeHex), p = placket ? rgb(placket) : null;
  return (t) => {
    let c: RGB = a;
    if (pleats) {
      const k = ((Math.atan2(t.z, t.x) / (Math.PI * 2)) + 1) * 28, f = k - Math.floor(k);
      if (f < 0.1) c = mix(a, b, 0.85);                                                 // the fold line
      else if (f < 0.5) c = mix(a, b, 0.35);                                            // the pleat's shaded face
    }
    if (p && isFront(t) && Math.abs(t.x) < 0.3) c = p;
    if (t.v >= t.h - 2 && t.n[1] > -0.5) c = shade(c, 0.85);                   // hem
    if (denim && isFront(t) && Math.abs(t.x) < 0.07) c = [214, 170, 80];
    return shade(c, tone(t, 0.04));
  };
}

/** Shapes a torso ring by zone: shoulders (top), waist (middle), hips (bottom) widths and the build's depth. */
function zoned(r: Ring, P: Proportions): Ring {
  const ss = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const ws = ss(5.6, 8.2, r.y), wh = ss(3.2, 0.8, r.y), ww = Math.max(0, 1 - ws - wh);
  const k = ws * P.shoulders + wh * P.hips + ww * P.waist;
  return { ...r, rx: r.rx * k, rz: r.rz * P.depth };
}

function buildTorso(m: M, s: ChibiSpec, P: Proportions): void {
  const nu = s.gender === "nu";
  const chest = chestPainter(s), hips = hipsPainter(s);
  // a sculpted profile, then smoothed: boys straighter and V-shaped (broad shoulders, flat chest, narrow hips); girls
  // narrower in the shoulder with a soft bust, a defined waist and fuller hips. The top rings slope down from the neck
  // into the shoulders so the arms' deltoids meet the torso in a curve, not a step.
  const body: Ring[] = nu
    ? [{ y: 9.6, rx: 0, rz: 0 }, { y: 9.6, rx: 1.5, rz: 1.1 }, { y: 9.35, rx: 2.45, rz: 1.55 }, { y: 8.85, rx: 3.15, rz: 1.85 }, { y: 8.0, rx: 3.3, rz: 1.95 },
      { y: 6.8, rx: 3.15, rz: 2.1, z: 0.05 }, { y: 5.6, rx: 2.9, rz: 1.95, z: 0.03 }, { y: 4.2, rx: 2.5, rz: 1.72 }, { y: 2.6, rx: 2.9, rz: 1.85 },
      { y: 1.0, rx: 3.45, rz: 2.05 }, { y: 0, rx: 3.55, rz: 2.1 }, { y: -1.2, rx: 3.2, rz: 2.0 }, { y: -2.0, rx: 2.3, rz: 1.55 }, { y: -2.35, rx: 0, rz: 0 }]
    : [{ y: 9.7, rx: 0, rz: 0 }, { y: 9.7, rx: 1.8, rz: 1.3 }, { y: 9.45, rx: 2.95, rz: 1.8 }, { y: 8.9, rx: 3.95, rz: 2.1 }, { y: 8.0, rx: 4.15, rz: 2.2 },
      { y: 6.6, rx: 3.95, rz: 2.25, z: 0.1 }, { y: 5.0, rx: 3.55, rz: 2.0 }, { y: 3.4, rx: 3.3, rz: 1.9 }, { y: 1.8, rx: 3.3, rz: 1.95 },
      { y: 0, rx: 3.35, rz: 2.0 }, { y: -1.3, rx: 3.0, rz: 1.9 }, { y: -2.0, rx: 2.2, rz: 1.5 }, { y: -2.35, rx: 0, rz: 0 }];
  // the chest's forward volume: a soft, stylised curve on the front only (girls lower and rounder, boys flatter pecs)
  // two soft rounded volumes (the clothes are painted on the same surface, so they drape over it), a faint
  // flat-colour shadow line under them for girls
  const [cy, sy, lx, lw] = nu ? [6.45, 1.05, 1.3, 1.05] : [7.0, 1.1, 1.35, 1.35];
  const lobes = (x: number) => Math.exp(-(((x - lx) / lw) ** 2)) + Math.exp(-(((x + lx) / lw) ** 2));
  const front = (p: THREE.Vector3) => {
    if (p.z <= 0 || nu) return;
    const y = p.y - cy, wy = Math.exp(-((y / (y < 0 ? sy * 0.8 : sy * 1.25)) ** 2));
    p.z += P.chest * wy * Math.min(1, lobes(p.x)) * Math.min(1, p.z / 1.4);
  };
  const all = smoothRings(body.map((r) => zoned(r, P)), SMOOTH);
  const cut = HIP_CUT, i = all.findIndex((r) => r.y < cut), a = all[i - 1], b = all[i], k = (a.y - cut) / (a.y - b.y);
  const mid: Ring = { y: cut, rx: a.rx + (b.rx - a.rx) * k, rz: a.rz + (b.rz - a.rz) * k, x: 0, z: (a.z ?? 0) + ((b.z ?? 0) - (a.z ?? 0)) * k };
  const paintBody: Painter = (t) => (t.y >= 1.5 ? chest(t) : hips(t));
  // the body carries the painted garment detail: 3× the texel density (crisp collars, plackets, prints)
  m.surface("torso", lathe([...all.slice(0, i), mid], P.square, 24, front), paintBody, undefined, 3);
  m.surface("hips", lathe(densify([mid, ...all.slice(i)], 2), P.square, 24), paintBody, undefined, 3);
  const frontZ = (x: number, y: number): number => {
    const j = all.findIndex((r) => r.y <= y);
    if (j <= 0) return 0;
    const r0 = all[j - 1], r1 = all[j], k2 = (r0.y - y) / (r0.y - r1.y || 1);
    const rx = r0.rx + (r1.rx - r0.rx) * k2, rz = r0.rz + (r1.rz - r0.rz) * k2, z0 = (r0.z ?? 0) + ((r1.z ?? 0) - (r0.z ?? 0)) * k2;
    const cx = Math.min(1, Math.abs(x) / Math.max(0.01, rx)), e = P.square;
    const ct = Math.pow(cx, 1 / e), st = Math.sqrt(Math.max(0, 1 - ct * ct));
    let z = z0 + rz * Math.pow(st, e);
    if (nu) {
      const v = P.chest, rz2 = 0.7 + 0.22 * v, cz = 1.8 * P.depth + v - rz2, dy = (y - (cy - 0.1)) / (1.3 + 0.08 * v);
      for (const sx of [-1, 1]) {
        const dx = (x - sx * (lx - 0.08)) / (1.22 + 0.1 * v), q = 1 - dx * dx - dy * dy;
        if (q > 0) z = Math.max(z, cz + rz2 * Math.sqrt(q));
      }
    } else {
      const yy = y - cy, wy = Math.exp(-((yy / (yy < 0 ? sy * 0.8 : sy * 1.25)) ** 2));
      z += P.chest * wy * Math.min(1, lobes(x));
    }
    return z;
  };
  buildTopPieces(m, s, { frontZ, depth: P.depth, hips: Math.max(P.hips, P.waist), low: SMOOTH < 2 });
  buildNeckPieces(m, s, frontZ, SMOOTH < 2);
  if (nu) {
    // girls: two soft, slightly flattened ellipsoids blended into the chest (finely subdivided: smooth, never pointy),
    // clothed in the top's colours, with a soft flat shadow along their rounded underside
    const v = P.chest, rz = 0.7 + 0.22 * v, rx = 1.22 + 0.1 * v, ry = 1.3 + 0.08 * v, cz = 1.8 * P.depth + v - rz;
    m.ink = false;                                                              // blended into the chest: no inner ink line
    for (const sx of [-1, 1]) {
      m.surface("torso", roundBlock([sx * (lx - 0.08), cy - 0.1, cz], [rx, ry, rz], 1, { seg: [16, 12] }), (t) => {
        const c = chest(t);
        return c && t.n[1] < -0.5 ? shade(c, 0.88) : c;
      }, undefined, 3);
    }
    m.ink = true;
  }
  // the neck flares into the trapezius
  const nk = P.neck;
  m.ink = false;
  m.surface("torso", lathe(rings([[11.3, 0], [11.3, 1.05 * nk], [10.4, 1.1 * nk], [9.7, 1.3 * nk], [9.2, 1.85 * nk], [8.8, 0]]), 1, 12), solid(s.skinShade, 0.02));
  m.ink = true;
  // skirts hang from the waist (open at the hem: a thin inturned lip), finely ringed so they bend smoothly with the legs
  const skirt = (r: readonly (readonly [number, number, number])[], p: Painter) => {
    const w = Math.max(P.hips, P.waist);
    const rr: Ring[] = r.filter(([, rx]) => rx > 0).map(([y, rx, rz]) => ({ y, rx: rx * w, rz: rz * P.depth }));
    const hem = rr[rr.length - 1];
    rr.push({ y: hem.y + 0.05, rx: hem.rx * 0.93, rz: hem.rz * 0.93 });
    m.surface("hips", lathe(densify(rr.slice(0, -1), 5).concat(rr.slice(-1)), 0.8, 20), p);
  };
  switch (s.lower) {
    case "skirt": skirt([[2.2, 3.15, 1.95], [-4.2, 4.3, 2.9], [-4.45, 4.0, 2.7], [-4.45, 0, 0]], skirtPainter(s.bottom, s.bottomShade, s.bottom3d === "pleated", undefined, s.bottom3d === "denimskirt")); break;
    case "pleated": skirt([[2.2, 3.15, 1.95], [-4.8, 4.5, 3.0], [-5.05, 4.2, 2.8], [-5.05, 0, 0]], skirtPainter(s.bottom, s.bottomShade, true)); break;
    case "maxi": skirt([[2.2, 3.15, 1.95], [-4, 3.9, 2.6], [-11.4, 4.9, 3.3], [-11.7, 4.6, 3.1], [-11.7, 0, 0]], skirtPainter(s.bottom, s.bottomShade, false)); break;
    case "robe": skirt([[2.2, 3.3, 2.05], [-4, 3.9, 2.6], [-10.8, 4.6, 3.1], [-11.1, 4.3, 2.9], [-11.1, 0, 0]], skirtPainter(s.torso, s.torsoShade, false, s.detail)); break;
    default: break;
  }
  if (s.belt) {
    m.surface("hips", roundBlock([0.9, -0.9, 2.05], [0.35, 1.5, 0.2], 0.6, { seg: [6, 5] }), solid(s.belt));
    m.surface("hips", roundBlock([-0.1, -0.6, 2.05], [0.35, 1.2, 0.2], 0.6, { seg: [6, 5] }), solid(s.belt));
  }
}

// ---- limbs (each hangs down, -y, from its pivot) ----

/** A lathe profile (y, r) list scaled in length below the pivot (y < 0) and in thickness. */
const limb = (pts: readonly (readonly [number, number])[], len: number, k: number): [number, number][] => pts.map(([y, r]) => [y < 0 ? y * len : y, r * k]);

/** A rounded end: rings of a quarter ellipse from radius r at y down (dir -1) or up (+1) by depth d, closed. */
function roundEnd(y: number, r: number, d: number, dir: -1 | 1): [number, number][] {
  return [0.35, 0.65, 0.88, 1].map((a) => [y + dir * d * Math.sin((a * Math.PI) / 2), a === 1 ? 0 : r * Math.cos((a * Math.PI) / 2)]);
}

function buildArm(m: M, s: ChibiSpec, P: Proportions, side: -1 | 1): void {
  const up: Seg = side < 0 ? "upperL" : "upperR", fo: Seg = side < 0 ? "foreL" : "foreR";
  const k = P.arm, hk = P.hand, L = P.armLen;
  const sleeveC = rgb(s.sleeveColor), skin = rgb(s.skin), skinSh = rgb(s.skinShade);
  const long = s.sleeve === "long";
  // upper arm: a round deltoid cap tapering to a rounded elbow (it overlaps the forearm's dome: no gap when bent)
  const upper = limb([[1.2, 0], [1.1, 0.72], [0.65, 1.1], [0, 1.18], [-1.4, 1.08], [-3.2, 0.98], [-4.7, 0.9]], L, k);
  m.surface(up, lathe(rings([...upper, ...roundEnd(-4.7 * L, 0.9 * k, 0.8, -1)]), 0.85, 12), painted(() => (long ? sleeveC : skin), 0.04));
  if (s.sleeve === "short") {
    m.surface(up, lathe(rings(limb([[1.45, 0], [1.35, 0.9], [0.8, 1.38], [0, 1.45], [-2.2, 1.36], [-2.55, 1.12], [-2.6, 0]], L, k)), 0.85, 12),
      painted((t) => (t.y < -2.0 * L ? shade(sleeveC, 0.84) : sleeveC), 0.04));
  }
  // forearm: a dome at the elbow, tapering to the wrist
  const fore = limb([[0, 0.98], [-1.2, 0.98], [-2.8, 0.85], [-3.8, 0.74], [-4.25, 0.56]], L, k);
  m.surface(fo, lathe(rings([...roundEnd(0, 0.98 * k, 0.85, 1).reverse(), ...fore, [-4.35 * L, 0]]), 0.85, 12),
    painted((t) => (long ? (t.y < -3.3 * L ? shade(sleeveC, 0.85) : sleeveC) : skin), 0.04));
  // the hand: a soft palm with the fingers drawn in (creases toward the tips), and a curved thumb in front
  const inner = -side, hy = -4.35 * L - 0.85;
  m.surface(fo, roundBlock([0, hy, 0.05], [0.66 * hk, 1.05 * hk, 0.88 * hk], 0.72, { seg: [12, 8] }),
    painted((t) => {
      const tip = t.y < hy - 0.35;
      if (tip && [-0.32, 0.12, 0.52].some((zc) => Math.abs(t.z - zc * hk) < 0.08)) return mix(skin, skinSh, 0.75);
      return tip ? mix(skin, skinSh, 0.25) : skin;
    }, 0.02));
  m.surface(fo, strand([inner * 0.45 * hk, hy + 0.5, 0.55 * hk], [inner * 0.72 * hk, hy + 0.05, 0.95 * hk], [inner * 0.5 * hk, hy - 0.55, 1.0 * hk], [0.3 * hk, 0.22 * hk], [0.28 * hk, 0.2 * hk], [1, 0, 0], [6, 5]),
    solid(s.skin, 0.02));
  buildSleevePieces(m, s, up, fo, k, L);
  if (side > 0 && s.wrist) {
    m.surface(fo, lathe(rings([[-3.2 * L, 0.9 * k], [-3.85 * L, 0.86 * k]], 1), 0.85, 12), solid(s.wrist.main));
    if (s.wrist.kind === "watch") m.surface(fo, roundBlock([0, -3.5 * L, 0.88 * k], [0.45, 0.42, 0.22], 0.5, { seg: [6, 4] }), solid(s.wrist.accent));
  }
}

function buildLeg(m: M, s: ChibiSpec, P: Proportions, side: -1 | 1): void {
  const th: Seg = side < 0 ? "thighL" : "thighR", ca: Seg = side < 0 ? "calfL" : "calfR", ft: Seg = side < 0 ? "footL" : "footR";
  const nu = s.gender === "nu";
  const skin = rgb(s.skin), bottom = rgb(s.bottom);
  const long = s.calf !== s.skin;
  const shorts = !long && s.thigh !== s.skin;
  const briefs = !long && !shorts && s.lower === "pants";
  const k = P.leg, L = P.legLen;
  // thigh: girls fuller at the hip and slimmer at the knee, boys straighter; a rounded knee end
  const thigh = limb(nu
    ? [[0.9, 0], [0.8, 1.35], [0.3, 1.86], [-1.5, 1.78], [-3.5, 1.5], [-5.3, 1.2]]
    : [[0.9, 0], [0.8, 1.3], [0.3, 1.74], [-1.5, 1.7], [-3.5, 1.56], [-5.3, 1.34]], L, k);
  const thighCloth = legCloth(s, side, "thigh", rgb(s.thigh), L), calfCloth = legCloth(s, side, "calf", rgb(s.calf), L);
  m.surface(th, lathe(rings([...thigh, ...roundEnd(-5.3 * L, (nu ? 1.2 : 1.34) * k, 1.0, -1)], 0.95), 0.85, 12), painted((t) => {
    if (long) return thighCloth(t);
    if (briefs && t.y > -1.1) return t.y < -0.8 ? shade(bottom, 0.85) : bottom;
    return skin;
  }, 0.04));
  if (shorts) {
    const cloth = rgb(s.thigh);
    m.surface(th, lathe(rings(limb([[1.3, 0], [1.2, 1.6], [0.4, 2.05], [-3.3, 1.98], [-3.6, 1.55], [-3.6, 0]], L, k), 0.95), 0.85, 12),
      painted((t) => (t.y < -3.1 * L ? shade(cloth, 0.78) : thighCloth(t)), 0.04));
  }
  // calf: a dome at the knee (under the thigh's end), down to the ankle, closed inside the shoe
  const sh = s.shoe, main = rgb(sh.main), sole = rgb(sh.sole);
  const boots = sh.kind === "boots" || sh.kind === "rainboots", sneakers = sh.kind === "sneakers";
  const ck = k * (nu ? 0.93 : 1), A = CALF * L;                                     // A: knee → ankle
  const calf = limb([[0, 1.36], [-1.4, 1.46], [-3.0, 1.3], [-4.6, 1.08], [-5.8, 0.98], [-6.2, 0.9]], L, ck);
  m.surface(ca, lathe(rings([...roundEnd(0, 1.36 * ck, 0.7, 1).reverse(), ...calf, ...roundEnd(-A, 0.9 * ck, 0.5, -1)], 0.95), 0.85, 12), painted((t) => {
    if (long) return t.y < -A + 1.0 ? shade(calfCloth(t), 0.85) : calfCloth(t);
    if (sneakers && t.y < -A + 1.3) return rgb("#f2eee6");
    return skin;
  }, 0.04));
  buildLegPieces(m, s, ca, ck, A);
  if (boots) {
    m.surface(ca, lathe(rings([[-2.2 * L, 0], [-2.2 * L, 1.72 * ck], [-3.1 * L, 1.72 * ck], [-3.1 * L, 1.52 * ck], [-A - 0.2, 1.3 * ck], [-A - 0.2, 0]], 0.97), 0.75, 12),
      painted((t) => (t.y > -3.15 * L ? sole : main), 0.04));
  }
  // the foot, on its own ankle pivot (y 0 = the ankle; it rolls heel-to-toe): the shoe or bare foot and sandal
  const f = P.foot, fb = (c: V3, r: V3, e: number, seg: [number, number], deform?: (p: THREE.Vector3) => void) =>
    roundBlock([c[0] * f, c[1] * f, c[2] * f], [r[0] * f, r[1] * f, r[2] * f], e, { seg, deform });
  const toe = (z0: number, k2: number) => (p: THREE.Vector3) => { if (p.z > z0 * f) p.y -= (p.z - z0 * f) * k2; };
  if (sh.kind === "dep" || sh.kind === "sandals" || sh.kind === "toong") {
    m.surface(ft, fb([0, -0.85, 0.5], [1.26, 0.78, 1.92], 0.62, [12, 7], toe(1.1, 0.15)), solid(s.skin, 0.02));
    m.surface(ft, fb([0, -1.6, 0.5], [1.48, 0.24, 2.2], 0.4, [12, 4]), solid(sh.sole));
    if (sh.kind === "toong") {
      // dép tông: a thong between the toes and two straps running back to the sides
      for (const sx of [-1, 1]) m.surface(ft, strand([0, -0.95, 1.9 * f], [sx * 0.9 * f, -0.2, 1.0 * f], [sx * 1.3 * f, -1.2, 0.1 * f], [0.3, 0.26], [0.14, 0.12], [0, 1, 0], [4, 6]), solid(sh.main === "#fffde7" ? "#d9534f" : sh.main));
    } else m.surface(ft, fb([0, -0.55, 1.0], [1.36, 0.26, 0.55], 0.5, [8, 4]), solid(sh.main));
    if (sh.kind === "sandals") {
      m.surface(ft, fb([0, -0.1, -0.9], [1.25, 0.24, 0.6], 0.5, [8, 4]), solid(sh.main));
      m.surface(ft, fb([0, -0.35, 0.05], [1.32, 0.2, 0.3], 0.5, [8, 4]), solid(sh.main));
    }
  } else if (sh.kind === "oxford") {
    m.surface(ft, fb([0, -0.8, 0.6], [1.4, 0.92, 2.1], 0.58, [14, 8], toe(1.2, 0.12)), painted((t) => {
      if (t.n[1] > 0.35 && Math.abs(t.x) < 0.5 * f && t.z > 0.1 * f && t.z < 1.3 * f) return Math.floor(t.z / (0.3 * f)) % 2 ? shade(main, 1.8) : main;   // laces
      if (t.z > 1.6 * f && t.n[1] > 0.2) return shade(main, 1.35);                                                                  // the glossy toe
      return main;
    }, 0.02), undefined, 2);
    m.surface(ft, fb([0, -1.55, 0.6], [1.5, 0.22, 2.22], 0.4, [14, 4]), solid(sh.sole));
    m.surface(ft, fb([0, -1.45, -1.25], [1.25, 0.34, 0.55], 0.5, [8, 4]), solid(sh.sole));
  } else {
    m.surface(ft, fb([0, -0.75, 0.6], [1.45, 1.0, 2.15], 0.58, [14, 8], toe(1.2, 0.12)), painted((t) => {
      if (sneakers && t.n[1] > 0.4 && Math.abs(t.x) < 0.55 * f && t.z > 0.6 * f && t.z < 1.9 * f) return Math.floor(t.z / (0.32 * f)) % 2 ? rgb("#f4f1ea") : rgb("#c9c4ba");     // the laces panel
      if (sneakers && t.z > 1.9 * f) return rgb("#f4f1ea");                                                              // the toe cap
      return main;
    }, 0.04), undefined, 2);
    m.surface(ft, fb([0, -1.55, 0.6], [1.56, 0.3, 2.28], 0.4, [14, 4]), solid(sneakers ? "#f4f1ea" : sh.sole));
    if (sneakers) m.surface(ft, fb([0, -1.62, 0.6], [1.58, 0.1, 2.3], 0.4, [14, 3]), solid(sh.sole));
  }
}

function buildRod(m: M): void {
  // a real cần câu, ~3× the old stick: a cork grip through the fist with a butt cap, a spinning reel hanging under it
  // (spool, foot, handle), then a long blank that tapers to a fine tip and droops a little under its own weight, with
  // three line guides under it (the line leaves the tip: rig.rodTip)
  m.surface("rod", roundBlock([0, 0, -1.2], [0.42, 0.42, 3.4], 0.8, { seg: [7, 6] }), solid("#c89a62"));   // the cork
  m.surface("rod", roundBlock([0, 0, -4.4], [0.5, 0.5, 0.45], 0.7, { seg: [6, 4] }), solid("#2a2420"));    // butt cap
  m.surface("rod", roundBlock([0, -0.75, 2.6], [0.12, 0.6, 0.18], 0.6, { seg: [4, 4] }), solid("#3a3a3a")); // reel foot
  m.surface("rod", roundBlock([0, -1.55, 2.6], [0.62, 0.55, 0.55], 0.5, { seg: [8, 5] }), solid("#b8bcc2")); // spool
  m.surface("rod", roundBlock([0.7, -1.55, 2.6], [0.12, 0.12, 0.5], 0.6, { seg: [4, 4] }), solid("#2a2420")); // handle
  m.surface("rod", strand([0, 0, 2.2], [0, 0.9, 30], [0, -3.2, 58], [0.2, 0.05], [0.2, 0.05], [1, 0, 0], [6, 8]),
    painted((t) => (t.v < 1.2 ? "#2a2420" : Math.floor(t.v / 9) % 2 ? "#23313d" : "#2c3c4a"), 0.03));
  for (const [z, y] of [[14, 0.25], [28, 0.35], [44, -0.9]] as const)                                  // line guides
    m.surface("rod", roundBlock([0, y - 0.45, z], [0.14, 0.3, 0.14], 0.6, { seg: [4, 3] }), solid("#c8ccd2"));
}

/** The face decal: the head front's 8×9-unit face area as a grid hugging the flattened face. */
function buildFaceGeo(g0: Gender): THREE.BufferGeometry {
  const { jaw, headE } = BASE[g0] ?? BASE.nam;
  const g = new THREE.PlaneGeometry(8 * VOX, 9 * VOX, 16, 18);
  const pos = g.getAttribute("position"), uv = g.getAttribute("uv");
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) / VOX, y = pos.getY(i) / VOX + 4.5;
    const z = headFrontZ(x, y, jaw, headE);
    pos.setXYZ(i, x * VOX, y * VOX, ((z ?? 0) + 0.05) * VOX);
    uv.setY(i, 1 - uv.getY(i));                                                   // the decal's row 0 is its top
  }
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** Builds the model of a look at a detail level (3 texels per unit and full grids high; 1 and coarser grids low). */
export function buildChibi(spec: ChibiSpec, detail: Detail): { geos: Record<Seg, THREE.BufferGeometry>; pixels: Uint8Array; width: number; height: number } {
  const m = new VoxelModel<Seg>(SEGS);
  SMOOTH = detail === "high" ? 2 : 1;
  const P = proportions(spec);
  buildHead(m, spec, P);
  buildTorso(m, spec, P);
  buildArm(m, spec, P, -1);
  buildArm(m, spec, P, 1);
  buildLeg(m, spec, P, -1);
  buildLeg(m, spec, P, 1);
  buildRod(m);
  // painted edges (collars, hems, hairlines, trims) are anti-aliased: 4×4 sub-samples high, 2×2 low
  m.aa = detail === "high" ? 4 : 2;
  const out = detail === "high" ? m.build(TEX_HIGH, VOX, 1, true) : m.build(TEX_LOW, VOX, 0.6, false);
  skinHips(out.geos.hips, VOX);
  return out;
}

interface Entry { parts: ChibiParts; tex: THREE.Texture; refs: number }

/** Builds the parts once per look key and detail level; actors `acquire` and `release` them (idle entries beyond
 *  `max` are disposed, oldest first). */
export class ChibiFactory {
  private readonly entries = new Map<string, Entry>();
  private readonly faceGeos = new Map<Gender, THREE.BufferGeometry>();
  private readonly faceMats = new Map<string, Record<FaceExpr, THREE.Material>>();

  constructor(private readonly max = 120) {}

  private faceGeo(g: Gender): THREE.BufferGeometry {
    let geo = this.faceGeos.get(g);
    if (!geo) this.faceGeos.set(g, (geo = buildFaceGeo(g)));
    return geo;
  }

  /** The face materials for a body type and eyes (size, spacing, colour), shared by every look with them. */
  private faces(g: Gender, body: BodyShape, hair: string): Record<FaceExpr, THREE.Material> {
    const beard = g === "nam" ? body.beard : "none";
    const eyes: FaceEyes = { size: 1 + 0.14 * body.eyeSize, spacing: 0.22 * body.eyeSpacing, iris: EYE_COLOR_HEX[body.eyeColor] ?? EYE_COLOR_HEX.nau, beard, beardColor: hair };
    const key = `${g}|${body.eyeSize}|${body.eyeSpacing}|${body.eyeColor}|${beard}|${beard === "none" ? "" : hair}`;
    let f = this.faceMats.get(key);
    if (!f) {
      const out = {} as Record<FaceExpr, THREE.Material>;
      for (const e of FACE_EXPRS) {
        const mat = voxelMaterial(pixelTexture(facePixels(e, g, eyes), FACE_W, FACE_H), { transparent: true });
        mat.polygonOffset = true;
        mat.polygonOffsetFactor = -2;
        out[e] = mat;
      }
      this.faceMats.set(key, (f = out));
    }
    return f;
  }

  acquire(spec: ChibiSpec, detail: Detail): { key: string; parts: ChibiParts } {
    const key = `${detail}|${spec.key}`;
    let e = this.entries.get(key);
    if (e) this.entries.delete(key);                                    // re-insert: LRU order
    else {
      const b = buildChibi(spec, detail);
      const tex = pixelTexture(b.pixels, b.width, b.height);
      e = { refs: 0, tex, parts: { ...b.geos, material: voxelMaterial(tex, { outline: detail === "high" ? OUTLINE : 0 }), faceGeo: this.faceGeo(spec.gender), faces: this.faces(spec.gender, spec.body, spec.hair.main), dims: proportions(spec).dims } };
    }
    e.refs++;
    this.entries.set(key, e);
    this.evict();
    return { key, parts: e.parts };
  }

  release(key: string): void {
    const e = this.entries.get(key);
    if (e) e.refs = Math.max(0, e.refs - 1);
    this.evict();
  }

  /** How many looks are built (for stats/tests). */
  size(): number { return this.entries.size; }

  private evict(): void {
    if (this.entries.size <= this.max) return;
    for (const [k, e] of this.entries) {
      if (this.entries.size <= this.max) break;
      if (e.refs > 0) continue;
      this.disposeEntry(e);
      this.entries.delete(k);
    }
  }

  private disposeEntry(e: Entry): void {
    for (const s of SEGS) e.parts[s].dispose();
    e.parts.material.dispose();
    e.tex.dispose();
  }

  dispose(): void {
    for (const e of this.entries.values()) this.disposeEntry(e);
    this.entries.clear();
    for (const f of this.faceMats.values()) for (const mat of Object.values(f)) {
      (mat as THREE.MeshLambertMaterial).map?.dispose();
      mat.dispose();
    }
    this.faceMats.clear();
    for (const g of this.faceGeos.values()) g.dispose();
    this.faceGeos.clear();
  }
}

export { SEGS };
