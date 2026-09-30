import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Roof } from "@/lib/game/housing/lot";
import type { PetSpecies } from "@/lib/game/pets/catalog";
import type { BossId, WildSpeciesId } from "@/lib/game/realm/model";
import type { VehicleKind } from "./live-plan";

// Browser only: the low-poly toon models for the world's live things — animals and pets, the bosses, stalls, fight
// rings, houses by roof, the ghe, vehicles, the bamboo barrier. Each model's static parts are baked into one vertex-
// coloured geometry (one draw call); only what moves (legs, wings, wheels, oars, the barrier's pole) is its own mesh.
// Units: 1 = 16 px; +z is "forward" (yaw 0 faces +z, like the chibis).

/** Colour-baked parts, merged into one geometry. `grain` (0…) varies each facet's colour a little (a painted,
 *  pixel-ish texture without a texture). */
export class Paint {
  private readonly parts: THREE.BufferGeometry[] = [];
  private readonly e = new THREE.Euler();
  private readonly m = new THREE.Matrix4();

  constructor(private readonly grain = 0) {}

  add(geo: THREE.BufferGeometry, hex: number, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): this {
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    if (g.getAttribute("uv")) g.deleteAttribute("uv");
    if (g.getAttribute("uv1")) g.deleteAttribute("uv1");
    const n = g.getAttribute("position").count, col = new Float32Array(n * 3), c = new THREE.Color(hex);
    const seed = this.parts.length * 7919 + 17;
    for (let i = 0; i < n; i++) {
      let k = 1;
      if (this.grain > 0) {
        let h = Math.imul(Math.floor(i / 3) + seed * 31, 2654435761) ^ seed;
        h = Math.imul(h ^ (h >>> 15), 2246822519);
        k = 1 + (((h >>> 0) % 1000) / 1000 - 0.5) * 2 * this.grain;
      }
      col[i * 3] = Math.min(1, c.r * k); col[i * 3 + 1] = Math.min(1, c.g * k); col[i * 3 + 2] = Math.min(1, c.b * k);
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    this.m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(this.e.set(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
    g = g.applyMatrix4(this.m);
    this.parts.push(g);
    return this;
  }

  box(w: number, h: number, d: number, hex: number, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): this {
    return this.add(new THREE.BoxGeometry(w, h, d), hex, x, y, z, rx, ry, rz);
  }

  get empty(): boolean {
    return this.parts.length === 0;
  }

  /** The merged geometry; with `outline`, every triangle also gets a reversed twin flagged `outline` = 1 (the
   *  creature material pushes those out along their normals and inks them: the outline in the same draw call). */
  geometry(outline = false): THREE.BufferGeometry {
    const g = mergeGeometries(this.parts, false) ?? new THREE.BufferGeometry();
    for (const p of this.parts) p.dispose();
    this.parts.length = 0;
    if (outline && g.getAttribute("position")) {
      const n = g.getAttribute("position").count;
      const flag = new Float32Array(n * 2);
      flag.fill(1, n);
      for (const name of ["position", "normal", "color"] as const) {
        const a = g.getAttribute(name);
        if (!a) continue;
        const src = a.array as Float32Array, out = new Float32Array(src.length * 2);
        out.set(src);
        for (let t = 0; t < n; t += 3) for (let v = 0; v < 3; v++) {
          const from = (t + (v === 0 ? 0 : 3 - v)) * 3, to = (n + t + v) * 3;       // a, c, b: reversed winding
          out[to] = src[from]; out[to + 1] = src[from + 1]; out[to + 2] = src[from + 2];
        }
        g.setAttribute(name, new THREE.BufferAttribute(out, 3));
      }
      g.setAttribute("outline", new THREE.BufferAttribute(flag, 1));
    }
    g.computeBoundingSphere();
    return g;
  }
}

/** The shared materials of every live model (the layer disposes them). */
export class ModelMats {
  readonly baked = toonMat({ vertexColors: true });
  /** The animals' look: toon-lit vertex colours with the ink outline baked into the geometry. */
  readonly creature = outlined(softMat(), INK_W);
  readonly glow = new THREE.MeshBasicMaterial({ color: 0xffe27a });
  readonly eyes = new THREE.MeshBasicMaterial({ color: 0xff3a2a });
  readonly decal = new THREE.MeshBasicMaterial({ color: 0xe0342a, transparent: true, opacity: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide });
  readonly foam = new THREE.MeshBasicMaterial({ color: 0xeaf6f4, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide });
  readonly windows: THREE.MeshToonMaterial = toonMat({ color: 0x3a4a5a, emissive: new THREE.Color(0xffc86a), emissiveIntensity: 0 });
  private readonly geos = new Set<THREE.BufferGeometry>();

  mesh(g: THREE.BufferGeometry, mat: THREE.Material = this.baked, shadow = true): THREE.Mesh {
    this.geos.add(g);
    const m = new THREE.Mesh(g, mat);
    m.castShadow = shadow;
    return m;
  }

  /** A paint job as a mesh (null if nothing was painted). */
  baked1(p: Paint, shadow = true): THREE.Mesh | null {
    return p.empty ? null : this.mesh(p.geometry(), this.baked, shadow);
  }

  /** A paint job as an outlined creature mesh (null if nothing was painted). */
  creature1(p: Paint, shadow = true): THREE.Mesh | null {
    return p.empty ? null : this.mesh(p.geometry(true), this.creature, shadow);
  }

  forget(g: THREE.BufferGeometry): void {
    this.geos.delete(g);
    g.dispose();
  }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    this.geos.clear();
    for (const m of [this.baked, this.creature, this.glow, this.eyes, this.decal, this.foam, this.windows]) m.dispose();
  }
}

/** Adds the one-draw-call ink outline to a material: vertices flagged `outline` are pushed out and drawn flat ink. */
function outlined(mat: THREE.MeshToonMaterial, width: number, ink = 0x2a1c18): THREE.MeshToonMaterial {
  const color = new THREE.Color(ink);
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uOutlineW = { value: width };
    sh.uniforms.uOutlineC = { value: color };
    sh.vertexShader = ["attribute float outline;", "uniform float uOutlineW;", "varying float vOutline;", sh.vertexShader.replace(
      "#include <begin_vertex>",
      ["#include <begin_vertex>", "transformed += normalize(objectNormal) * outline * uOutlineW;", "vOutline = outline;"].join("\n"),
    )].join("\n");
    sh.fragmentShader = ["uniform vec3 uOutlineC;", "varying float vOutline;", sh.fragmentShader.replace(
      "#include <opaque_fragment>",
      ["if (vOutline > 0.5) outgoingLight = uOutlineC;", "#include <opaque_fragment>"].join("\n"),
    )].join("\n");
  };
  mat.customProgramCacheKey = () => "creature-outline";
  return mat;
}

let softRamp: THREE.DataTexture | null = null;
/** The creatures' soft shading (the characters' ramp): flat colours, shade blending smoothly into light. */
function softMat(): THREE.MeshToonMaterial {
  if (!softRamp) {
    softRamp = new THREE.DataTexture(new Uint8Array([168, 168, 172, 255, 206, 206, 208, 255, 240, 240, 240, 255, 255, 255, 255, 255]), 4, 1, THREE.RGBAFormat);
    softRamp.minFilter = softRamp.magFilter = THREE.LinearFilter;
    softRamp.needsUpdate = true;
  }
  return new THREE.MeshToonMaterial({ gradientMap: softRamp, vertexColors: true });
}

let rampTex: THREE.DataTexture | null = null;
function toonMat(p: THREE.MeshToonMaterialParameters): THREE.MeshToonMaterial {
  if (!rampTex) {
    const steps = [0.42, 0.62, 0.86, 1.0], data = new Uint8Array(16);
    steps.forEach((v, i) => data.set([v * 255, v * 255, v * 255, 255], i * 4));
    rampTex = new THREE.DataTexture(data, 4, 1, THREE.RGBAFormat);
    rampTex.minFilter = rampTex.magFilter = THREE.NearestFilter;
    rampTex.needsUpdate = true;
  }
  return new THREE.MeshToonMaterial({ gradientMap: rampTex, ...p });
}

// ---------------------------------------------------------------- animals
//
// Cute, chibi-proportioned toon animals in the characters' family: rounded bodies with haunches, big heads with big
// glossy eyes (a white glint each), soft snouts and noses, species ears and tails, tapered legs with paws — every part
// painted with a faint per-facet grain (the small pixel texture) and wrapped in the ink outline (one inverted hull in
// the same draw call). A creature is ~7 draw calls: trunk, head, four legs, tail.

export interface Creature {
  root: THREE.Group;
  /** The body (bobs, leans). */
  body: THREE.Group;
  /** Hip pivots: front-left, front-right, back-left, back-right (swing on x). */
  legs: THREE.Object3D[];
  /** Wings (birds): left, right (flap on z). */
  wings: THREE.Object3D[];
  head: THREE.Object3D | null;
  tail: THREE.Object3D | null;
  /** Hops rather than walks (rabbits, hamsters, birds on the ground). */
  hop: boolean;
  flies: boolean;
  /** Units: the height of its back (labels, hp bars go above). */
  height: number;
  /** The torso mesh (breathes while idle). */
  trunk?: THREE.Object3D;
  /** Waddles side to side instead of swinging legs (ducks). */
  waddle?: boolean;
}

type Ears = "long" | "point" | "round" | "floppy" | "tall";
type Tail = "puff" | "bushy" | "plume" | "thin" | "curl" | "stub";

interface QuadSpec {
  /** Body ellipsoid diameters: width, height, length. */
  body: [number, number, number]; color: number; belly?: number; back?: number;
  /** Head radius; `neck` lifts it (deer, wolves); `mask` paints a lighter muzzle/cheek patch. */
  head: number; headColor?: number; neck?: number; mask?: number;
  snout?: number; snoutColor?: number; nose?: number;
  leg: number; legW?: number; legColor?: number; paw?: number;
  ears?: Ears; earColor?: number; earInner?: number;
  tail?: Tail; tailColor?: number; tailTip?: number;
  antlers?: boolean; horns?: number; tusks?: boolean; mane?: number; ridge?: number; spots?: number; stripes?: number;
  collar?: number; cheeks?: boolean; eye?: number;
  hop?: boolean; glowEyes?: boolean;
}

const EYE = 0x1c1410;
const PINK = 0xf2a4a8;
const INK_W = 0.02;

const sph = (w = 10, h = 7) => new THREE.SphereGeometry(0.5, w, h);
type V = readonly [number, number, number];

/** An ellipsoid of diameters `d` at `c` (rotated by `r`). */
function ell(p: Paint, hex: number, d: V, c: V, r: V = [0, 0, 0], seg: [number, number] = [10, 7]): Paint {
  return p.add(sph(seg[0], seg[1]), hex, c[0], c[1], c[2], r[0], r[1], r[2], d[0], d[1], d[2]);
}

/** A tube along a smooth curve through `pts`, capped with a ball at the tip. */
function tube(p: Paint, hex: number, pts: readonly V[], r: number, tipR = r): Paint {
  const curve = new THREE.CatmullRomCurve3(pts.map((q) => new THREE.Vector3(...q)));
  p.add(new THREE.TubeGeometry(curve, Math.max(4, pts.length * 3), r, 5, false), hex);
  const e = pts[pts.length - 1], s = pts[0];
  return p.add(sph(6, 4), hex, e[0], e[1], e[2], 0, 0, 0, tipR * 2, tipR * 2, tipR * 2).add(sph(6, 4), hex, s[0], s[1], s[2], 0, 0, 0, r * 2, r * 2, r * 2);
}

/** Big glossy eyes with a white glint (up and toward the viewer's left on both). */
function eyes(p: Paint, y: number, z: number, spread: number, size: number): void {
  for (const sd of [-1, 1]) {
    ell(p, EYE, [size * 0.9, size * 1.1, size * 0.55], [sd * spread, y, z], [0, sd * 0.35, 0], [8, 6]);
    ell(p, 0xffffff, [size * 0.36, size * 0.36, size * 0.2], [sd * spread - size * 0.16, y + size * 0.24, z + size * 0.24], [0, 0, 0], [6, 4]);
  }
}

function quad(mats: ModelMats, s: QuadSpec, scale = 1): Creature {
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  const [bw, bh, bl] = s.body, hr = s.head, legW = s.legW ?? Math.min(bw, bl) * 0.3;
  const y0 = s.leg + bh / 2;
  const hc = s.headColor ?? s.color, lc = s.legColor ?? s.color;

  // the trunk: a rounded body with haunches and shoulders, a lighter belly, a darker saddle, species markings
  const p = new Paint();
  ell(p, s.color, [bw, bh, bl], [0, y0, 0], [0, 0, 0], [12, 9]);
  for (const sd of [-1, 1]) {
    ell(p, s.color, [bw * 0.42, bh * 0.74, bl * 0.42], [sd * bw * 0.25, y0 - bh * 0.07, -bl * 0.24]);
    ell(p, s.color, [bw * 0.34, bh * 0.6, bl * 0.32], [sd * bw * 0.24, y0 - bh * 0.1, bl * 0.26]);
  }
  if (s.belly !== undefined) ell(p, s.belly, [bw * 0.78, bh * 0.6, bl * 0.8], [0, y0 - bh * 0.2, 0.02]);
  if (s.back !== undefined) ell(p, s.back, [bw * 0.8, bh * 0.5, bl * 0.84], [0, y0 + bh * 0.24, -0.01]);
  if (s.mane !== undefined) p.add(sph(10, 7), s.mane, 0, y0 + bh * 0.1, bl * 0.3, 0, 0, 0, bw * 1.08, bh * 1.08, bl * 0.46);
  if (s.ridge !== undefined) for (let i = 0; i < 5; i++) {
    const z = bl * (0.3 - i * 0.13);
    p.add(new THREE.ConeGeometry(0.5, 1, 5), s.ridge, 0, y0 + bh * 0.5 * Math.sqrt(Math.max(0, 1 - (2 * z / bl) ** 2)) + bh * 0.04, z, -0.3, 0, 0, bw * 0.16, bh * 0.28, bw * 0.16);
  }
  if (s.stripes !== undefined) for (const f of [-0.28, -0.08, 0.12]) {
    const k = Math.sqrt(1 - (2 * f) ** 2) * 1.02;
    p.add(new THREE.TorusGeometry(1, 0.06, 4, 12, Math.PI), s.stripes, 0, y0, f * bl, 0, 0, 0, (bw / 2) * k, (bh / 2) * k, 0.5);
  }
  if (s.spots !== undefined) for (const [fx, fz] of [[0.28, 0.12], [-0.3, -0.05], [0.22, -0.26], [-0.2, 0.26], [0.05, -0.12]] as const) {
    const x = fx * bw, z = fz * bl, yy = y0 + (bh / 2) * Math.sqrt(Math.max(0, 1 - (2 * x / bw) ** 2 - (2 * z / bl) ** 2)) - 0.01;
    ell(p, s.spots, [bw * 0.12, bh * 0.07, bw * 0.12], [x, yy, z], [0, 0, 0], [6, 4]);
  }
  const trunk = mats.creature1(p)!;
  body.add(trunk);

  // the head, on its own pivot at the neck (it bobs while grazing, looks around while idle)
  const head = new THREE.Group();
  const neck = s.neck ?? 0;
  head.position.set(0, y0 + bh * 0.2, bl * 0.36);
  const hp = new Paint();
  const cx = 0, cy = neck + hr * 0.3, cz = neck * 0.38 + hr * 0.5;
  if (neck) ell(hp, hc, [hr * 1.05, neck + hr * 0.9, hr * 1.1], [0, neck * 0.45, neck * 0.18], [0.35, 0, 0], [8, 6]);
  ell(hp, hc, [hr * 2, hr * 1.84, hr * 1.9], [cx, cy, cz], [0, 0, 0], [12, 9]);
  if (s.mask !== undefined) ell(hp, s.mask, [hr * 1.5, hr * 1.0, hr * 1.2], [cx, cy - hr * 0.36, cz + hr * 0.4]);
  let tipZ = cz + hr * 0.9;
  if (s.snout) {
    const sl = s.snout;
    ell(hp, s.snoutColor ?? hc, [hr * 0.9, hr * 0.7, sl * 2 + hr * 0.5], [cx, cy - hr * 0.32, cz + hr * 0.62 + sl * 0.45]);
    tipZ = cz + hr * 0.62 + sl * 0.45 + sl + hr * 0.25;
    ell(hp, s.nose ?? EYE, [hr * 0.36, hr * 0.26, hr * 0.22], [cx, cy - hr * 0.18, tipZ - hr * 0.06], [0, 0, 0], [8, 5]);
  } else ell(hp, s.nose ?? 0xd07a7a, [hr * 0.24, hr * 0.18, hr * 0.14], [cx, cy - hr * 0.2, cz + hr * 0.9], [0, 0, 0], [6, 4]);
  if (!s.glowEyes) eyes(hp, cy + hr * 0.12, cz + hr * 0.68, hr * 0.47, hr * 0.42 * (s.eye ?? 1));
  if (s.cheeks) for (const sd of [-1, 1]) ell(hp, PINK, [hr * 0.36, hr * 0.2, hr * 0.12], [sd * hr * 0.6, cy - hr * 0.2, cz + hr * 0.66], [0, sd * 0.6, 0], [6, 4]);
  const ec = s.earColor ?? hc, ei = s.earInner ?? PINK;
  for (const sd of [-1, 1]) {
    switch (s.ears) {
      case "long":
        hp.add(new THREE.CapsuleGeometry(0.5, 1, 3, 8), ec, sd * hr * 0.32, cy + hr * 1.55, cz - hr * 0.12, -0.12, 0, sd * -0.16, hr * 0.46, hr * 0.95, hr * 0.22);
        hp.add(new THREE.CapsuleGeometry(0.5, 1, 3, 8), ei, sd * hr * 0.33, cy + hr * 1.5, cz - hr * 0.04, -0.12, 0, sd * -0.16, hr * 0.26, hr * 0.72, hr * 0.12);
        break;
      case "point":
      case "tall": {
        const tall = s.ears === "tall";
        const [x, y, rz] = tall ? [hr * 0.82, cy + hr * 0.62, sd * -1.05] : [hr * 0.52, cy + hr * 0.86, sd * -0.26];
        hp.add(new THREE.ConeGeometry(0.5, 1, 8), ec, sd * x, y, cz - hr * 0.08, 0, 0, rz, hr * 0.62, hr * (tall ? 0.95 : 0.85), hr * 0.3);
        hp.add(new THREE.ConeGeometry(0.5, 1, 8), ei, sd * x, y - hr * 0.08, cz - hr * 0.0, 0, 0, rz, hr * 0.36, hr * (tall ? 0.62 : 0.55), hr * 0.14);
        break;
      }
      case "round":
        ell(hp, ec, [hr * 0.6, hr * 0.6, hr * 0.26], [sd * hr * 0.64, cy + hr * 0.74, cz - hr * 0.1], [0, 0, sd * -0.3], [8, 6]);
        ell(hp, ei, [hr * 0.34, hr * 0.34, hr * 0.12], [sd * hr * 0.66, cy + hr * 0.72, cz - hr * 0.0], [0, 0, sd * -0.3], [6, 4]);
        break;
      case "floppy":
        hp.add(new THREE.CapsuleGeometry(0.5, 1, 3, 8), ec, sd * hr * 0.88, cy + hr * 0.08, cz - hr * 0.05, 0.1, 0, sd * 0.32, hr * 0.46, hr * 0.62, hr * 0.2);
        break;
      default: break;
    }
    if (s.antlers) {
      const b = (x: number, y: number, z: number): V => [sd * x * hr, cy + y * hr, cz + z * hr];
      tube(hp, 0x8a6440, [b(0.35, 0.8, -0.1), b(0.6, 1.5, -0.25), b(0.95, 2.3, -0.3), b(1.0, 2.9, -0.05)], hr * 0.07, hr * 0.08);
      tube(hp, 0x8a6440, [b(0.62, 1.6, -0.25), b(0.55, 2.1, 0.15), b(0.45, 2.4, 0.35)], hr * 0.06, hr * 0.07);
      tube(hp, 0x8a6440, [b(0.85, 2.1, -0.3), b(1.35, 2.4, -0.25), b(1.55, 2.75, -0.1)], hr * 0.055, hr * 0.065);
    }
    if (s.horns) {
      const k = s.horns / 0.45;
      const b = (x: number, y: number, z: number): V => [sd * x * hr, cy + y * hr, cz + z * hr];
      tube(hp, 0xe8dcc0, [b(0.55, 0.55, 0), b(1.15 * k, 0.62, -0.1), b(1.6 * k, 0.95, -0.2), b(1.55 * k, 1.35 * k, -0.05)], hr * 0.15, hr * 0.15);
      hp.add(new THREE.ConeGeometry(0.5, 1, 8), 0xf4ecd8, sd * 1.5 * k * hr, cy + (1.35 * k + 0.22) * hr, cz - 0.05 * hr, 0, 0, sd * 0.35, hr * 0.28, hr * 0.46, hr * 0.28);
    }
    if (s.tusks) tube(hp, 0xf4ecd8, [[sd * hr * 0.32, cy - hr * 0.42, tipZ - hr * 0.35], [sd * hr * 0.46, cy - hr * 0.3, tipZ - hr * 0.12], [sd * hr * 0.44, cy + hr * 0.02, tipZ - hr * 0.02]], hr * 0.07, hr * 0.03);
  }
  if (s.collar !== undefined) {
    hp.add(new THREE.TorusGeometry(1, 0.13, 5, 16), s.collar, 0, neck * 0.2 - hr * 0.22, hr * 0.05, Math.PI / 2 - 0.55, 0, 0, hr * 0.8, hr * 0.8, hr * 0.8);
    ell(hp, 0xf0c040, [hr * 0.24, hr * 0.24, hr * 0.12], [0, neck * 0.2 - hr * 0.62, hr * 0.62], [0, 0, 0], [6, 4]);
  }
  head.add(mats.creature1(hp)!);
  if (s.glowEyes) for (const sd of [-1, 1]) {
    const e = mats.mesh(new THREE.SphereGeometry(0.5, 8, 5), mats.eyes, false);
    e.scale.set(hr * 0.32, hr * 0.22, hr * 0.14);
    e.position.set(sd * hr * 0.44, cy + hr * 0.12, cz + hr * 0.78);
    e.rotation.set(0, sd * 0.35, sd * -0.25);
    head.add(e);
  }
  body.add(head);

  // legs: hip pivots with a tapered leg and a paw hanging below
  const legs: THREE.Object3D[] = [];
  const legLen = s.leg + bh * 0.26;
  const legGeo = new Paint()
    .add(new THREE.CylinderGeometry(legW * 0.52, legW * 0.4, legLen - legW * 0.3, 8, 1, true), lc, 0, -legLen / 2 + legW * 0.05, 0)
    .add(sph(8, 5), lc, 0, 0, 0, 0, 0, 0, legW * 1.04, legW * 1.04, legW * 1.04)
    .add(sph(8, 5), s.paw ?? darker(lc, 0.82), 0, -legLen + legW * 0.26, legW * 0.14, 0, 0, 0, legW * 1.02, legW * 0.6, legW * 1.28)
    .geometry(true);
  mats.mesh(legGeo);                                              // registers it for disposal
  for (const [fx, fz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const hip = new THREE.Group();
    hip.position.set(fx * bw * 0.27, legLen, fz * bl * 0.27);
    const leg = new THREE.Mesh(legGeo, mats.creature);
    leg.castShadow = true;
    hip.add(leg);
    body.add(hip);
    legs.push(hip);
  }

  // the tail, on a pivot at the rump (wags)
  let tail: THREE.Object3D | null = null;
  if (s.tail) {
    const t = new THREE.Group();
    t.position.set(0, y0 + bh * 0.16, -bl * 0.44);
    const tc = s.tailColor ?? s.color, tp = new Paint();
    switch (s.tail) {
      case "puff": tp.add(new THREE.IcosahedronGeometry(0.5, 1), tc, 0, 0.02, -bw * 0.06, 0, 0, 0, bw * 0.42, bw * 0.4, bw * 0.38); break;
      case "bushy": {
        const L = bl * 0.62, a = -0.55;
        ell(tp, tc, [bw * 0.44, bw * 0.44, L], [0, Math.sin(a) * L * 0.42, -Math.cos(a) * L * 0.42], [-a, 0, 0]);
        ell(tp, s.tailTip ?? tc, [bw * 0.34, bw * 0.34, L * 0.42], [0, Math.sin(a) * L * 0.86, -Math.cos(a) * L * 0.86], [-a, 0, 0], [8, 6]);
        break;
      }
      case "plume":
        ell(tp, tc, [bw * 0.6, bh * 1.7, bw * 0.62], [0, bh * 0.72, -bw * 0.3], [-0.3, 0, 0]);
        ell(tp, s.tailTip ?? tc, [bw * 0.5, bw * 0.5, bw * 0.6], [0, bh * 1.52, -bw * 0.05], [0, 0, 0], [8, 6]);
        break;
      case "thin": tube(tp, tc, [[0, 0, 0], [0, -0.05, -bl * 0.3], [0, 0.02, -bl * 0.62], [0, 0.12, -bl * 0.78]], Math.max(0.014, bw * 0.06), Math.max(0.012, bw * 0.05)); break;
      case "curl": tp.add(new THREE.TorusGeometry(bw * 0.17, bw * 0.07, 5, 12, Math.PI * 1.6), tc, 0, bw * 0.18, -0.04, 0, Math.PI / 2, 0); break;
      default: ell(tp, tc, [bw * 0.26, bw * 0.24, bw * 0.3], [0, 0.02, -bw * 0.04], [0, 0, 0], [8, 5]); break;
    }
    t.add(mats.creature1(tp)!);
    body.add(t);
    tail = t;
  }
  root.scale.setScalar(scale);
  return { root, body, legs, wings: [], head, tail, hop: !!s.hop, flies: false, height: (y0 + bh / 2 + neck + hr * 1.4) * scale, trunk };
}

interface BirdOpts { color: number; wing: number; beak?: number; head?: number; belly?: number; tail?: number; duck?: boolean; crest?: number }

function bird(mats: ModelMats, o: BirdOpts, scale = 1): Creature {
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  const beak = o.beak ?? 0xf0a030, hc = o.head ?? o.color;
  const p = new Paint();
  ell(p, o.color, [0.36, 0.32, 0.5], [0, 0.32, 0], [-0.15, 0, 0], [12, 8]);
  ell(p, o.belly ?? darker(o.color, 1.12), [0.3, 0.24, 0.36], [0, 0.26, 0.08], [-0.15, 0, 0]);
  ell(p, hc, [0.3, 0.29, 0.29], [0, 0.56, 0.17], [0, 0, 0], [12, 8]);
  if (o.duck) ell(p, beak, [0.15, 0.05, 0.2], [0, 0.52, 0.36], [0.1, 0, 0], [8, 5]);
  else p.add(new THREE.ConeGeometry(0.045, 0.13, 6), beak, 0, 0.54, 0.37, Math.PI / 2, 0, 0);
  eyes(p, 0.59, 0.28, 0.085, 0.07);
  if (o.crest !== undefined) p.add(new THREE.ConeGeometry(0.04, 0.14, 5), o.crest, 0, 0.73, 0.14, -0.4, 0, 0);
  // the tail fan and the little legs with feet
  p.add(new THREE.ConeGeometry(0.5, 1, 6), o.tail ?? darker(o.wing, 0.9), 0, 0.38, -0.3, -Math.PI / 2 - 0.5, 0, 0, 0.2, 0.2, 0.05);
  for (const sd of [-1, 1]) {
    p.add(new THREE.CylinderGeometry(0.018, 0.018, 0.14, 5), beak, sd * 0.07, 0.1, 0.02);
    ell(p, beak, [0.07, 0.025, 0.1], [sd * 0.07, 0.025, 0.05], [0, 0, 0], [6, 4]);
  }
  const trunk = mats.creature1(p)!;
  body.add(trunk);
  const wings: THREE.Object3D[] = [];
  const wg = new Paint();
  ell(wg, o.wing, [0.06, 0.2, 0.34], [0.03, -0.04, -0.03], [0.25, 0, 0]);
  ell(wg, darker(o.wing, 0.78), [0.05, 0.12, 0.16], [0.035, -0.08, -0.17], [0.4, 0, 0], [6, 4]);
  const wgeo = wg.geometry(true);
  mats.mesh(wgeo);
  for (const sd of [-1, 1]) {
    const w = new THREE.Group();
    w.position.set(sd * 0.16, 0.38, 0.02);
    const m = new THREE.Mesh(wgeo, mats.creature);
    m.castShadow = true;
    m.scale.x = sd;
    w.add(m);
    body.add(w);
    wings.push(w);
  }
  root.scale.setScalar(scale);
  return { root, body, legs: [], wings, head: null, tail: null, hop: true, flies: true, height: 0.72 * scale, trunk };
}

function darker(hex: number, k: number): number {
  const c = new THREE.Color(hex).multiplyScalar(k);
  return c.setRGB(Math.min(1, c.r), Math.min(1, c.g), Math.min(1, c.b)).getHex();
}

const WILD: Record<Exclude<WildSpeciesId, "bird" | "firefly" | "ga_rung" | "co_trang">, [QuadSpec, number]> = {
  rabbit: [{ body: [0.36, 0.34, 0.46], color: 0xc2ab8e, belly: 0xf1e9dc, head: 0.18, mask: 0xf1e9dc, ears: "long", earInner: 0xf0b8b8, leg: 0.08, legW: 0.1, paw: 0xf1e9dc, tail: "puff", tailColor: 0xffffff, hop: true, nose: 0xe08a8a, eye: 1.1 }, 1],
  deer: [{ body: [0.44, 0.44, 0.84], color: 0xb87c46, belly: 0xf0dcbc, head: 0.19, neck: 0.36, mask: 0xf0dcbc, snout: 0.1, snoutColor: 0xd9b48a, nose: 0x3a2418, ears: "tall", earInner: 0xf0d0b0, leg: 0.62, legW: 0.1, paw: 0x3a2a1a, tail: "stub", tailColor: 0xffffff, antlers: true, spots: 0xfbf2e0 }, 1],
  fox: [{ body: [0.32, 0.3, 0.6], color: 0xe07a32, belly: 0xfbeee0, head: 0.2, mask: 0xfbeee0, snout: 0.13, snoutColor: 0xfbeee0, ears: "point", earColor: 0xe07a32, earInner: 0x3a2418, leg: 0.24, legW: 0.09, legColor: 0x3a2418, tail: "bushy", tailTip: 0xffffff, eye: 1.05 }, 1],
  wolf: [{ body: [0.42, 0.42, 0.84], color: 0x7d808c, belly: 0xd8d8de, head: 0.24, neck: 0.08, mask: 0xd8d8de, snout: 0.18, snoutColor: 0xc8c8d0, ears: "point", earInner: 0x4a4c56, leg: 0.4, legW: 0.12, paw: 0x5e6170, tail: "bushy", tailColor: 0x6e717c, tailTip: 0xd8d8de, mane: 0x9a9daa }, 1],
  bear: [{ body: [0.82, 0.76, 1.1], color: 0x6a4428, belly: 0x8a6040, head: 0.36, mask: 0xc8a57c, snout: 0.12, snoutColor: 0xc8a57c, ears: "round", earInner: 0x8a6040, leg: 0.34, legW: 0.26, paw: 0x4a2e1a, tail: "stub", eye: 0.9 }, 1],
  // 0097 (forest-content): the rừng tràm's own
  chuot_dong: [{ body: [0.26, 0.24, 0.42], color: 0x8a6a4a, belly: 0xd8c4a8, head: 0.14, mask: 0xd8c4a8, ears: "round", earInner: 0xe0a8a0, leg: 0.06, legW: 0.07, tail: "thin", nose: 0xe08a8a, eye: 1.1 }, 0.9],
  ran_ri_ca: [{ body: [0.16, 0.14, 1.2], color: 0x4a5a2a, belly: 0xc8c090, stripes: 0x2e3a1a, head: 0.12, snout: 0.08, snoutColor: 0x4a5a2a, leg: 0.02, legW: 0.02, legColor: 0x4a5a2a, tail: "thin", eye: 0.8 }, 1],
  cay_huong: [{ body: [0.3, 0.3, 0.62], color: 0x8a7a5a, belly: 0xd8ccb0, stripes: 0x3a3020, head: 0.17, mask: 0xf0e8d8, snout: 0.11, snoutColor: 0x3a3020, ears: "round", earInner: 0x3a3020, leg: 0.16, legW: 0.08, legColor: 0x2a2418, tail: "thin", tailColor: 0x3a3020, eye: 1.05 }, 1],
  rua_hop_lung_den: [{ body: [0.46, 0.26, 0.56], color: 0x2a2a22, back: 0x3a3428, belly: 0xc8b070, head: 0.11, headColor: 0x8a7a4a, leg: 0.06, legW: 0.1, legColor: 0x8a7a4a, tail: "stub", eye: 0.8 }, 1],
};

export function wildAnimal(mats: ModelMats, sp: WildSpeciesId): Creature {
  if (sp === "bird") return bird(mats, { color: 0x9a7452, wing: 0x6e4c2e, belly: 0xe8d4b4, head: 0x8a6446, beak: 0xf0a030 }, 1);
  if (sp === "ga_rung") return bird(mats, { color: 0xb8402a, wing: 0x3a4a2a, belly: 0x5a3a20, head: 0xd84a2a, beak: 0xe0c070, crest: 0xe02a2a, tail: 0x2a4a3a }, 1.3);   // 0097
  if (sp === "co_trang") return bird(mats, { color: 0xf4f2ea, wing: 0xe8e6de, belly: 0xffffff, head: 0xf8f6ee, beak: 0xe0b030 }, 1.5);   // 0097
  if (sp === "firefly") {
    const root = new THREE.Group(), body = new THREE.Group();
    root.add(body);
    const m = mats.mesh(new THREE.SphereGeometry(0.09, 6, 4), mats.glow, false);
    m.position.y = 1;
    body.add(m);
    return { root, body, legs: [], wings: [], head: null, tail: null, hop: false, flies: true, height: 1.2 };
  }
  const [spec, scale] = WILD[sp];
  return quad(mats, spec, scale);
}

const PETS: Record<Exclude<PetSpecies, "vet">, QuadSpec> = {
  hamster: { body: [0.34, 0.3, 0.36], color: 0xe6b476, belly: 0xfff4e2, head: 0.17, mask: 0xfff4e2, ears: "round", earInner: 0xf0a0a0, leg: 0.05, legW: 0.07, paw: 0xf6c8c0, tail: "stub", hop: true, cheeks: true, eye: 1.1 },
  tho: { body: [0.32, 0.3, 0.4], color: 0xf6f2ec, belly: 0xffffff, head: 0.17, ears: "long", earInner: 0xf6c4c8, leg: 0.07, legW: 0.09, tail: "puff", hop: true, nose: 0xe89098, cheeks: true, eye: 1.15 },
  soc: { body: [0.24, 0.26, 0.34], color: 0xa85a32, belly: 0xf3dcb4, head: 0.15, mask: 0xf3dcb4, ears: "point", earInner: 0xe0a080, leg: 0.1, legW: 0.07, tail: "plume", tailColor: 0xb8663a, tailTip: 0xd08050, hop: true, eye: 1.1 },
  meo: { body: [0.28, 0.28, 0.48], color: 0xeaa456, belly: 0xfff4e2, stripes: 0xc87a32, head: 0.19, mask: 0xfff4e2, ears: "point", earInner: 0xf4b8b0, leg: 0.18, legW: 0.08, paw: 0xfff4e2, tail: "thin", collar: 0xd23a4a, nose: 0xe88a90, cheeks: true, eye: 1.15 },
  cho: { body: [0.32, 0.32, 0.52], color: 0xdaa65c, belly: 0xf6e6ca, head: 0.21, mask: 0xf6e6ca, snout: 0.09, snoutColor: 0xf6e6ca, ears: "floppy", earColor: 0xa8783a, leg: 0.2, legW: 0.1, paw: 0xf6e6ca, tail: "curl", collar: 0x2a7ad2, eye: 1.05 },
};

export function petModel(mats: ModelMats, sp: PetSpecies): Creature {
  if (sp === "vet") return bird(mats, { color: 0x3cb043, wing: 0x2a8a36, beak: 0xf0c040, head: 0xe0402a, belly: 0x8ad05a, tail: 0x2a6ad0, crest: 0xe0402a }, 1.1);
  return quad(mats, PETS[sp], 1);
}

const DOG_COAT: Record<string, [number, number | undefined, number | undefined]> = {
  vang: [0xd9a55a, undefined, undefined], muc: [0x2a2320, undefined, undefined], ven: [0x9a7040, 0x5a3a20, undefined], dom: [0xf0ece0, undefined, 0x3a3030],
};
export function dogModel(mats: ModelMats, coat = "vang"): Creature {
  const [c, stripes, spots] = DOG_COAT[coat] ?? DOG_COAT.vang;
  const light = c === 0x2a2320 ? 0x4a3a30 : 0xf4e4c8;
  return quad(mats, { body: [0.36, 0.36, 0.64], color: c, belly: light, stripes, spots, head: 0.24, mask: light, snout: 0.12, snoutColor: light, ears: "floppy", earColor: darker(c, 0.8), leg: 0.26, legW: 0.11, paw: light, tail: "curl", collar: 0xd23a4a }, 1);
}

export function ratModel(mats: ModelMats): Creature {
  return quad(mats, { body: [0.18, 0.16, 0.3], color: 0x7a706a, belly: 0xb8aea8, head: 0.1, snout: 0.07, snoutColor: 0x8a807a, nose: 0xe89098, ears: "round", earColor: 0xd8a0a0, earInner: 0xf0b8b8, leg: 0.04, legW: 0.05, paw: 0xe8b0b0, tail: "thin", tailColor: 0xd8a0a0 }, 1);
}

// ---------------------------------------------------------------- bosses

export function bossModel(mats: ModelMats, kind: BossId): Creature {
  switch (kind) {
    case "trau_tinh": return quad(mats, { body: [1.1, 0.95, 1.55], color: 0x3d3f4a, belly: 0x55576a, head: 0.5, mask: 0x6a6070, snout: 0.16, snoutColor: 0x6a6070, nose: 0x2a2a30, ears: "floppy", leg: 0.6, legW: 0.3, paw: 0x22232a, tail: "thin", horns: 0.45, glowEyes: true, mane: 0x2a2c36 }, 2.2);
    case "soi_ma": return quad(mats, { body: [0.5, 0.5, 1.0], color: 0x8fa6e0, belly: 0xdfe8ff, head: 0.3, neck: 0.1, mask: 0xdfe8ff, snout: 0.2, snoutColor: 0xc8d4f4, ears: "point", earInner: 0x4a5a9a, leg: 0.5, legW: 0.14, tail: "bushy", tailColor: 0xb8c8f0, tailTip: 0xffffff, mane: 0x6f86c8, glowEyes: true }, 2.6);
    case "heo_rung": return quad(mats, { body: [0.8, 0.72, 1.2], color: 0x5a4030, belly: 0x7a5a44, head: 0.4, snout: 0.16, snoutColor: 0xc88a7a, nose: 0xa05a50, ears: "point", earInner: 0x3a2818, leg: 0.3, legW: 0.22, paw: 0x2a1e14, tail: "curl", tusks: true, ridge: 0x2a1c10, glowEyes: true }, 2.4);
    case "nguoi_tuyet": {
      const root = new THREE.Group(), body = new THREE.Group();
      root.add(body);
      const p = new Paint()
        .add(new THREE.IcosahedronGeometry(1.1, 1), 0xf4f8ff, 0, 1.0, 0)
        .add(new THREE.IcosahedronGeometry(0.8, 1), 0xeef4ff, 0, 2.45, 0)
        .add(new THREE.IcosahedronGeometry(0.55, 1), 0xf8fbff, 0, 3.5, 0)
        .add(new THREE.ConeGeometry(0.1, 0.5, 5), 0xf08a2a, 0, 3.5, 0.72, Math.PI / 2)
        .box(0.9, 0.2, 0.9, 0xc0342a, 0, 3.05, 0)
        .box(0.12, 1.4, 0.12, 0x6a4a2a, 0.95, 2.6, 0, 0, 0, -0.9).box(0.12, 1.4, 0.12, 0x6a4a2a, -0.95, 2.6, 0, 0, 0, 0.9);
      body.add(mats.baked1(p)!);
      const head = new THREE.Group();
      head.position.set(0, 3.5, 0);
      for (const sd of [-1, 1]) {
        const e = mats.mesh(new THREE.BoxGeometry(0.12, 0.12, 0.04), mats.eyes, false);
        e.position.set(sd * 0.2, 0.12, 0.52);
        head.add(e);
      }
      body.add(head);
      return { root, body, legs: [], wings: [], head, tail: null, hop: true, flies: false, height: 4.1 };
    }
    case "thuy_quai": {
      const root = new THREE.Group(), body = new THREE.Group();
      root.add(body);
      const p = new Paint();
      // three coils arching out of the water, then the head with fins
      for (let i = 0; i < 3; i++) p.add(new THREE.TorusGeometry(0.9 - i * 0.12, 0.34 - i * 0.05, 6, 12, Math.PI), i % 2 ? 0x2f8f8a : 0x277a76, 0, 0, -1.4 - i * 1.5, 0, Math.PI / 2, 0);
      p.add(new THREE.CapsuleGeometry(0.45, 1.2, 3, 7), 0x2f8f8a, 0, 1.1, 0.4, -0.5)
        .add(new THREE.ConeGeometry(0.3, 0.8, 4), 0x7fd0c0, 0, 2.1, 0.2, -0.3)
        .add(new THREE.ConeGeometry(0.2, 0.6, 3), 0x7fd0c0, 0.5, 1.4, 0.6, 0, 0, -1)
        .add(new THREE.ConeGeometry(0.2, 0.6, 3), 0x7fd0c0, -0.5, 1.4, 0.6, 0, 0, 1)
        .box(0.5, 0.18, 0.4, 0xe8f0d0, 0, 1.2, 1.15);
      body.add(mats.baked1(p)!);
      const head = new THREE.Group();
      head.position.set(0, 1.6, 0.9);
      for (const sd of [-1, 1]) {
        const e = mats.mesh(new THREE.BoxGeometry(0.1, 0.1, 0.04), mats.eyes, false);
        e.position.set(sd * 0.22, 0.05, 0.1);
        head.add(e);
      }
      body.add(head);
      return { root, body, legs: [], wings: [], head, tail: null, hop: false, flies: false, height: 2.6 };
    }
  }
}

// ---------------------------------------------------------------- set pieces

const WOOD = 0x9a6a3e, WOOD_DARK = 0x6e4424;

/** A market stall: table, four posts, a striped awning, goods on the table (0…1 full). */
export function stallModel(mats: ModelMats, color: number, goods: number, player: boolean): THREE.Group {
  const g = new THREE.Group(), p = new Paint();
  p.box(2.2, 0.12, 1.0, WOOD, 0, 0.8, 0).box(2.1, 0.7, 0.08, WOOD_DARK, 0, 0.42, 0.44);
  for (const [x, z] of [[-1.05, -0.45], [1.05, -0.45], [-1.05, 0.45], [1.05, 0.45]]) p.box(0.08, z < 0 ? 2.1 : 1.8, 0.08, WOOD_DARK, x, z < 0 ? 1.05 : 0.9, z);
  for (let i = 0; i < 6; i++) p.box(2.4 / 6, 0.06, 1.35, i % 2 ? 0xf6efe0 : color, -1.2 + (i + 0.5) * (2.4 / 6), 1.95, 0.05, -0.28);
  p.box(2.4, 0.18, 0.04, color, 0, 1.72, 0.66);                                           // the awning's valance
  const n = Math.round(Math.max(0, Math.min(1, goods)) * 8);
  const fruit = [0xe8483a, 0xf2c240, 0x7ab648, 0xf08a2a];
  for (let i = 0; i < n; i++) {
    const x = -0.85 + (i % 4) * 0.56, z = i < 4 ? -0.18 : 0.2;
    if (i % 3 === 0) p.box(0.34, 0.2, 0.3, 0xc9955a, x, 0.96, z);
    else p.add(new THREE.IcosahedronGeometry(0.13, 0), fruit[i % 4], x, 0.99, z);
  }
  if (player) p.box(0.9, 0.34, 0.05, 0xf6e7c0, 0, 2.3, 0.62).box(0.06, 0.4, 0.06, WOOD_DARK, 0, 2.1, 0.6);   // the name board
  g.add(mats.baked1(p)!);
  return g;
}

/** A fighting ring: a sand disc, eight posts on its circle, two rope heights. `r` in units. */
export function ringModel(mats: ModelMats, r: number): THREE.Group {
  const g = new THREE.Group(), p = new Paint();
  p.add(new THREE.CylinderGeometry(r, r + 0.1, 0.08, 20), 0xd8c08a, 0, 0.04, 0);
  const posts = 8;
  for (let i = 0; i < posts; i++) {
    const a = (i / posts) * Math.PI * 2, b = ((i + 1) / posts) * Math.PI * 2;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    p.box(0.14, 1.2, 0.14, i % 2 ? 0xc0392b : 0x2a5ab8, x, 0.6, z).box(0.2, 0.08, 0.2, 0xf6e7c0, x, 1.22, z);
    const mx = (x + Math.cos(b) * r) / 2, mz = (z + Math.sin(b) * r) / 2, len = 2 * r * Math.sin(Math.PI / posts);
    for (const h of [0.6, 1.0]) p.box(0.04, 0.04, len, 0xf2e8d0, mx, h, mz, 0, -(a + b) / 2, 0);
  }
  g.add(mats.baked1(p, false)!);
  return g;
}

/** A house on a Khu nhà lot (w × d units): walls, a door, windows (the shared night-lit material) and its roof. */
export function houseModel(mats: ModelMats, w: number, d: number, roof: Roof, wall: number): THREE.Group {
  const g = new THREE.Group(), p = new Paint();
  const h = 2.4;
  p.box(w, 0.2, d, 0xb8b0a0, 0, 0.1, 0).box(w - 0.2, h, d - 0.2, wall, 0, 0.2 + h / 2, 0);
  p.box(0.8, 1.5, 0.06, 0x7a4a2a, 0, 0.95, d / 2 - 0.08).box(0.08, 0.08, 0.04, 0xf2c240, 0.28, 0.95, d / 2 - 0.03);
  const top = 0.2 + h;
  if (roof === "ngoi") {                                                          // red clay tiles, a gable
    const half = d / 2 + 0.35, len = w + 0.6;
    const gable = new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(-half, 0), new THREE.Vector2(half, 0), new THREE.Vector2(0, 1.3)]), { depth: len, bevelEnabled: false });
    gable.translate(0, 0, -len / 2);
    p.add(gable, 0xb8442e, 0, top, 0, 0, Math.PI / 2, 0).box(len + 0.1, 0.12, 0.14, 0x8a2e20, 0, top + 1.3, 0);
  } else if (roof === "tole") {                                                   // corrugated sheet, a low slope
    p.box(w + 0.5, 0.1, d + 0.5, 0x8aa4b8, 0, top + 0.3, 0, 0.18);
    for (let i = -3; i <= 3; i++) p.box(0.05, 0.05, d + 0.5, 0x6a8498, (i / 7) * (w + 0.5), top + 0.37, 0, 0.18);
  } else if (roof === "la") {                                                     // palm-leaf thatch, a hip
    p.add(new THREE.ConeGeometry(1, 1, 4), 0xc8a050, 0, top + 0.75, 0, 0, Math.PI / 4, 0, (w + 0.8) * 0.72, 1.6, (d + 0.8) * 0.72)
      .add(new THREE.ConeGeometry(1, 1, 4), 0xa8843a, 0, top + 0.2, 0, 0, Math.PI / 4, 0, (w + 0.9) * 0.74, 0.25, (d + 0.9) * 0.74);
  } else {                                                                        // bằng: a flat concrete roof, a parapet
    p.box(w, 0.16, d, 0xc8c4bc, 0, top + 0.08, 0)
      .box(w, 0.4, 0.12, 0xd8d4cc, 0, top + 0.36, d / 2 - 0.06).box(w, 0.4, 0.12, 0xd8d4cc, 0, top + 0.36, -d / 2 + 0.06)
      .box(0.12, 0.4, d, 0xd8d4cc, w / 2 - 0.06, top + 0.36, 0).box(0.12, 0.4, d, 0xd8d4cc, -w / 2 + 0.06, top + 0.36, 0)
      .add(new THREE.CylinderGeometry(0.3, 0.3, 0.7, 8), 0x5a8ab8, w / 2 - 0.6, top + 0.5, -d / 2 + 0.6);   // a water tank
  }
  g.add(mats.baked1(p)!);
  const win = new THREE.BoxGeometry(0.62, 0.62, 0.05);
  mats.mesh(win);
  for (const sx of [-1, 1]) {
    const m = new THREE.Mesh(win, mats.windows);
    m.position.set(sx * Math.min(w / 2 - 0.7, 1.4), 1.55, d / 2 - 0.08);
    g.add(m);
  }
  return g;
}

