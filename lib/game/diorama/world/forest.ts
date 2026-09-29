import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { DOMAIN } from "@/lib/game/world/terrain";
import { CHUNK_PX, chunkOf, CHUNKS_X, CHUNKS_Y, scatterFlowers, scatterGrass, scatterHyacinths, scatterRocks, scatterTrees, type Spot, type TreeKind } from "@/lib/game/world/scenery";
import { toon } from "./toon";

// Browser only: the world's trees, rocks, grass and flowers, instanced per scenery chunk. Trees have three levels of
// detail (a full crown with its trunk, a coarse crown, a far proxy of a few triangles); a chunk shows one level at a
// time from its distance to the camera. Grass and flowers only exist in the near chunks. Every instanced mesh has its
// own bounding sphere, so the renderer's frustum culling skips the chunks off screen.

const TRUNK = new THREE.Color(0x7a5436);

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

function roundTree(lod: number): THREE.BufferGeometry {
  if (lod === 2) return painted(crown(0, 1.7, 1.6, 2.6), WHITE);
  const parts = [painted(crown(lod === 0 ? 1 : 0, 1.7, 1.55, 2.7), WHITE)];
  if (lod === 0) parts.push(painted(crown(1, 1.05, 0.95, 3.7).translate(0.5, 0, 0.2), WHITE));
  parts.push(painted(new THREE.CylinderGeometry(0.16, 0.26, 1.6, lod === 0 ? 6 : 4).translate(0, 0.8, 0), TRUNK));
  return mergeGeometries(parts)!;
}

const PALE = new THREE.Color(0xe2dccb), PALM_TRUNK = new THREE.Color(0x8a6a48), CULM = new THREE.Color(0x9ab85a);

/** Tràm (melaleuca): a tall, slim, pale papery trunk and a few small airy tufts high up. */
function tram(lod: number): THREE.BufferGeometry {
  const parts = [painted(new THREE.CylinderGeometry(0.07, 0.13, 4.2, lod === 0 ? 6 : 4).translate(0, 2.1, 0), PALE)];
  const tufts = lod === 0 ? [[0, 4.4, 0, 0.75], [0.45, 3.8, 0.2, 0.5], [-0.35, 4.0, -0.25, 0.55]] : lod === 1 ? [[0, 4.3, 0, 0.85]] : [[0, 4.1, 0, 0.9]];
  for (const [x, y, z, r] of tufts) parts.push(painted(crown(0, r, r * 0.7, y).translate(x, 0, z), WHITE));
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
    parts.push(painted(frond, WHITE));
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
    parts.push(painted(new THREE.BoxGeometry(0.34, 3.2, 0.05).translate(0, 1.6, 0).rotateZ(tilt).rotateY(a), WHITE));
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
    parts.push(painted(new THREE.ConeGeometry(0.55, 1.6, 5).translate(0, h - 0.2, 0).rotateZ(-lean * 1.6).rotateY(a).translate(cx, 0, cz), WHITE));
  }
  return mergeGeometries(parts)!;
}

const TREE_COLORS: Record<TreeKind, number[]> = {
  tram: [0x7f9a5a, 0x8aa662, 0x6f8c4e, 0x94a86a],
  dua: [0x5f9a3a, 0x6aa83f, 0x4f8a33, 0x78b048],
  duanuoc: [0x5a8a3a, 0x6f9a42, 0x4f7a32],
  tre: [0x7cae44, 0x8abf4e, 0x6a9a3a],
  cay: [0x3f7a2e, 0x4a8a34, 0x356a28, 0x5a9a3a],
};

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

  constructor(density = 1) {
    const treeMat = toon({ vertexColors: true });
    const rockMat = toon({ vertexColors: true });
    const grassMat = toon({ vertexColors: true, side: THREE.DoubleSide });
    this.mats.push(treeMat, rockMat, grassMat);
    const treeGeo: Record<TreeKind, THREE.BufferGeometry[]> = {
      tram: [0, 1, 2].map(tram), dua: [0, 1, 2].map(dua), duanuoc: [0, 1, 2].map(duanuoc), tre: [0, 1, 2].map(tre), cay: [0, 1, 2].map(roundTree),
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
              const k = t.scale * (kind === "tram" ? 1.15 : kind === "cay" ? 0.8 : 1);
              m.compose(p.set(t.x / 16, t.h - 0.15, t.y / 16), q.setFromAxisAngle(up, t.rot), s.set(k, k * (0.9 + t.tint * 0.3), k));
              im.setMatrixAt(i, m);
              const pal = TREE_COLORS[kind];
              im.setColorAt(i, col.setHex(pal[Math.floor(t.tint * pal.length) % pal.length]));
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
        set.near.add(inst(tuftGeo, grassMat, grass[c], (sp) => [sp.scale, sp.scale, sp.scale, -0.05], (sp) => [0x7fb54a, 0x6aa23c, 0x98c45a][Math.floor(sp.tint * 3)]));
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

  setQuality(high: boolean): void {
    this.lodDist = high ? [110, 260] : [60, 150];
    this.nearOn = high;
    for (const c of this.chunks) c.level = -1;
  }

  /** Pick each chunk's level of detail from the camera. */
  update(camera: THREE.Vector3): void {
    for (const c of this.chunks) {
      const d = c.center.distanceTo(camera);
      const level = d < this.lodDist[0] ? 0 : d < this.lodDist[1] ? 1 : 2;
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
