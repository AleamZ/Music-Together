import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { canalCrossings, floatingMarket, gardenSpots, lotusPonds, mooredBoats, stiltHouses, villageShops, type Boat, type Crossing, type Garden, type House, type Pond, type Shop } from "@/lib/game/world/delta";
import { heightAt, RIVER_LEVEL } from "@/lib/game/world/terrain";
import { faceAxes, signMesh, type FaceQuad } from "../zones/signmesh";
import { toon } from "./toon";

// Browser only: the delta's life along the water (lib/game/world/delta.ts) as ONE vertex-coloured mesh — plank bridges
// and cầu khỉ over the canals, nhà sàn on the banks (tin or leaf roofs) with a xuồng tied below, and the floating
// market's ghe with their cây bẹo poles. Low-poly, toon-shaded; one draw call for all of it.

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
const cyl = (r: number, h: number, x: number, y: number, z: number, hex: number, seg = 5) => tint(new THREE.CylinderGeometry(r, r, h, seg).translate(x, y, z), hex);
/** A pitched roof over w × d (ridge along x), eaves at y. */
function roof(w: number, d: number, h: number, y: number, hex: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.0001, 1, 1, 4, 1).rotateY(Math.PI / 4);
  g.scale(w / Math.SQRT2 * 1.02, h, d / Math.SQRT2 * 1.02);
  return tint(g.translate(0, y + h / 2, 0), hex);
}

/** Place a local part (x right, z toward the facing) at a spot, turned by yaw. */
const at = (g: THREE.BufferGeometry, x: number, y: number, z: number, yaw: number) => g.rotateY(yaw).translate(x, y, z);

function bridge(c: Crossing, out: THREE.BufferGeometry[]): void {
  const len = U(c.len), w = U(c.w) * (c.monkey ? 0.35 : 0.8), y = c.deck, bed = RIVER_LEVEL - 1.2;
  const p: THREE.BufferGeometry[] = [];
  if (c.monkey) {
    // cầu khỉ: one bamboo pole to walk on, X-legs, a handrail on one side
    p.push(box(0.22, 0.12, len, 0, y + 0.3, 0, 0xc8b070));
    for (const z of [-len / 2 + 0.3, 0, len / 2 - 0.3]) {
      p.push(tint(new THREE.CylinderGeometry(0.05, 0.05, y + 0.7 - bed, 4).rotateZ(0.25).translate(-0.2, (y + 0.7 + bed) / 2, z), 0xa89050));
      p.push(tint(new THREE.CylinderGeometry(0.05, 0.05, y + 0.7 - bed, 4).rotateZ(-0.25).translate(0.2, (y + 0.7 + bed) / 2, z), 0xa89050));
    }
    p.push(tint(new THREE.CylinderGeometry(0.04, 0.04, len, 4).rotateX(Math.PI / 2).translate(0.45, y + 1.2, 0), 0xb89c5a));
    for (const z of [-len / 2 + 0.3, len / 2 - 0.3]) p.push(cyl(0.04, 1, 0.45, y + 0.75, z, 0xa89050));
  } else {
    // a plank road bridge on wooden piles, with rails
    p.push(box(w, 0.16, len, 0, y - 0.02, 0, 0x9a6a3e));
    for (let z = -len / 2 + 0.25; z < len / 2; z += 0.5) p.push(box(w + 0.1, 0.03, 0.08, 0, y + 0.075, z, 0x7a5030));
    for (const sx of [-1, 1]) {
      p.push(box(0.1, 0.1, len, sx * (w / 2 - 0.05), y + 0.75, 0, 0x8a5a33));
      for (let z = -len / 2 + 0.2; z <= len / 2; z += 1.1) p.push(box(0.1, 0.75, 0.1, sx * (w / 2 - 0.05), y + 0.37, z, 0x6b4a33));
      for (const z of [-len / 4, len / 4]) p.push(cyl(0.12, y - bed, sx * (w / 2 - 0.2), (y + bed) / 2, z, 0x5a3a24));
    }
  }
  for (const g of p) out.push(at(g, U(c.x), 0, U(c.y), c.yaw));
}

