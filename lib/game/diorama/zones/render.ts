import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { WATER_Y, type Built } from "../build";
import { pxLen, pxToWorld } from "../coords";
import { rng } from "../layout";
import type { ZGround, ZoneLayout, ZoneOpts, ZPlant } from "./kit";

// Browser only (Three.js): a zone's diorama from its ZoneLayout — the terrain block on its plinth, water, the boxes and
// pitched roofs merged per material, instanced plants and bulbs, markers over the interactables, night lights. The same
// flat toon style as the pond (flat-shaded Lambert, no textures). Returns the pond's `Built` so DioramaView drives it.

const GROUND_COL: Record<ZGround, number> = {
  grass: 0x6aa23c, dirt: 0xc89a5e, sand: 0xdcc08a, water: 0x3f7f86, cobble: 0x8a7868, pave: 0xb4a48c, road: 0x7a7068,
  soil: 0x9a7a4e, bamboo: 0x4f8a30, stone: 0x76655a,
};
const GROUND_TOP: Record<ZGround, number> = {
  grass: 0, dirt: -0.02, sand: -0.08, water: -0.8, cobble: -0.02, pave: 0.03, road: -0.04, soil: -0.03, bamboo: 0.02, stone: 0.02,
};
const FLOOR = -1.4;
const U = (px: number) => px / 16;

/** A unit prism (x −.5….5, y 0…1, z −.5….5) whose ridge runs along x. */
function prismGeometry(): THREE.BufferGeometry {
  const a = [-0.5, 0, -0.5], b = [0.5, 0, -0.5], c = [0.5, 0, 0.5], d = [-0.5, 0, 0.5], e = [-0.5, 1, 0], f = [0.5, 1, 0];
  const tris = [a, e, f, a, f, b, d, c, f, d, f, e, a, d, e, b, f, c];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(tris.flat(), 3));
  geo.computeVertexNormals();
  return geo;
}

