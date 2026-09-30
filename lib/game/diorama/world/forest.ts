import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { DOMAIN } from "@/lib/game/world/terrain";
import { CHUNK_PX, chunkOf, CHUNKS_X, CHUNKS_Y, landUse, scatterFlowers, scatterGrass, scatterHyacinths, scatterRocks, scatterTrees, type Spot, type TreeKind } from "@/lib/game/world/scenery";
import { toon } from "./toon";

// Browser only: the world's trees, rocks, grass and flowers, instanced per scenery chunk. Trees have three levels of
// detail (a full crown with its trunk, a coarse crown, a far proxy of a few triangles); a chunk shows one level at a
// time from its distance to the camera. Grass and flowers only exist in the near chunks. Every instanced mesh has its
// own bounding sphere, so the renderer's frustum culling skips the chunks off screen.

const TRUNK = new THREE.Color(0x7a5436);
/** A chunk's half diagonal (units). */
const CHUNK_R = (CHUNK_PX / 16) * Math.SQRT1_2;

function painted(g: THREE.BufferGeometry, c: THREE.Color): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  const n = geo.getAttribute("position").count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  if (geo.getAttribute("uv")) geo.deleteAttribute("uv");
  return geo;
}

const WHITE = new THREE.Color(1, 1, 1);

/** A round crown: an icosahedron, squashed and nudged a little so no two look machine-made. */
function crown(detail: number, sx: number, sy: number, y: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.getAttribute("position");
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), yy = p.getY(i), z = p.getZ(i);
    const k = 1 + 0.08 * Math.sin(x * 5.1 + z * 3.7) + 0.06 * Math.cos(yy * 6.3);
    p.setXYZ(i, x * sx * k, yy * sy * k + y, z * sx * k);
  }
  g.computeVertexNormals();
  return g;
}

/** The leaf colour the tree builders paint (set per kind; fruit and flowers keep their own). */
let LEAF = WHITE;

const PALE = new THREE.Color(0xe2dccb), PALM_TRUNK = new THREE.Color(0x8a6a48), CULM = new THREE.Color(0x9ab85a);

/** Tràm (melaleuca): a tall, slim, pale papery trunk and a few small airy tufts high up. */
function tram(lod: number): THREE.BufferGeometry {
  const parts = [painted(new THREE.CylinderGeometry(0.07, 0.13, 4.2, lod === 0 ? 6 : 4).translate(0, 2.1, 0), PALE)];
  const tufts = lod === 0 ? [[0, 4.4, 0, 0.75], [0.45, 3.8, 0.2, 0.5], [-0.35, 4.0, -0.25, 0.55]] : lod === 1 ? [[0, 4.3, 0, 0.85]] : [[0, 4.1, 0, 0.9]];
  for (const [x, y, z, r] of tufts) parts.push(painted(crown(0, r, r * 0.7, y).translate(x, 0, z), LEAF));
  return mergeGeometries(parts)!;
}

/** Dừa (coconut palm): a leaning, slightly curved ringed trunk and a crown of drooping fronds, coconuts under it. */
function dua(lod: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const segs = lod === 0 ? 5 : 2, H = 5.2;
  let x = 0, y = 0;
  for (let i = 0; i < segs; i++) {
    const lean = 0.12 + i * 0.06, h = H / segs;
    parts.push(painted(new THREE.CylinderGeometry(0.11 - i * 0.008, 0.14 - i * 0.008, h * 1.04, lod === 0 ? 6 : 4).rotateZ(-lean).translate(x + Math.sin(lean) * h / 2, y + h / 2, 0), PALM_TRUNK));
    x += Math.sin(lean) * h; y += Math.cos(lean) * h;
  }
  const n = lod === 0 ? 8 : lod === 1 ? 6 : 5;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const frond = new THREE.BoxGeometry(2.2, 0.04, 0.42).translate(1.05, 0, 0).rotateZ(-0.35 - (k % 2) * 0.2).rotateY(a).translate(x, y, 0);
    parts.push(painted(frond, LEAF));
  }
  if (lod === 0) for (let k = 0; k < 3; k++) parts.push(painted(new THREE.IcosahedronGeometry(0.14, 0).translate(x + Math.cos(k * 2) * 0.18, y - 0.18, Math.sin(k * 2) * 0.18), new THREE.Color(0x6b8a2e)));
  return mergeGeometries(parts)!;
}