/** An empty lot: a "for sale" board (unowned) or a bamboo scaffold (owned, not built yet). */
export function lotSign(mats: ModelMats, owned: boolean, w: number, d: number): THREE.Group {
  const g = new THREE.Group(), p = new Paint();
  if (!owned) {
    p.box(0.08, 1.3, 0.08, WOOD_DARK, -0.4, 0.65, 0).box(0.08, 1.3, 0.08, WOOD_DARK, 0.4, 0.65, 0)
      .box(1.1, 0.6, 0.06, 0xf6e7c0, 0, 1.1, 0.05).box(0.9, 0.12, 0.02, 0xc0392b, 0, 1.2, 0.09);
  } else {
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) p.box(0.09, 2.6, 0.09, 0xb8b060, x * (w / 2 - 0.3), 1.3, z * (d / 2 - 0.3));
    for (const y of [1.2, 2.4]) {
      p.box(w - 0.5, 0.06, 0.06, 0xb8b060, 0, y, d / 2 - 0.3).box(w - 0.5, 0.06, 0.06, 0xb8b060, 0, y, -d / 2 + 0.3)
        .box(0.06, 0.06, d - 0.5, 0xb8b060, w / 2 - 0.3, y, 0).box(0.06, 0.06, d - 0.5, 0xb8b060, -w / 2 + 0.3, y, 0);
    }
    p.box(w * 0.5, 0.5, d * 0.4, 0xa8a49c, -w * 0.15, 0.25, 0).box(0.6, 0.3, 0.6, 0xc9955a, w * 0.25, 0.15, d * 0.2);
  }
  g.add(mats.baked1(p)!);
  return g;
}

