import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { rimHills } from "@/lib/game/world/rim";
import { DOMAIN, fbm, hashAt, heightAt, waterAt } from "@/lib/game/world/terrain";
import { landColor } from "./terrain-mesh";

// The land past the rendered chunks (view only: beyond DOMAIN, no collision, not on the minimap) — the same seamless
// heightfield as the world's (terrain.ts heightAt, with rim.ts folded in: Thất Sơn's forested hills round the north
// and east, paddies and canals on the low land, the far rivers and the south-west estuary), coloured by the same
// landColor on the same lit terrain material, fading into the fog at the far edge. Its trees: instanced tropical kinds
// (broadleaf canopy on the hills, bamboo and coconuts at their feet, dừa groves and thốt nốt on the paddies), in two
// levels: low-poly models in the near band, a single-crown impostor farther out. Few draw calls, built once.

const U = 16;
/** How far the far land reaches past DOMAIN (px), and its grid (px). */
const REACH = 12000, STEP = 200;
/** Trees: out to this far past DOMAIN; low-poly models inside NEAR_TREES, crowns only beyond. */
const TREES_OUT = 6400, NEAR_TREES = 2600, TREE_STEP = 100;

function outDomain(x: number, y: number): number {
  return Math.max(DOMAIN.x0 - x, x - DOMAIN.x1, DOMAIN.y0 - y, y - DOMAIN.y1, 0);
}

function farLand(): THREE.Mesh {
  const x0 = DOMAIN.x0 - REACH, y0 = DOMAIN.y0 - REACH;
  const nx = Math.round((DOMAIN.x1 - DOMAIN.x0 + 2 * REACH) / STEP), ny = Math.round((DOMAIN.y1 - DOMAIN.y0 + 2 * REACH) / STEP);
  const pos = new Float32Array((nx + 1) * (ny + 1) * 3), col = new Float32Array((nx + 1) * (ny + 1) * 3);
  const c = new THREE.Color();
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    const x = x0 + i * STEP, y = y0 + j * STEP, k = (j * (nx + 1) + i) * 3;
    // strictly inside DOMAIN the chunks draw the land: sink it out of sight; ON the boundary share their height
    const inside = x > DOMAIN.x0 && x < DOMAIN.x1 && y > DOMAIN.y0 && y < DOMAIN.y1;
    const h = inside ? heightAt(x, y) - 40 : heightAt(x, y);
    pos.set([x / U, h, y / U], k);
    landColor(x, y, h, 0.3, c);
    col.set([c.r, c.g, c.b], k);
  }
  const idx: number[] = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + 1, d = a + nx + 1, e = d + 1;
    idx.push(a, d, b, b, d, e);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g);
  m.name = "horizon";
  m.receiveShadow = false;
  return m;
}

type Kind = "broad" | "palm" | "bamboo";
const PAL: Record<Kind, number[]> = {
  broad: [0x3f7a35, 0x4f8a3a, 0x36702f, 0x5b9a42],
  palm: [0x4f8f3a, 0x5f9f45, 0x467f35],
  bamboo: [0x6fa545, 0x7fb54f],
};

function painted(g: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const c = new THREE.Color(hex);
  const out = g.index ? g.toNonIndexed() : g;
  const m = out.getAttribute("position").count, b = new Float32Array(m * 3);
  for (let i = 0; i < m; i++) b.set([c.r, c.g, c.b], i * 3);
  out.setAttribute("color", new THREE.BufferAttribute(b, 3));
  out.deleteAttribute("uv");
  if (out.getAttribute("normal")) out.deleteAttribute("normal");
  return out;
}
const WHITE = 0xffffff, TRUNK = 0x6b4e33;
/** Low-poly models (1 unit = 16 px), leaves white (tinted per instance), trunks brown. */
function model(kind: Kind, near: boolean): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  if (kind === "broad") {
    if (near) parts.push(painted(new THREE.CylinderGeometry(0.18, 0.28, 2.2, 5).translate(0, 1.1, 0), TRUNK));
    parts.push(painted(new THREE.IcosahedronGeometry(near ? 1.9 : 2.1, near ? 1 : 0).scale(1, 0.8, 1).translate(0, 3.1, 0), WHITE));
    if (near) parts.push(painted(new THREE.IcosahedronGeometry(1.3, 0).translate(0.9, 3.8, 0.4), WHITE));
  } else if (kind === "palm") {
    if (near) {
      parts.push(painted(new THREE.CylinderGeometry(0.1, 0.16, 6, 5).translate(0, 3, 0).rotateZ(0.08), TRUNK));
      for (let i = 0; i < 7; i++) parts.push(painted(new THREE.ConeGeometry(0.28, 2.4, 3).translate(0, 1.2, 0).rotateZ(1.15).rotateY((i / 7) * Math.PI * 2).translate(0.25, 5.9, 0), WHITE));
    } else parts.push(painted(new THREE.ConeGeometry(1.8, 1.1, 6).translate(0, 5.8, 0), WHITE), painted(new THREE.CylinderGeometry(0.12, 0.12, 5.4, 3).translate(0, 2.7, 0), TRUNK));
  } else {
    const n = near ? 6 : 1;
    for (let i = 0; i < n; i++) parts.push(painted(new THREE.ConeGeometry(near ? 0.55 : 1.5, 5.5, 4).translate(Math.cos(i * 2.2) * 0.5, 2.75, Math.sin(i * 2.2) * 0.5), WHITE));
  }
  const g = mergeGeometries(parts)!;
  parts.forEach((p) => p.dispose());
  g.computeVertexNormals();
  return g;
}

