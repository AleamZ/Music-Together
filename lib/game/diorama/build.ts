import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { pxLen, pxToWorld } from "./coords";
import { rng, type Building, type DioramaLayout, type Ground, type Plant } from "./layout";

// Browser only (Three.js): the static diorama from a layout — the terrain block with its earthy base, the pond's
// basin and animated water, Cầu ao, instanced plants and the buildings as low-poly shapes. Everything procedural:
// no model or texture files. Flat, stylized toon colours (flat-shaded Lambert).

const GROUND_COL: Record<Ground, number> = {
  grass: 0x6aa23c, path: 0xc89a5e, soil: 0x6e4a2a, sand: 0xdcc08a, water: 0x3f7f86, deep: 0x2f6470, bamboo: 0x4f8a30,
};
const GROUND_TOP: Record<Ground, number> = { grass: 0, path: -0.03, soil: -0.02, sand: -0.08, water: -0.7, deep: -1.0, bamboo: 0.02 };
/** The terrain block's floor (every tile runs from here up to its top). */
const FLOOR = -1.4;
export const WATER_Y = -0.22;

export interface Built {
  root: THREE.Group;
  water: THREE.Mesh;
  /** The water plane's rest heights, for the waves. */
  waterBase: Float32Array;
  /** Instanced meshes that thin out in low quality (their full count). */
  thinnable: Array<{ mesh: THREE.InstancedMesh; full: number }>;
  /** Swaying crowns (palm/banana/tree tops): their rest rotation. */
  sway: Array<{ obj: THREE.Object3D; seed: number; base: number }>;
  lamps: THREE.PointLight[];
  /** Emissive lamp bulbs (brighter at night). */
  bulbs: THREE.MeshBasicMaterial[];
  flowers: THREE.InstancedMesh | null;
  /** Roofs and awnings that turn see-through while the player is under or just behind them (map px footprint). */
  roofs: Array<{ mats: THREE.MeshLambertMaterial[]; x: number; y: number; w: number; h: number }>;
  /** Windows, neon and bulbs that light up at night (the view sets their emissiveIntensity from the night); zones only. */
  glow?: THREE.MeshLambertMaterial[];
  dispose(): void;
}

