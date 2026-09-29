import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { ChibiHat, ChibiSpec } from "./spec";

// Browser only: a ChibiSpec → merged, vertex-coloured low-poly meshes, one per rig segment (head, torso, upper arms,
// forearms, thighs, calves). Every segment of a look is built once and shared by all the actors wearing that look;
// all characters share one flat-shaded Lambert material, so a character costs ~11 draw calls.

export type Detail = "high" | "low";

/** Rig measurements (world units; the feet are at y = 0). */
export const RIG = {
  hipY: 0.62,
  neckY: 0.6,
  headR: 0.5,
  headCY: 0.48,
  shoulderX: 0.29,
  shoulderY: 0.53,
  upperLen: 0.23,
  foreLen: 0.2,
  legX: 0.12,
  thighLen: 0.3,
  calfLen: 0.26,
} as const;

export interface ChibiParts {
  head: THREE.BufferGeometry;
  torso: THREE.BufferGeometry;
  upperL: THREE.BufferGeometry;
  upperR: THREE.BufferGeometry;
  foreL: THREE.BufferGeometry;
  foreR: THREE.BufferGeometry;
  thighL: THREE.BufferGeometry;
  thighR: THREE.BufferGeometry;
  calfL: THREE.BufferGeometry;
  calfR: THREE.BufferGeometry;
  rod: THREE.BufferGeometry;
}

const TAU = Math.PI * 2;
const tmpC = new THREE.Color();

/** Collects coloured primitives for one segment and merges them. */
class Seg {
  private readonly list: THREE.BufferGeometry[] = [];
  add(geo: THREE.BufferGeometry, color: string, at: [number, number, number] = [0, 0, 0], rot: [number, number, number] = [0, 0, 0], scale: [number, number, number] = [1, 1, 1]): this {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.deleteAttribute("uv");
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...at), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...scale));
    g.applyMatrix4(m);
    g = g.toNonIndexed();
    tmpC.set(color).convertSRGBToLinear();
    const n = g.getAttribute("position").count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = tmpC.r; col[i * 3 + 1] = tmpC.g; col[i * 3 + 2] = tmpC.b; }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    this.list.push(g);
    return this;
  }
  build(): THREE.BufferGeometry {
    if (!this.list.length) this.add(new THREE.BoxGeometry(0.001, 0.001, 0.001), "#000000");
    const out = mergeGeometries(this.list, false);
    for (const g of this.list) g.dispose();
    if (!out) throw new Error("chibi-merge-failed");
    out.computeBoundingSphere();
    return out;
  }
}

/** Primitive geometry, per detail level (created once, cloned into segments). */
class Prims {
  private readonly cache = new Map<string, THREE.BufferGeometry>();
  constructor(private readonly lo: boolean) {}
  private get(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let g = this.cache.get(key);
    if (!g) { g = make(); this.cache.set(key, g); }
    return g;
  }
  box(): THREE.BufferGeometry { return this.get("box", () => new THREE.BoxGeometry(1, 1, 1)); }
  ball(): THREE.BufferGeometry { return this.get("ball", () => new THREE.IcosahedronGeometry(1, this.lo ? 0 : 1)); }
  head(): THREE.BufferGeometry { return this.get("head", () => new THREE.IcosahedronGeometry(1, this.lo ? 1 : 2)); }
  cyl(top = 1, bottom = 1): THREE.BufferGeometry {
    return this.get(`cyl${top}|${bottom}`, () => new THREE.CylinderGeometry(top, bottom, 1, this.lo ? 6 : 8));
  }
  cone(): THREE.BufferGeometry { return this.get("cone", () => new THREE.ConeGeometry(1, 1, this.lo ? 8 : 12)); }
  /** A dome: the top `frac` of a sphere (frac 0.5 = hemisphere). */
  dome(frac: number): THREE.BufferGeometry {
    return this.get(`dome${frac}`, () => new THREE.SphereGeometry(1, this.lo ? 8 : 12, this.lo ? 4 : 6, 0, TAU, 0, Math.PI * frac));
  }
  ring(): THREE.BufferGeometry { return this.get("ring", () => new THREE.TorusGeometry(1, 0.22, 4, this.lo ? 8 : 12)); }
  dispose(): void { for (const g of this.cache.values()) g.dispose(); this.cache.clear(); }
}

