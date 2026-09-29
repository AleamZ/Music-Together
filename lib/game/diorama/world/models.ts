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

/** Colour-baked parts, merged into one geometry. */
export class Paint {
  private readonly parts: THREE.BufferGeometry[] = [];
  private readonly e = new THREE.Euler();
  private readonly m = new THREE.Matrix4();

  add(geo: THREE.BufferGeometry, hex: number, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): this {
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    if (g.getAttribute("uv")) g.deleteAttribute("uv");
    if (g.getAttribute("uv1")) g.deleteAttribute("uv1");
    const n = g.getAttribute("position").count, col = new Float32Array(n * 3), c = new THREE.Color(hex);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
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

  geometry(): THREE.BufferGeometry {
    const g = mergeGeometries(this.parts, false) ?? new THREE.BufferGeometry();
    for (const p of this.parts) p.dispose();
    this.parts.length = 0;
    g.computeBoundingSphere();
    return g;
  }
}

/** The shared materials of every live model (the layer disposes them). */
export class ModelMats {
  readonly baked = toonMat({ vertexColors: true });
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

  forget(g: THREE.BufferGeometry): void {
    this.geos.delete(g);
    g.dispose();
  }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    this.geos.clear();
    for (const m of [this.baked, this.glow, this.eyes, this.decal, this.foam, this.windows]) m.dispose();
  }
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
}

interface QuadSpec {
  body: [number, number, number]; color: number; belly?: number;
  head: [number, number, number]; headColor?: number; neck?: number; snout?: number; snoutColor?: number;
  leg: number; legW?: number; legColor?: number;
  ears?: "long" | "point" | "round" | "floppy"; earColor?: number;
  tail?: "puff" | "bushy" | "thin" | "curl" | "stub"; tailColor?: number; tailTip?: number;
  antlers?: boolean; horns?: number; tusks?: boolean; mane?: number; spots?: number; stripes?: number;
  hop?: boolean; glowEyes?: boolean;
}

const EYE = 0x1c1410;