export function buildDiorama(L: DioramaLayout): Built {
  const size = { width: L.width, height: L.height };
  const root = new THREE.Group();
  const geos = new Set<THREE.BufferGeometry>();
  const mats = new Map<string, THREE.Material>();
  const g = <T extends THREE.BufferGeometry>(x: T): T => { geos.add(x); return x; };
  const lam = (color: number, opts: { flat?: boolean; emissive?: number } = {}): THREE.MeshLambertMaterial => {
    const key = `l${color}|${opts.flat ?? true}|${opts.emissive ?? 0}`;
    let m = mats.get(key) as THREE.MeshLambertMaterial | undefined;
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color, flatShading: opts.flat ?? true, emissive: opts.emissive ?? 0 });
      mats.set(key, m);
    }
    return m;
  };
  const W = (x: number, y: number) => pxToWorld({ x, y }, size);
  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, shadow = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = shadow;
    m.receiveShadow = true;
    return m;
  };
  const thinnable: Built["thinnable"] = [];
  const sway: Built["sway"] = [];
  const unitBox = g(new THREE.BoxGeometry(1, 1, 1));

  // ---------------------------------------------------------------- terrain: one instanced box per tile
  const t = pxLen(L.tile);
  const tiles = new THREE.InstancedMesh(unitBox, lam(0xffffff), L.cols * L.rows);
  tiles.receiveShadow = true;
  const R = rng(99);
  const mtx = new THREE.Matrix4(), col = new THREE.Color();
  for (let r = 0; r < L.rows; r++) for (let c = 0; c < L.cols; c++) {
    const i = r * L.cols + c, kind = L.ground[i];
    const top = GROUND_TOP[kind] + (kind === "grass" ? (R() - 0.5) * 0.04 : 0);
    const p = W(c * L.tile + L.tile / 2, r * L.tile + L.tile / 2);
    mtx.makeScale(t, top - FLOOR, t).setPosition(p.x, (top + FLOOR) / 2, p.z);
    tiles.setMatrixAt(i, mtx);
    col.setHex(GROUND_COL[kind]).offsetHSL(0, 0, (R() - 0.5) * 0.035);
    tiles.setColorAt(i, col);
  }
  root.add(tiles);

  // the diorama's base: layered earth under the map, a darker plinth, like a model on a table
  const mw = pxLen(L.width), mh = pxLen(L.height);
  const earth = mesh(g(new THREE.BoxGeometry(mw, 1.6, mh)), lam(0x7a5530), 0, FLOOR - 0.8, 0, false);
  const stone = mesh(g(new THREE.BoxGeometry(mw + 0.3, 0.9, mh + 0.3)), lam(0x5b4636), 0, FLOOR - 2.05, 0, false);
  const plinth = mesh(g(new THREE.BoxGeometry(mw + 1.6, 0.6, mh + 1.6)), lam(0x3b3029), 0, FLOOR - 2.8, 0, false);
  const grassLip = mesh(g(new THREE.BoxGeometry(mw + 0.08, 0.12, mh + 0.08)), lam(0x5a8f32), 0, FLOOR + 0.02, 0, false);
  root.add(earth, stone, plinth, grassLip);
  // a skirt of grass south of the map where the border trees stand
  const skirt = mesh(g(new THREE.BoxGeometry(mw + 1.6, 0.2, 2.6)), lam(0x5a8f32), 0, -0.1, mh / 2 + 1.3 + 0.01, false);
  const skirtW = mesh(g(new THREE.BoxGeometry(2.6, 0.2, mh)), lam(0x5a8f32), -mw / 2 - 1.3, -0.1, 0, false);
  const skirtE = mesh(g(new THREE.BoxGeometry(2.6, 0.2, mh)), lam(0x5a8f32), mw / 2 + 1.3, -0.1, 0, false);
  for (const s of [skirt, skirtW, skirtE]) root.add(s);

  // ---------------------------------------------------------------- water: a subdivided plane over the pond's box
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of L.shore) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
  const wa = W(minX - 6, minY - 6), wb = W(maxX + 6, maxY + 6);
  const wGeo = g(new THREE.PlaneGeometry(wb.x - wa.x, wb.z - wa.z, 64, 40));
  wGeo.rotateX(-Math.PI / 2);
  const waterMat = new THREE.MeshPhongMaterial({ color: 0x4aa3c8, transparent: true, opacity: 0.82, shininess: 90, specular: 0x9fd8ff, flatShading: true });
  mats.set("water", waterMat);
  const water = new THREE.Mesh(wGeo, waterMat);
  water.position.set((wa.x + wb.x) / 2, WATER_Y, (wa.z + wb.z) / 2);
  water.receiveShadow = true;
  root.add(water);
  const waterBase = Float32Array.from((wGeo.attributes.position as THREE.BufferAttribute).array);

  // lily pads and their flowers
  const padGeo = g(new THREE.CylinderGeometry(0.28, 0.28, 0.03, 9, 1, false, 0.5, Math.PI * 1.8));
  const pads = new THREE.InstancedMesh(padGeo, lam(0x4f9a3a), L.lilies.length);
  L.lilies.forEach((l, i) => {
    const p = W(l.x, l.y);
    mtx.makeRotationY(i * 1.3).setPosition(p.x, WATER_Y + 0.03, p.z);
    pads.setMatrixAt(i, mtx);
  });
  root.add(pads);
  const fl = L.lilies.filter((l) => l.flower);
  const flowers = new THREE.InstancedMesh(g(new THREE.ConeGeometry(0.11, 0.16, 5)), lam(0xf29bb5), fl.length);
  fl.forEach((l, i) => {
    const p = W(l.x - 1, l.y - 1);
    mtx.makeRotationX(Math.PI).setPosition(p.x, WATER_Y + 0.13, p.z);
    flowers.setMatrixAt(i, mtx);
  });
  root.add(flowers);

  // ---------------------------------------------------------------- Cầu ao: plank deck on posts
  const plank = lam(0xb07a45), plankDark = lam(0x8a5a30), post = lam(0x5a3a1e);
  const deckY = 0.12;
  for (const r of L.platform) {
    const c = W(r.x + r.w / 2, r.y + r.h / 2);
    const deck = mesh(g(new THREE.BoxGeometry(pxLen(r.w), 0.14, pxLen(r.h))), plank, c.x, deckY - 0.07, c.z);
    root.add(deck);
    // plank seams
    const across = r.w > r.h;
    const n = Math.floor((across ? r.w : r.h) / 12);
    for (let k = 1; k < n; k++) {
      const seam = across
        ? mesh(unitBox, plankDark, pxToWorld({ x: r.x + k * 12, y: 0 }, size).x, deckY + 0.001, c.z, false)
        : mesh(unitBox, plankDark, c.x, deckY + 0.001, pxToWorld({ x: 0, y: r.y + k * 12 }, size).z, false);
      seam.scale.set(across ? 0.04 : pxLen(r.w), 0.01, across ? pxLen(r.h) : 0.04);
      root.add(seam);
    }
  }
  const postGeo = g(new THREE.CylinderGeometry(0.09, 0.1, 1.1, 6));
  for (const p of L.posts) {
    const w = W(p.x, p.y);
    root.add(mesh(postGeo, post, w.x, deckY - 0.57, w.z));
  }

  // ---------------------------------------------------------------- plants (instanced)
  const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, list: Plant[], place: (p: Plant, m: THREE.Matrix4) => void, colour?: (p: Plant, c: THREE.Color) => void, thin = true) => {
    const im = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
    im.count = list.length;
    im.castShadow = true;
    im.receiveShadow = true;
    list.forEach((p, i) => {
      place(p, mtx);
      im.setMatrixAt(i, mtx);
      if (colour) { colour(p, col); im.setColorAt(i, col); }
    });
    root.add(im);
    if (thin) thinnable.push({ mesh: im, full: list.length });
    return im;
  };
  const q = new THREE.Quaternion(), e3 = new THREE.Euler(), s3 = new THREE.Vector3(), p3 = new THREE.Vector3();
  const compose = (m: THREE.Matrix4, x: number, y: number, z: number, sx: number, sy: number, sz: number, rx = 0, ry = 0, rz = 0) =>
    m.compose(p3.set(x, y, z), q.setFromEuler(e3.set(rx, ry, rz)), s3.set(sx, sy, sz));

  // round trees: trunk + two stacked low-poly crowns
  const trunkGeo = g(new THREE.CylinderGeometry(0.1, 0.16, 1, 5));
  const crownGeo = g(new THREE.IcosahedronGeometry(1, 0));
  inst(trunkGeo, lam(0x6b4a2b), L.trees, (p, m) => {
    const w = W(p.x, p.y), h = pxLen(p.h) * 0.45;
    compose(m, w.x, h / 2, w.z, 1 + (p.h - 30) / 60, h, 1 + (p.h - 30) / 60);
  });
  inst(crownGeo, lam(0xffffff), L.trees, (p, m) => {
    const w = W(p.x, p.y), h = pxLen(p.h), r = h * 0.36;
    compose(m, w.x, h * 0.62, w.z, r, r * 0.9, r, 0, (p.seed % 628) / 100);
  }, (p, c) => c.setHex([0x4f8f35, 0x5b9c3a, 0x437d2e, 0x6aa83f][p.seed % 4]));
  inst(crownGeo, lam(0xffffff), L.trees, (p, m) => {
    const w = W(p.x, p.y), h = pxLen(p.h), r = h * 0.24;
    compose(m, w.x + 0.1, h * 0.9, w.z - 0.05, r, r * 0.9, r, 0, (p.seed % 314) / 100);
  }, (p, c) => c.setHex([0x6aa83f, 0x7fb548, 0x5b9c3a, 0x8cc452][p.seed % 4]));

  // bamboo: thin culms with a leafy cone on top
  const culmGeo = g(new THREE.CylinderGeometry(0.05, 0.06, 1, 5));
  inst(culmGeo, lam(0x8fb84e), L.bamboo, (p, m) => {
    const w = W(p.x, p.y), h = pxLen(p.h);
    compose(m, w.x, h / 2, w.z, 1, h, 1, ((p.seed % 20) - 10) / 90, 0, ((p.seed % 17) - 8) / 80);
  }, (p, c) => c.setHex(p.seed % 3 ? 0x8fb84e : 0x7aa640));
  const leafGeo = g(new THREE.ConeGeometry(1, 1, 5));
  inst(leafGeo, lam(0xffffff), L.bamboo, (p, m) => {
    const w = W(p.x, p.y), h = pxLen(p.h);
    compose(m, w.x, h * 0.78, w.z, 0.7, h * 0.55, 0.7, 0, (p.seed % 100) / 16);
  }, (p, c) => c.setHex([0x4f8a30, 0x44792a, 0x5a9a38][p.seed % 3]));

  // reeds and rocks
  const reedGeo = g(new THREE.BoxGeometry(0.05, 1, 0.05));
  inst(reedGeo, lam(0x6a9a38), L.reeds, (p, m) => {
    const w = W(p.x, p.y), h = pxLen(p.h);
    compose(m, w.x, WATER_Y + h / 2, w.z, 1, h, 1, ((p.seed % 13) - 6) / 40, 0, ((p.seed % 11) - 5) / 40);
  }, (p, c) => c.setHex(p.seed % 4 ? 0x6a9a38 : 0x8fb84e));
  const tipGeo = g(new THREE.CapsuleGeometry(0.05, 0.14, 2, 4));
  inst(tipGeo, lam(0x7a4a2a), L.reeds.filter((r) => r.seed % 3 !== 0), (p, m) => {
    const w = W(p.x, p.y), h = pxLen(p.h);
    compose(m, w.x + ((p.seed % 11) - 5) / 40 * -h / 2, WATER_Y + h, w.z, 1, 1, 1, ((p.seed % 13) - 6) / 40, 0, ((p.seed % 11) - 5) / 40);
  });
  const rockGeo = g(new THREE.DodecahedronGeometry(1, 0));
  inst(rockGeo, lam(0xffffff), L.rocks, (p, m) => {
    const w = W(p.x, p.y), r = pxLen(p.h) * 1.4;
    compose(m, w.x, -0.05, w.z, r * 1.3, r * 0.7, r, (p.seed % 7) / 3, (p.seed % 9) / 3, 0);
  }, (p, c) => c.setHex([0x9a9488, 0x847e74, 0xaaa294][p.seed % 3]), false);

  // worm mounds
  const moundGeo = g(new THREE.SphereGeometry(1, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2));
  for (const md of L.mounds) {
    const w = W(md.x, md.y);
    const mm = mesh(moundGeo, lam(0x7a5230), w.x, -0.02, w.z);
    mm.scale.set(pxLen(10), 0.22, pxLen(5));
    root.add(mm);
  }

  // ---------------------------------------------------------------- buildings and props
  const roofs: Built["roofs"] = [];
  /** A roof material of its own (it fades on its own), registered for disposal. */
  const roofMat = (color: number, roof: Built["roofs"][number]) => {
    const m = new THREE.MeshLambertMaterial({ color, flatShading: true, transparent: true });
    mats.set(`roof${mats.size}`, m);
    roof.mats.push(m);
    return m;
  };
  const lamps: THREE.PointLight[] = [];
  const bulbs: THREE.MeshBasicMaterial[] = [];
  const bulbMat = (color: number) => {
    const m = new THREE.MeshBasicMaterial({ color });
    mats.set(`bulb${bulbs.length}`, m);
    bulbs.push(m);
    return m;
  };
  const lantern = (x: number, y: number, z: number) => {
    root.add(mesh(g(new THREE.SphereGeometry(0.14, 8, 6)), bulbMat(0xd23a3a), x, y, z, false));
  };
  for (const b of L.buildings) root.add(building(b));
  for (const l of L.lights) {
    const w = W(l.x, l.y);
    const light = new THREE.PointLight(0xffb060, 0, pxLen(l.r) * 3.2, 1.6);
    light.position.set(w.x, 1.8, w.z);
    lamps.push(light);
    root.add(light);
  }

  function building(b: Building): THREE.Object3D {
    const grp = new THREE.Group();
    const c = W(b.x, b.y);
    grp.position.set(c.x, 0, c.z);
    const w = pxLen(b.w), d = pxLen(b.d), h = pxLen(b.h);
    const roof: Built["roofs"][number] = { mats: [], x: b.x - b.w / 2, y: b.y - b.d / 2, w: b.w, h: b.d };
    if (b.kind === "stall" || b.kind === "hut") roofs.push(roof);
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, shadow = true) => {
      const m = mesh(geo, mat, x, y, z, shadow);
      grp.add(m);
      return m;
    };
    const box = (bw: number, bh: number, bd: number, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = add(unitBox, mat, x, y, z);
      m.scale.set(bw, bh, bd);
      return m;
    };
    switch (b.kind) {
      case "stall": {                                            // Vựa cá: an open stall under a blue-white awning
        const wood = lam(0x8a5a30), dark = lam(0x5a3a1e);
        box(w, 0.12, d, lam(0xa8784a), 0, 0.06, 0);
        box(w, h * 0.8, 0.2, wood, 0, h * 0.4, -d / 2 + 0.1);             // back wall
        for (const sx of [-1, 1]) box(0.2, h * 0.8, d, wood, sx * (w / 2 - 0.1), h * 0.4, 0);
        box(w * 0.9, 0.5, 0.5, dark, 0, 0.55, d / 2 - 1.3);                 // the counter
        box(w * 0.9, 0.08, 0.6, lam(0xc9a06a), 0, 0.84, d / 2 - 1.3);
        for (const sx of [-1, 1]) box(0.16, h + 0.3, 0.16, dark, sx * (w / 2 - 0.1), (h + 0.3) / 2, d / 2 - 0.1);
        const stripes = 12;
        for (let k = 0; k < stripes; k++) {                                  // the striped awning, sloping to the front
          const s = add(unitBox, roofMat(k % 2 ? 0xf4f1e8 : 0x3a7bd5, roof), -w / 2 + (k + 0.5) * (w / stripes) , h + 0.35, 0.3);
          s.scale.set(w / stripes + 0.01, 0.12, d + 0.8);
          s.rotation.x = 0.22;
        }
        // hanging dried fish
        for (let k = 0; k < 6; k++) box(0.35, 0.2, 0.05, lam(0xc9a06a), -w / 2 + 1 + k * 1.1, h * 0.6, -d / 2 + 0.25);
        lantern(-w / 2 + 0.2, h - 0.2, d / 2 + 0.1);
        lantern(w / 2 - 0.2, h - 0.2, d / 2 + 0.1);
        break;
      }
      case "hut": {                                              // Tiệm đồ câu: a bamboo hut with a thatched roof
        const wall = lam(0xb88a52);
        box(w * 0.92, h * 0.62, d * 0.8, wall, 0, h * 0.31, -d * 0.08);
        box(1.3, h * 0.45, 0.08, lam(0x3a2418), 0, h * 0.225, d * 0.32 + 0.01);   // doorway
        box(w * 0.5, 0.45, 0.5, lam(0x8a5a30), -w * 0.18, 0.5, d * 0.45);        // counter out front
        const thatch = add(g(new THREE.ConeGeometry(1, 1, 4, 1)), roofMat(0xc9a55a, roof), 0, h * 0.62 + h * 0.28, -d * 0.05);
        thatch.scale.set(w * 0.78, h * 0.56, d * 0.74);
        thatch.rotation.y = Math.PI / 4;
        const eave = add(unitBox, roofMat(0xa8843f, roof), 0, h * 0.64, -d * 0.05);
        eave.scale.set(w * 1.02, 0.12, d * 0.96);
        // a rod rack leaning on the wall
        for (let k = 0; k < 4; k++) {
          const rod = box(0.05, 2.4, 0.05, lam(k % 2 ? 0xb7c65a : 0x8a5a30), w / 2 - 0.6 - k * 0.3, 1.1, d * 0.34);
          rod.rotation.z = -0.2;
        }
        lantern(-w / 2 + 0.2, h * 0.6, d / 2 - 0.4);
        lantern(w / 2 - 0.2, h * 0.6, d / 2 - 0.4);
        break;
      }
      case "records":
      case "board":
      case "sign":
      case "city_post": {                                        // a board on two posts
        const pmat = lam(0x5a3a1e);
        const two = b.kind !== "sign" && b.kind !== "city_post";
        for (const sx of two ? [-1, 1] : [0]) box(0.12, h, 0.12, pmat, sx * (w / 2 - 0.1), h / 2, 0);
        const panelCol = b.kind === "records" ? 0xe8d9a8 : b.kind === "board" ? 0xd06a3a : b.kind === "city_post" ? 0x9ecf8a : 0xf4f1e8;
        box(w, h * 0.42, 0.08, lam(0x3a2418), 0, h * 0.72, 0.06);
        box(w - 0.12, h * 0.42 - 0.12, 0.1, lam(panelCol), 0, h * 0.72, 0.07);
        if (b.kind === "board" || b.kind === "records") box(w + 0.2, 0.1, 0.4, lam(0x8a5a30), 0, h * 0.95, 0.05);
        break;
      }
      case "post": box(0.18, h, 0.18, lam(0x5a3a1e), 0, h / 2, 0); break;
      case "ghe":
      case "xuong": {                                            // a Mekong boat: a tapered hull, a painted eye
        const hull = new THREE.Shape();
        const hw = w / 2, hd = d / 2;
        hull.moveTo(-hw, 0);
        hull.quadraticCurveTo(-hw * 0.6, -hd, 0, -hd);
        hull.quadraticCurveTo(hw * 0.6, -hd, hw, 0);
        hull.quadraticCurveTo(hw * 0.6, hd, 0, hd);
        hull.quadraticCurveTo(-hw * 0.6, hd, -hw, 0);
        const geo = g(new THREE.ExtrudeGeometry(hull, { depth: 0.35, bevelEnabled: false, curveSegments: 6 }));
        geo.rotateX(Math.PI / 2);
        const m = add(geo, lam(b.kind === "ghe" ? 0x6b4a2b : 0x5a3a1e), 0, WATER_Y + 0.25, 0);
        m.castShadow = true;
        box(w * 0.7, 0.04, d * 0.6, lam(0xb07a45), 0, WATER_Y + 0.2, 0);
        if (b.kind === "ghe") {
          box(w * 0.3, 0.5, d * 0.7, lam(0x3a5a3a), -w * 0.12, WATER_Y + 0.5, 0);   // the mui (cabin roof)
          for (const sx of [-1, 1]) box(0.12, 0.12, 0.02, lam(0xd23a3a), sx * (hw - 0.25), WATER_Y + 0.15, hd * 0.55);
        } else {
          box(0.05, 0.9, 0.05, lam(0x3a2418), 0, WATER_Y + 0.6, 0);                  // the pole
        }
        break;
      }
      case "palm": {                                             // coconut palm: a curved segmented trunk and fronds
        const segs = 6, lean = b.lean ?? 0.3, R2 = rng(b.seed ?? 1);
        let x = 0, y = 0;
        const segH = h / segs;
        for (let k = 0; k < segs; k++) {
          const tilt = lean * (k / segs) * 0.9;
          const s = add(g(new THREE.CylinderGeometry(0.1 - k * 0.008, 0.14 - k * 0.008, segH * 1.05, 6)), lam(k % 2 ? 0x8a6a45 : 0x7a5a38), x, y + segH / 2, 0);
          s.rotation.z = -tilt;
          x += Math.sin(tilt) * segH; y += Math.cos(tilt) * segH;
        }
        const crown = new THREE.Group();
        crown.position.set(x, y, 0);
        for (let k = 0; k < 8; k++) {
          const f = new THREE.Mesh(unitBox, lam(k % 2 ? 0x4f9a3a : 0x3f7a2e));
          f.scale.set(1.9, 0.05, 0.4);
          f.position.set(0.8, -0.2, 0);
          const arm = new THREE.Group();
          arm.rotation.y = (k / 8) * Math.PI * 2 + R2();
          arm.rotation.z = -0.35 - R2() * 0.2;
          f.castShadow = true;
          arm.add(f);
          crown.add(arm);
        }
        for (let k = 0; k < 3; k++) crown.add(mesh(g(new THREE.SphereGeometry(0.12, 6, 4)), lam(0x6b4a2b), Math.cos(k * 2) * 0.15, -0.15, Math.sin(k * 2) * 0.15));
        grp.add(crown);
        grp.rotation.y = ((b.seed ?? 0) % 7) * 0.9;
        sway.push({ obj: crown, seed: b.seed ?? 0, base: 0 });
        break;
      }
      case "banana": {
        add(g(new THREE.CylinderGeometry(0.14, 0.2, h * 0.55, 6)), lam(0x7a9a48), 0, h * 0.275, 0);
        const crown = new THREE.Group();
        crown.position.y = h * 0.55;
        for (let k = 0; k < 6; k++) {
          const f = new THREE.Mesh(unitBox, lam(k % 2 ? 0x6fbf4a : 0x5a9a38));
          f.scale.set(1.3, 0.04, 0.55);
          f.position.set(0.6, 0.1, 0);
          f.castShadow = true;
          const arm = new THREE.Group();
          arm.rotation.y = (k / 6) * Math.PI * 2;
          arm.rotation.z = 0.35;
          arm.add(f);
          crown.add(arm);
        }
        grp.add(crown);
        sway.push({ obj: crown, seed: b.x, base: 0 });
        break;
      }
    }
    return grp;
  }

  // ---------------------------------------------------------------- fences
  const railMat = lam(0x8a5a30);
  for (const f of L.fences) {
    const a = W(f.x1, f.y1), b2 = W(f.x2, f.y2);
    const len = Math.hypot(b2.x - a.x, b2.z - a.z), n = Math.max(2, Math.round(len / 1.2));
    for (let k = 0; k <= n; k++) {
      const x = a.x + ((b2.x - a.x) * k) / n, z = a.z + ((b2.z - a.z) * k) / n;
      const p = mesh(unitBox, railMat, x, 0.35, z);
      p.scale.set(0.12, 0.7, 0.12);
      root.add(p);
    }
    for (const hy of [0.3, 0.58]) {
      const r = mesh(unitBox, railMat, (a.x + b2.x) / 2, hy, (a.z + b2.z) / 2);
      r.scale.set(Math.abs(b2.x - a.x) + 0.08, 0.06, Math.abs(b2.z - a.z) + 0.08);
      root.add(r);
    }
  }

  // Merge every static mesh that shares a material into one draw call (the swaying crowns and the water stay apart).
  for (const s of sway) s.obj.userData.keep = true;
  water.userData.keep = true;
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
    const m = new THREE.Mesh(g(merged), b.mat);
    m.castShadow = b.cast;
    m.receiveShadow = true;
    root.add(m);
  }

  return {
    root, water, waterBase, thinnable, sway, lamps, bulbs, flowers, roofs,
    dispose() {
      root.traverse((o) => { if (o instanceof THREE.InstancedMesh) o.dispose(); });
      for (const x of geos) x.dispose();
      for (const m of mats.values()) m.dispose();
      root.clear();
    },
  };
}

/** Waves: two travelling sines over the water plane's rest heights (a gentle bob, stronger in wind). */
export function animateWater(b: Built, t: number, wind: number): void {
  const pos = b.water.geometry.attributes.position as THREE.BufferAttribute;
  const arr = pos.array as Float32Array, base = b.waterBase;
  const amp = 0.035 + Math.min(0.08, wind / 900);
  const s = t / 1000;
  for (let i = 0; i < arr.length; i += 3) {
    const x = base[i], z = base[i + 2];
    arr[i + 1] = base[i + 1] + amp * (Math.sin(x * 0.9 + s * 1.6) + Math.sin(z * 1.3 - s * 1.1 + x * 0.3) * 0.7);
  }
  pos.needsUpdate = true;
  b.water.geometry.computeVertexNormals();
}