export interface Boat { root: THREE.Group; oar: THREE.Object3D }

/** The ghe: a tapered wooden hull with painted eyes at the bow, a bench, an oar on the stern. Length ~3.4 units. */
export function boatModel(mats: ModelMats): Boat {
  const root = new THREE.Group();
  const hull = new THREE.BoxGeometry(1.2, 0.5, 3.4, 1, 1, 8);
  const pos = hull.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i), k = Math.abs(z) / 1.7;
    pos.setX(i, pos.getX(i) * (1 - k * k * 0.85) * (pos.getY(i) < 0 ? 0.7 : 1));
    pos.setY(i, pos.getY(i) + k * k * 0.3);
  }
  hull.computeVertexNormals();
  const p = new Paint().add(hull, 0x7a4a2a, 0, 0.18, 0)
    .box(0.9, 0.06, 2.4, 0xa87a4a, 0, 0.38, 0)                 // the floor
    .box(1.0, 0.08, 0.3, 0xc9955a, 0, 0.5, -0.4)               // the bench
    .box(0.9, 0.08, 0.06, 0xc0392b, 0, 0.62, 1.52);            // the bow's red rim
  for (const sd of [-1, 1]) p.box(0.02, 0.14, 0.2, 0xffffff, sd * 0.31, 0.5, 1.36, 0, sd * 0.35, 0).box(0.025, 0.07, 0.08, 0x1c1410, sd * 0.32, 0.5, 1.4, 0, sd * 0.35, 0);
  root.add(mats.baked1(p)!);
  const oar = new THREE.Group();
  oar.position.set(0.35, 0.7, -1.4);
  oar.add(mats.baked1(new Paint().box(0.06, 0.06, 2.2, 0xc9955a, 0, 0, -0.9, 0.4).box(0.24, 0.03, 0.5, 0xa87a4a, 0, -0.42, -1.9, 0.4))!);
  root.add(oar);
  return { root, oar };
}

