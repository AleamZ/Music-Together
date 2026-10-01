import * as THREE from "three";

// Pixel-art models: a model is a set of named segments, each made of pieces — parametric SURFACES (sculpted shapes:
// lathes, rounded blocks, tapered strands; see voxel-shapes.ts) and plain boxes. Every surface (and every box face)
// gets its own rectangle in ONE texture atlas, painted texel by texel by a painter that sees the texel's position and
// normal on the model; the atlas is plain RGBA bytes (a DataTexture, no DOM), nearest-filtered so the pixels stay
// crisp. Reusable for props and the environment, not only the characters.

export type RGB = readonly [number, number, number];
export type FaceDir = "px" | "nx" | "py" | "ny" | "pz" | "nz";

const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

/** `#rrggbb` → bytes. */
export function rgb(hex: string): RGB {
  const n = parseInt(hex.slice(1, 7), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** Brightness scale. */
export function shade(c: RGB, k: number): RGB {
  return [clamp(c[0] * k), clamp(c[1] * k), clamp(c[2] * k)];
}
/** Linear mix a→b. */
export function mix(a: RGB, b: RGB, t: number): RGB {
  return [clamp(a[0] + (b[0] - a[0]) * t), clamp(a[1] + (b[1] - a[1]) * t), clamp(a[2] + (b[2] - a[2]) * t)];
}
/** A deterministic 0..1 hash of an integer lattice point (per-pixel noise). */
export function hash3(x: number, y: number, z: number, seed = 0): number {
  let h = (Math.floor(x) * 374761393 + Math.floor(y) * 668265263 + Math.floor(z) * 2147483647 + seed * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** What a painter is told about one texel: its centre `x/y/z` in the piece's own (untransformed) units, the outward
 *  normal `n` there, the dominant direction of that normal (`dir`), and its column/row `u/v` in a `w`×`h` rectangle
 *  (v = 0 at the top of a box face, at the start — the top — of a surface). */
export interface Texel { dir: FaceDir; u: number; v: number; w: number; h: number; x: number; y: number; z: number; n: RGBLike; surface: boolean }
type RGBLike = readonly [number, number, number];
/** Returns a colour, or null for "transparent" (alpha 0). */
export type Painter = (t: Texel) => RGB | null;

export interface BoxOpts {
  /** Applied after painting coordinates are taken (rotation about a pivot etc.), in units. */
  matrix?: THREE.Matrix4;
  /** Faces not to build (hidden against another piece). */
  skip?: readonly FaceDir[];
}

/** A parametric surface: `at(u, v)` for u, v in [0, 1] (u goes round, v along), in units. `center(v)` is a point
 *  inside the shape at that v (normals point away from it). `sizeU/sizeV`: its extent in units (texel counts). */
export interface Shape {
  at: (u: number, v: number) => THREE.Vector3;
  center: (u: number, v: number) => THREE.Vector3;
  sizeU: number;
  sizeV: number;
  /** Grid resolution at detail "high" (low halves it). */
  segU: number;
  segV: number;
  /** segV is exact (lathe rows) — never coarsened. */
  fixedV?: boolean;
}

interface Box { kind: "box"; min: RGBLike; max: RGBLike; paint: Painter; opts: BoxOpts }
interface Surf { kind: "surf"; shape: Shape; paint: Painter; matrix?: THREE.Matrix4; sharp: number; ink: boolean; tag: number }
type Piece = Box | Surf;

interface FaceDef { dir: FaceDir; n: [number, number, number]; o: (a: Box) => THREE.Vector3; u: (a: Box) => THREE.Vector3; v: (a: Box) => THREE.Vector3 }

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const FACES: readonly FaceDef[] = [
  { dir: "pz", n: [0, 0, 1], o: (b) => V(b.min[0], b.max[1], b.max[2]), u: (b) => V(b.max[0] - b.min[0], 0, 0), v: (b) => V(0, b.min[1] - b.max[1], 0) },
  { dir: "nz", n: [0, 0, -1], o: (b) => V(b.max[0], b.max[1], b.min[2]), u: (b) => V(b.min[0] - b.max[0], 0, 0), v: (b) => V(0, b.min[1] - b.max[1], 0) },
  { dir: "px", n: [1, 0, 0], o: (b) => V(b.max[0], b.max[1], b.max[2]), u: (b) => V(0, 0, b.min[2] - b.max[2]), v: (b) => V(0, b.min[1] - b.max[1], 0) },
  { dir: "nx", n: [-1, 0, 0], o: (b) => V(b.min[0], b.max[1], b.min[2]), u: (b) => V(0, 0, b.max[2] - b.min[2]), v: (b) => V(0, b.min[1] - b.max[1], 0) },
  { dir: "py", n: [0, 1, 0], o: (b) => V(b.min[0], b.max[1], b.min[2]), u: (b) => V(b.max[0] - b.min[0], 0, 0), v: (b) => V(0, 0, b.max[2] - b.min[2]) },
  { dir: "ny", n: [0, -1, 0], o: (b) => V(b.min[0], b.min[1], b.max[2]), u: (b) => V(b.max[0] - b.min[0], 0, 0), v: (b) => V(0, 0, b.min[2] - b.max[2]) },
];

function dirOf(n: THREE.Vector3): FaceDir {
  const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
  if (ay >= ax && ay >= az) return n.y >= 0 ? "py" : "ny";
  if (ax >= az) return n.x >= 0 ? "px" : "nx";
  return n.z >= 0 ? "pz" : "nz";
}

/** The outward unit normal of a shape at (u, v), from finite differences (the centre breaks ties at the poles). */
export function shapeNormal(s: Shape, u: number, v: number, out = new THREE.Vector3()): THREE.Vector3 {
  const e = 1e-3;
  const v0 = Math.max(0, v - e), v1 = Math.min(1, v + e);
  const du = s.at(u + e, v).sub(s.at(u - e, v));
  const dv = s.at(u, v1).sub(s.at(u, v0));
  out.crossVectors(du, dv);
  const p = s.at(u, v), away = p.clone().sub(s.center(u, v));
  if (out.lengthSq() < 1e-10) out.copy(away);
  if (out.dot(away) < 0) out.negate();
  return out.lengthSq() > 0 ? out.normalize() : out.set(0, 1, 0);
}

interface Rect { seg: string; piece: Piece; face?: FaceDef; w: number; h: number; x: number; y: number }

export interface VoxelBuild<S extends string> {
  geos: Record<S, THREE.BufferGeometry>;
  /** RGBA bytes, `width`×`height`, row 0 first (uv.y = 0). */
  pixels: Uint8Array;
  width: number;
  height: number;
}

/** Collects pieces per segment, then packs and paints one atlas and builds one geometry per segment. */
export class VoxelModel<S extends string> {
  private readonly segs = new Map<S, Piece[]>();
  /** Edge anti-aliasing: sub-samples per axis for texels on a painted edge (1 = off). */
  aa = 1;
  /** Texel density multiplier for the surfaces added from now on. */
  sharp = 1;
  /** Whether the surfaces added from now on get the ink outline (off for pieces blended into another: no inner lines). */
  ink = true;
  /** A number stored per vertex (attribute `tag`) for the surfaces added from now on (e.g. which bone skins them). */
  tag = 0;
  constructor(private readonly names: readonly S[]) {
    for (const n of names) this.segs.set(n, []);
  }

  /** A box from `min` to `max` (units) in segment `seg`. */
  box(seg: S, min: RGBLike, max: RGBLike, paint: Painter, opts: BoxOpts = {}): this {
    const lo = [Math.min(min[0], max[0]), Math.min(min[1], max[1]), Math.min(min[2], max[2])] as const;
    const hi = [Math.max(min[0], max[0]), Math.max(min[1], max[1]), Math.max(min[2], max[2])] as const;
    this.segs.get(seg)?.push({ kind: "box", min: lo, max: hi, paint, opts });
    return this;
  }

  /** A sculpted surface in segment `seg`, painted at `sharp`× the build's texel density (and the model's current
   *  `sharp`): the pieces that carry painted detail (collars, trims, prints) get more texels than flat ones. */
  surface(seg: S, shape: Shape, paint: Painter, matrix?: THREE.Matrix4, sharp = 1): this {
    this.segs.get(seg)?.push({ kind: "surf", shape, paint, matrix, sharp: sharp * this.sharp, ink: this.ink, tag: this.tag });
    return this;
  }

  /** `res`: texels per unit; `unit`: world size of one unit; `detail` < 1 coarsens the surface grids; `outline` > 0
   *  adds an inverted hull to every surface (attribute `outline` = 1 on its vertices: the material pushes them out
   *  along the normal and paints them dark — see voxel-material). */
  build(res: number, unit: number, detail = 1, outline = false): VoxelBuild<S> {
    const rects: Rect[] = [];
    for (const [seg, pieces] of this.segs) for (const piece of pieces) {
      if (piece.kind === "surf") {
        rects.push({ seg, piece, w: Math.max(2, Math.round(piece.shape.sizeU * res * piece.sharp)), h: Math.max(2, Math.round(piece.shape.sizeV * res * piece.sharp)), x: 0, y: 0 });
        continue;
      }
      for (const face of FACES) {
        if (piece.opts.skip?.includes(face.dir)) continue;
        const u = face.u(piece).length(), v = face.v(piece).length();
        rects.push({ seg, piece, face, w: Math.max(1, Math.round(u * res)), h: Math.max(1, Math.round(v * res)), x: 0, y: 0 });
      }
    }
    // shelf packing, tallest first
    // every rectangle gets a one-texel gutter repeating its edge (so smooth, linear-filtered sampling never bleeds)
    const G = 1;
    const area = rects.reduce((a, r) => a + (r.w + 2 * G) * (r.h + 2 * G), 0);
    const widest = rects.reduce((a, r) => Math.max(a, r.w + 2 * G), 1);
    let width = 64;
    while ((width * width < area * 1.5 || width < widest) && width < 4096) width *= 2;
    const order = [...rects].sort((a, b) => b.h - a.h || b.w - a.w);
    let x = 0, y = 0, shelf = 0;
    for (const r of order) {
      if (x + r.w + 2 * G > width) { x = 0; y += shelf; shelf = 0; }
      r.x = x + G; r.y = y + G;
      x += r.w + 2 * G;
      shelf = Math.max(shelf, r.h + 2 * G);
    }
    let height = 16;
    while (height < y + shelf) height *= 2;
    const pixels = new Uint8Array(width * height * 4);
    const pos = new THREE.Vector3(), nrm = new THREE.Vector3();
    // Every rectangle is painted at texel centres first; then each texel on an edge between two painted regions (a
    // collar, a hairline, a hem: its colour differs from a neighbour's) is repainted as the average of an `aa`×`aa`
    // grid of sub-samples, so painted edges come out anti-aliased (smooth, vector-like) instead of stair-stepped — at
    // the cost of painting only the edge texels again.
    const aa = Math.max(1, Math.round(this.aa));
    for (const r of rects) {
      let sample: (fu: number, fv: number, tu: number, tv: number) => RGB | null;
      if (r.piece.kind === "surf") {
        // sample the shape on a modest grid once, then interpolate per texel (cheap: no shape calls per pixel)
        const s = r.piece.shape, paint = r.piece.paint;
        const gu = Math.max(8, s.segU * 2), gv = Math.max(4, s.segV * 2);
        const GP = new Float32Array((gu + 1) * (gv + 1) * 3), GN = new Float32Array((gu + 1) * (gv + 1) * 3);
        for (let j = 0; j <= gv; j++) for (let i = 0; i <= gu; i++) {
          const k = (j * (gu + 1) + i) * 3;
          const p = s.at(i / gu, j / gv), n = shapeNormal(s, i / gu, j / gv);
          GP[k] = p.x; GP[k + 1] = p.y; GP[k + 2] = p.z;
          GN[k] = n.x; GN[k + 1] = n.y; GN[k + 2] = n.z;
        }
        const lerp = (A: Float32Array, fu: number, fv: number, out: THREE.Vector3) => {
          const i = Math.max(0, Math.min(gu - 1, Math.floor(fu))), j = Math.max(0, Math.min(gv - 1, Math.floor(fv))), a = fu - i, b = fv - j;
          const k00 = (j * (gu + 1) + i) * 3, k10 = k00 + 3, k01 = k00 + (gu + 1) * 3, k11 = k01 + 3;
          const w00 = (1 - a) * (1 - b), w10 = a * (1 - b), w01 = (1 - a) * b, w11 = a * b;
          return out.set(
            A[k00] * w00 + A[k10] * w10 + A[k01] * w01 + A[k11] * w11,
            A[k00 + 1] * w00 + A[k10 + 1] * w10 + A[k01 + 1] * w01 + A[k11 + 1] * w11,
            A[k00 + 2] * w00 + A[k10 + 2] * w10 + A[k01 + 2] * w01 + A[k11 + 2] * w11,
          );
        };
        sample = (fu0, fv0, tu, tv) => {
          const fu = (fu0 / r.w) * gu, fv = (fv0 / r.h) * gv;
          lerp(GP, fu, fv, pos);
          lerp(GN, fu, fv, nrm);
          if (nrm.lengthSq() > 0) nrm.normalize();
          return paint({ dir: dirOf(nrm), u: tu, v: tv, w: r.w, h: r.h, x: pos.x, y: pos.y, z: pos.z, n: [nrm.x, nrm.y, nrm.z], surface: true });
        };
      } else {
        const f = r.face;
        if (!f) continue;
        const piece = r.piece, o = f.o(piece), U = f.u(piece), Vv = f.v(piece);
        sample = (fu, fv, tu, tv) => {
          pos.copy(o).addScaledVector(U, fu / r.w).addScaledVector(Vv, fv / r.h);
          return piece.paint({ dir: f.dir, u: tu, v: tv, w: r.w, h: r.h, x: pos.x, y: pos.y, z: pos.z, n: f.n, surface: false });
        };
      }
      const at = (tu: number, tv: number) => ((r.y + tv) * width + r.x + tu) * 4;
      for (let tv = 0; tv < r.h; tv++) for (let tu = 0; tu < r.w; tu++) {
        const c = sample(tu + 0.5, tv + 0.5, tu, tv), i = at(tu, tv);
        if (c) { pixels[i] = c[0]; pixels[i + 1] = c[1]; pixels[i + 2] = c[2]; pixels[i + 3] = 255; }
      }
      if (aa < 2) continue;
      const edge = new Uint8Array(r.w * r.h);
      const differs = (a: number, b: number) => pixels[a + 3] !== pixels[b + 3] ||
        Math.abs(pixels[a] - pixels[b]) + Math.abs(pixels[a + 1] - pixels[b + 1]) + Math.abs(pixels[a + 2] - pixels[b + 2]) > 24;
      for (let tv = 0; tv < r.h; tv++) for (let tu = 0; tu < r.w; tu++) {
        const i = at(tu, tv), k = tv * r.w + tu;
        if (tu + 1 < r.w && differs(i, at(tu + 1, tv))) { edge[k] = 1; edge[k + 1] = 1; }
        if (tv + 1 < r.h && differs(i, at(tu, tv + 1))) { edge[k] = 1; edge[k + r.w] = 1; }
      }
      for (let tv = 0; tv < r.h; tv++) for (let tu = 0; tu < r.w; tu++) {
        if (!edge[tv * r.w + tu]) continue;
        let R = 0, Gc = 0, B = 0, A = 0;
        for (let sj = 0; sj < aa; sj++) for (let si = 0; si < aa; si++) {
          const c = sample(tu + (si + 0.5) / aa, tv + (sj + 0.5) / aa, tu, tv);
          if (c) { R += c[0]; Gc += c[1]; B += c[2]; A++; }
        }
        const i = at(tu, tv);
        if (A) { pixels[i] = Math.round(R / A); pixels[i + 1] = Math.round(Gc / A); pixels[i + 2] = Math.round(B / A); }
        pixels[i + 3] = Math.round((255 * A) / (aa * aa));
      }
    }
    for (const r of rects) {
      const cp = (fx: number, fy: number, tx: number, ty: number) => {
        const a = (fy * width + fx) * 4, b = (ty * width + tx) * 4;
        pixels[b] = pixels[a]; pixels[b + 1] = pixels[a + 1]; pixels[b + 2] = pixels[a + 2]; pixels[b + 3] = pixels[a + 3];
      };
      for (let u = 0; u < r.w; u++) { cp(r.x + u, r.y, r.x + u, r.y - 1); cp(r.x + u, r.y + r.h - 1, r.x + u, r.y + r.h); }
      for (let v = -1; v <= r.h; v++) { cp(r.x, r.y + v, r.x - 1, r.y + v); cp(r.x + r.w - 1, r.y + v, r.x + r.w, r.y + v); }
    }
    const geos = {} as Record<S, THREE.BufferGeometry>;
    const nm = new THREE.Matrix3();
    for (const name of this.names) {
      const P: number[] = [], N: number[] = [], UV: number[] = [], O: number[] = [], TG: number[] = [];
      let tag = 0;
      let hull = 0;
      const emit = (p: THREE.Vector3, n: THREE.Vector3, uv: readonly [number, number], m?: THREE.Matrix4) => {
        O.push(hull);
        TG.push(tag);
        const q = m ? p.clone().applyMatrix4(m) : p;
        const k = m ? n.clone().applyMatrix3(nm.getNormalMatrix(m)).normalize() : n;
        P.push(q.x * unit, q.y * unit, q.z * unit);
        N.push(k.x, k.y, k.z);
        UV.push(uv[0], uv[1]);
      };
      for (const r of rects) {
        if (r.seg !== name) continue;
        tag = r.piece.kind === "surf" ? r.piece.tag : 0;
        const e = 0.02;                                                   // inset: never sample the neighbour's texels
        const u0 = (r.x + e) / width, u1 = (r.x + r.w - e) / width, v0 = (r.y + e) / height, v1 = (r.y + r.h - e) / height;
        if (r.piece.kind === "surf") {
          const s = r.piece.shape;
          const su = Math.max(4, Math.round(s.segU * detail)), sv = s.fixedV ? s.segV : Math.max(2, Math.round(s.segV * detail));
          const grid: { p: THREE.Vector3; n: THREE.Vector3; uv: [number, number] }[] = [];
          for (let j = 0; j <= sv; j++) for (let i = 0; i <= su; i++) {
            const u = i / su, v = j / sv;
            grid.push({ p: s.at(u, v), n: shapeNormal(s, u, v), uv: [u0 + (u1 - u0) * u, v0 + (v1 - v0) * v] });
          }
          const g = (i: number, j: number) => grid[j * (su + 1) + i];
          const tri = (a: typeof grid[0], b: typeof grid[0], c: typeof grid[0]) => {
            const face = b.p.clone().sub(a.p).cross(c.p.clone().sub(a.p));
            if (face.lengthSq() < 1e-12) return;                           // collapsed at a pole
            const avg = a.n.clone().add(b.n).add(c.n);
            const list = face.dot(avg) >= 0 ? [a, b, c] : [a, c, b];
            const mat = r.piece.kind === "surf" ? r.piece.matrix : undefined;
            for (const q of list) emit(q.p, q.n, q.uv, mat);
            if (outline && r.piece.kind === "surf" && r.piece.ink) {
              hull = 1;
              for (const q of [list[0], list[2], list[1]]) emit(q.p, q.n, q.uv, mat);
              hull = 0;
            }
          };
          for (let j = 0; j < sv; j++) for (let i = 0; i < su; i++) {
            tri(g(i, j), g(i + 1, j), g(i, j + 1));
            tri(g(i + 1, j), g(i + 1, j + 1), g(i, j + 1));
          }
          continue;
        }
        const f = r.face;
        if (!f) continue;
        const o = f.o(r.piece), U = f.u(r.piece), Vv = f.v(r.piece), n = V(...f.n);
        const flip = U.clone().cross(Vv).dot(n) < 0;
        const c00 = { p: o.clone(), uv: [u0, v0] as const }, c10 = { p: o.clone().add(U), uv: [u1, v0] as const };
        const c01 = { p: o.clone().add(Vv), uv: [u0, v1] as const }, c11 = { p: o.clone().add(U).add(Vv), uv: [u1, v1] as const };
        for (const c of flip ? [c00, c01, c10, c10, c01, c11] : [c00, c10, c01, c10, c11, c01]) emit(c.p, n, c.uv, r.piece.opts.matrix);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(P), 3));
      g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(N), 3));
      g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(UV), 2));
      g.setAttribute("outline", new THREE.BufferAttribute(new Float32Array(O), 1));
      g.setAttribute("tag", new THREE.BufferAttribute(new Float32Array(TG), 1));
      g.computeBoundingSphere();
      geos[name] = g;
    }
    return { geos, pixels, width, height };
  }
}

/** A matrix rotating about a pivot (units) by Euler angles, then moving by `offset`. */
export function around(pivot: RGBLike, rot: RGBLike, offset: RGBLike = [0, 0, 0]): THREE.Matrix4 {
  return new THREE.Matrix4()
    .makeTranslation(pivot[0] + offset[0], pivot[1] + offset[1], pivot[2] + offset[2])
    .multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rot[0], rot[1], rot[2])))
    .multiply(new THREE.Matrix4().makeTranslation(-pivot[0], -pivot[1], -pivot[2]));
}
