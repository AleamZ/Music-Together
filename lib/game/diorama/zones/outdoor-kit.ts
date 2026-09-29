import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { PlotDraw } from "@/lib/game/art/crops";
import type { GameMap, Rect } from "@/lib/game/maps/types";
import { pxLen, pxToWorld, type MapSize } from "../coords";
import { rng } from "../layout";

// The toolkit of the outdoor zone dioramas built straight from their map data (field, Bãi đất, Mỏ đá, Sông Cái):
// flat-shaded Lambert materials cached by colour, boxes placed in map px, instanced repeats, a terrain of one instanced
// box per ground cell, the plinth under the map, lamps, palms, signs and an animated water plane. `finish()` merges the
// static meshes per material (a few draw calls) and hangs the zone's runtime hooks on the group (userData.rig). Builds
// without WebGL (node tests too). Original procedural art only: no model or texture files.

/** What the view drives each frame (the pond's Built fields, plus the zone's own hooks). */
export interface ZoneRig {
  lamps: THREE.PointLight[];
  bulbs: THREE.MeshBasicMaterial[];
  thinnable: Array<{ mesh: THREE.InstancedMesh; full: number }>;
  sway: Array<{ obj: THREE.Object3D; seed: number; base: number }>;
  roofs: Array<{ mats: THREE.MeshLambertMaterial[]; x: number; y: number; w: number; h: number }>;
  /** The first water surface (null: none). */
  water: THREE.Mesh | null;
  /** Water, fire, drifting things (t = ms; frozen when reduced motion). */
  animate(t: number, wind: number): void;
  /** Where feet stand at map px (3D units). */
  heightAt(x: number, y: number): number;
  /** The field's plots (crops by stage); other zones have none. */
  setPlots?(plots: ReadonlyArray<PlotDraw>, now: number): void;
  dispose(): void;
}

export interface OutdoorOptions {
  /** 0.5 … 1: how many repeated plants/props (low-end devices build fewer). */
  density?: number;
}

/** A zone builder: the map → its diorama group in zone-local px → units (centred like the pond). */
export type OutdoorBuilder = (map: GameMap, opts?: OutdoorOptions) => THREE.Group;

export const rigOf = (g: THREE.Object3D): ZoneRig => g.userData.rig as ZoneRig;

/** The water surface's height (the same as the pond's). */
export const ZONE_WATER_Y = -0.22;
const FLOOR = -1.4;

export interface Inst {
  x: number; y: number; z: number;
  sx?: number; sy?: number; sz?: number;
  rx?: number; ry?: number; rz?: number;
  color?: number;
}

/** Is (x, y) inside a px rect (grown by `pad`)? */
export const inRect = (x: number, y: number, r: Rect, pad = 0): boolean =>
  x >= r.x - pad && x < r.x + r.w + pad && y >= r.y - pad && y < r.y + r.h + pad;

export class Kit {
  readonly root = new THREE.Group();
  readonly size: MapSize;
  readonly lamps: THREE.PointLight[] = [];
  readonly bulbs: THREE.MeshBasicMaterial[] = [];
  readonly thinnable: ZoneRig["thinnable"] = [];
  readonly sway: ZoneRig["sway"] = [];
  readonly roofs: ZoneRig["roofs"] = [];
  readonly animators: Array<(t: number, wind: number) => void> = [];
  readonly unit: THREE.BoxGeometry;
  private firstWater: THREE.Mesh | null = null;
  private readonly geos = new Set<THREE.BufferGeometry>();
  private readonly mats = new Map<string, THREE.Material>();
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly s3 = new THREE.Vector3();
  private readonly p3 = new THREE.Vector3();
  private readonly col = new THREE.Color();

  constructor(size: MapSize) {
    this.size = { width: size.width, height: size.height };
    this.unit = this.geo(new THREE.BoxGeometry(1, 1, 1));
  }

  geo<T extends THREE.BufferGeometry>(g: T): T {
    this.geos.add(g);
    return g;
  }