// ---- head: face, hair, hat, hairpin ----

function buildHead(s: ChibiSpec, P: Prims): THREE.BufferGeometry {
  const seg = new Seg();
  const r = RIG.headR, cy = RIG.headCY;
  seg.add(P.head(), s.skin, [0, cy, 0], [0, 0, 0], [r, r * 0.94, r * 0.92]);
  // neck
  seg.add(P.cyl(), s.skinShade, [0, 0.05, 0], [0, 0, 0], [0.1, 0.14, 0.1]);
  // face (front = +z): eyes with a shine, blush, mouth, little ears
  const fz = r * 0.86;
  for (const sx of [-1, 1]) {
    seg.add(P.box(), "#2a1a14", [sx * 0.17, cy - 0.04, fz], [0, sx * 0.3, 0], [0.09, 0.15, 0.05]);
    seg.add(P.box(), "#ffffff", [sx * 0.17 - 0.02, cy + 0.0, fz + 0.03], [0, 0, 0], [0.035, 0.045, 0.02]);
    seg.add(P.ball(), s.blush, [sx * 0.29, cy - 0.16, fz - 0.1], [0, 0, 0], [0.07, 0.035, 0.03]);
    seg.add(P.ball(), s.skin, [sx * r * 0.93, cy - 0.04, 0], [0, 0, 0], [0.06, 0.1, 0.07]);
  }
  seg.add(P.box(), s.mouth, [0, cy - 0.22, fz - 0.02], [0, 0, 0], [0.08, 0.025, 0.03]);
  addHair(seg, s, P);
  if (s.hat) addHat(seg, s.hat, P);
  if (s.hairpin) addHairpin(seg, s, P);
  else if (s.gender === "nu" && !s.hat) seg.add(P.ball(), "#d23a67", [0.33, cy + 0.33, 0.22], [0, 0, 0], [0.07, 0.05, 0.05]);
  return seg.build();
}

