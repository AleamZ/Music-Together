import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { CABLE, cableAt, DI_LAC, FOOTBRIDGE, GATE, LAKE, NUI, PARK_NAME, SUMMIT, TEMPLE, TOWER, WATERFALL } from "@/lib/game/world/nuicam";
import { heightAt } from "@/lib/game/world/terrain";
import { faceAxes, signMesh, type FaceQuad } from "../zones/signmesh";
import { toon } from "./toon";

// Browser only: the mountain's landmarks (lib/game/world/nuicam.ts) — the lake, the red footbridge, the white Di Lặc,
// the golden tower and the temple, the waterfall, the cable car (its cabins glide), the summit viewpoint over a drifting
// sea of clouds, and the container gate with the (invented) park's name. One static vertex-coloured mesh, one for the
// water, instanced cabins, a few cloud sheets, the gate's painted sign.

const U = (px: number) => px / 16;
function tint(g: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(hex), n = geo.getAttribute("position").count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  if (geo.getAttribute("uv")) geo.deleteAttribute("uv");
  return geo;
}
const box = (w: number, h: number, d: number, x: number, y: number, z: number, hex: number) => tint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), hex);
const place = (g: THREE.BufferGeometry, px: number, py: number, yaw: number, y0 = heightAt(px, py)) => g.rotateY(yaw).translate(U(px), y0, U(py));
/** A curved Asian roof: a flat 4-sided pyramid with upturned corners (a few cones at the corners). */
function eaves(w: number, h: number, y: number, hex: number): THREE.BufferGeometry[] {
  const out = [tint(new THREE.ConeGeometry(w * 0.75, h, 4, 1).rotateY(Math.PI / 4).translate(0, y + h / 2, 0), hex)];
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) out.push(tint(new THREE.ConeGeometry(0.12, 0.5, 4).rotateZ(-sx * 0.9).rotateX(sz * 0.9).translate(sx * w * 0.5, y + 0.1, sz * w * 0.5), hex));
  return out;
}

export interface NuiCam { root: THREE.Group; animate(t: number, reduced: boolean): void; dispose(): void }