  /** A cached flat Lambert material. */
  lam(color: number, emissive = 0): THREE.MeshLambertMaterial {
    const key = `l${color}|${emissive}`;
    let m = this.mats.get(key) as THREE.MeshLambertMaterial | undefined;
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color, flatShading: true, emissive });
      this.mats.set(key, m);
    }
    return m;
  }

  /** Register a material made elsewhere (disposed with the zone). */
  own<T extends THREE.Material>(m: T): T {
    this.mats.set(`own${this.mats.size}`, m);
    return m;
  }

  /** px → world ground point. */
  W(x: number, y: number): { x: number; z: number } {
    return pxToWorld({ x, y }, this.size);
  }

  mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = this.root, shadow = true): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = shadow;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  /** A box in world units standing on `y0` (its bottom), centred at (x, z). */
  box(w: number, h: number, d: number, mat: THREE.Material | number, x: number, y0: number, z: number, ry = 0, parent: THREE.Object3D = this.root): THREE.Mesh {
    const m = this.mesh(this.unit, typeof mat === "number" ? this.lam(mat) : mat, x, y0 + h / 2, z, parent);
    m.scale.set(w, h, d);
    m.rotation.y = ry;
    return m;
  }

  /** A box over a px rect (inset px on every side), from y0 up by h (units). */
  boxPx(r: Rect, y0: number, h: number, mat: THREE.Material | number, inset = 0, parent: THREE.Object3D = this.root): THREE.Mesh {
    const c = this.W(r.x + r.w / 2, r.y + r.h / 2);
    return this.box(pxLen(r.w - inset * 2), h, pxLen(r.h - inset * 2), mat, c.x, y0, c.z, 0, parent);
  }

  /** A bar between two px points (a rail, a rope, a pipe), `t` thick (`ty` tall), its centre at height y. */
  beam(x1: number, y1: number, x2: number, y2: number, y: number, t: number, mat: THREE.Material | number, ty = t): THREE.Mesh {
    const a = this.W(x1, y1), b = this.W(x2, y2);
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const m = this.mesh(this.unit, typeof mat === "number" ? this.lam(mat) : mat, (a.x + b.x) / 2, y, (a.z + b.z) / 2);
    m.scale.set(len, ty, t);
    m.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
    return m;
  }

  compose(m: THREE.Matrix4, i: Inst): THREE.Matrix4 {
    return m.compose(this.p3.set(i.x, i.y, i.z), this.q.setFromEuler(this.e.set(i.rx ?? 0, i.ry ?? 0, i.rz ?? 0)),
      this.s3.set(i.sx ?? 1, i.sy ?? 1, i.sz ?? 1));
  }

  /** One instanced mesh for a list (world units). `thin`: fewer in low quality; `capacity` leaves room for refills. */
  inst(geo: THREE.BufferGeometry, mat: THREE.Material | number, list: readonly Inst[], opts: { thin?: boolean; capacity?: number; shadow?: boolean } = {}): THREE.InstancedMesh {
    const material = typeof mat === "number" ? this.lam(mat) : mat;
    const im = new THREE.InstancedMesh(geo, material, Math.max(1, opts.capacity ?? list.length));
    im.castShadow = opts.shadow ?? true;
    im.receiveShadow = true;
    this.fill(im, list);
    this.root.add(im);
    if (opts.thin) this.thinnable.push({ mesh: im, full: im.count });
    return im;
  }

  /** (Re)fill an instanced mesh (up to its capacity). */
  fill(im: THREE.InstancedMesh, list: readonly Inst[]): void {
    const n = Math.min(list.length, im.instanceMatrix.count);
    for (let i = 0; i < n; i++) {
      im.setMatrixAt(i, this.compose(this.m4, list[i]));
      const c = list[i].color;
      if (c !== undefined) im.setColorAt(i, this.col.setHex(c));
    }
    im.count = n;
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
  }

  /** The ground: one instanced box per cell; `at(x, y)` gives its top (units) and colour at the cell's centre. */
  terrain(cell: number, at: (x: number, y: number) => { top: number; color: number }, seed = 99): THREE.InstancedMesh {
    const cols = Math.ceil(this.size.width / cell), rows = Math.ceil(this.size.height / cell);
    const t = pxLen(cell);
    const im = new THREE.InstancedMesh(this.unit, this.lam(0xffffff), cols * rows);
    im.receiveShadow = true;
    const R = rng(seed);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const g = at(c * cell + cell / 2, r * cell + cell / 2);
      const p = this.W(c * cell + cell / 2, r * cell + cell / 2);
      this.m4.makeScale(t, g.top - FLOOR, t).setPosition(p.x, (g.top + FLOOR) / 2, p.z);
      im.setMatrixAt(r * cols + c, this.m4);
      im.setColorAt(r * cols + c, this.col.setHex(g.color).offsetHSL(0, 0, (R() - 0.5) * 0.035));
    }
    this.root.add(im);
    return im;
  }

  /** The diorama's base: layered earth under the map on a dark plinth, like a model on a table. */
  base(earth = 0x7a5530, lip = 0x5a8f32): void {
    const mw = pxLen(this.size.width), mh = pxLen(this.size.height);
    this.mesh(this.geo(new THREE.BoxGeometry(mw, 1.6, mh)), this.lam(earth), 0, FLOOR - 0.8, 0, this.root, false);
    this.mesh(this.geo(new THREE.BoxGeometry(mw + 0.3, 0.9, mh + 0.3)), this.lam(0x5b4636), 0, FLOOR - 2.05, 0, this.root, false);
    this.mesh(this.geo(new THREE.BoxGeometry(mw + 1.6, 0.6, mh + 1.6)), this.lam(0x3b3029), 0, FLOOR - 2.8, 0, this.root, false);
    this.mesh(this.geo(new THREE.BoxGeometry(mw + 0.08, 0.12, mh + 0.08)), this.lam(lip), 0, FLOOR + 0.02, 0, this.root, false);
  }

  /** A bulb that glows at night (the view warms it from lantern red to lamp yellow). */
  bulb(x: number, y: number, z: number, r = 0.14, parent: THREE.Object3D = this.root): THREE.Mesh {
    const m = this.own(new THREE.MeshBasicMaterial({ color: 0xd23a3a }));
    this.bulbs.push(m);
    return this.mesh(this.geo(new THREE.SphereGeometry(r, 8, 6)), m, x, y, z, parent, false);
  }

  /** A night light at map px (radius px), `height` units up. */
  lamp(x: number, y: number, r: number, height = 1.8, color = 0xffb060): THREE.PointLight {
    const w = this.W(x, y);
    const l = new THREE.PointLight(color, 0, pxLen(r) * 3.2, 1.6);
    l.position.set(w.x, height, w.z);
    this.lamps.push(l);
    this.root.add(l);
    return l;
  }

  /** A roof whose materials fade while the player is under it (px footprint). */
  roof(r: Rect): { mat(color: number): THREE.MeshLambertMaterial } {
    const entry: ZoneRig["roofs"][number] = { mats: [], x: r.x, y: r.y, w: r.w, h: r.h };
    this.roofs.push(entry);
    const byColor = new Map<number, THREE.MeshLambertMaterial>();
    return {
      mat: (color: number) => {
        let m = byColor.get(color);
        if (!m) {
          m = this.own(new THREE.MeshLambertMaterial({ color, flatShading: true, transparent: true }));
          byColor.set(color, m);
          entry.mats.push(m);
        }
        return m;
      },
    };
  }

  /** A coconut palm at px (the 2D prop's h/lean/seed): a curved segmented trunk and a swaying crown. */
  palm(x: number, y: number, hPx: number, lean: number, seed: number, y0 = 0): void {
    const grp = new THREE.Group();
    const c = this.W(x, y);
    grp.position.set(c.x, y0, c.z);
    const h = pxLen(hPx), segs = 6, R = rng(seed);
    let px0 = 0, py = 0;
    const segH = h / segs;
    for (let k = 0; k < segs; k++) {
      const tilt = lean * (k / segs) * 0.9;
      const s = this.mesh(this.geo(new THREE.CylinderGeometry(0.1 - k * 0.008, 0.14 - k * 0.008, segH * 1.05, 6)), this.lam(k % 2 ? 0x8a6a45 : 0x7a5a38), px0, py + segH / 2, 0, grp);
      s.rotation.z = -tilt;
      px0 += Math.sin(tilt) * segH; py += Math.cos(tilt) * segH;
    }
    const crown = new THREE.Group();
    crown.position.set(px0, py, 0);
    for (let k = 0; k < 8; k++) {
      const f = new THREE.Mesh(this.unit, this.lam(k % 2 ? 0x4f9a3a : 0x3f7a2e));
      f.scale.set(1.9, 0.05, 0.4);
      f.position.set(0.8, -0.2, 0);
      f.castShadow = true;
      const arm = new THREE.Group();
      arm.rotation.y = (k / 8) * Math.PI * 2 + R();
      arm.rotation.z = -0.35 - R() * 0.2;
      arm.add(f);
      crown.add(arm);
    }
    for (let k = 0; k < 3; k++) this.mesh(this.geo(new THREE.SphereGeometry(0.12, 6, 4)), this.lam(0x6b4a2b), Math.cos(k * 2) * 0.15, -0.15, Math.sin(k * 2) * 0.15, crown);
    grp.add(crown);
    grp.rotation.y = (seed % 7) * 0.9;
    crown.userData.keep = true;
    this.sway.push({ obj: crown, seed, base: 0 });
    this.root.add(grp);
  }

  /** A banana plant at px. */
  banana(x: number, y: number): void {
    const c = this.W(x, y), h = pxLen(34);
    this.mesh(this.geo(new THREE.CylinderGeometry(0.14, 0.2, h * 0.55, 6)), this.lam(0x7a9a48), c.x, h * 0.275, c.z);
    const crown = new THREE.Group();
    crown.position.set(c.x, h * 0.55, c.z);
    for (let k = 0; k < 6; k++) {
      const f = new THREE.Mesh(this.unit, this.lam(k % 2 ? 0x6fbf4a : 0x5a9a38));
      f.scale.set(1.3, 0.04, 0.55);
      f.position.set(0.6, 0.1, 0);
      f.castShadow = true;
      const arm = new THREE.Group();
      arm.rotation.y = (k / 6) * Math.PI * 2;
      arm.rotation.z = 0.35;
      arm.add(f);
      crown.add(arm);
    }
    crown.userData.keep = true;
    this.sway.push({ obj: crown, seed: x, base: 0 });
    this.root.add(crown);
  }

  /** A small sign on one post (px base), the green city-map post, or a two-post board. */
  sign(x: number, y: number, kind: "sign" | "city" | "board" = "sign"): void {
    const c = this.W(x, y);
    const h = pxLen(kind === "sign" ? 22 : 30), w = pxLen(kind === "sign" ? 16 : kind === "city" ? 18 : 24);
    const post = this.lam(0x5a3a1e);
    for (const sx of kind === "board" ? [-1, 1] : [0]) this.box(0.12, h, 0.12, post, c.x + sx * (w / 2 - 0.1), 0, c.z);
    this.box(w, h * 0.42, 0.08, 0x3a2418, c.x, h * 0.51, c.z + 0.06);
    this.box(w - 0.12, h * 0.42 - 0.12, 0.1, kind === "city" ? 0x9ecf8a : kind === "board" ? 0xd06a3a : 0xf4f1e8, c.x, h * 0.57, c.z + 0.07);
    if (kind === "board") this.box(w + 0.2, 0.1, 0.4, 0x8a5a30, c.x, h * 0.93, c.z + 0.05);
  }

  /** A water surface over a px rect: a gentle bob, waves travelling downstream (+x) when `flow` > 0. Vertex colours
   *  from `tint(x, y)` (px) when given (deeper in the middle, lighter over shoals). */
  water(r: Rect, opts: { y?: number; color?: number; opacity?: number; segs?: [number, number]; flow?: number; tint?: (x: number, y: number) => number } = {}): THREE.Mesh {
    const a = this.W(r.x, r.y), b = this.W(r.x + r.w, r.y + r.h);
    const [sx, sz] = opts.segs ?? [Math.max(2, Math.round(r.w / 12)), Math.max(2, Math.round(r.h / 12))];
    const g = this.geo(new THREE.PlaneGeometry(b.x - a.x, b.z - a.z, sx, sz));
    g.rotateX(-Math.PI / 2);
    const cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2, y = opts.y ?? ZONE_WATER_Y;
    if (opts.tint) {
      const pos = g.attributes.position as THREE.BufferAttribute;
      const cols = new Float32Array(pos.count * 3), c = new THREE.Color();
      for (let i = 0; i < pos.count; i++) {
        c.setHex(opts.tint((pos.getX(i) + cx) * 16 + this.size.width / 2, (pos.getZ(i) + cz) * 16 + this.size.height / 2));
        cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
      }
      g.setAttribute("color", new THREE.BufferAttribute(cols, 3));
    }
    const mat = this.own(new THREE.MeshPhongMaterial({
      color: opts.tint ? 0xffffff : opts.color ?? 0x4aa3c8, vertexColors: !!opts.tint, transparent: true, opacity: opts.opacity ?? 0.84,
      shininess: 90, specular: 0x9fd8ff, flatShading: true,
    }));
    const m = new THREE.Mesh(g, mat);
    m.position.set(cx, y, cz);
    m.receiveShadow = true;
    m.userData.keep = true;
    this.root.add(m);
    this.firstWater ??= m;
    const base = Float32Array.from((g.attributes.position as THREE.BufferAttribute).array);
    const flow = opts.flow ?? 0;
    this.animators.push((t, wind) => {
      const pos = g.attributes.position as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      const amp = 0.03 + Math.min(0.07, wind / 900), s = t / 1000;
      for (let i = 0; i < arr.length; i += 3) {
        const x = base[i], z = base[i + 2];
        arr[i + 1] = base[i + 1] + amp * (Math.sin(x * 0.9 - s * (1.6 + flow * 2.2)) + Math.sin(z * 1.3 - s * 1.1 + x * 0.3) * 0.6);
      }
      pos.needsUpdate = true;
      g.computeVertexNormals();
    });
    return m;
  }

  /** Merge the static meshes per material, hang the hooks on the group (userData.rig) and return it. */
  finish(hooks: { heightAt: ZoneRig["heightAt"]; setPlots?: ZoneRig["setPlots"]; animate?: ZoneRig["animate"] }): THREE.Group {
    const root = this.root;
    root.updateMatrixWorld(true);
    const kept = (o: THREE.Object3D) => { for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p.userData.keep) return true; return false; };
    const buckets = new Map<string, { mat: THREE.Material; cast: boolean; parts: THREE.BufferGeometry[]; meshes: THREE.Mesh[] }>();
    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || o instanceof THREE.InstancedMesh || Array.isArray(o.material) || kept(o)) return;
      const key = `${o.material.uuid}|${o.castShadow}`;
      let b = buckets.get(key);
      if (!b) { b = { mat: o.material, cast: o.castShadow, parts: [], meshes: [] }; buckets.set(key, b); }
      const geo = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrixWorld);
      for (const name of Object.keys(geo.attributes)) if (name !== "position" && name !== "normal") geo.deleteAttribute(name);
      b.parts.push(geo);
      b.meshes.push(o);
    });
    for (const b of buckets.values()) {
      if (b.meshes.length < 2) { for (const p of b.parts) p.dispose(); continue; }
      const merged = mergeGeometries(b.parts, false);
      for (const p of b.parts) p.dispose();
      if (!merged) continue;
      for (const m of b.meshes) m.removeFromParent();
      const m = new THREE.Mesh(this.geo(merged), b.mat);
      m.castShadow = b.cast;
      m.receiveShadow = true;
      root.add(m);
    }
    const animators = this.animators, geos = this.geos, mats = this.mats;
    const rig: ZoneRig = {
      lamps: this.lamps, bulbs: this.bulbs, thinnable: this.thinnable, sway: this.sway, roofs: this.roofs, water: this.firstWater,
      heightAt: hooks.heightAt,
      setPlots: hooks.setPlots,
      animate: (t, wind) => {
        for (const a of animators) a(t, wind);
        hooks.animate?.(t, wind);
      },
      dispose: () => {
        root.traverse((o) => { if (o instanceof THREE.InstancedMesh) o.dispose(); });
        for (const g of geos) g.dispose();
        for (const m of mats.values()) m.dispose();
        root.clear();
      },
    };
    root.userData.rig = rig;
    return root;
  }
}