function addHair(seg: Seg, s: ChibiSpec, P: Prims): void {
  const { main, hi, shade } = s.hair;
  const r = RIG.headR, cy = RIG.headCY;
  const cap = (scale: number, frac: number, tilt = -0.85) => seg.add(P.dome(frac), main, [0, cy + 0.02, -0.02], [tilt, 0, 0], [r * scale, r * scale, r * scale]);
  const fringe = (w: number, h: number, y = cy + 0.28) => seg.add(P.box(), main, [0, y, r * 0.78], [-0.35, 0, 0], [w, h, 0.14]);
  switch (s.hair.style) {
    case "buzz":
      cap(1.02, 0.62, -0.8);
      break;
    case "undercut":
      cap(1.02, 0.6, -0.95);
      seg.add(P.box(), main, [0.05, cy + 0.42, 0.1], [-0.3, 0, -0.15], [0.7, 0.16, 0.6]);
      seg.add(P.box(), hi, [0.12, cy + 0.47, 0.28], [-0.5, 0, -0.2], [0.4, 0.1, 0.2]);
      break;
    case "curly": {
      cap(1.06, 0.68);
      const n = 11;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU, ring = i % 2 ? 0.55 : 0.35;
        const x = Math.sin(a) * r * 0.9, z = Math.cos(a) * r * 0.9 - 0.06;
        if (z > r * 0.55 && ring < 0.5) continue;                       // keep the face clear
        seg.add(P.ball(), i % 3 ? main : hi, [x, cy + ring, z * 0.95], [0, 0, 0], [0.17, 0.16, 0.17]);
      }
      seg.add(P.ball(), main, [0, cy + 0.52, 0], [0, 0, 0], [0.26, 0.16, 0.26]);
      break;
    }
    case "bob":
      cap(1.07, 0.68);
      seg.add(P.box(), main, [0, cy - 0.08, -0.22], [0, 0, 0], [1.08, 0.62, 0.62]);
      for (const sx of [-1, 1]) seg.add(P.box(), shade, [sx * 0.5, cy - 0.1, 0.12], [0, 0, 0], [0.14, 0.56, 0.4]);
      fringe(0.78, 0.2);
      break;
    case "long":
      cap(1.07, 0.68);
      seg.add(P.box(), main, [0, cy - 0.3, -0.28], [0.08, 0, 0], [1.02, 1.05, 0.45]);
      for (const sx of [-1, 1]) seg.add(P.box(), shade, [sx * 0.5, cy - 0.22, 0.14], [0, 0, 0], [0.14, 0.84, 0.36]);
      fringe(0.74, 0.18);
      break;
    case "ponytail":
      cap(1.06, 0.68);
      fringe(0.7, 0.16);
      seg.add(P.ball(), shade, [0, cy + 0.26, -0.5], [0, 0, 0], [0.1, 0.1, 0.1]);
      seg.add(P.cyl(0.6, 1), main, [0, cy - 0.06, -0.62], [0.35, 0, 0], [0.16, 0.62, 0.16]);
      break;
    case "twin_braids":
      cap(1.06, 0.68);
      fringe(0.74, 0.18);
      for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) {
        seg.add(P.ball(), i % 2 ? shade : main, [sx * 0.46, cy - 0.12 - i * 0.16, -0.02], [0, 0, 0], [0.12 - i * 0.012, 0.1, 0.12 - i * 0.012]);
      }
      break;
    case "bun":
      cap(1.06, 0.68);
      fringe(0.7, 0.14);
      seg.add(P.ball(), main, [0, cy + 0.52, -0.2], [0, 0, 0], [0.24, 0.22, 0.24]);
      seg.add(P.ring(), shade, [0, cy + 0.38, -0.16], [Math.PI / 2 - 0.4, 0, 0], [0.14, 0.14, 0.14]);
      break;
    case "bangs":
      cap(1.07, 0.68);
      seg.add(P.box(), main, [0, cy - 0.02, -0.24], [0, 0, 0], [1.02, 0.44, 0.5]);
      fringe(0.96, 0.3, cy + 0.2);
      break;
    case "short":
    default:
      cap(1.05, 0.68);
      fringe(0.62, 0.2);
      seg.add(P.box(), hi, [-0.14, cy + 0.36, r * 0.62], [-0.55, 0, 0.25], [0.26, 0.1, 0.1]);
      break;
  }
}