/** `crank`: the bike's pedals and crank arms (turned by the rider's pedalling: rotation.x = the crank angle). */
export interface Vehicle { root: THREE.Group; wheels: THREE.Object3D[]; radius: number; crank?: THREE.Object3D }

export function vehicleModel(mats: ModelMats, kind: VehicleKind, color: number): Vehicle {
  const root = new THREE.Group(), p = new Paint(), wheels: THREE.Object3D[] = [];
  const wheel = (r: number, t: number, x: number, z: number, spokes: boolean) => {
    const w = new THREE.Group();
    w.position.set(x, r, z);
    const wp = new Paint().add(new THREE.TorusGeometry(r - t / 2, t / 2, 5, 14), 0x22201e, 0, 0, 0, 0, Math.PI / 2, 0);
    if (spokes) for (let i = 0; i < 3; i++) wp.box(0.02, (r - t) * 2, 0.02, 0xc8c8c8, 0, 0, 0, (i / 3) * Math.PI);
    else wp.add(new THREE.CylinderGeometry(r * 0.5, r * 0.5, t * 0.8, 8), 0xb8b8b8, 0, 0, 0, 0, 0, Math.PI / 2);
    w.add(mats.baked1(wp)!);
    root.add(w);
    wheels.push(w);
  };
  let radius = 0.32;
  let crank: THREE.Object3D | undefined;
  if (kind === "bike") {
    wheel(0.34, 0.06, 0, 0.62, true); wheel(0.34, 0.06, 0, -0.62, true);
    p.box(0.05, 0.05, 1.0, color, 0, 0.62, 0, -0.15).box(0.05, 0.55, 0.05, color, 0, 0.6, -0.2, 0.25)
      .box(0.05, 0.6, 0.05, color, 0, 0.62, 0.55, -0.3).box(0.6, 0.04, 0.04, 0x3a3a3a, 0, 0.95, 0.46)
      .box(0.2, 0.06, 0.3, 0x2a2420, 0, 0.9, -0.22).box(0.28, 0.06, 0.26, 0x8a6a3a, 0, 0.55, -0.72)
      .add(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 12), 0x8a8a8a, 0.05, 0.36, -0.04, 0, 0, Math.PI / 2);   // the chainring
    // the cranks at the bottom bracket: the left arm up, the right one down (a = 0: the left foot at the top)
    const r = 0.17, cp = new Paint()
      .box(0.03, r, 0.04, 0x3a3a3a, -0.09, r / 2, 0).box(0.12, 0.03, 0.07, 0x22201e, -0.16, r, 0)
      .box(0.03, r, 0.04, 0x3a3a3a, 0.09, -r / 2, 0).box(0.12, 0.03, 0.07, 0x22201e, 0.16, -r, 0);
    crank = new THREE.Group();
    crank.position.set(0, 0.36, -0.04);
    crank.add(mats.baked1(cp)!);
    root.add(crank);
  } else if (kind === "moto") {
    radius = 0.3;
    wheel(0.3, 0.12, 0, 0.7, false); wheel(0.3, 0.12, 0, -0.62, false);
    p.box(0.36, 0.34, 0.9, color, 0, 0.55, 0.05).box(0.3, 0.1, 0.62, 0x22201e, 0, 0.82, -0.25)
      .box(0.34, 0.3, 0.24, color, 0, 0.7, 0.62, -0.3).box(0.7, 0.04, 0.04, 0x3a3a3a, 0, 1.0, 0.6)
      .box(0.14, 0.1, 0.06, 0xfff4c0, 0, 0.8, 0.76).box(0.1, 0.08, 0.5, 0x8a8a8a, 0.2, 0.32, -0.4);
  } else {
    radius = 0.3;
    for (const [x, z] of [[-0.72, 0.8], [0.72, 0.8], [-0.72, -0.8], [0.72, -0.8]]) wheel(0.3, 0.2, x, z, false);
    p.box(1.4, 0.45, 2.5, color, 0, 0.55, 0).box(1.3, 0.2, 0.9, color, 0, 0.86, 0.72)
      .box(1.2, 0.36, 0.05, 0x9ad0e8, 0, 1.08, 0.3, -0.35)                                   // the windscreen (open top)
      .box(1.2, 0.08, 1.1, 0x5a3a2a, 0, 0.8, -0.35)                                          // the seats' floor
      .box(1.3, 0.35, 0.2, 0x3a2a24, 0, 0.98, -0.8)                                          // the back seat
      .box(0.3, 0.12, 0.05, 0xfff4c0, 0.5, 0.62, 1.26).box(0.3, 0.12, 0.05, 0xfff4c0, -0.5, 0.62, 1.26)
      .box(0.3, 0.1, 0.05, 0xe0342a, 0.5, 0.62, -1.26).box(0.3, 0.1, 0.05, 0xe0342a, -0.5, 0.62, -1.26);
  }
  root.add(mats.baked1(p)!);
  return { root, wheels, radius, crank };
}