function quad(mats: ModelMats, s: QuadSpec, scale = 1): Creature {
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  const [bw, bh, bl] = s.body, [hw, hh, hl] = s.head, legW = s.legW ?? Math.min(bw, bl) * 0.28;
  const y0 = s.leg + bh / 2;
  const p = new Paint().box(bw, bh, bl, s.color, 0, y0, 0);
  if (s.belly !== undefined) p.box(bw * 0.8, bh * 0.3, bl * 0.8, s.belly, 0, y0 - bh * 0.38, 0);
  if (s.mane !== undefined) p.box(bw * 1.08, bh * 1.1, bl * 0.35, s.mane, 0, y0 + bh * 0.05, bl * 0.3);
  if (s.stripes !== undefined) for (let i = -1; i <= 1; i++) p.box(bw * 1.02, bh * 0.9, bl * 0.07, s.stripes, 0, y0 + bh * 0.04, i * bl * 0.22);
  if (s.spots !== undefined) for (let i = 0; i < 3; i++) p.box(bw * 1.03, bh * 0.35, bl * 0.18, s.spots, 0, y0 + bh * (0.15 - i * 0.12), bl * (0.25 - i * 0.28));
  if (s.tusks) p.add(new THREE.ConeGeometry(0.04, 0.2, 4), 0xf4ecd8, hw * 0.35, y0 + (s.neck ?? 0) - hh * 0.15, bl / 2 + hl * 0.95, 1.2, 0, 0)
    .add(new THREE.ConeGeometry(0.04, 0.2, 4), 0xf4ecd8, -hw * 0.35, y0 + (s.neck ?? 0) - hh * 0.15, bl / 2 + hl * 0.95, 1.2, 0, 0);
  const bodyMesh = mats.baked1(p)!;
  body.add(bodyMesh);

  // the head, on its own pivot (it bobs while grazing)
  const head = new THREE.Group();
  head.position.set(0, y0 + (s.neck ?? 0), bl / 2);
  const hp = new Paint().box(hw, hh, hl, s.headColor ?? s.color, 0, 0, hl * 0.4);
  if (s.neck) hp.box(hw * 0.6, s.neck, hw * 0.6, s.headColor ?? s.color, 0, -s.neck / 2, 0);
  if (s.snout) hp.box(hw * 0.6, hh * 0.5, s.snout, s.snoutColor ?? s.headColor ?? s.color, 0, -hh * 0.18, hl * 0.9 + s.snout / 2 - 0.02)
    .box(hw * 0.2, hh * 0.14, 0.03, EYE, 0, -hh * 0.05, hl * 0.9 + s.snout);
  if (!s.glowEyes) hp.box(0.05, 0.06, 0.02, EYE, hw * 0.28, hh * 0.12, hl * 0.9 + 0.01).box(0.05, 0.06, 0.02, EYE, -hw * 0.28, hh * 0.12, hl * 0.9 + 0.01);
  const ec = s.earColor ?? s.headColor ?? s.color;
  for (const sd of [-1, 1]) {
    if (s.ears === "long") hp.box(hw * 0.2, hh * 1.3, hw * 0.12, ec, sd * hw * 0.22, hh * 1.1, hl * 0.2, 0, 0, sd * -0.12);
    else if (s.ears === "point") hp.add(new THREE.ConeGeometry(hw * 0.18, hh * 0.55, 4), ec, sd * hw * 0.3, hh * 0.72, hl * 0.25, 0, Math.PI / 4, 0);
    else if (s.ears === "round") hp.add(new THREE.SphereGeometry(hw * 0.17, 6, 4), ec, sd * hw * 0.38, hh * 0.52, hl * 0.2);
    else if (s.ears === "floppy") hp.box(hw * 0.14, hh * 0.6, hl * 0.3, ec, sd * hw * 0.55, hh * 0.05, hl * 0.25, 0, 0, sd * 0.25);
    if (s.antlers) {
      hp.box(0.04, 0.5, 0.04, 0x7a5a3a, sd * hw * 0.3, hh * 0.8, hl * 0.2, 0, 0, sd * -0.35)
        .box(0.04, 0.26, 0.04, 0x7a5a3a, sd * hw * 0.55, hh * 1.05, hl * 0.28, 0.4, 0, sd * -0.9);
    }
    if (s.horns) hp.add(new THREE.TorusGeometry(s.horns, s.horns * 0.16, 4, 8, Math.PI * 0.9), 0xe8dcc0, sd * hw * 0.5, hh * 0.45, hl * 0.3, 0, Math.PI / 2, sd > 0 ? 0 : Math.PI);
  }
  head.add(mats.baked1(hp)!);
  if (s.glowEyes) for (const sd of [-1, 1]) {
    const e = mats.mesh(new THREE.BoxGeometry(0.07, 0.06, 0.02), mats.eyes, false);
    e.position.set(sd * hw * 0.28, hh * 0.12, hl * 0.9 + 0.012);
    head.add(e);
  }
  body.add(head);

  // legs: hip pivots with the leg hanging below
  const legs: THREE.Object3D[] = [];
  const legGeo = new Paint().box(legW, s.leg, legW, s.legColor ?? s.color, 0, -s.leg / 2, 0)
    .box(legW * 1.05, s.leg * 0.14, legW * 1.1, darker(s.legColor ?? s.color, 0.7), 0, -s.leg + s.leg * 0.07, legW * 0.04).geometry();
  mats.mesh(legGeo);                                              // registers it for disposal
  for (const [fx, fz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const hip = new THREE.Group();
    hip.position.set(fx * (bw / 2 - legW * 0.55), s.leg, fz * (bl / 2 - legW * 0.8));
    const leg = new THREE.Mesh(legGeo, mats.baked);
    leg.castShadow = true;
    hip.add(leg);
    body.add(hip);
    legs.push(hip);
  }

  // the tail
  let tail: THREE.Object3D | null = null;
  if (s.tail) {
    const t = new THREE.Group();
    t.position.set(0, y0 + bh * 0.3, -bl / 2);
    const tc = s.tailColor ?? s.color, tp = new Paint();
    if (s.tail === "puff") tp.add(new THREE.IcosahedronGeometry(bw * 0.2, 0), tc, 0, 0, -0.03);
    else if (s.tail === "bushy") tp.add(new THREE.CapsuleGeometry(bw * 0.2, bl * 0.35, 2, 5), tc, 0, -0.08, -bl * 0.3, -1.1).add(new THREE.IcosahedronGeometry(bw * 0.2, 0), s.tailTip ?? tc, 0, -0.26, -bl * 0.52);
    else if (s.tail === "thin") tp.box(0.05, 0.05, bl * 0.6, tc, 0, 0.05, -bl * 0.28, -0.5);
    else if (s.tail === "curl") tp.add(new THREE.TorusGeometry(bw * 0.18, 0.035, 4, 8, Math.PI * 1.5), tc, 0, bw * 0.2, -0.06, 0, Math.PI / 2, 0);
    else tp.box(bw * 0.25, bw * 0.2, 0.12, tc, 0, 0, -0.05, 0.4);
    t.add(mats.baked1(tp)!);
    body.add(t);
    tail = t;
  }
  root.scale.setScalar(scale);
  return { root, body, legs, wings: [], head, tail, hop: !!s.hop, flies: false, height: (y0 + bh / 2 + (s.neck ?? 0) + hh / 2) * scale };
}

function bird(mats: ModelMats, color: number, wing: number, beak = 0xf0a030, head = color, scale = 1): Creature {
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  const p = new Paint()
    .add(new THREE.SphereGeometry(0.2, 7, 5), color, 0, 0.32, 0, 0, 0, 0, 1, 0.9, 1.3)
    .add(new THREE.SphereGeometry(0.13, 7, 5), head, 0, 0.5, 0.2)
    .add(new THREE.ConeGeometry(0.04, 0.12, 4), beak, 0, 0.48, 0.36, Math.PI / 2)
    .box(0.03, 0.04, 0.02, EYE, 0.08, 0.53, 0.3).box(0.03, 0.04, 0.02, EYE, -0.08, 0.53, 0.3)
    .box(0.14, 0.03, 0.2, darker(color, 0.8), 0, 0.34, -0.3, 0.3)
    .box(0.03, 0.14, 0.03, beak, 0.07, 0.07, 0).box(0.03, 0.14, 0.03, beak, -0.07, 0.07, 0);
  body.add(mats.baked1(p)!);
  const wings: THREE.Object3D[] = [];
  const wg = new Paint().box(0.3, 0.03, 0.2, wing, 0.15, 0, 0).geometry();
  mats.mesh(wg);
  for (const sd of [-1, 1]) {
    const w = new THREE.Group();
    w.position.set(sd * 0.14, 0.38, 0);
    const m = new THREE.Mesh(wg, mats.baked);
    m.scale.x = sd;
    w.add(m);
    body.add(w);
    wings.push(w);
  }
  root.scale.setScalar(scale);
  return { root, body, legs: [], wings, head: null, tail: null, hop: true, flies: true, height: 0.6 * scale };
}

function darker(hex: number, k: number): number {
  return new THREE.Color(hex).multiplyScalar(k).getHex();
}

const WILD: Record<Exclude<WildSpeciesId, "bird" | "firefly">, [QuadSpec, number]> = {
  rabbit: [{ body: [0.34, 0.3, 0.46], color: 0xb8a48a, belly: 0xece4d4, head: [0.28, 0.26, 0.26], ears: "long", leg: 0.12, tail: "puff", tailColor: 0xffffff, hop: true, snout: 0.05, snoutColor: 0xe8dccb }, 1],
  deer: [{ body: [0.46, 0.44, 0.95], color: 0xb07a44, belly: 0xe8d2b0, head: [0.24, 0.26, 0.34], neck: 0.4, ears: "point", leg: 0.78, legW: 0.1, tail: "stub", tailColor: 0xffffff, antlers: true, spots: 0xd8b07a, snout: 0.12 }, 1],
  fox: [{ body: [0.3, 0.3, 0.7], color: 0xd8702c, belly: 0xf4e4d0, head: [0.28, 0.26, 0.26], ears: "point", earColor: 0x3a2418, leg: 0.3, legColor: 0x3a2418, tail: "bushy", tailTip: 0xffffff, snout: 0.16, snoutColor: 0xf4e4d0 }, 1],
  wolf: [{ body: [0.42, 0.44, 0.95], color: 0x7a7d86, belly: 0xc8c8c8, head: [0.34, 0.32, 0.32], ears: "point", leg: 0.5, tail: "bushy", tailColor: 0x6a6d76, snout: 0.2, snoutColor: 0xb8b8b8, mane: 0x8a8d96 }, 1],
  bear: [{ body: [0.85, 0.78, 1.25], color: 0x5a3a24, head: [0.52, 0.48, 0.44], ears: "round", leg: 0.42, legW: 0.26, tail: "stub", snout: 0.18, snoutColor: 0xb89a74 }, 1],
};

export function wildAnimal(mats: ModelMats, sp: WildSpeciesId): Creature {
  if (sp === "bird") return bird(mats, 0x8a6a4a, 0x6a4a2a, 0xf0a030, 0x8a6a4a, 1);
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
  hamster: { body: [0.3, 0.24, 0.32], color: 0xe0b070, belly: 0xfff4e0, head: [0.24, 0.22, 0.18], ears: "round", earColor: 0xf0a0a0, leg: 0.06, tail: "stub", hop: true },
  tho: { body: [0.3, 0.28, 0.4], color: 0xf4f0ea, head: [0.26, 0.24, 0.24], ears: "long", earColor: 0xf6d4d4, leg: 0.1, tail: "puff", hop: true, snout: 0.04, snoutColor: 0xf6d4d4 },
  soc: { body: [0.22, 0.24, 0.36], color: 0xa0522d, belly: 0xf0d8b0, head: [0.22, 0.22, 0.2], ears: "point", leg: 0.12, tail: "bushy", tailColor: 0xb8663a, hop: true },
  meo: { body: [0.26, 0.26, 0.52], color: 0xe8a050, belly: 0xfff4e0, stripes: 0xc87830, head: [0.28, 0.26, 0.22], ears: "point", leg: 0.22, tail: "thin", snout: 0.05, snoutColor: 0xfff4e0 },
  cho: { body: [0.3, 0.3, 0.56], color: 0xd9a55a, belly: 0xf4e4c8, head: [0.3, 0.28, 0.26], ears: "floppy", earColor: 0xa8783a, leg: 0.26, tail: "curl", snout: 0.12, snoutColor: 0xf4e4c8 },
};

export function petModel(mats: ModelMats, sp: PetSpecies): Creature {
  if (sp === "vet") return bird(mats, 0x3cb043, 0x2a8a36, 0xf0c040, 0xe0402a, 1.1);
  return quad(mats, PETS[sp], 1);
}

const DOG_COAT: Record<string, [number, number | undefined, number | undefined]> = {
  vang: [0xd9a55a, undefined, undefined], muc: [0x2a2320, undefined, undefined], ven: [0x9a7040, 0x5a3a20, undefined], dom: [0xf0ece0, undefined, 0x3a3030],
};
export function dogModel(mats: ModelMats, coat = "vang"): Creature {
  const [c, stripes, spots] = DOG_COAT[coat] ?? DOG_COAT.vang;
  return quad(mats, { body: [0.36, 0.36, 0.72], color: c, stripes, spots, head: [0.34, 0.32, 0.3], ears: "floppy", leg: 0.34, tail: "curl", snout: 0.16, snoutColor: c === 0x2a2320 ? 0x4a3a30 : 0xf4e4c8 }, 1);
}

export function ratModel(mats: ModelMats): Creature {
  return quad(mats, { body: [0.16, 0.14, 0.3], color: 0x6f6660, head: [0.14, 0.12, 0.12], ears: "round", earColor: 0xd8a0a0, leg: 0.05, tail: "thin", tailColor: 0xd8a0a0, snout: 0.07 }, 1);
}

// ---------------------------------------------------------------- bosses

export function bossModel(mats: ModelMats, kind: BossId): Creature {
  switch (kind) {
    case "trau_tinh": return quad(mats, { body: [1.1, 0.95, 1.7], color: 0x3d3f4a, belly: 0x55576a, head: [0.7, 0.62, 0.6], ears: "floppy", leg: 0.7, legW: 0.3, tail: "thin", horns: 0.45, snout: 0.22, snoutColor: 0x6a6070, glowEyes: true, mane: 0x2a2c36 }, 2.2);
    case "soi_ma": return quad(mats, { body: [0.5, 0.5, 1.1], color: 0x8fa6e0, belly: 0xdfe8ff, head: [0.4, 0.36, 0.36], ears: "point", leg: 0.6, tail: "bushy", tailColor: 0xb8c8f0, tailTip: 0xffffff, snout: 0.24, snoutColor: 0xc8d4f4, mane: 0x6f86c8, glowEyes: true }, 2.6);
    case "heo_rung": return quad(mats, { body: [0.8, 0.72, 1.3], color: 0x5a4030, belly: 0x7a5a44, head: [0.56, 0.5, 0.46], ears: "point", leg: 0.36, legW: 0.22, tail: "curl", tusks: true, snout: 0.2, snoutColor: 0xc88a7a, mane: 0x3a2818, glowEyes: true }, 2.4);
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

export interface Vehicle { root: THREE.Group; wheels: THREE.Object3D[]; radius: number }

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
  if (kind === "bike") {
    wheel(0.34, 0.06, 0, 0.62, true); wheel(0.34, 0.06, 0, -0.62, true);
    p.box(0.05, 0.05, 1.0, color, 0, 0.62, 0, -0.15).box(0.05, 0.55, 0.05, color, 0, 0.6, -0.2, 0.25)
      .box(0.05, 0.6, 0.05, color, 0, 0.62, 0.55, -0.3).box(0.6, 0.04, 0.04, 0x3a3a3a, 0, 0.95, 0.46)
      .box(0.2, 0.06, 0.3, 0x2a2420, 0, 0.9, -0.22).box(0.28, 0.06, 0.26, 0x8a6a3a, 0, 0.55, -0.72);
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
  return { root, wheels, radius };
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
  g.add(mats.baked1(new Paint().add(new THREE.SphereGeometry(0.2, 7, 5), color, 0, 0, 0, 0, 0, 0, 0.6, 0.8, 1.6)
    .add(new THREE.ConeGeometry(0.16, 0.26, 3), darker(color, 0.8), 0, 0, -0.38, -Math.PI / 2)
    .box(0.02, 0.04, 0.04, EYE, 0.1, 0.05, 0.2).box(0.02, 0.04, 0.04, EYE, -0.1, 0.05, 0.2), false)!);
  return g;
}

export function duckModel(mats: ModelMats): Creature {
  const c = bird(mats, 0xf4f0e6, 0xe8e4d8, 0xf0a030, 0xf4f0e6, 1.2);
  c.hop = false;
  c.flies = false;
  return c;
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