function addHat(seg: Seg, h: ChibiHat, P: Prims): void {
  const cy = RIG.headCY, top = cy + 0.28;
  const brim = (rad: number, y: number, c = h.brim, tilt = 0) => seg.add(P.cyl(), c, [0, y, 0.02], [tilt, 0, 0], [rad, 0.04, rad]);
  switch (h.shape) {
    case "nonla":
      seg.add(P.cone(), h.main, [0, top + 0.26, 0], [0, 0, 0], [0.95, 0.52, 0.95]);
      seg.add(P.cyl(), h.accent, [0, top + 0.02, 0], [0, 0, 0], [0.9, 0.02, 0.9]);
      break;
    case "cap":
      seg.add(P.dome(0.5), h.main, [0, top - 0.08, 0], [0, 0, 0], [0.56, 0.44, 0.56]);
      seg.add(P.box(), h.brim, [0, top - 0.06, 0.58], [-0.1, 0, 0], [0.62, 0.05, 0.42]);
      seg.add(P.ball(), h.accent, [0, top + 0.37, 0], [0, 0, 0], [0.06, 0.04, 0.06]);
      break;
    case "beanie":
      seg.add(P.dome(0.55), h.main, [0, top - 0.1, 0], [-0.1, 0, 0], [0.57, 0.6, 0.57]);
      seg.add(P.cyl(), h.brim, [0, top - 0.08, 0], [-0.1, 0, 0], [0.58, 0.14, 0.58]);
      seg.add(P.ball(), h.accent, [0, top + 0.5, -0.05], [0, 0, 0], [0.14, 0.14, 0.14]);
      break;
    case "fedora":
      brim(0.85, top - 0.02);
      seg.add(P.cyl(0.8, 1), h.main, [0, top + 0.18, 0], [0, 0, 0], [0.5, 0.4, 0.5]);
      seg.add(P.cyl(), h.accent, [0, top + 0.04, 0], [0, 0, 0], [0.52, 0.08, 0.52]);
      break;
    case "sunhat":
      brim(1.0, top - 0.04, h.main);
      seg.add(P.dome(0.5), h.main, [0, top - 0.04, 0], [0, 0, 0], [0.54, 0.42, 0.54]);
      seg.add(P.cyl(), h.brim, [0, top + 0.02, 0], [0, 0, 0], [0.55, 0.08, 0.55]);
      seg.add(P.ball(), h.accent, [0.4, top + 0.08, 0.3], [0, 0, 0], [0.1, 0.08, 0.1]);
      break;
    case "helmet":
      seg.add(P.dome(0.55), h.main, [0, top - 0.16, 0], [-0.1, 0, 0], [0.62, 0.62, 0.62]);
      seg.add(P.box(), h.accent, [0, top + 0.26, 0.02], [0, 0, 0], [0.12, 0.2, 0.9]);
      break;
    case "coi":
      seg.add(P.dome(0.5), h.main, [0, top - 0.1, 0], [0, 0, 0], [0.62, 0.5, 0.66]);
      brim(0.72, top - 0.1, h.brim);
      break;
    case "bucket":
      seg.add(P.cyl(0.8, 1), h.main, [0, top + 0.08, 0], [0, 0, 0], [0.56, 0.36, 0.56]);
      seg.add(P.cyl(1, 0.8), h.brim, [0, top - 0.12, 0], [0, 0, 0], [0.82, 0.08, 0.82]);
      break;
    case "crown":
      seg.add(P.cyl(), h.main, [0, top + 0.1, 0], [0, 0, 0], [0.4, 0.18, 0.4]);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        seg.add(P.cone(), h.shade, [Math.sin(a) * 0.36, top + 0.28, Math.cos(a) * 0.36], [0, 0, 0], [0.08, 0.2, 0.08]);
      }
      seg.add(P.ball(), h.accent, [0, top + 0.12, 0.4], [0, 0, 0], [0.06, 0.06, 0.04]);
      break;
    case "antlers":
      for (const sx of [-1, 1]) {
        seg.add(P.cyl(), h.main, [sx * 0.26, top + 0.28, 0], [0, 0, sx * -0.35], [0.05, 0.5, 0.05]);
        seg.add(P.cyl(), h.main, [sx * 0.42, top + 0.38, 0], [0, 0, sx * -1.1], [0.04, 0.26, 0.04]);
        seg.add(P.cyl(), h.shade, [sx * 0.24, top + 0.4, 0.04], [0, 0, sx * 0.5], [0.035, 0.2, 0.035]);
      }
      seg.add(P.cyl(), h.accent, [0, top - 0.02, 0], [0, 0, 0], [0.54, 0.05, 0.54]);
      break;
    case "cowboy":
      brim(0.95, top - 0.04);
      for (const sx of [-1, 1]) seg.add(P.box(), h.brim, [sx * 0.86, top + 0.06, 0], [0, 0, sx * 0.5], [0.3, 0.04, 1.2]);
      seg.add(P.cyl(0.85, 1), h.main, [0, top + 0.2, 0], [0, 0, 0], [0.48, 0.44, 0.48]);
      seg.add(P.cyl(), h.accent, [0, top + 0.04, 0], [0, 0, 0], [0.5, 0.08, 0.5]);
      break;
    case "taibeo":
    default:
      seg.add(P.dome(0.5), h.main, [0, top - 0.1, 0], [-0.08, 0, 0], [0.58, 0.46, 0.58]);
      seg.add(P.cyl(1, 0.9), h.shade, [0, top - 0.1, 0.02], [0, 0, 0], [0.7, 0.06, 0.7]);
      break;
  }
}

