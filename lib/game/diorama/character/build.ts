import * as THREE from "three";
import type { Gender } from "@/lib/game/types";
import type { ChibiHat, ChibiSpec } from "./spec";
import { FACE_EXPRS, FACE_H, FACE_W, facePixels, type FaceExpr } from "./voxel-face";
import { VoxelModel, around, type Painter, type RGB, type Shape, type Texel } from "./voxel-atlas";
import { lathe, roundBlock, smoothRings, spow, strand, type Ring } from "./voxel-shapes";
import { mix, painted, pixelTexture, rgb, shade, solid, tone, voxelMaterial } from "./voxel-material";

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

/** Per body type: where the arms and legs hang and how big the head is drawn. Boys: broader shoulders, a touch
 *  wider stance; girls: narrower shoulders, a slightly bigger head on a slimmer body. */
export interface BodyDims { shoulderX: number; legX: number; headScale: number }
export const BODY: Record<Gender, BodyDims> = {
  nam: { shoulderX: 4.85 * VOX, legX: 1.8 * VOX, headScale: 1.3 },
  nu: { shoulderX: 4.05 * VOX, legX: 1.7 * VOX, headScale: 1.34 },
};

/** Lathe smoothing (extra rings between the sculpted ones) for the model being built: high detail only. */
let SMOOTH = 2;

/** The ink outline's width (world units). */
const OUTLINE = 0.011;

const SEGS = ["head", "torso", "upperL", "upperR", "foreL", "foreR", "thighL", "thighR", "calfL", "calfR", "rod"] as const;
export type Seg = (typeof SEGS)[number];

export interface ChibiParts extends Record<Seg, THREE.BufferGeometry> {
  /** The look's atlas material (all segments). */
  material: THREE.Material;
  /** The face decal (shared) and its expressions for this body type (shared). */
  faceGeo: THREE.BufferGeometry;
  faces: Record<FaceExpr, THREE.Material>;
  /** Where this body type's limbs attach. */
  dims: BodyDims;
}

type V3 = readonly [number, number, number];
type M = VoxelModel<Seg>;

const isFront = (t: Texel) => t.dir === "pz";
/** A round lathe ring list from (y, r) pairs (rz = r·kz). */
const rings = (pts: readonly (readonly [number, number])[], kz = 1, x = 0, z = 0): Ring[] => pts.map(([y, r]) => ({ y, rx: r, rz: r * kz, x, z }));

// ---- head (head space: chin at y 0, face toward +z) ----

const HEAD = { cy: 4.7, rx: 4.2, ry: 4.8, rz: 4.1, e: 0.62, flat: 3.7 } as const;