/** Dừa nước (nipa palm): no trunk — long feathery fronds straight out of the mud, arching over the water. */
function duanuoc(lod: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const n = lod === 0 ? 7 : lod === 1 ? 5 : 4;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + (k % 2) * 0.3, tilt = 0.6 + (k % 3) * 0.15;
    parts.push(painted(new THREE.BoxGeometry(0.34, 3.2, 0.05).translate(0, 1.6, 0).rotateZ(tilt).rotateY(a), LEAF));
  }
  return mergeGeometries(parts)!;
}

/** Tre (a bamboo clump): a bundle of tall green culms, their leafy tops nodding outwards. */
function tre(lod: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const n = lod === 0 ? 9 : lod === 1 ? 5 : 3;
  for (let k = 0; k < n; k++) {
    const a = k * 2.4, r = 0.25 + (k % 3) * 0.12, h = 4.2 + (k % 4) * 0.5, lean = 0.08 + (k % 3) * 0.06;
    const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
    if (lod < 2) parts.push(painted(new THREE.CylinderGeometry(0.05, 0.06, h, 4).translate(0, h / 2, 0).rotateZ(-lean).rotateY(a).translate(cx, 0, cz), CULM));
    parts.push(painted(new THREE.ConeGeometry(0.55, 1.6, 5).translate(0, h - 0.2, 0).rotateZ(-lean * 1.6).rotateY(a).translate(cx, 0, cz), LEAF));
  }
  return mergeGeometries(parts)!;
}

/** Painted in a fixed colour (fruit, flowers: the instance colour tints only the LEAF parts' leaves). */
const fixed = (g: THREE.BufferGeometry, hex: number) => painted(g, new THREE.Color(hex));

/** Thốt nốt (sugar palm): a very tall, straight, thin trunk and a round, spiky ball of fan leaves on top. */
function thotnot(lod: number): THREE.BufferGeometry {
  const parts = [painted(new THREE.CylinderGeometry(0.1, 0.16, 7, lod === 0 ? 6 : 4).translate(0, 3.5, 0), new THREE.Color(0x5a4a3a))];
  parts.push(painted(new THREE.IcosahedronGeometry(1.15, 0).translate(0, 7.4, 0), LEAF));
  if (lod === 0) for (let k = 0; k < 8; k++) parts.push(painted(new THREE.ConeGeometry(0.22, 1.1, 3).translate(0, 0.55, 0).rotateZ(1.2).rotateY((k / 8) * Math.PI * 2).translate(0, 7.3, 0), LEAF));
  return mergeGeometries(parts)!;
}

/** Chuối (banana): a soft green pseudo-stem and big paddle leaves arching out; some carry a hanging bunch. */
function chuoi(lod: number): THREE.BufferGeometry {
  const parts = [painted(new THREE.CylinderGeometry(0.16, 0.22, 1.8, 5).translate(0, 0.9, 0), new THREE.Color(0x7a9a48))];
  const n = lod === 0 ? 7 : 4;
  for (let k = 0; k < n; k++) parts.push(painted(new THREE.BoxGeometry(0.5, 0.03, 2).translate(0, 0, 0.95).rotateX(-0.5 - (k % 2) * 0.35).rotateY((k / n) * Math.PI * 2).translate(0, 1.8, 0), LEAF));
  if (lod === 0) parts.push(fixed(new THREE.CylinderGeometry(0.2, 0.08, 0.6, 5).translate(0.25, 1.35, 0), 0x9ab83a), fixed(new THREE.ConeGeometry(0.12, 0.3, 4).rotateX(Math.PI).translate(0.25, 0.9, 0), 0x7a2a4a));
  return mergeGeometries(parts)!;
}