function house(h: House, out: THREE.BufferGeometry[]): void {
  const s = 1 + (h.seed % 5) * 0.06, W = 3.2 * s, D = 2.6 * s, floor = h.ground + 1.1, wallH = 1.5;
  const wall = [0x9a6a3e, 0xb08a5a, 0x8a7a5a][h.seed % 3], roofC = h.roof === "tin" ? [0x9aa4a8, 0x8a5a3a, 0x6a8a9a][h.seed % 3] : 0xb89458;
  const p: THREE.BufferGeometry[] = [];
  for (const [x, z] of [[-W / 2 + 0.15, -D / 2 + 0.15], [W / 2 - 0.15, -D / 2 + 0.15], [-W / 2 + 0.15, D / 2 + 0.9], [W / 2 - 0.15, D / 2 + 0.9], [0, D / 2 + 0.9]]) {
    p.push(cyl(0.08, floor - (RIVER_LEVEL - 0.8), x, (floor + RIVER_LEVEL - 0.8) / 2, z, 0x5a3a24));
  }
  p.push(box(W + 0.2, 0.14, D + 1.2, 0, floor, 0.5, 0x8a6040));                       // the floor and its porch over the water
  p.push(box(W, wallH, D, 0, floor + 0.07 + wallH / 2, 0, wall));
  p.push(box(0.6, 1.1, 0.04, -W / 4, floor + 0.62, D / 2 + 0.02, 0x3a2418));         // the door
  p.push(box(0.7, 0.5, 0.04, W / 4, floor + 0.95, D / 2 + 0.02, 0x2a3a3a));          // the window (shutter open)
  p.push(box(0.72, 0.08, 0.3, W / 4, floor + 1.25, D / 2 + 0.15, wall));
  p.push(roof(W + 0.8, D + 1.5, 1.25, floor + wallH, roofC));
  p.push(box(W + 0.2, 0.06, 0.06, 0, floor + 0.55, D / 2 + 1.05, 0x6b4a33));         // the porch rail
  // life: clay water jars (lu), a hanging fishing net frame (vó) on a pole, washing on a line
  p.push(tint(new THREE.SphereGeometry(0.28, 7, 5).scale(1, 1.2, 1).translate(W / 2 + 0.5, h.ground + 0.3, -0.4), 0x7a4a2e));
  p.push(tint(new THREE.SphereGeometry(0.22, 7, 5).scale(1, 1.2, 1).translate(W / 2 + 0.55, h.ground + 0.25, 0.3), 0x8a5a38));
  if (h.seed % 2) {
    p.push(tint(new THREE.CylinderGeometry(0.04, 0.05, 3.2, 4).rotateX(0.6).translate(-W / 2 - 0.4, floor + 0.6, D / 2 + 1.6), 0x8a6a45));
    p.push(tint(new THREE.ConeGeometry(0.9, 0.5, 4, 1, true).rotateX(Math.PI).translate(-W / 2 - 0.4, floor + 0.2, D / 2 + 2.8), 0xd8d0b8));
  } else {
    p.push(box(0.03, 0.03, 2.4, W / 2 + 0.2, floor + 1.3, 0.6, 0x3a2418).rotateY(Math.PI / 2));
    for (let i = 0; i < 3; i++) p.push(box(0.35, 0.45, 0.02, W / 2 - 0.9 + i * 0.5, floor + 1.05, 0.6, [0xd23a3a, 0x3a7bd5, 0xf4f1e8][i]));
  }
  for (const g of p) out.push(at(g, U(h.x), 0, U(h.y), h.yaw));
}

const GOODS = [[0xe07a2e, 0xf4d03a], [0x6aa83f, 0x9ac84a], [0xd23a3a, 0xf29bb5], [0x6b8a2e, 0xe0b33c], [0xa86a3a, 0x5caa4a]];