export interface Barrier { root: THREE.Group; pole: THREE.Object3D }

/** The bamboo barrier at a gated entrance: two node-ringed bamboo posts, a red-and-white striped pole hinged on the
 *  left post (raised when open), a little lantern. `w` = the opening's width (units); the pole spans it along +x. */
export function barrierModel(mats: ModelMats, w: number): Barrier {
  const root = new THREE.Group(), p = new Paint();
  for (const x of [-w / 2 - 0.2, w / 2 + 0.2]) {
    p.add(new THREE.CylinderGeometry(0.12, 0.14, 1.6, 7), 0x9aa84a, x, 0.8, 0);
    for (const y of [0.4, 0.85, 1.3]) p.add(new THREE.CylinderGeometry(0.145, 0.145, 0.05, 7), 0x7a8a34, x, y, 0);
  }
  p.box(0.12, 0.2, 0.12, 0x6e4424, w / 2 + 0.2, 1.05, 0).add(new THREE.SphereGeometry(0.14, 6, 5), 0xe0342a, -w / 2 - 0.2, 1.72, 0);
  root.add(mats.baked1(p)!);
  const pole = new THREE.Group();
  pole.position.set(-w / 2 - 0.2, 1.1, 0);
  const pp = new Paint();
  const segs = Math.max(3, Math.round(w / 0.5));
  for (let i = 0; i < segs; i++) pp.add(new THREE.CylinderGeometry(0.07, 0.07, (w + 0.4) / segs, 6), i % 2 ? 0xf6efe0 : 0xc0392b, ((i + 0.5) / segs) * (w + 0.4), 0, 0, 0, 0, Math.PI / 2);
  pole.add(mats.baked1(pp)!);
  root.add(pole);
  return { root, pole };
}