function addHairpin(seg: Seg, s: ChibiSpec, P: Prims): void {
  const hp = s.hairpin;
  if (!hp) return;
  const cy = RIG.headCY, r = RIG.headR;
  switch (hp.kind) {
    case "headband":
      seg.add(P.ring(), hp.main, [0, cy + 0.18, -0.02], [Math.PI / 2 - 0.5, 0, 0], [r * 1.02, r * 1.0, r * 0.6]);
      break;
    case "bandana":
      seg.add(P.cyl(), hp.main, [0, cy + 0.22, 0], [-0.3, 0, 0], [r * 1.08, 0.1, r * 1.08]);
      seg.add(P.box(), hp.main, [0, cy + 0.08, -r * 1.02], [0.4, 0, 0], [0.12, 0.26, 0.05]);
      break;
    case "tie":
      seg.add(P.ball(), hp.main, [0, cy + 0.22, -r * 1.02], [0, 0, 0], [0.08, 0.08, 0.06]);
      break;
    case "bow":
      for (const sx of [-1, 1]) seg.add(P.cone(), hp.main, [0.28 + sx * 0.09, cy + 0.42, 0.18], [0, 0, sx * -Math.PI / 2], [0.08, 0.14, 0.06]);
      seg.add(P.ball(), hp.accent, [0.28, cy + 0.42, 0.2], [0, 0, 0], [0.04, 0.04, 0.04]);
      break;
    case "flower":
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU;
        seg.add(P.ball(), hp.main, [0.32 + Math.cos(a) * 0.07, cy + 0.36 + Math.sin(a) * 0.07, 0.24], [0, 0, 0], [0.05, 0.05, 0.03]);
      }
      seg.add(P.ball(), hp.accent, [0.32, cy + 0.36, 0.26], [0, 0, 0], [0.04, 0.04, 0.03]);
      break;
    case "star":
    default:
      seg.add(P.cone(), hp.main, [0.3, cy + 0.38, 0.22], [Math.PI / 2, 0, 0], [0.09, 0.04, 0.09]);
      seg.add(P.ball(), hp.accent, [0.3, cy + 0.38, 0.25], [0, 0, 0], [0.03, 0.03, 0.02]);
      break;
  }
}

// ---- torso: hips, chest, skirt/robe, belt, neckwear ----