export function renderZone(L: ZoneLayout, opts: ZoneOpts = {}): Built {
  const size = { width: L.width, height: L.height };
  const root = new THREE.Group();
  const geos = new Set<THREE.BufferGeometry>();
  const mats = new Map<string, THREE.Material>();
  const g = <T extends THREE.BufferGeometry>(x: T): T => { geos.add(x); return x; };
  const lam = (color: number): THREE.MeshLambertMaterial => {
    const key = `l${color}`;
    let m = mats.get(key) as THREE.MeshLambertMaterial | undefined;
    if (!m) { m = new THREE.MeshLambertMaterial({ color, flatShading: true }); mats.set(key, m); }
    return m;
  };
  /** Windows and neon: lit from `glow` at night (DioramaView sets emissiveIntensity from the night). */
  const glowMats: THREE.MeshLambertMaterial[] = [];
  const glowLam = (color: number): THREE.MeshLambertMaterial => {
    const key = `g${color}`;
    let m = mats.get(key) as THREE.MeshLambertMaterial | undefined;
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color, flatShading: true, emissive: new THREE.Color(color).lerp(new THREE.Color(0xffd27a), 0.5), emissiveIntensity: 0 });
      mats.set(key, m);
      glowMats.push(m);
    }
    return m;
  };
  const W = (x: number, y: number) => pxToWorld({ x, y }, size);
  const mtx = new THREE.Matrix4(), col = new THREE.Color();
  const q = new THREE.Quaternion(), e3 = new THREE.Euler(), s3 = new THREE.Vector3(), p3 = new THREE.Vector3();
  const compose = (m: THREE.Matrix4, x: number, y: number, z: number, sx: number, sy: number, sz: number, rx = 0, ry = 0, rz = 0) =>
    m.compose(p3.set(x, y, z), q.setFromEuler(e3.set(rx, ry, rz)), s3.set(sx, sy, sz));
  const unitBox = g(new THREE.BoxGeometry(1, 1, 1));
  const thinnable: Built["thinnable"] = [];

  // ---------------------------------------------------------------- terrain + the plinth
  const t = pxLen(L.tile);
  const tiles = new THREE.InstancedMesh(unitBox, lam(0xffffff), L.cols * L.rows);
  tiles.receiveShadow = true;
  const R = rng(99);
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
  const mw = pxLen(L.width), mh = pxLen(L.height);
  const slab = (w: number, h: number, d: number, color: number, y: number) => {
    const m = new THREE.Mesh(unitBox, lam(color));
    m.scale.set(w, h, d);
    m.position.set(0, y, 0);
    m.receiveShadow = true;
    root.add(m);
  };
  slab(mw, 1.6, mh, 0x7a5530, FLOOR - 0.8);
  slab(mw + 0.3, 0.9, mh + 0.3, 0x5b4636, FLOOR - 2.05);
  slab(mw + 1.6, 0.6, mh + 1.6, 0x3b3029, FLOOR - 2.8);

  // ---------------------------------------------------------------- water
  const waterMat = new THREE.MeshPhongMaterial({ color: 0x4aa3c8, transparent: true, opacity: 0.82, shininess: 90, specular: 0x9fd8ff, flatShading: true });
  mats.set("water", waterMat);
  let water: THREE.Mesh | null = null;
  for (const [k, w] of L.water.entries()) {
    const a = W(w.x, w.y), b = W(w.x + w.w, w.y + w.h);
    const geo = g(new THREE.PlaneGeometry(b.x - a.x, b.z - a.z, k === 0 ? Math.min(64, Math.ceil(b.x - a.x)) : 1, k === 0 ? Math.min(24, Math.ceil(b.z - a.z) + 1) : 1));
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, waterMat);
    m.position.set((a.x + b.x) / 2, WATER_Y, (a.z + b.z) / 2);
    m.receiveShadow = true;
    m.userData.keep = true;
    root.add(m);
    if (k === 0) water = m;
  }
  if (!water) {                                          // no water: a tiny hidden plane keeps the view's wave step cheap
    water = new THREE.Mesh(g(new THREE.PlaneGeometry(0.1, 0.1, 1, 1)), waterMat);
    water.visible = false;
    water.userData.keep = true;
    root.add(water);
  }
  const waterBase = Float32Array.from((water.geometry.attributes.position as THREE.BufferAttribute).array);

  // ---------------------------------------------------------------- boxes and roofs (merged below)
  const roofs: Built["roofs"] = L.roofs.map((r) => ({ mats: [], x: r.x, y: r.y, w: r.w, h: r.h }));
  const roofMats = new Map<string, THREE.MeshLambertMaterial>();
  const roofMat = (id: string, color: number): THREE.Material => {
    const idx = L.roofs.findIndex((r) => r.id === id);
    if (idx < 0) return lam(color);
    const key = `${id}|${color}`;
    let m = roofMats.get(key);
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color, flatShading: true, transparent: true });
      mats.set(`roof:${key}`, m);
      roofMats.set(key, m);
      roofs[idx].mats.push(m);
    }
    return m;
  };
  for (const b of L.boxes) {
    const c = W(b.x + b.w / 2, b.y + b.d / 2);
    const mat = b.roof ? roofMat(b.roof, b.color) : b.glow ? glowLam(b.color) : lam(b.color);
    const m = new THREE.Mesh(unitBox, mat);
    m.scale.set(Math.max(0.01, U(b.w)), Math.max(0.01, U(b.h)), Math.max(0.01, U(b.d)));
    m.position.set(c.x, U(b.z0 + b.h / 2), c.z);
    m.castShadow = b.h > 2 && !b.glow;
    m.receiveShadow = true;
    root.add(m);
  }
  const prism = g(prismGeometry());
  for (const gb of L.gables) {
    const c = W(gb.x + gb.w / 2, gb.y + gb.d / 2);
    const m = new THREE.Mesh(prism, gb.roof ? roofMat(gb.roof, gb.color) : lam(gb.color));
    if (gb.ridge === "x") m.scale.set(U(gb.w), U(gb.h), U(gb.d));
    else { m.rotation.y = Math.PI / 2; m.scale.set(U(gb.d), U(gb.h), U(gb.w)); }
    m.position.set(c.x, U(gb.z0), c.z);
    m.castShadow = true;
    m.receiveShadow = true;
    root.add(m);
  }

  // ---------------------------------------------------------------- instanced: plants, bulbs, markers
  const inst = <T>(geo: THREE.BufferGeometry, mat: THREE.Material, list: T[], place: (p: T, m: THREE.Matrix4) => void, colour?: (p: T, c: THREE.Color) => void, thin = false) => {
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

  const trunkGeo = g(new THREE.CylinderGeometry(0.1, 0.16, 1, 5));
  const crownGeo = g(new THREE.IcosahedronGeometry(1, 0));
  inst(trunkGeo, lam(0x6b4a2b), L.trees, (p, m) => { const w = W(p.x, p.y), h = pxLen(p.h) * 0.45; compose(m, w.x, h / 2, w.z, 1, h, 1); });
  inst(crownGeo, lam(0xffffff), L.trees, (p, m) => {
    const w = W(p.x, p.y), h = pxLen(p.h), r = h * 0.36;
    compose(m, w.x, h * 0.62, w.z, r, r * 0.9, r, 0, (p.seed % 628) / 100);
  }, (p, c) => c.setHex([0x4f8f35, 0x5b9c3a, 0x437d2e, 0x6aa83f][p.seed % 4]));

  const culmGeo = g(new THREE.CylinderGeometry(0.05, 0.06, 1, 5));
  inst(culmGeo, lam(0x8fb84e), L.bamboo, (p: ZPlant, m) => {
    const w = W(p.x, p.y), h = pxLen(p.h);
    compose(m, w.x, h / 2, w.z, 1, h, 1, ((p.seed % 20) - 10) / 90, 0, ((p.seed % 17) - 8) / 80);
  }, (p, c) => c.setHex(p.seed % 3 ? 0x8fb84e : 0x7aa640), true);
  const leafGeo = g(new THREE.ConeGeometry(1, 1, 5));
  inst(leafGeo, lam(0xffffff), L.bamboo, (p, m) => {
    const w = W(p.x, p.y), h = pxLen(p.h);
    compose(m, w.x, h * 0.78, w.z, 0.7, h * 0.55, 0.7, 0, (p.seed % 100) / 16);
  }, (p, c) => c.setHex([0x4f8a30, 0x44792a, 0x5a9a38][p.seed % 3]), true);

  // palms: a leaning trunk and eight fronds, all instanced
  const palmTrunk = g(new THREE.CylinderGeometry(0.1, 0.15, 1, 6));
  inst(palmTrunk, lam(0x7a5a38), L.palms, (p, m) => {
    const w = W(p.x, p.y), h = pxLen(p.h), yaw = (p.seed % 7) * 0.9;
    const tilt = p.lean * 0.5;
    compose(m, w.x + Math.sin(tilt) * h / 2 * Math.cos(yaw), Math.cos(tilt) * h / 2, w.z - Math.sin(tilt) * h / 2 * Math.sin(yaw), 1, h, 1, 0, yaw, -tilt);
  });
  const fronds: Array<{ p: (typeof L.palms)[number]; k: number }> = L.palms.flatMap((p) => Array.from({ length: 8 }, (_, k) => ({ p, k })));
  const tmpA = new THREE.Matrix4(), tmpB = new THREE.Matrix4();
  inst(unitBox, lam(0xffffff), fronds, ({ p, k }, m) => {
    const w = W(p.x, p.y), h = pxLen(p.h), yaw = (p.seed % 7) * 0.9, tilt = p.lean * 0.5;
    const top = new THREE.Vector3(w.x + Math.sin(tilt) * h * Math.cos(yaw), Math.cos(tilt) * h, w.z - Math.sin(tilt) * h * Math.sin(yaw));
    tmpA.compose(top, q.setFromEuler(e3.set(0, (k / 8) * Math.PI * 2 + p.seed, -0.4 - (k % 3) * 0.08)), s3.set(1, 1, 1));
    tmpB.compose(p3.set(0.8, -0.2, 0), q.identity(), s3.set(1.9, 0.05, 0.4));
    m.multiplyMatrices(tmpA, tmpB);
  }, ({ k }, c) => c.setHex(k % 2 ? 0x4f9a3a : 0x3f7a2e));

  // banana plants: a stem and six broad leaves
  inst(g(new THREE.CylinderGeometry(0.14, 0.2, 1, 6)), lam(0x7a9a48), L.bananas, (p, m) => {
    const w = W(p.x, p.y), h = pxLen(p.h) * 0.55;
    compose(m, w.x, h / 2, w.z, 1, h, 1);
  });
  const leaves = L.bananas.flatMap((p) => Array.from({ length: 6 }, (_, k) => ({ p, k })));
  inst(unitBox, lam(0xffffff), leaves, ({ p, k }, m) => {
    const w = W(p.x, p.y), h = pxLen(p.h) * 0.55;
    tmpA.compose(p3.set(w.x, h, w.z), q.setFromEuler(e3.set(0, (k / 6) * Math.PI * 2 + p.seed, 0.35)), s3.set(1, 1, 1));
    tmpB.compose(p3.set(0.6, 0.1, 0), q.identity(), s3.set(1.3, 0.04, 0.55));
    m.multiplyMatrices(tmpA, tmpB);
  }, ({ k }, c) => c.setHex(k % 2 ? 0x6fbf4a : 0x5a9a38));

  // bulbs: lanterns and string lights. Their own colour by day; at night they glow warm (the emissive, from the view).
  const bulbMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, emissive: 0xffd27a, emissiveIntensity: 0 });
  mats.set("bulbs", bulbMat);
  glowMats.push(bulbMat);
  const bulbs = inst(g(new THREE.IcosahedronGeometry(1, 0)), bulbMat, L.bulbs, (b, m) => {
    const w = W(b.x, b.y), r = U(b.size ?? 2);
    compose(m, w.x, U(b.z), w.z, r, r * 1.2, r);
  }, (b, c) => c.setHex(b.color));
  bulbs.castShadow = false;

  // markers: a gold diamond over every interactable (always lit, so it reads by day and night)
  const markerMat = new THREE.MeshBasicMaterial({ color: 0xffd166 });
  mats.set("marker", markerMat);
  const markers = inst(g(new THREE.OctahedronGeometry(1, 0)), markerMat, L.markers, (mk, m) => {
    const w = W(mk.x, mk.y);
    compose(m, w.x, U(mk.z), w.z, 0.18, 0.28, 0.18);
  });
  markers.castShadow = false;
  markers.userData.keep = true;

  // ---------------------------------------------------------------- fences (merged)
  const railMat = lam(0xa8743f);
  for (const f of L.fences) {
    const a = W(f.x1, f.y1), b2 = W(f.x2, f.y2);
    const len = Math.hypot(b2.x - a.x, b2.z - a.z), n = Math.max(2, Math.round(len / 0.6));
    for (let k = 0; k <= n; k++) {
      const p = new THREE.Mesh(unitBox, railMat);
      p.position.set(a.x + ((b2.x - a.x) * k) / n, 0.3, a.z + ((b2.z - a.z) * k) / n);
      p.scale.set(0.1, 0.6, 0.1);
      p.castShadow = true;
      root.add(p);
    }
    for (const hy of [0.22, 0.48]) {
      const r = new THREE.Mesh(unitBox, railMat);
      r.position.set((a.x + b2.x) / 2, hy, (a.z + b2.z) / 2);
      r.scale.set(Math.abs(b2.x - a.x) + 0.06, 0.05, Math.abs(b2.z - a.z) + 0.06);
      r.castShadow = true;
      root.add(r);
    }
  }

  // ---------------------------------------------------------------- night lights
  const lamps: THREE.PointLight[] = [];
  for (const l of L.lights) {
    const w = W(l.x, l.y);
    const light = new THREE.PointLight(0xffb060, 0, pxLen(l.r) * 3.2, 1.6);
    light.position.set(w.x, 2.2, w.z);
    lamps.push(light);
    root.add(light);
  }

  // ---------------------------------------------------------------- merge static meshes per material (one draw call each)
  root.updateMatrixWorld(true);
  const buckets = new Map<string, { mat: THREE.Material; cast: boolean; parts: THREE.BufferGeometry[]; meshes: THREE.Mesh[] }>();
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || o instanceof THREE.InstancedMesh || Array.isArray(o.material) || o.userData.keep || o === tiles) return;
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

  if (opts.origin === "corner") root.position.set(mw / 2, 0, mh / 2);
  return {
    root, water, waterBase, thinnable, sway: [], lamps, bulbs: [], flowers: null, roofs, glow: glowMats,
    dispose() {
      root.traverse((o) => { if (o instanceof THREE.InstancedMesh) o.dispose(); });
      for (const x of geos) x.dispose();
      for (const m of mats.values()) m.dispose();
      root.clear();
    },
  };
}