export function buildNuiCam(): NuiCam {
  const parts: THREE.BufferGeometry[] = [];
  const root = new THREE.Group();
  root.name = "nuicam";
  const geos: THREE.BufferGeometry[] = [], mats: THREE.Material[] = [];

  // ---- the temple complex: a red-and-gold hall on a terrace, and the golden tiered tower
  {
    const g: THREE.BufferGeometry[] = [box(5, 0.5, 4, 0, 0.25, 0, 0xd8cdb4), box(4.2, 2, 3.2, 0, 1.5, 0, 0xe8c070), box(1, 1.5, 0.06, 0, 1.25, 1.62, 0x8a2a1a)];
    for (const x of [-1.8, -0.6, 0.6, 1.8]) g.push(box(0.2, 2, 0.2, x, 1.5, 1.7, 0xb8322a));
    g.push(...eaves(5.2, 1.2, 2.5, 0xd2562e), ...eaves(3.6, 0.9, 3.4, 0xe07a2e));
    for (const p of g) parts.push(place(p, TEMPLE.x, TEMPLE.y, TEMPLE.yaw));
    const tw: THREE.BufferGeometry[] = [box(3, 0.6, 3, 0, 0.3, 0, 0xd8cdb4)];
    let y = 0.6;
    for (let i = 0; i < 7; i++) {
      const w = 2.4 - i * 0.26, h = 1.25 - i * 0.07;
      tw.push(box(w, h, w, 0, y + h / 2, 0, 0xf2d27a), box(w * 0.3, h * 0.55, 0.05, 0, y + h * 0.45, w / 2 + 0.01, 0x8a4a1a));
      y += h;
      tw.push(...eaves(w + 0.6, 0.45, y, 0xe0a030));
      y += 0.3;
    }
    tw.push(tint(new THREE.ConeGeometry(0.18, 1.3, 6).translate(0, y + 0.65, 0), 0xf6d23a));
    for (const p of tw) parts.push(place(p, TOWER.x, TOWER.y, 0));
  }

  // ---- the white seated Di Lặc on the hillside, smiling over the lake
  {
    const w = 0xf2efe6, g: THREE.BufferGeometry[] = [
      box(4, 0.8, 3.4, 0, 0.4, 0, 0xd8cdb4),
      tint(new THREE.SphereGeometry(1.9, 12, 8).scale(1.15, 0.8, 1).translate(0, 1.9, 0), w),        // the crossed legs
      tint(new THREE.SphereGeometry(1.55, 12, 10).scale(1, 1.05, 0.95).translate(0, 3.2, 0.15), w),   // the round belly and chest
      tint(new THREE.SphereGeometry(0.95, 12, 10).translate(0, 4.9, 0.1), w),                          // the head
      tint(new THREE.SphereGeometry(0.28, 6, 5).translate(-0.95, 4.8, 0.05), w), tint(new THREE.SphereGeometry(0.28, 6, 5).translate(0.95, 4.8, 0.05), w),   // the long ears
      tint(new THREE.SphereGeometry(0.5, 8, 6).translate(-1.4, 2.9, 0.7), w), tint(new THREE.SphereGeometry(0.5, 8, 6).translate(1.4, 2.9, 0.7), w),       // the hands
      box(0.5, 0.06, 0.05, 0, 4.65, 1.02, 0x8a7a6a),                                                     // the smile
    ];
    for (const p of g) parts.push(place(p, DI_LAC.x, DI_LAC.y, DI_LAC.yaw, heightAt(DI_LAC.x, DI_LAC.y) - 0.2));
  }

  // ---- the lake: water, the path round it (pale flagstones), the red arched footbridge over the inlet
  const lakeMat = toon({ color: 0x5f8f7a, transparent: true, opacity: 0.88 });
  mats.push(lakeMat);
  const lakeGeo = new THREE.CircleGeometry(U(LAKE.r) + 0.3, 32).rotateX(-Math.PI / 2);
  geos.push(lakeGeo);
  const lake = new THREE.Mesh(lakeGeo, lakeMat);
  lake.position.set(U(LAKE.x), LAKE.level, U(LAKE.y));
  root.add(lake);
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2, r = LAKE.r + 14 + Math.sin(a * 3) * 3, x = LAKE.x + Math.cos(a) * r, y = LAKE.y + Math.sin(a) * r;
    if (Math.abs(x - FOOTBRIDGE.x) < 10 && Math.abs(y - FOOTBRIDGE.y) < 30) continue;
    parts.push(tint(new THREE.CylinderGeometry(0.42, 0.46, 0.1, 6).translate(U(x), heightAt(x, y) + 0.04, U(y)), 0xd8d0bc));
  }
  {
    const L = U(FOOTBRIDGE.len), g: THREE.BufferGeometry[] = [];
    for (let i = 0; i <= 10; i++) {
      const f = i / 10, z = (f - 0.5) * L, arch = Math.sin(f * Math.PI) * 0.9;
      g.push(box(1.1, 0.1, L / 10 + 0.05, 0, arch + 0.1, z, 0xa8322a));
      if (i % 2 === 0) for (const sx of [-0.55, 0.55]) g.push(box(0.08, 0.6, 0.08, sx, arch + 0.4, z, 0xd23a2a));
      for (const sx of [-0.55, 0.55]) g.push(box(0.06, 0.06, L / 10 + 0.05, sx, arch + 0.72, z, 0xe04a3a));
    }
    for (const p of g) parts.push(place(p, FOOTBRIDGE.x, FOOTBRIDGE.y, FOOTBRIDGE.yaw, LAKE.level + 0.05));
  }

  // ---- the waterfall: a mossy stone wall, the falling sheet, a pool with foam
  const fallMat = toon({ color: 0xdff2f4, transparent: true, opacity: 0.8 });
  mats.push(fallMat);
  const fallGeo = new THREE.PlaneGeometry(1.4, 3.2, 1, 6);
  geos.push(fallGeo);
  const fall = new THREE.Mesh(fallGeo, fallMat);
  {
    const y0 = heightAt(WATERFALL.x, WATERFALL.y);
    const g = [box(3.2, 3.6, 1, 0, 1.8, -0.6, 0x7a7466), box(3.3, 0.3, 1.1, 0, 3.6, -0.6, 0x5a8a3a), box(0.8, 0.6, 1, -1.1, 3.2, -0.3, 0x5a8a3a),
      tint(new THREE.CylinderGeometry(1.4, 1.5, 0.2, 14).translate(0, 0.05, 0.9), 0x6f9a8a), tint(new THREE.DodecahedronGeometry(0.4, 0).translate(1.3, 0.2, 1.4), 0x8a8478)];
    for (const p of g) parts.push(place(p, WATERFALL.x, WATERFALL.y, WATERFALL.yaw, y0));
    fall.position.set(U(WATERFALL.x), y0 + 1.75, U(WATERFALL.y));
    fall.rotation.y = WATERFALL.yaw;
    fall.translateZ(-0.05);
    root.add(fall);
  }

  // ---- the summit viewpoint: a stone platform, a railing, a lamp post, a bench
  {
    const g = [tint(new THREE.CylinderGeometry(2.2, 2.4, 0.3, 10).translate(0, 0.15, 0), 0xd8d0bc), box(0.1, 3, 0.1, 1.5, 1.5, -1, 0x3a3a44), box(0.5, 0.3, 0.5, 1.5, 3.1, -1, 0xf6e7a0),
      box(1.6, 0.1, 0.5, -0.6, 0.55, -1.2, 0x8a5a33), box(0.1, 0.45, 0.4, -1.3, 0.35, -1.2, 0x3a3a44), box(0.1, 0.45, 0.4, 0.1, 0.35, -1.2, 0x3a3a44)];
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; g.push(box(0.08, 0.9, 0.08, Math.cos(a) * 2.1, 0.75, Math.sin(a) * 2.1, 0x6b4a33)); }
    for (const p of g) parts.push(place(p, SUMMIT.x, SUMMIT.y, 0));
  }

  // ---- the cable car: pylons up the slope, the cable, the stations; the cabins glide (instanced)
  const N = 7, sag = 1.2;
  const cableY = (f: number) => { const p = cableAt(f); return Math.max(heightAt(p.x, p.y) + 3.5, (1 - f) * (heightAt(CABLE.a.x, CABLE.a.y) + 4) + f * (heightAt(CABLE.b.x, CABLE.b.y) + 4)) - Math.sin(f * Math.PI) * sag; };
  const yaw = Math.atan2(CABLE.b.x - CABLE.a.x, CABLE.b.y - CABLE.a.y);
  for (let k = 1; k < N; k++) {
    const f = k / N, p = cableAt(f), g0 = heightAt(p.x, p.y), top = cableY(f) + 0.3;
    for (const p2 of [box(0.25, top - g0, 0.25, 0, (top - g0) / 2, 0, 0x8a8e98), box(1.4, 0.2, 0.3, 0, top - g0, 0, 0x6a6e78)]) parts.push(place(p2, p.x, p.y, yaw, g0));
  }
  for (let s = 0; s < 40; s++) {
    const f0 = s / 40, f1 = (s + 1) / 40, a = cableAt(f0), b = cableAt(f1);
    const va = new THREE.Vector3(U(a.x), cableY(f0), U(a.y)), vb = new THREE.Vector3(U(b.x), cableY(f1), U(b.y));
    for (const off of [-0.5, 0.5]) {
      const side = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)).multiplyScalar(off);
      const len = va.distanceTo(vb), g = tint(new THREE.CylinderGeometry(0.025, 0.025, len, 3), 0x2a2a30);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize()));
      parts.push(g.translate((va.x + vb.x) / 2 + side.x, (va.y + vb.y) / 2, (va.z + vb.z) / 2 + side.z));
    }
  }
  for (const [end, h] of [[CABLE.a, heightAt(CABLE.a.x, CABLE.a.y)], [CABLE.b, heightAt(CABLE.b.x, CABLE.b.y)]] as const) {
    for (const p of [box(3, 3.4, 2.4, 0, 1.7, 0, 0xe8e2d4), ...eaves(3.6, 0.9, 3.4, 0x2e7a8a)]) parts.push(place(p, end.x, end.y, yaw, h));
  }
  const cabinGeo = mergeGeometries([box(0.9, 0.8, 0.9, 0, -0.9, 0, 0xffffff), box(0.95, 0.12, 0.95, 0, -0.45, 0, 0xffffff), box(0.06, 0.5, 0.06, 0, -0.2, 0, 0x3a3a44),
    box(0.7, 0.35, 0.92, 0, -0.8, 0, 0x2a3a4a)])!;
  geos.push(cabinGeo);
  const cabinMat = toon({ vertexColors: true });
  mats.push(cabinMat);
  const CABINS = 10;
  const cabins = new THREE.InstancedMesh(cabinGeo, cabinMat, CABINS);
  for (let i = 0; i < CABINS; i++) cabins.setColorAt(i, new THREE.Color(i % 4 === 3 ? 0x3aa84a : 0xd8322a));
  cabins.frustumCulled = false;
  root.add(cabins);

  // ---- a sea of clouds round the upper slopes: a few soft sheets that drift and turn
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, depthWrite: false });
  mats.push(cloudMat);
  const clouds: THREE.Mesh[] = [];
  for (let i = 0; i < 5; i++) {
    const g = new THREE.RingGeometry(U(NUI.r) * (0.62 + i * 0.07), U(NUI.r) * (0.74 + i * 0.07), 28, 1, i * 1.3, Math.PI * (0.6 + (i % 2) * 0.3)).rotateX(-Math.PI / 2);
    geos.push(g);
    const m = new THREE.Mesh(g, cloudMat);
    m.position.set(U(NUI.x), NUI.h * (0.55 + (i % 3) * 0.06), U(NUI.y));
    m.renderOrder = 2;
    clouds.push(m);
    root.add(m);
  }

  // ---- the gate: stacked shipping containers in an A-frame over the road, the park's (invented) name
  const faces: FaceQuad[] = [];
  {
    const C = [0xd8322a, 0x2e7ad0, 0xf2c230, 0x3aa84a, 0xe07a2e, 0x8a4ab8], g: THREE.BufferGeometry[] = [];
    const cont = (x: number, y: number, z: number, rot: number, c: number) => {
      const b = box(1.5, 1.5, 6, 0, 0, 0, c);
      const ribs: THREE.BufferGeometry[] = [];
      for (let k = -2.7; k <= 2.8; k += 0.45) ribs.push(box(1.56, 1.56, 0.06, 0, 0, k, new THREE.Color(c).multiplyScalar(0.8).getHex()));
      return [b, ...ribs].map((q) => q.rotateZ(rot).translate(x, y, z));
    };
    for (const s of [-1, 1]) {                                         // the two leaning stacks (the A's legs)
      g.push(...cont(s * 3.6, 0.8, 0, 0, C[(s + 1) % 6]), ...cont(s * 3.2, 2.3, 0, 0, C[(s + 3) % 6]), ...cont(s * 2.6, 3.8, 0, s * 0.35, C[(s + 4) % 6]));
    }
    g.push(...cont(0, 0, 0, 0, C[2]).map((q) => q.rotateY(Math.PI / 2).translate(0, 5.2, 0)));   // the top one across
    for (const p of g) parts.push(place(p.rotateY(Math.PI / 2), GATE.x, GATE.y, GATE.yaw - Math.PI / 2));
    const y = heightAt(GATE.x, GATE.y) + 6.3, ax = faceAxes("w");
    faces.push({ center: new THREE.Vector3(U(GATE.x) - 0.85, y, U(GATE.y)), right: ax.right, up: ax.up, w: 6.2, h: 0.95, art: { lines: [PARK_NAME], bg: 0x1f5fa8, fg: 0xfff4c0, rim: 0xf2c230 } });
    parts.push(box(0.1, 1.1, 6.4, U(GATE.x) - 0.78, y, U(GATE.y), 0x2a2a30));
  }
  const signs = signMesh(faces);
  if (signs) root.add(signs.mesh);

  const geo = mergeGeometries(parts)!;
  for (const p of parts) p.dispose();
  geos.push(geo);
  const mat = toon({ vertexColors: true });
  mats.push(mat);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  root.add(mesh);

  const m4 = new THREE.Matrix4(), p3 = new THREE.Vector3(), q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), one = new THREE.Vector3(1, 1, 1);
  const fallPos = fallGeo.getAttribute("position") as THREE.BufferAttribute, fallBase = Float32Array.from(fallPos.array as Float32Array);
  return {
    root,
    animate(t, reduced) {
      const s = reduced ? 0 : t / 1000;
      for (let i = 0; i < CABINS; i++) {
        // half go up, half come down, slowly
        const up = i % 2 === 0, f0 = ((i / CABINS) + s * 0.012) % 1, f = up ? f0 : 1 - f0;
        const c = cableAt(f);
        m4.compose(p3.set(U(c.x) + Math.cos(yaw) * (up ? -0.5 : 0.5), cableY(f), U(c.y) - Math.sin(yaw) * (up ? -0.5 : 0.5)), q, one);
        cabins.setMatrixAt(i, m4);
      }
      cabins.instanceMatrix.needsUpdate = true;
      clouds.forEach((m, i) => { m.rotation.y = s * 0.01 * (i % 2 ? 1 : -1) + i; m.position.y = NUI.h * (0.55 + (i % 3) * 0.06) + Math.sin(s * 0.2 + i) * 0.3; });
      for (let i = 0; i < fallPos.count; i++) fallPos.setZ(i, fallBase[i * 3 + 2] + Math.sin(fallBase[i * 3 + 1] * 3 + s * 8) * 0.04);
      fallPos.needsUpdate = true;
    },
    dispose() { for (const g of geos) g.dispose(); for (const m of mats) m.dispose(); cabins.dispose(); if (signs) { signs.geometry.dispose(); signs.material.dispose(); signs.texture.dispose(); } },
  };
}
