import * as THREE from "three";
import type { Shape } from "./voxel-atlas";

// Sculpted parametric shapes for pixel-art models (units): rounded blocks (superellipsoids), lathes with a
// squarish-to-round cross-section (torsos, limbs, hats), and tapered curved strands (hair locks, tails). Low-to-mid
// poly on purpose: their grids are 8–16 segments round, smooth-shaded; the pixels come from the painted texture.

const TAU = Math.PI * 2;
type V3 = readonly [number, number, number];

/** sign(w)·|w|^e — the superellipse power. */
export function spow(w: number, e: number): number {
  return Math.sign(w) * Math.pow(Math.abs(w), e);
}

/** A rounded block centred at `c` with radii `r`; `e` < 1 squarer (0.3 ≈ a softened box), 1 = ellipsoid.
 *  `deform` may move each point (e.g. a narrower jaw, a flattened face). */
export function roundBlock(c: V3, r: V3, e = 0.5, opts: { seg?: [number, number]; deform?: (p: THREE.Vector3) => void } = {}): Shape {
  const [su, sv] = opts.seg ?? [8, 6];
  const at = (u: number, v: number) => {
    const th = u * TAU, ph = Math.min(1, Math.max(0, v)) * Math.PI;
    const sp = spow(Math.sin(ph), e);
    const p = new THREE.Vector3(c[0] + r[0] * sp * spow(Math.cos(th), e), c[1] + r[1] * spow(Math.cos(ph), e), c[2] + r[2] * sp * spow(Math.sin(th), e));
    opts.deform?.(p);
    return p;
  };
  const ring = TAU * Math.sqrt((r[0] * r[0] + r[2] * r[2]) / 2) * (e < 1 ? 1.1 : 1);
  return { at, center: () => new THREE.Vector3(...c), sizeU: ring, sizeV: Math.PI * r[1] * (e < 1 ? 1.05 : 1), segU: su, segV: sv };
}

/** One row of a lathe profile: height `y`, half-widths `rx` (sideways) and `rz` (front-back), optional centre shift. */
export interface Ring { y: number; rx: number; rz: number; x?: number; z?: number }

/** A lathe through `rings` (top first); the cross-section is a superellipse of power `e` (1 = ellipse, <1 squarer).
 *  Put rx = rz = 0 on the first/last ring to close the ends. `seg` = segments round. */
export function lathe(rings: readonly Ring[], e = 0.8, seg = 10, deform?: (p: THREE.Vector3) => void): Shape {
  const n = rings.length;
  // v runs ring to ring (one grid row per ring, so the silhouette keeps its sculpted corners)
  const ringAt = (v: number): Ring => {
    const f = Math.min(1, Math.max(0, v)) * (n - 1);
    const i = Math.min(n - 2, Math.floor(f)), t = f - i;
    const a = rings[i], b = rings[i + 1];
    const L = (p: number, q: number) => p + (q - p) * t;
    return { y: L(a.y, b.y), rx: L(a.rx, b.rx), rz: L(a.rz, b.rz), x: L(a.x ?? 0, b.x ?? 0), z: L(a.z ?? 0, b.z ?? 0) };
  };
  const at = (u: number, v: number) => {
    const r = ringAt(v), th = u * TAU;
    const p = new THREE.Vector3((r.x ?? 0) + r.rx * spow(Math.cos(th), e), r.y, (r.z ?? 0) + r.rz * spow(Math.sin(th), e));
    deform?.(p);
    return p;
  };
  let total = 0;
  for (let i = 1; i < n; i++) total += Math.hypot(rings[i - 1].y - rings[i].y, (rings[i - 1].rx + rings[i - 1].rz) / 2 - (rings[i].rx + rings[i].rz) / 2);
  const maxR = rings.reduce((m, r) => Math.max(m, (r.rx + r.rz) / 2), 0.1);
  return {
    at,
    center: (_u, v) => { const r = ringAt(v); return new THREE.Vector3(r.x ?? 0, r.y, r.z ?? 0); },
    sizeU: TAU * maxR * (e < 1 ? 1.1 : 1), sizeV: Math.max(1, total), segU: seg, segV: n - 1, fixedV: true,
  };
}

/** A tapered strand along a quadratic Bézier p0 → p1 (control) → p2: width `w` (along `side`) and thickness `t`
 *  (the other way) go from the root values to the tip ones; both ends are rounded shut. */
export function strand(p0: V3, p1: V3, p2: V3, w: readonly [number, number], t: readonly [number, number], side: V3 = [1, 0, 0], seg: [number, number] = [5, 5]): Shape {
  const A = new THREE.Vector3(...p0), B = new THREE.Vector3(...p1), C = new THREE.Vector3(...p2);
  const S0 = new THREE.Vector3(...side).normalize();
  const point = (v: number) => {
    const k = 1 - v;
    return A.clone().multiplyScalar(k * k).addScaledVector(B, 2 * k * v).addScaledVector(C, v * v);
  };
  const tangent = (v: number) => B.clone().sub(A).multiplyScalar(2 * (1 - v)).addScaledVector(C.clone().sub(B), 2 * v).normalize();
  const at = (u: number, v: number) => {
    const vc = Math.min(1, Math.max(0, v));
    const T = tangent(vc);
    const S = S0.clone().addScaledVector(T, -S0.dot(T)).normalize();
    const N = T.clone().cross(S).normalize();
    const cap = Math.sqrt(Math.min(1, vc / 0.12)) * Math.sqrt(Math.min(1, (1 - vc) / 0.1));
    const ww = (w[0] + (w[1] - w[0]) * vc) * cap, tt = (t[0] + (t[1] - t[0]) * vc) * cap;
    const th = u * TAU;
    return point(vc).addScaledVector(S, ww * spow(Math.cos(th), 0.8)).addScaledVector(N, tt * spow(Math.sin(th), 0.8));
  };
  const len = A.distanceTo(B) + B.distanceTo(C);
  return { at, center: (_u, v) => point(Math.min(1, Math.max(0, v))), sizeU: TAU * Math.max(w[0], w[1]) * 0.8, sizeV: len, segU: seg[0], segV: seg[1] };
}