/** How much the jaw narrows toward the chin: a squarer jaw for boys, a softer, rounder-pointed chin for girls. */
const JAW: Record<Gender, number> = { nam: 0.17, nu: 0.27 };

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
export function headFrontZ(x: number, y: number, jaw = JAW.nam): number | null {
  const k = y < HEAD.cy ? (HEAD.cy - y) / HEAD.ry : 0;
  const jx = 1 - jaw * k * k, jz = 1 - 0.06 * k * k;
  const p = 2 / HEAD.e;
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
  const cy = HEAD.cy + 0.3, rx = (HEAD.rx + 0.3) * grow, ry = (HEAD.ry + 0.45) * grow, rz = (HEAD.rz + 0.5) * grow, e = HEAD.e;
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

function buildHead(m: M, s: ChibiSpec): void {
  const skin = rgb(s.skin), skinSh = rgb(s.skinShade);
  m.surface("head", roundBlock([0, HEAD.cy, 0], [HEAD.rx, HEAD.ry, HEAD.rz], HEAD.e, { seg: [20, 12], deform: headDeform(JAW[s.gender] ?? JAW.nam) }),
    painted((t) => (t.n[1] < -0.8 && t.y < 1.2 ? mix(skin, skinSh, 0.35) : skin), 0.02));
  // ears: a rounded shell with a darker inner fold
  for (const sx of [-1, 1]) {
    m.surface("head", roundBlock([sx * 3.95, 4.3, 0.1], [0.5, 0.95, 0.62], 0.8, { seg: [8, 7] }),
      painted((t) => (t.x * sx > 4.2 && Math.abs(t.y - 4.3) < 0.45 && Math.abs(t.z - 0.1) < 0.3 ? mix(skin, skinSh, 0.6) : skin), 0.02));
  }
  const hp = hairPainter(s);
  buildHair(m, s, hp, !!s.hat);
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

function strawPainter(main: string, shadeHex: string, band: string): Painter {
  const a = rgb(main), b = rgb(shadeHex), c = rgb(band);
  return (t) => {
    if (t.y > 9.95 && t.y < 10.45 && t.n[1] > 0) return shade(c, tone(t, 0.04));
    const ring = Math.floor((14 - t.y) * 0.8);                                   // a few flat woven rings
    return shade(ring % 2 === 1 && t.n[1] > 0 ? mix(a, b, 0.3) : a, tone(t, 0.05));
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
  const surf = (s: Shape, p: Painter) => m.surface("head", s, p);
  switch (h.shape) {
    case "nonla":
      surf(lathe(rings([[14.2, 0], [13.9, 0.45], [9.7, 6.9], [9.45, 7.0], [9.35, 6.7], [9.9, 4.5], [10.1, 0]]), 1, 18), strawPainter(h.main, h.shade, h.accent));
      break;
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
      surf(lathe(hatProfile(12.2, 4.4, 9.1, 7.7), 1, 18), banded(h.main, h.brim, 9.4, 10.2));
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
  const T = rgb(s.torso), TS = rgb(s.torsoShade), D = rgb(s.detail), SK = rgb(s.skin);
  const bare = s.torso === s.skin;
  const band = s.band ? rgb(s.band) : null;
  const neck = s.neck && s.neck.kind !== "scarf" ? s.neck : null;
  return (t) => {
    const ax = Math.abs(t.x);
    let c: RGB = T;
    if (bare) {
      c = SK;
      if (band && t.y > 5.2 && t.y < 7.9) c = t.y < 5.6 ? shade(band, 0.85) : band;
      if (band && t.y >= 7.9 && Math.abs(ax - 1.9) < 0.3) c = band;
      if (!band && isFront(t) && ax < 0.3 && Math.abs(t.y - 3.2) < 0.3) c = rgb(s.skinShade);   // navel
    } else {
      if (s.sleeve === "none" && t.y > 7.2 && ax > 2.2) c = SK;                   // tank top: bare shoulders, straps
      if (t.z > 0) {
        const open = t.y - 7.6;
        if (open > 0 && ax < 0.4 + open * 0.8) c = SK;
        else if (s.detail !== s.torso && open > -0.6 && ax < 0.4 + (open + 0.6) * 0.8 + 0.3) c = D;
        else if (s.detail !== s.torso && isFront(t) && ax < 0.26 && t.y < 7.1 && t.y > 2) c = D;
      }
      if (t.y > 9.1 && ax < 1.6) c = SK;
      if (t.y < 2.1 && t.y > 1.4) c = TS;
    }
    if (neck && t.z > 0) {
      if (ax < 1.8 && Math.abs(t.y - (7.8 + ax * 0.55)) < 0.28) c = rgb(neck.main);
      if (ax < 0.3 && t.y > 7.0 && t.y < 7.6) c = rgb(neck.accent);
    }
    return shade(c, tone(t, 0.04));
  };
}

function hipsPainter(s: ChibiSpec): Painter {
  const B = rgb(s.lower === "robe" ? s.torso : s.bottom), BS = rgb(s.lower === "robe" ? s.torsoShade : s.bottomShade);
  const belt = s.belt ? rgb(s.belt) : null;
  const jeans = s.calf !== s.skin && s.lower === "pants";
  return (t) => {
    const ax = Math.abs(t.x);
    let c: RGB = t.y > 1 ? BS : B;
    if (belt && t.y > 0.3 && t.y < 1.5) c = isFront(t) && ax < 0.7 ? shade(belt, 0.75) : belt;
    else if (jeans && t.y > 0.8) c = isFront(t) && ax < 0.55 ? rgb("#cdb77a") : shade(B, 0.7);
    else if (isFront(t) && ax < 0.15 && t.y < 0.8 && s.lower === "pants") c = shade(B, 0.8);
    return shade(c, tone(t, 0.04));
  };
}

function skirtPainter(base: string, shadeHex: string, pleats: boolean, placket?: string): Painter {
  const a = rgb(base), b = rgb(shadeHex), p = placket ? rgb(placket) : null;
  return (t) => {
    let c: RGB = a;
    if (pleats && Math.floor(t.u / 3) % 2 === 0) c = mix(a, b, 0.6);
    if (p && isFront(t) && Math.abs(t.x) < 0.3) c = p;
    if (t.v >= t.h - 2 && t.n[1] > -0.5) c = shade(c, 0.85);                   // hem
    return shade(c, tone(t, 0.04));
  };
}

function buildTorso(m: M, s: ChibiSpec): void {
  const nu = s.gender === "nu";
  const chest = chestPainter(s), hips = hipsPainter(s);
  // a sculpted profile, then smoothed: boys straighter and V-shaped (broad shoulders, flat chest, narrow hips); girls
  // narrower in the shoulder with a soft bust, a defined waist and fuller hips. The top rings slope down from the neck
  // into the shoulders so the arms' deltoids meet the torso in a curve, not a step.
  const body: Ring[] = nu
    ? [{ y: 9.6, rx: 0, rz: 0 }, { y: 9.6, rx: 1.5, rz: 1.1 }, { y: 9.35, rx: 2.45, rz: 1.55 }, { y: 8.85, rx: 3.15, rz: 1.85 }, { y: 8.0, rx: 3.3, rz: 1.95 },
      { y: 6.8, rx: 3.15, rz: 2.3, z: 0.2 }, { y: 5.6, rx: 2.9, rz: 2.05, z: 0.1 }, { y: 4.2, rx: 2.5, rz: 1.72 }, { y: 2.6, rx: 2.9, rz: 1.85 },
      { y: 1.0, rx: 3.45, rz: 2.05 }, { y: 0, rx: 3.55, rz: 2.1 }, { y: -1.2, rx: 3.2, rz: 2.0 }, { y: -2.0, rx: 2.3, rz: 1.55 }, { y: -2.35, rx: 0, rz: 0 }]
    : [{ y: 9.7, rx: 0, rz: 0 }, { y: 9.7, rx: 1.8, rz: 1.3 }, { y: 9.45, rx: 2.95, rz: 1.8 }, { y: 8.9, rx: 3.95, rz: 2.1 }, { y: 8.0, rx: 4.15, rz: 2.2 },
      { y: 6.6, rx: 3.95, rz: 2.25, z: 0.1 }, { y: 5.0, rx: 3.55, rz: 2.0 }, { y: 3.4, rx: 3.3, rz: 1.9 }, { y: 1.8, rx: 3.3, rz: 1.95 },
      { y: 0, rx: 3.35, rz: 2.0 }, { y: -1.3, rx: 3.0, rz: 1.9 }, { y: -2.0, rx: 2.2, rz: 1.5 }, { y: -2.35, rx: 0, rz: 0 }];
  m.surface("torso", lathe(smoothRings(body, SMOOTH), 0.74, 20), (t) => (t.y >= 1.5 ? chest(t) : hips(t)));
  // the neck flares into the trapezius
  const nk = nu ? 0.88 : 1;
  m.surface("torso", lathe(rings([[11.3, 0], [11.3, 1.05 * nk], [10.4, 1.1 * nk], [9.7, 1.3 * nk], [9.2, 1.85 * nk], [8.8, 0]]), 1, 12), solid(s.skinShade, 0.02));
  const skirt = (r: readonly (readonly [number, number, number])[], p: Painter) => m.surface("torso", lathe(r.map(([y, rx, rz]) => ({ y, rx, rz })), 0.8, 16), p);
  switch (s.lower) {
    case "skirt": skirt([[2.2, 3.15, 1.95], [-4.2, 4.3, 2.9], [-4.45, 4.0, 2.7], [-4.45, 0, 0]], skirtPainter(s.bottom, s.bottomShade, false)); break;
    case "pleated": skirt([[2.2, 3.15, 1.95], [-4.8, 4.5, 3.0], [-5.05, 4.2, 2.8], [-5.05, 0, 0]], skirtPainter(s.bottom, s.bottomShade, true)); break;
    case "maxi": skirt([[2.2, 3.15, 1.95], [-4, 3.9, 2.6], [-11.4, 4.9, 3.3], [-11.7, 4.6, 3.1], [-11.7, 0, 0]], skirtPainter(s.bottom, s.bottomShade, false)); break;
    case "robe": skirt([[2.2, 3.3, 2.05], [-4, 3.9, 2.6], [-10.8, 4.6, 3.1], [-11.1, 4.3, 2.9], [-11.1, 0, 0]], skirtPainter(s.torso, s.torsoShade, false, s.detail)); break;
    default: break;
  }
  if (s.belt) {
    m.surface("torso", roundBlock([0.9, -0.9, 2.05], [0.35, 1.5, 0.2], 0.6, { seg: [6, 5] }), solid(s.belt));
    m.surface("torso", roundBlock([-0.1, -0.6, 2.05], [0.35, 1.2, 0.2], 0.6, { seg: [6, 5] }), solid(s.belt));
  }
  if (s.neck?.kind === "scarf") {
    m.surface("torso", lathe(rings([[10.1, 0], [10.1, 1.6], [9.6, 2.35], [8.5, 2.5], [8.3, 0]], 0.85), 0.85, 14), solid(s.neck.main));
    m.surface("torso", roundBlock([1.2, 7.2, 2.3], [0.6, 1.6, 0.3], 0.6, { seg: [6, 6] }), solid(s.neck.shade));
  }
}

// ---- limbs (each hangs down, -y, from its pivot) ----

function buildArm(m: M, s: ChibiSpec, side: -1 | 1): void {
  const up: Seg = side < 0 ? "upperL" : "upperR", fo: Seg = side < 0 ? "foreL" : "foreR";
  const nu = s.gender === "nu";
  const k = nu ? 0.86 : 1.04, hk = nu ? 0.9 : 1.08;                            // limb and hand thickness
  const sleeveC = rgb(s.sleeveColor), skin = rgb(s.skin), skinSh = rgb(s.skinShade);
  const long = s.sleeve === "long";
  // upper arm: a round deltoid cap tapering to the elbow
  m.surface(up, lathe(rings([[1.2, 0], [1.1, 0.72 * k], [0.65, 1.1 * k], [0, 1.18 * k], [-1.4, 1.08 * k], [-3.2, 0.98 * k], [-4.6, 0.9 * k], [-5.15, 0.62 * k], [-5.3, 0]]), 0.85, 12),
    painted(() => (long ? sleeveC : skin), 0.04));
  if (s.sleeve === "short") {
    m.surface(up, lathe(rings([[1.45, 0], [1.35, 0.9 * k], [0.8, 1.38 * k], [0, 1.45 * k], [-2.2, 1.36 * k], [-2.55, 1.12 * k], [-2.6, 0]]), 0.85, 12),
      painted((t) => (t.y < -2.0 ? shade(sleeveC, 0.84) : sleeveC), 0.04));
  }
  m.surface(fo, lathe(rings([[0.7, 0], [0.55, 0.72 * k], [0, 0.95 * k], [-1.2, 0.98 * k], [-2.8, 0.85 * k], [-3.8, 0.74 * k], [-4.25, 0.52 * k], [-4.35, 0]]), 0.85, 12),
    painted((t) => (long ? (t.y < -3.3 ? shade(sleeveC, 0.85) : sleeveC) : skin), 0.04));
  // the hand: a soft palm with the fingers drawn in (creases toward the tips), and a curved thumb in front
  const inner = -side;
  m.surface(fo, roundBlock([0, -5.2, 0.05], [0.66 * hk, 1.05 * hk, 0.88 * hk], 0.72, { seg: [12, 8] }),
    painted((t) => {
      const tip = t.y < -5.55;
      if (tip && [-0.32, 0.12, 0.52].some((zc) => Math.abs(t.z - zc * hk) < 0.08)) return mix(skin, skinSh, 0.75);
      return tip ? mix(skin, skinSh, 0.25) : skin;
    }, 0.02));
  m.surface(fo, strand([inner * 0.45 * hk, -4.7, 0.55 * hk], [inner * 0.72 * hk, -5.15, 0.95 * hk], [inner * 0.5 * hk, -5.75, 1.0 * hk], [0.3 * hk, 0.22 * hk], [0.28 * hk, 0.2 * hk], [1, 0, 0], [6, 5]),
    solid(s.skin, 0.02));
  if (side > 0 && s.wrist) {
    m.surface(fo, lathe(rings([[-3.2, 0.9 * k], [-3.85, 0.86 * k]], 1), 0.85, 12), solid(s.wrist.main));
    if (s.wrist.kind === "watch") m.surface(fo, roundBlock([0, -3.5, 0.88 * k], [0.45, 0.42, 0.22], 0.5, { seg: [6, 4] }), solid(s.wrist.accent));
  }
}

function buildLeg(m: M, s: ChibiSpec, side: -1 | 1): void {
  const th: Seg = side < 0 ? "thighL" : "thighR", ca: Seg = side < 0 ? "calfL" : "calfR";
  const nu = s.gender === "nu";
  const skin = rgb(s.skin), bottom = rgb(s.bottom);
  const long = s.calf !== s.skin;
  const shorts = !long && s.thigh !== s.skin;
  const briefs = !long && !shorts && s.lower === "pants";
  // girls: fuller at the hip, slimmer at the knee; boys: straighter
  const thigh: readonly (readonly [number, number])[] = nu
    ? [[0.9, 0], [0.8, 1.35], [0.3, 1.86], [-1.5, 1.78], [-3.5, 1.5], [-5.3, 1.22], [-6.05, 1.0], [-6.4, 0]]
    : [[0.9, 0], [0.8, 1.3], [0.3, 1.74], [-1.5, 1.7], [-3.5, 1.56], [-5.3, 1.36], [-6.05, 1.1], [-6.4, 0]];
  m.surface(th, lathe(rings(thigh, 0.95), 0.85, 12), painted((t) => {
    if (long) return rgb(s.thigh);
    if (briefs && t.y > -1.1) return t.y < -0.8 ? shade(bottom, 0.85) : bottom;
    return skin;
  }, 0.04));
  if (shorts) {
    const cloth = rgb(s.thigh);
    m.surface(th, lathe(rings([[1.3, 0], [1.2, 1.6], [0.4, 2.05], [-3.3, 1.98], [-3.6, 1.55], [-3.6, 0]], 0.95), 0.85, 12), painted((t) => {
      if (t.y < -3.1) return shade(cloth, 0.78);
      return cloth;
    }, 0.04));
  }
  // calf and foot
  const sh = s.shoe, main = rgb(sh.main), sole = rgb(sh.sole);
  const boots = sh.shape === "boots", sneakers = sh.shape === "sneakers";
  const ck = nu ? 0.93 : 1;
  m.surface(ca, lathe(rings([[0.6, 0], [0.5, 1.15 * ck], [0, 1.36 * ck], [-1.4, 1.46 * ck], [-3.0, 1.3 * ck], [-4.6, 1.08 * ck], [-5.8, 0.98 * ck], [-6.2, 0.82 * ck], [-6.35, 0]], 0.95), 0.85, 12), painted((t) => {
    if (long) return t.y < -5.2 ? shade(rgb(s.calf), 0.85) : rgb(s.calf);
    if (sneakers && t.y < -4.9) return rgb("#f2eee6");
    return skin;
  }, 0.04));
  if (boots) {
    m.surface(ca, lathe(rings([[-2.2, 0], [-2.2, 1.72], [-3.1, 1.72], [-3.1, 1.52], [-6.4, 1.3], [-6.4, 0]], 0.97), 0.75, 12),
      painted((t) => (t.y > -3.15 ? sole : main), 0.04));
  }
  if (sh.shape === "dep" || sh.shape === "sandals") {
    m.surface(ca, roundBlock([0, -7.05, 0.5], [1.26, 0.78, 1.92], 0.62, { seg: [12, 7], deform: (p) => { if (p.z > 1.1) p.y -= (p.z - 1.1) * 0.15; } }), solid(s.skin, 0.02));
    m.surface(ca, roundBlock([0, -7.8, 0.5], [1.48, 0.24, 2.2], 0.4, { seg: [12, 4] }), solid(sh.sole));
    m.surface(ca, roundBlock([0, -6.75, 1.0], [1.36, 0.26, 0.55], 0.5, { seg: [8, 4] }), solid(sh.main));
    if (sh.shape === "sandals") m.surface(ca, roundBlock([0, -6.3, -0.9], [1.25, 0.24, 0.6], 0.5, { seg: [8, 4] }), solid(sh.main));
  } else {
    m.surface(ca, roundBlock([0, -6.95, 0.6], [1.45, 1.0, 2.15], 0.58, { seg: [14, 8], deform: (p) => { if (p.z > 1.2) p.y -= (p.z - 1.2) * 0.12; } }), painted((t) => {
      if (sneakers && t.n[1] > 0.4 && Math.abs(t.x) < 0.55 && t.z > 0.6 && t.z < 1.9) return rgb("#f4f1ea");     // the laces panel
      if (sneakers && t.z > 1.9) return rgb("#f4f1ea");                                                        // the toe cap
      return main;
    }, 0.04));
    m.surface(ca, roundBlock([0, -7.75, 0.6], [1.56, 0.3, 2.28], 0.4, { seg: [14, 4] }), solid(sh.sole));
  }
}

function buildRod(m: M): void {
  m.surface("rod", roundBlock([0, 0, 0.2], [0.3, 0.3, 1.4], 0.6, { seg: [6, 5] }), solid("#3a2418"));
  m.surface("rod", strand([0, 0, 1.4], [0, 0, 10], [0, 0, 19], [0.14, 0.09], [0.14, 0.09], [1, 0, 0], [6, 4]),
    painted((t) => (Math.floor(t.v / 3) % 2 ? "#6f4526" : "#8b5a33"), 0.03));
}

/** The face decal: the head front's 8×9-unit face area as a grid hugging the flattened face. */
function buildFaceGeo(g0: Gender): THREE.BufferGeometry {
  const jaw = JAW[g0] ?? JAW.nam;
  const g = new THREE.PlaneGeometry(8 * VOX, 9 * VOX, 16, 18);
  const pos = g.getAttribute("position"), uv = g.getAttribute("uv");
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) / VOX, y = pos.getY(i) / VOX + 4.5;
    const z = headFrontZ(x, y, jaw);
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
  buildHead(m, spec);
  buildTorso(m, spec);
  buildArm(m, spec, -1);
  buildArm(m, spec, 1);
  buildLeg(m, spec, -1);
  buildLeg(m, spec, 1);
  buildRod(m);
  return detail === "high" ? m.build(3, VOX, 1, true) : m.build(1, VOX, 0.6, false);
}

interface Entry { parts: ChibiParts; tex: THREE.Texture; refs: number }

/** Builds the parts once per look key and detail level; actors `acquire` and `release` them (idle entries beyond
 *  `max` are disposed, oldest first). */
export class ChibiFactory {
  private readonly entries = new Map<string, Entry>();
  private readonly faceGeos = new Map<Gender, THREE.BufferGeometry>();
  private readonly faceMats = new Map<Gender, Record<FaceExpr, THREE.Material>>();

  constructor(private readonly max = 120) {}

  private faceGeo(g: Gender): THREE.BufferGeometry {
    let geo = this.faceGeos.get(g);
    if (!geo) this.faceGeos.set(g, (geo = buildFaceGeo(g)));
    return geo;
  }

  private faces(g: Gender): Record<FaceExpr, THREE.Material> {
    let f = this.faceMats.get(g);
    if (!f) {
      const out = {} as Record<FaceExpr, THREE.Material>;
      for (const e of FACE_EXPRS) {
        const mat = voxelMaterial(pixelTexture(facePixels(e, g), FACE_W, FACE_H), { transparent: true });
        mat.polygonOffset = true;
        mat.polygonOffsetFactor = -2;
        out[e] = mat;
      }
      this.faceMats.set(g, (f = out));
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
      e = { refs: 0, tex, parts: { ...b.geos, material: voxelMaterial(tex, { outline: detail === "high" ? OUTLINE : 0 }), faceGeo: this.faceGeo(spec.gender), faces: this.faces(spec.gender), dims: BODY[spec.gender] ?? BODY.nam } };
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