function buildTorso(s: ChibiSpec, P: Prims): THREE.BufferGeometry {
  const seg = new Seg();
  const nu = s.gender === "nu";
  const shoulder = nu ? 0.21 : 0.24, waist = nu ? 0.19 : 0.22;
  seg.add(P.cyl(1, 1), s.bottom, [0, 0.06, 0], [0, 0, 0], [nu ? 0.23 : 0.22, 0.16, 0.15]);
  seg.add(P.cyl(1, waist / shoulder), s.torso, [0, 0.37, 0], [0, 0, 0], [shoulder, 0.46, 0.15]);
  // shoulders round off into the sleeves; a collar line in the detail colour
  for (const sx of [-1, 1]) seg.add(P.ball(), s.sleeveColor, [sx * (shoulder + 0.02), 0.54, 0], [0, 0, 0], [0.09, 0.08, 0.1]);
  seg.add(P.box(), s.detail, [0, 0.52, 0.14], [0.2, 0, 0], [0.16, 0.08, 0.03]);
  if (s.detail !== s.torso) seg.add(P.box(), s.detail, [0, 0.3, 0.15], [0, 0, 0], [0.03, 0.34, 0.02]);
  if (s.band) seg.add(P.cyl(), s.band, [0, 0.42, 0], [0, 0, 0], [shoulder * 1.04, 0.12, 0.16]);
  const skirt = (len: number, flare: number, c = s.bottom) => seg.add(P.cyl(0.62, 1), c, [0, 0.12 - len / 2, 0], [0, 0, 0], [waist + flare, len, 0.2 + flare * 0.7]);
  switch (s.lower) {
    case "skirt": skirt(0.3, 0.12); break;
    case "pleated": skirt(0.38, 0.14); for (let i = -2; i <= 2; i++) seg.add(P.box(), s.bottomShade, [i * 0.07, -0.06, 0.25], [0.3, 0, 0], [0.02, 0.34, 0.02]); break;
    case "maxi": skirt(0.66, 0.16); break;
    case "robe": skirt(0.6, 0.12, s.torso); seg.add(P.box(), s.detail, [0, -0.05, 0.25], [0.2, 0, 0], [0.04, 0.5, 0.02]); break;
    default: break;
  }
  if (s.belt) {
    seg.add(P.cyl(), s.belt, [0, 0.15, 0], [0, 0, 0], [waist + 0.015, 0.06, 0.165]);
    seg.add(P.box(), s.belt, [0.05, 0.05, 0.16], [0, 0, 0.2], [0.04, 0.16, 0.02]);
    seg.add(P.box(), s.belt, [-0.03, 0.05, 0.16], [0, 0, -0.15], [0.04, 0.14, 0.02]);
  }
  const n = s.neck;
  if (n?.kind === "scarf") {
    seg.add(P.ring(), n.main, [0, 0.6, 0], [Math.PI / 2, 0, 0], [0.16, 0.16, 0.45]);
    seg.add(P.box(), n.shade, [0.08, 0.46, 0.15], [0.1, 0, 0.15], [0.07, 0.22, 0.03]);
  } else if (n) {
    seg.add(P.ring(), n.main, [0, 0.55, 0.02], [Math.PI / 2 - 0.5, 0, 0], [0.14, 0.14, 0.12]);
    seg.add(P.ball(), n.accent, [0, 0.43, 0.16], [0, 0, 0], [0.04, 0.05, 0.03]);
  }
  return seg.build();
}

// ---- limbs (each hangs down from its pivot, -y) ----

function buildUpper(s: ChibiSpec, P: Prims): THREE.BufferGeometry {
  const L = RIG.upperLen;
  const c = s.sleeve === "none" ? s.skin : s.sleeveColor;
  return new Seg().add(P.cyl(1, 0.9), c, [0, -L / 2, 0], [0, 0, 0], [0.075, L, 0.075]).build();
}

function buildFore(s: ChibiSpec, P: Prims, right: boolean): THREE.BufferGeometry {
  const F = RIG.foreLen;
  const seg = new Seg();
  seg.add(P.cyl(0.9, 0.85), s.sleeve === "long" ? s.sleeveColor : s.skin, [0, -F / 2, 0], [0, 0, 0], [0.068, F, 0.068]);
  seg.add(P.ball(), s.skin, [0, -F - 0.04, 0.01], [0, 0, 0], [0.085, 0.085, 0.085]);
  if (right && s.wrist) {
    seg.add(P.ring(), s.wrist.main, [0, -F + 0.03, 0], [Math.PI / 2, 0, 0], [0.075, 0.075, 0.3]);
    if (s.wrist.kind === "watch") seg.add(P.box(), s.wrist.accent, [0.07, -F + 0.03, 0], [0, 0, 0], [0.03, 0.06, 0.06]);
  }
  return seg.build();
}

function buildThigh(s: ChibiSpec, P: Prims): THREE.BufferGeometry {
  const T = RIG.thighLen;
  return new Seg().add(P.cyl(1, 0.9), s.thigh, [0, -T / 2, 0], [0, 0, 0], [0.095, T, 0.1]).build();
}