/** A spear leaning by the guard (bamboo shaft, iron tip, a red tassel). */
export function spearModel(mats: ModelMats): THREE.Group {
  const g = new THREE.Group();
  g.add(mats.baked1(new Paint().add(new THREE.CylinderGeometry(0.035, 0.04, 2.4, 5), 0xb8a860, 0, 1.2, 0)
    .add(new THREE.ConeGeometry(0.07, 0.3, 4), 0xc8ccd0, 0, 2.55, 0).add(new THREE.SphereGeometry(0.08, 5, 4), 0xc0392b, 0, 2.32, 0))!);
  g.rotation.z = 0.12;
  return g;
}

export function digModel(mats: ModelMats, dug: boolean): THREE.Group {
  const g = new THREE.Group(), p = new Paint();
  if (dug) {
    p.add(new THREE.CylinderGeometry(0.45, 0.4, 0.04, 10), 0x3a2818, 0, 0.02, 0);
    for (let i = 0; i < 5; i++) { const a = i * 1.3; p.add(new THREE.IcosahedronGeometry(0.16, 0), 0x7a5530, Math.cos(a) * 0.62, 0.08, Math.sin(a) * 0.62); }
  } else {
    p.add(new THREE.SphereGeometry(0.4, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), 0x8a6a3f, 0, 0, 0, 0, 0, 0, 1, 0.35, 1)
      .box(0.7, 0.04, 0.1, 0xd8342a, 0, 0.16, 0, 0, Math.PI / 4).box(0.7, 0.04, 0.1, 0xd8342a, 0, 0.16, 0, 0, -Math.PI / 4);
  }
  g.add(mats.baked1(p, false)!);
  return g;
}