/** Xoài (mango): a dense, dark, rounded canopy on a short trunk, a few green fruits hanging. */
function xoai(lod: number): THREE.BufferGeometry {
  const parts = [painted(crown(lod === 0 ? 1 : 0, 2, 1.5, 2.9), LEAF), painted(new THREE.CylinderGeometry(0.2, 0.3, 1.9, lod === 0 ? 6 : 4).translate(0, 0.95, 0), TRUNK)];
  if (lod === 0) for (let k = 0; k < 5; k++) parts.push(fixed(new THREE.SphereGeometry(0.13, 5, 4).scale(0.8, 1.2, 0.8).translate(Math.cos(k * 1.3) * 1.5, 1.7, Math.sin(k * 1.3) * 1.5), 0x9ac84a));
  return mergeGeometries(parts)!;
}

/** Mận (rose-apple): a medium tree, lighter leaves, clusters of red-pink bell fruits. */
function man(lod: number): THREE.BufferGeometry {
  const parts = [painted(crown(0, 1.5, 1.3, 2.5), LEAF), painted(new THREE.CylinderGeometry(0.14, 0.22, 1.7, 4).translate(0, 0.85, 0), TRUNK)];
  if (lod < 2) for (let k = 0; k < (lod === 0 ? 9 : 4); k++) parts.push(fixed(new THREE.ConeGeometry(0.14, 0.24, 5).rotateX(Math.PI).translate(Math.cos(k * 2.1) * 1.35, 1.6 + (k % 3) * 0.35, Math.sin(k * 2.1) * 1.2), k % 2 ? 0xd8324a : 0xf06a8a));
  return mergeGeometries(parts)!;
}

/** Bông điên điển (sesbania): a slender shrub-tree with feathery leaves and hanging clusters of yellow flowers. */
function diendien(lod: number): THREE.BufferGeometry {
  const parts = [painted(new THREE.CylinderGeometry(0.06, 0.1, 1.8, 4).translate(0, 0.9, 0), TRUNK), painted(crown(0, 1.1, 0.6, 2.1), LEAF)];
  if (lod < 2) for (let k = 0; k < (lod === 0 ? 10 : 5); k++) parts.push(fixed(new THREE.ConeGeometry(0.1, 0.35, 4).rotateX(Math.PI).translate(Math.cos(k * 2.4) * 0.9, 1.6, Math.sin(k * 2.4) * 0.9), 0xf6d22a));
  return mergeGeometries(parts)!;
}

/** A dâm bụt / ixora hedge bush: a low green mound dotted with red flowers. */
function hedge(lod: number): THREE.BufferGeometry {
  const parts = [painted(crown(0, 0.7, 0.5, 0.45), LEAF)];
  if (lod < 2) for (let k = 0; k < (lod === 0 ? 7 : 3); k++) parts.push(fixed(new THREE.IcosahedronGeometry(0.12, 0).translate(Math.cos(k * 2.3) * 0.55, 0.6 + (k % 2) * 0.2, Math.sin(k * 2.3) * 0.5), 0xe03a3a));
  return mergeGeometries(parts)!;
}

const TREE_COLORS: Record<TreeKind, number[]> = {
  tram: [0x7f9a5a, 0x8aa662, 0x6f8c4e, 0x94a86a],
  dua: [0x5f9a3a, 0x6aa83f, 0x4f8a33, 0x78b048],
  duanuoc: [0x5a8a3a, 0x6f9a42, 0x4f7a32],
  tre: [0x7cae44, 0x8abf4e, 0x6a9a3a],
  xoai: [0x2f5f24, 0x356a28, 0x2a5420],
  man: [0x5a9a3a, 0x6aa83f, 0x4f8a33],
  chuoi: [0x7cc04a, 0x6aaf40, 0x8ccf52],
  thotnot: [0x4f7a32, 0x5a8a3a, 0x46702c],
  diendien: [0x7aa84a, 0x8ab85a],
  hedge: [0x3f7a2e, 0x4a8a34],
};