function boat(b: Boat, out: THREE.BufferGeometry[]): void {
  const ghe = b.kind === "ghe", L = ghe ? 4.2 : 2.6, W = ghe ? 1.2 : 0.7, y = RIVER_LEVEL;
  const p: THREE.BufferGeometry[] = [];
  // the hull: a shallow tapered trough (wider at the gunwale), pointed bow and stern
  p.push(tint(new THREE.CylinderGeometry(W / 2, W / 2.8, 0.36, 4, 1).rotateY(Math.PI / 4).scale(1, 1, L / W).translate(0, y + 0.0, 0), ghe ? 0x6a4a2e : 0x7a5a3a));
  p.push(box(W * 0.9, 0.05, L * 0.8, 0, y + 0.08, 0, 0x9a7a4a));
  for (const s of [-1, 1]) p.push(tint(new THREE.ConeGeometry(W / 2.6, 0.8, 4).rotateX(s * Math.PI / 2).scale(1, 0.5, 1).translate(0, y + 0.1, s * (L * 0.36 + 0.4)), 0x6a4a2e));
  if (ghe) {
    p.push(box(W * 0.9, 0.9, 1.4, 0, y + 0.5, -0.9, 0x8a6a45));                        // the mui (a little cabin)
    p.push(tint(new THREE.CylinderGeometry(0.75, 0.75, 1.5, 8, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2).scale(1, 0.55, 1).translate(0, y + 0.95, -0.9), 0x5a5048));
    const [a, c] = GOODS[b.goods % GOODS.length];
    for (let i = 0; i < 6; i++) p.push(tint(new THREE.SphereGeometry(0.2, 6, 4).translate(((i % 3) - 1) * 0.3, y + 0.25 + Math.floor(i / 3) * 0.2, 0.7 + (i % 2) * 0.2), i % 2 ? a : c));
    // cây bẹo: a tall pole with a sample of the goods hanging on top, so buyers see from afar what she sells
    p.push(cyl(0.04, 4.2, 0.3, y + 2.1, 1.3, 0xb89c5a, 4));
    p.push(tint(new THREE.SphereGeometry(0.25, 6, 4).translate(0.3, y + 3.9, 1.3), a));
    p.push(tint(new THREE.SphereGeometry(0.2, 6, 4).translate(0.45, y + 3.6, 1.3), c));
  }
  p.push(tint(new THREE.ConeGeometry(0.34, 0.2, 10).translate(0, y + 0.95, ghe ? 1.6 : 0), 0xe8d6a0));   // a nón lá left on the seat
  for (const g of p) out.push(at(g, U(b.x), 0, U(b.y), b.yaw));
}

/** Ao sen: a round pond (water a hair over the ground, polygon-offset), lotus pads, pink flowers and buds. */
function pond(p: Pond, out: THREE.BufferGeometry[]): void {
  const g0 = heightAt(p.x, p.y), r = U(p.r), cx = U(p.x), cz = U(p.y);
  out.push(tint(new THREE.CylinderGeometry(r + 0.35, r + 0.6, 0.12, 20).translate(cx, g0 + 0.02, cz), 0x7a6a44));      // the mud rim
  out.push(tint(new THREE.CylinderGeometry(r, r, 0.06, 20).translate(cx, g0 + 0.07, cz), 0x6f8a58));                    // the water
  for (let i = 0; i < 18; i++) {
    const a = i * 2.39996, d = Math.sqrt((i + 0.5) / 18) * (r - 0.35), x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
    out.push(tint(new THREE.CylinderGeometry(0.34, 0.34, 0.03, 8, 1, false, 0.4, Math.PI * 1.8).translate(x, g0 + 0.115, z), i % 3 ? 0x4f8a33 : 0x5f9a3a));
    if (i % 3 === 0) {
      out.push(tint(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 3).translate(x + 0.1, g0 + 0.35, z), 0x4f7a30));
      out.push(tint(new THREE.ConeGeometry(0.16, 0.3, 6).rotateX(i % 2 ? Math.PI : 0).translate(x + 0.1, g0 + 0.66, z), i % 2 ? 0xf28ab0 : 0xe86a9a));
    }
  }
}

/** A thatched garden house among the fruit trees (leaf roof on posts, a raised floor), its pale stone path. */
function garden(gd: Garden, out: THREE.BufferGeometry[]): void {
  const y = heightAt(gd.x, gd.y), p: THREE.BufferGeometry[] = [];
  p.push(box(2.6, 0.3, 2.2, 0, y + 0.15, 0, 0x9a7a4e));
  for (const [x, z] of [[-1.1, -0.9], [1.1, -0.9], [-1.1, 0.9], [1.1, 0.9]]) p.push(cyl(0.07, 1.5, x, y + 1.05, z, 0x6b4a33));
  p.push(box(2.3, 1, 0.08, 0, y + 0.8, -0.9, 0xb89a68));
  p.push(roof(3.4, 3, 1.1, y + 1.8, 0xb8944a));
  for (let i = 1; i <= 6; i++) {                                                        // the path: pale stepping stones, winding
    const s = i * 0.95, x = Math.sin(i * 0.9) * 0.6;
    p.push(tint(new THREE.CylinderGeometry(0.32, 0.36, 0.08, 7).translate(x, y + 0.03, 1.3 + s), 0xd8d0bc));
  }
  for (const g of p) out.push(at(g, U(gd.x), 0, U(gd.y), gd.yaw));
}