export function bobberModel(mats: ModelMats): THREE.Group {
  const g = new THREE.Group();
  g.add(mats.baked1(new Paint().add(new THREE.SphereGeometry(0.12, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), 0xe0342a, 0, 0, 0)
    .add(new THREE.SphereGeometry(0.12, 8, 5, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), 0xf6f6f0, 0, 0, 0)
    .add(new THREE.CylinderGeometry(0.02, 0.02, 0.2, 4), 0x2a2420, 0, 0.18, 0), false)!);
  return g;
}

export function fishModel(mats: ModelMats, color: number): THREE.Group {
  const g = new THREE.Group();
  const p = new Paint();
  ell(p, color, [0.2, 0.26, 0.5], [0, 0, 0], [0, 0, 0], [10, 7]);
  ell(p, darker(color, 1.25), [0.16, 0.14, 0.4], [0, -0.06, 0.02]);
  p.add(new THREE.ConeGeometry(0.5, 1, 6), darker(color, 0.8), 0, 0, -0.33, -Math.PI / 2, 0, 0, 0.05, 0.2, 0.3);
  p.add(new THREE.ConeGeometry(0.5, 1, 5), darker(color, 0.8), 0, 0.14, -0.02, -0.5, 0, 0, 0.04, 0.12, 0.2);
  eyes(p, 0.04, 0.15, 0.075, 0.07);
  g.add(mats.creature1(p, false)!);
  return g;
}