const BUILDERS: Record<TreeKind, (lod: number) => THREE.BufferGeometry> = { tram, dua, duanuoc, tre, xoai, man, chuoi, thotnot, diendien, hedge };

interface ChunkSet {
  /** trees by LOD, then kind */
  lods: THREE.Group[];
  near: THREE.Group;                    // grass, flowers (only at LOD 0)
  rocks?: THREE.InstancedMesh;
  hy?: THREE.InstancedMesh;
  center: THREE.Vector3;
  level: number;
}

export class Forest {
  readonly root = new THREE.Group();
  private readonly chunks: ChunkSet[] = [];
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly mats: THREE.Material[] = [];
  private lodDist: [number, number] = [110, 260];
  private nearOn = true;
  readonly counts = { trees: 0, rocks: 0, grass: 0, flowers: 0 };
  /** (time s, strength) for the rice's wind sway. */
  private readonly wind = { value: new THREE.Vector2(0, 0.25) };
  /** 0097: every tràm's instances (all its LODs) by its rounded world px, and the ones shown felled now (a stump). */
  private readonly tramAt = new Map<string, Array<{ im: THREE.InstancedMesh; i: number; m: THREE.Matrix4 }>>();
  private hidden = new Set<string>();

  constructor(density = 1) {
    const treeMat = toon({ vertexColors: true });
    const rockMat = toon({ vertexColors: true });
    const grassMat = toon({ vertexColors: true, side: THREE.DoubleSide });
    // the rice (and grass) sways: a wind wave rolling across the paddies, bending each tuft's top more than its base —
    // a few vertex-shader lines, no extra draw calls
    const wind = this.wind;
    grassMat.onBeforeCompile = (sh) => {
      sh.uniforms.uWind = wind;
      sh.vertexShader = "uniform vec2 uWind;\n" + sh.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
#ifdef USE_INSTANCING
      vec2 wp = vec2(instanceMatrix[3].x, instanceMatrix[3].z);
      float gust = sin(uWind.x * 1.6 - wp.x * 0.35 - wp.y * 0.22) * 0.6 + sin(uWind.x * 2.7 - wp.x * 0.9 + wp.y * 0.5) * 0.25;
      float bend = max(position.y, 0.0) * gust * uWind.y;
      transformed.x += bend; transformed.z += bend * 0.5;
#endif`);
    };
    grassMat.customProgramCacheKey = () => "rice-wind";
    this.mats.push(treeMat, rockMat, grassMat);
    const treeGeo: Record<TreeKind, THREE.BufferGeometry[]> = {
      ...Object.fromEntries((Object.keys(BUILDERS) as TreeKind[]).map((k) => {
        LEAF = new THREE.Color(TREE_COLORS[k][0]);
        const g = [0, 1, 2].map(BUILDERS[k]);
        LEAF = WHITE;
        return [k, g];
      })) as Record<TreeKind, THREE.BufferGeometry[]>,
    };
    const rockGeo = painted(new THREE.DodecahedronGeometry(1, 0), new THREE.Color(0x9a9488));
    const tuftGeo = painted(mergeGeometries([0, 1, 2].map((i) => new THREE.ConeGeometry(0.1, 0.7, 3).rotateZ((i - 1) * 0.35).translate((i - 1) * 0.12, 0.3, 0))!), WHITE);
    const flowerGeo = painted(new THREE.IcosahedronGeometry(0.16, 0).translate(0, 0.35, 0), WHITE);
    const hyGeo = painted(mergeGeometries([new THREE.SphereGeometry(0.34, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.SphereGeometry(0.22, 5, 3, 0, Math.PI * 2, 0, Math.PI / 2).translate(0.32, 0, 0.1)])!, WHITE);
    this.geos.push(...Object.values(treeGeo).flat(), rockGeo, tuftGeo, flowerGeo, hyGeo);

    const n = CHUNKS_X * CHUNKS_Y;
    const byChunk = <T extends { x: number; y: number }>(list: readonly T[], thin: number) => {
      const out: T[][] = Array.from({ length: n }, () => []);
      list.forEach((s, i) => { if (thin >= 1 || (i * 0.618) % 1 < thin) out[chunkOf(s.x, s.y)].push(s); });
      return out;
    };
    const trees = byChunk(scatterTrees(), density);
    const rocks = byChunk(scatterRocks(), density);
    const grass = byChunk(scatterGrass(), density);
    const flowers = byChunk(scatterFlowers(), density);
    const hyacinths = byChunk(scatterHyacinths(), density);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();

    for (let c = 0; c < n; c++) {
      const set: ChunkSet = { lods: [new THREE.Group(), new THREE.Group(), new THREE.Group()], near: new THREE.Group(), center: new THREE.Vector3(), level: -1 };
      const list = trees[c];
      if (list.length) {
        for (const kind of Object.keys(treeGeo) as TreeKind[]) {
          const mine = list.filter((t) => t.kind === kind);
          if (!mine.length) continue;
          for (let lod = 0; lod < 3; lod++) {
            const im = new THREE.InstancedMesh(treeGeo[kind][lod], treeMat, mine.length);
            mine.forEach((t, i) => {
              const k = t.scale * (kind === "tram" ? 1.15 : kind === "xoai" ? 0.9 : kind === "hedge" ? 1.2 : 1);
              m.compose(p.set(t.x / 16, t.h - 0.15, t.y / 16), q.setFromAxisAngle(up, t.rot), s.set(k, k * (0.9 + t.tint * 0.3), k));
              im.setMatrixAt(i, m);
              if (kind === "tram") {                                                   // 0097: felled trees are hidden
                const key = `${Math.round(t.x)},${Math.round(t.y)}`;
                const list = this.tramAt.get(key) ?? [];
                list.push({ im, i, m: m.clone() });
                this.tramAt.set(key, list);
              }
              const pal = TREE_COLORS[kind], base = new THREE.Color(pal[0]);
              col.setHex(pal[Math.floor(t.tint * pal.length) % pal.length]);
              im.setColorAt(i, col.setRGB(Math.min(1.25, col.r / Math.max(0.05, base.r)), Math.min(1.25, col.g / Math.max(0.05, base.g)), Math.min(1.25, col.b / Math.max(0.05, base.b))));
            });
            im.castShadow = lod < 2;
            im.receiveShadow = false;
            im.computeBoundingSphere();
            set.lods[lod].add(im);
          }
        }
        this.counts.trees += list.length;
      }
      const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, spots: Spot[], place: (sp: Spot) => [number, number, number, number], tint: (sp: Spot) => number) => {
        const im = new THREE.InstancedMesh(geo, mat, spots.length);
        spots.forEach((sp, i) => {
          const [sx, sy, sz, lift] = place(sp);
          m.compose(p.set(sp.x / 16, sp.h + lift, sp.y / 16), q.setFromAxisAngle(up, sp.rot), s.set(sx, sy, sz));
          im.setMatrixAt(i, m);
          im.setColorAt(i, col.setHex(tint(sp)));
        });
        im.computeBoundingSphere();
        return im;
      };
      if (rocks[c].length) {
        const r = inst(rockGeo, rockMat, rocks[c], (sp) => [sp.scale * 0.9, sp.scale * 0.6, sp.scale * 0.75, -0.1], (sp) => (sp.tint < 0.5 ? 0xffffff : 0xd8d2c4));
        r.castShadow = true;
        set.rocks = r;                                     // rocks: hidden only at the far level (a draw call a chunk)
        r.visible = false;
        this.root.add(r);
        this.counts.rocks += rocks[c].length;
      }
      if (hyacinths[c].length) {                          // lục bình: shown with the rocks (a draw call a chunk)
        const hy = inst(hyGeo, grassMat, hyacinths[c], (sp) => [sp.scale, sp.scale * 0.6, sp.scale, 0.01], (sp) => (sp.tint < 0.7 ? 0x4f8a33 : 0x6aa83f));
        hy.visible = false;
        set.hy = hy;
        this.root.add(hy);
      }
      if (grass[c].length) {
        set.near.add(inst(tuftGeo, grassMat, grass[c], (sp) => [sp.scale, sp.scale, sp.scale, -0.05], (sp) => (landUse(sp.x, sp.y) === "paddy" ? [0x9ccc48, 0xb8c850, 0xd8c457] : [0x7fb54a, 0x6aa23c, 0x98c45a])[Math.floor(sp.tint * 3)]));
        this.counts.grass += grass[c].length;
      }
      if (flowers[c].length) {
        set.near.add(inst(flowerGeo, grassMat, flowers[c], (sp) => [sp.scale * 0.7, sp.scale * 0.7, sp.scale * 0.7, -0.05],
          (sp) => [0xf2f0e6, 0xf2d24a, 0xe8748a, 0xb58ae0, 0xf29a4a][Math.floor(sp.tint * 5)]));
        this.counts.flowers += flowers[c].length;
      }
      set.center.set((DOMAIN.x0 + (c % CHUNKS_X + 0.5) * CHUNK_PX) / 16, 4, (DOMAIN.y0 + (Math.floor(c / CHUNKS_X) + 0.5) * CHUNK_PX) / 16);
      for (const g of [...set.lods, set.near]) { g.visible = false; this.root.add(g); }
      this.chunks.push(set);
    }
  }