function buildCalf(s: ChibiSpec, P: Prims): THREE.BufferGeometry {
  const C = RIG.calfLen;
  const seg = new Seg();
  const sh = s.shoe;
  const boots = sh.shape === "boots";
  seg.add(P.cyl(0.95, 0.85), boots ? sh.main : s.calf, [0, -C / 2, 0], [0, 0, 0], [0.085, C, 0.09]);
  const flat = sh.shape === "dep" || sh.shape === "sandals";
  const y = -C - 0.03;
  if (flat) {
    seg.add(P.box(), s.skin, [0, y + 0.01, 0.04], [0, 0, 0], [0.14, 0.07, 0.22]);
    seg.add(P.box(), sh.sole, [0, y - 0.04, 0.04], [0, 0, 0], [0.16, 0.03, 0.26]);
    seg.add(P.box(), sh.main, [0, y + 0.03, 0.08], [0, 0, 0], [0.15, 0.03, 0.05]);
    if (sh.shape === "sandals") seg.add(P.box(), sh.main, [0, y + 0.04, -0.06], [0, 0, 0], [0.15, 0.03, 0.03]);
  } else {
    seg.add(P.box(), sh.main, [0, y, 0.04], [0, 0, 0], [0.16, 0.09, 0.26]);
    seg.add(P.box(), sh.shape === "sneakers" ? sh.sole : sh.sole, [0, y - 0.05, 0.04], [0, 0, 0], [0.17, 0.03, 0.27]);
  }
  return seg.build();
}

function buildRod(P: Prims): THREE.BufferGeometry {
  return new Seg()
    .add(P.cyl(), "#8b5a33", [0, 0, 0.55], [Math.PI / 2, 0, 0], [0.02, 1.1, 0.02])
    .add(P.cyl(), "#3a2418", [0, 0, 0.08], [Math.PI / 2, 0, 0], [0.035, 0.16, 0.035])
    .build();
}

interface Entry { parts: ChibiParts; refs: number }

/** Builds the parts once per look key and detail level; actors `acquire` and `release` them (idle entries beyond
 *  `max` are disposed, oldest first). */
export class ChibiFactory {
  private readonly prims: Record<Detail, Prims> = { high: new Prims(false), low: new Prims(true) };
  private readonly entries = new Map<string, Entry>();
  private readonly rods: Partial<Record<Detail, THREE.BufferGeometry>> = {};
  /** The one material every character shares (flat toon shading, vertex colours). */
  readonly material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

  constructor(private readonly max = 120) {}

  acquire(spec: ChibiSpec, detail: Detail): { key: string; parts: ChibiParts } {
    const key = `${detail}|${spec.key}`;
    let e = this.entries.get(key);
    if (e) this.entries.delete(key);                                    // re-insert: LRU order
    else {
      const P = this.prims[detail];
      const rod = (this.rods[detail] ??= buildRod(P));
      const upper = buildUpper(spec, P), thigh = buildThigh(spec, P), calf = buildCalf(spec, P);
      e = {
        refs: 0,
        parts: {
          head: buildHead(spec, P), torso: buildTorso(spec, P),
          upperL: upper, upperR: upper, foreL: buildFore(spec, P, false), foreR: buildFore(spec, P, true),
          thighL: thigh, thighR: thigh, calfL: calf, calfR: calf, rod,
        },
      };
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
      this.disposeParts(e.parts);
      this.entries.delete(k);
    }
  }

  private disposeParts(p: ChibiParts): void {
    const seen = new Set<THREE.BufferGeometry>();
    for (const [name, g] of Object.entries(p) as [keyof ChibiParts, THREE.BufferGeometry][]) if (name !== "rod") seen.add(g);
    for (const g of seen) g.dispose();
  }

  dispose(): void {
    for (const e of this.entries.values()) this.disposeParts(e.parts);
    this.entries.clear();
    for (const r of Object.values(this.rods)) r?.dispose();
    this.prims.high.dispose();
    this.prims.low.dispose();
    this.material.dispose();
  }
}