interface TreeSpot { x: number; y: number; h: number; kind: Kind; s: number; rot: number; tint: number; near: boolean }

function scatter(): TreeSpot[] {
  const out: TreeSpot[] = [];
  const x0 = DOMAIN.x0 - TREES_OUT, y0 = DOMAIN.y0 - TREES_OUT, x1 = DOMAIN.x1 + TREES_OUT, y1 = DOMAIN.y1 + TREES_OUT;
  for (let gy = y0; gy < y1; gy += TREE_STEP) for (let gx = x0; gx < x1; gx += TREE_STEP) {
    const o = outDomain(gx, gy);
    if (o <= 0) continue;
    const roll = hashAt(gx, gy, 61), k = hashAt(gx, gy, 62);
    const x = gx + (hashAt(gx, gy, 63) - 0.5) * TREE_STEP * 0.9, y = gy + (hashAt(gx, gy, 64) - 0.5) * TREE_STEP * 0.9;
    const hill = rimHills(x, y);
    let kind: Kind | null = null;
    if (hill > 2.5) kind = roll < 0.75 ? (k < 0.85 ? "broad" : "bamboo") : null;                // the hills' canopy
    else if (hill > 0.6) kind = roll < 0.4 ? (k < 0.5 ? "bamboo" : "palm") : null;
    else if (fbm(x / 700 + 11, y / 700 - 5, 2) > 0.25) kind = roll < 0.45 ? (k < 0.75 ? "palm" : "broad") : null;   // dừa groves, orchards
    else if (Math.abs(((x + 40960) % 1200) - 600) > 560 && roll < 0.25) kind = "palm";         // thốt nốt on the dikes
    if (!kind || waterAt(x, y) !== null) continue;
    out.push({ x, y, h: heightAt(x, y), kind, s: 0.8 + hashAt(gx, gy, 65) * 0.5, rot: hashAt(gx, gy, 66) * Math.PI * 2, tint: hashAt(gx, gy, 67), near: o < NEAR_TREES });
  }
  return out;
}

function trees(mat: THREE.Material): THREE.InstancedMesh[] {
  const spots = scatter();
  const meshes: THREE.InstancedMesh[] = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
  for (const kind of ["broad", "palm", "bamboo"] as Kind[]) for (const near of [true, false]) {
    const mine = spots.filter((t) => t.kind === kind && t.near === near);
    if (!mine.length) continue;
    const im = new THREE.InstancedMesh(model(kind, near), mat, mine.length);
    mine.forEach((t, i) => {
      m.compose(p.set(t.x / U, t.h - 0.1, t.y / U), q.setFromAxisAngle(up, t.rot), s.setScalar(t.s * 1.3));
      im.setMatrixAt(i, m);
      im.setColorAt(i, c.setHex(PAL[kind][Math.floor(t.tint * PAL[kind].length)]));
    });
    im.name = `backdrop-${kind}-${near ? "near" : "far"}`;
    im.computeBoundingSphere();
    meshes.push(im);
  }
  return meshes;
}

export interface Backdrop {
  /** The far land (the view sets the terrain's material on it). */
  land: THREE.Mesh;
  root: THREE.Group;
  /** Kept for the view's sky hook: the backdrop is lit like the land, nothing to tint. */
  tint(horizon: THREE.Color, night: number): void;
  dispose(): void;
}

export function buildBackdrop(): Backdrop {
  const land = farLand();
  const root = new THREE.Group();
  root.name = "backdrop";
  const treeMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const ims = trees(treeMat);
  root.add(...ims);
  for (const o of [land, ...ims]) { o.matrixAutoUpdate = false; o.updateMatrix(); }
  return {
    land, root,
    tint() { /* lit by the scene's sun and fog */ },
    dispose() {
      land.geometry.dispose();
      for (const im of ims) { im.geometry.dispose(); im.dispose(); }
      treeMat.dispose();
    },
  };
}

export const BACKDROP_TREES_OUT = TREES_OUT;