  /** 0097: the felled tràm (world px) are cut down to a stump until they respawn; the rest stand. */
  setFelled(points: ReadonlyArray<{ x: number; y: number }>): void {
    const next = new Set(points.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`));
    const touched = new Set<THREE.InstancedMesh>();
    const stump = new THREE.Matrix4(), pos = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    for (const key of this.hidden) if (!next.has(key)) for (const e of this.tramAt.get(key) ?? []) { e.im.setMatrixAt(e.i, e.m); touched.add(e.im); }
    for (const key of next) if (!this.hidden.has(key)) for (const e of this.tramAt.get(key) ?? []) {
      e.m.decompose(pos, q, sc);
      stump.compose(pos, q, sc.set(sc.x * 0.9, sc.y * 0.07, sc.z * 0.9));        // the trunk's foot only
      e.im.setMatrixAt(e.i, stump);
      touched.add(e.im);
    }
    for (const im of touched) im.instanceMatrix.needsUpdate = true;
    this.hidden = next;
  }

  setQuality(high: boolean): void {
    this.lodDist = high ? [110, 260] : [60, 150];
    this.nearOn = high;
    for (const c of this.chunks) c.level = -1;
  }

  /** Pick each chunk's level of detail from the camera. */
  /** The wind over the rice: time (ms), wind km/h; frozen when reduced motion. */
  animate(t: number, windKmh: number, reduced: boolean): void {
    this.wind.value.set(reduced ? 0 : t / 1000, reduced ? 0 : 0.12 + Math.min(0.35, windKmh / 60));
  }

  /** `range`: past it (units, the view's range) a chunk is not drawn at all (level 3). */
  update(camera: THREE.Vector3, range = Infinity): void {
    for (const c of this.chunks) {
      const d = c.center.distanceTo(camera);
      const level = d - CHUNK_R > range ? 3 : d < this.lodDist[0] ? 0 : d < this.lodDist[1] ? 1 : 2;
      if (level === c.level) continue;
      c.level = level;
      c.lods.forEach((g, i) => { g.visible = i === level; });
      c.near.visible = this.nearOn && level === 0;
      if (c.rocks) c.rocks.visible = level < 2;
      if (c.hy) c.hy.visible = level < 2;
    }
  }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    this.root.traverse((o) => { if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose(); });
  }
}