export function duckModel(mats: ModelMats): Creature {
  const c = bird(mats, { color: 0xf6f2e8, wing: 0xe8e2d4, beak: 0xf0a030, head: 0xf6f2e8, belly: 0xffffff, tail: 0xe8e2d4, duck: true }, 1.2);
  c.hop = false;
  c.flies = false;
  c.waddle = true;
  return c;
}

/** Poses a creature for a frame: `phase` is its gait phase (radians), `gait` its stride (freq 0 = standing), `t` ms.
 *  Walks swing diagonal leg pairs with a small double-time bob; fleeing quadrupeds gallop (front pair, then back
 *  pair, the body rocking); hoppers tuck all four legs in each bound; standing animals breathe, look about, graze
 *  now and then and wag; birds flap in the air; ducks waddle. */
export function poseCreature(c: Creature, phase: number, gait: { freq: number; amp: number }, t: number, fleeing: boolean, reduced: boolean): void {
  const amp = gait.freq > 0 ? gait.amp : 0;
  const moving = amp > 0 && !reduced;
  const k = amp, s = Math.sin(phase);
  c.body.rotation.set(0, 0, 0);
  let bob = 0;
  if (c.legs.length === 4) {
    const [fl, fr, bl, br] = c.legs;
    if (!moving) for (const l of c.legs) l.rotation.x = 0;
    else if (c.hop) {
      const air = Math.abs(Math.sin(phase / 2));
      fl.rotation.x = fr.rotation.x = -0.9 * air * Math.min(1, k + 0.3);
      bl.rotation.x = br.rotation.x = 1.0 * air * Math.min(1, k + 0.3);
      bob = air * 0.18;
      c.body.rotation.x = -0.25 * Math.cos(phase / 2) * air;
    } else if (fleeing) {
      const f = Math.sin(phase), b = Math.sin(phase - 1.6);
      fl.rotation.x = f * k; fr.rotation.x = Math.sin(phase + 0.4) * k;
      bl.rotation.x = b * k; br.rotation.x = Math.sin(phase - 1.2) * k;
      bob = Math.abs(Math.sin(phase + 0.5)) * 0.07 * (1 + k);
      c.body.rotation.x = -0.06 + Math.sin(phase + 0.8) * 0.09 * k;
    } else {
      fl.rotation.x = br.rotation.x = s * k;
      fr.rotation.x = bl.rotation.x = -s * k;
      bob = Math.abs(Math.cos(phase)) * 0.025 * (1 + k);
    }
  } else if (c.waddle && moving) c.body.rotation.z = Math.sin(phase) * 0.14;
  else if (c.hop && moving) bob = Math.abs(Math.sin(phase / 2)) * 0.18;
  c.body.position.y = bob;
  // idle life: breathing, looking about, grazing
  const idle = reduced ? 0 : 1;
  if (c.trunk) c.trunk.scale.y = 1 + (moving ? 0 : Math.sin(t / 520 + phase) * 0.018 * idle);
  if (c.head) {
    if (moving) { c.head.rotation.x = Math.sin(phase * 2) * 0.05; c.head.rotation.y = 0; }
    else {
      c.head.rotation.x = Math.max(0, Math.sin(t / 1400 + phase)) * 0.5 * idle;
      c.head.rotation.y = Math.sin(t / 2300 + phase * 1.7) * 0.4 * idle * (c.head.rotation.x > 0.1 ? 0.3 : 1);
    }
  }
  if (c.tail) c.tail.rotation.y = reduced ? 0 : Math.sin(t / (fleeing ? 90 : moving ? 160 : 260)) * (moving ? 0.4 : 0.28);
  if (c.wings.length) {
    const air = c.flies && (fleeing || gait.freq > 2.5);
    const flap = air && !reduced ? Math.sin(t / 55) * 0.9 : c.waddle && moving ? 0.25 + Math.sin(phase * 2) * 0.1 : 0.1;
    c.wings[0].rotation.z = flap; c.wings[1].rotation.z = -flap;
    if (air) {
      c.body.position.y = Math.min(2.5, c.body.position.y + 0.5 + Math.sin(t / 300) * 0.2);
      c.body.rotation.x = -0.15;
    }
  }
}

/** A text label as a sprite (cached textures by text + style). */
export class Labels {
  private readonly cache = new Map<string, { tex: THREE.CanvasTexture; mat: THREE.SpriteMaterial; aspect: number }>();

  sprite(text: string, style: "name" | "ring" | "boss" | "alert" = "name", height = 0.42): THREE.Sprite {
    const key = `${style}|${text}`;
    let e = this.cache.get(key);
    if (!e) {
      const scale = 4, font = (style === "alert" ? 16 : 9) * scale;
      const cv = document.createElement("canvas");
      const c = cv.getContext("2d");
      if (!c) throw new Error("canvas-2d-unavailable");
      c.font = `bold ${font}px monospace`;
      const w = Math.ceil(c.measureText(text).width) + 8 * scale, h = font + 6 * scale;
      cv.width = w; cv.height = h;
      c.font = `bold ${font}px monospace`;
      c.fillStyle = style === "boss" ? "rgba(90, 16, 16, 0.85)" : style === "ring" ? "rgba(40, 60, 120, 0.8)" : style === "alert" ? "rgba(0,0,0,0)" : "rgba(58, 36, 24, 0.8)";
      c.beginPath();
      c.roundRect(0, 0, w, h, 3 * scale);
      c.fill();
      c.fillStyle = style === "alert" ? "#ffd84a" : "#ffffff";
      if (style === "alert") { c.strokeStyle = "#3a2418"; c.lineWidth = 3 * scale; c.textAlign = "center"; c.textBaseline = "middle"; c.strokeText(text, w / 2, h / 2); }
      c.textBaseline = "middle";
      c.textAlign = "center";
      c.fillText(text, w / 2, h / 2 + scale / 2);
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearFilter;
      e = { tex, mat: new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }), aspect: w / h };
      this.cache.set(key, e);
    }
    const s = new THREE.Sprite(e.mat);
    s.scale.set(height * e.aspect, height, 1);
    s.renderOrder = 10;
    return s;
  }

  dispose(): void {
    for (const e of this.cache.values()) { e.tex.dispose(); e.mat.dispose(); }
    this.cache.clear();
  }
}