/** A tạp hóa: a single-storey tiled front with a corrugated awning, goods hanging at the door, an umbrella, chairs. */
function shop(s: Shop, out: THREE.BufferGeometry[], signs: FaceQuad[]): void {
  const y = heightAt(s.x, s.y), p: THREE.BufferGeometry[] = [];
  const wall = [0xe8d6b0, 0xcfe0d4, 0xecd07a, 0xe6b8a8][s.seed % 4];
  p.push(box(4.4, 2.6, 3, 0, y + 1.3, -0.4, wall));
  p.push(roof(4.8, 3.6, 1, y + 2.6, 0xb0503a));
  p.push(box(4.6, 0.06, 1.6, 0, y + 2.1, 1.8, 0x9aa4a8).rotateX(0.18));                // the corrugated awning
  for (const x of [-2.1, 2.1]) p.push(cyl(0.05, 2, x, y + 1, 2.5, 0x8a8e98));
  p.push(box(1.6, 1.9, 0.06, 0, y + 0.95, 1.12, 0x3a2a24));                             // the open doorway
  for (let i = 0; i < 6; i++) p.push(box(0.22, 0.3, 0.12, -1.3 + (i % 3) * 0.25, y + 1.9 - Math.floor(i / 3) * 0.35, 1.25, [0xd23a3a, 0xf4d03a, 0x3a7bd5, 0x5caa4a, 0xe07a2e, 0xf4f1e8][i]));
  p.push(box(1.1, 0.8, 0.6, 1.4, y + 0.4, 1.5, 0xa8744a));                               // a counter of goods
  p.push(cyl(0.04, 2, 3, y + 1, 3, 0xe8e2d4, 4));                                        // the sun umbrella
  p.push(tint(new THREE.ConeGeometry(1.3, 0.5, 8).translate(3, y + 2.1, 3), s.seed % 2 ? 0xd23a3a : 0x2e7ad0));
  for (const x of [2.5, 3.5]) p.push(box(0.45, 0.45, 0.45, x, y + 0.23, 3.6, s.seed % 2 ? 0x2e7ad0 : 0xd23a3a));   // plastic chairs
  p.push(tint(new THREE.CylinderGeometry(0.22, 0.16, 0.35, 6).translate(-2, y + 0.18, 1.6), 0x9a5a3a), tint(new THREE.IcosahedronGeometry(0.35, 0).translate(-2, y + 0.6, 1.6), 0x4f9a3a));
  for (const g of p) out.push(at(g, U(s.x), 0, U(s.y), s.yaw));
  // the signboard: a big painted board over the awning, facing the road
  const c = new THREE.Vector3(0, y + 2.9, 1.12).applyAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw).add(new THREE.Vector3(U(s.x), 0, U(s.y)));
  const ax = faceAxes("s");
  signs.push({ center: c, right: ax.right.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw), up: ax.up, w: 4.2, h: 0.9, art: { lines: [s.name], bg: [0x1f5fa8, 0xd23a3a, 0x2e8a4a][s.seed % 3], fg: 0xfff4c0, rim: 0xf4d03a } });
  out.push(at(box(4.4, 1, 0.1, 0, y + 2.9, 1.06, 0x3a2418), U(s.x), 0, U(s.y), s.yaw));
}

/** Everything along the water, one mesh. */
export function buildDelta(): { root: THREE.Group; dispose(): void } {
  const parts: THREE.BufferGeometry[] = [];
  for (const c of canalCrossings()) bridge(c, parts);
  for (const h of stiltHouses()) house(h, parts);
  for (const b of mooredBoats()) boat(b, parts);
  for (const b of floatingMarket()) boat(b, parts);
  for (const p of lotusPonds()) pond(p, parts);
  for (const g of gardenSpots()) garden(g, parts);
  const faces: FaceQuad[] = [];
  for (const s of villageShops()) shop(s, parts, faces);
  const root = new THREE.Group();
  root.name = "delta";
  const signs = signMesh(faces);
  if (signs) root.add(signs.mesh);
  const geo = parts.length ? mergeGeometries(parts)! : new THREE.BufferGeometry();
  for (const p of parts) p.dispose();
  const mat = toon({ vertexColors: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  root.add(mesh);
  return { root, dispose() { geo.dispose(); mat.dispose(); if (signs) { signs.geometry.dispose(); signs.material.dispose(); signs.texture.dispose(); } } };
}
