import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { DOMAIN, fbm, hashAt, RIVER_LEVEL, RIVER_PTS, smoothstep } from "@/lib/game/world/terrain";
import { WORLD_H, WORLD_W } from "@/lib/game/world/zones";

// The backdrop round the playable world (view only: no collision, not on the minimap, all of it beyond DOMAIN). Few
// draw calls, no LOD:
//   - the far land (one vertex-coloured grid): the delta going on — paddies in blocks, dikes, darker orchard strips —
//     cut by the two river mouths' continuations and a far river winding off east; south-west it opens into a wide
//     estuary / the sea (below the sea plane there, so the sea shows);
//   - palm / dừa tree lines along the far canals and dikes (two instanced meshes: trunks, crowns);
//   - mountain ranges on the north and east horizon: three layered ridgelines (one merged mesh, unlit, fading into
//     the haze colour with distance; the fog does the rest), cloud caps on the peaks toward Núi Mây Xanh (north-east).
// World px in, three units out (1 unit = 16 px), as the rest of the world view.

const U = 16;

/** The far river: the main river's east end winding on to the horizon (world px). */
const FAR_RIVER: { x: number; y: number }[] = [
  RIVER_PTS[RIVER_PTS.length - 1], { x: 7200, y: 1500 }, { x: 9200, y: 2100 }, { x: 11400, y: 1300 }, { x: 13800, y: 1700 }, { x: 17000, y: 900 },
];
/** …and the west end out to the estuary. */
const WEST_RIVER: { x: number; y: number }[] = [
  RIVER_PTS[0], { x: -3000, y: 1900 }, { x: -4800, y: 2700 }, { x: -6500, y: 3800 },
];
/** The far canals (straight, as the delta's are), for the tree lines and the water. */
const FAR_CANALS: { x: number; y: number }[][] = [
  [{ x: -9000, y: 300 }, { x: -1200, y: 310 }],
  [{ x: 5200, y: 320 }, { x: 14000, y: 380 }],
  [{ x: 2000, y: -1200 }, { x: 2100, y: -9000 }],
  [{ x: -2400, y: -2200 }, { x: 7000, y: -2600 }],
  [{ x: 6200, y: -800 }, { x: 6400, y: 5200 }],
  [{ x: 1000, y: 3500 }, { x: 9000, y: 3900 }],
];

function segDist(pts: readonly { x: number; y: number }[], x: number, y: number): number {
  let d = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    const t = Math.max(0, Math.min(1, ((x - a.x) * (b.x - a.x) + (y - a.y) * (b.y - a.y)) / l2));
    d = Math.min(d, Math.hypot(x - a.x - t * (b.x - a.x), y - a.y - t * (b.y - a.y)));
  }
  return d;
}

/** The estuary: the south-west opens into the sea. 1 = open water. */
function estuary(x: number, y: number): number {
  const d = Math.hypot((x + 7000) / 1.4, y - 6200);
  return 1 - smoothstep(5200, 6400, d + fbm(x / 1400, y / 1400, 2) * 900);
}

/** How wet far px (x, y) is, 0…1 (smooth across the banks, so the grid shows no steps), and how much of it is sea. */
export function backdropWet(x: number, y: number): { wet: number; sea: number } {
  const sea = smoothstep(0.3, 0.7, estuary(x, y));
  const w = 180 + Math.max(0, Math.hypot(x - WORLD_W / 2, y - WORLD_H / 2) - 3000) * 0.02;
  const river = Math.max(1 - smoothstep(w - 160, w + 160, segDist(FAR_RIVER, x, y)), 1 - smoothstep(w * 1.4 - 160, w * 1.4 + 160, segDist(WEST_RIVER, x, y)));
  let canal = 0;
  for (const c of FAR_CANALS) canal = Math.max(canal, 1 - smoothstep(20, 180, segDist(c, x, y)));
  return { wet: Math.max(sea, river, canal * 0.8), sea };
}

/** Is far px (x, y) water? */
export function backdropWater(x: number, y: number): boolean {
  return backdropWet(x, y).wet > 0.5;
}

const C = {
  rice: new THREE.Color(0x8fbf4a), ripe: new THREE.Color(0xc7c255), young: new THREE.Color(0x6fae45),
  dike: new THREE.Color(0x7d8a4a), orchard: new THREE.Color(0x4f7f3a), sand: new THREE.Color(0xcdbf8a),
  haze: new THREE.Color(0x9fb8b0), river: new THREE.Color(0x5f96a8), sea: new THREE.Color(0x3f86b8),
};

const tmpW = new THREE.Color();

function farLand(): THREE.Mesh {
  const step = 200, reach = 12000;
  const x0 = DOMAIN.x0 - reach, y0 = DOMAIN.y0 - reach;
  const nx = Math.ceil((DOMAIN.x1 - DOMAIN.x0 + 2 * reach) / step), ny = Math.ceil((DOMAIN.y1 - DOMAIN.y0 + 2 * reach) / step);
  const pos = new Float32Array((nx + 1) * (ny + 1) * 3), col = new Float32Array((nx + 1) * (ny + 1) * 3);
  const c = new THREE.Color();
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    const x = x0 + i * step, y = y0 + j * step, k = (j * (nx + 1) + i) * 3;
    const out = Math.max(DOMAIN.x0 - x, x - DOMAIN.x1, DOMAIN.y0 - y, y - DOMAIN.y1, 0);
    const inside = out === 0;
    const { wet, sea } = backdropWet(x, y);
    // the land a hand above the water; the far rim rises gently so the eye reads distance
    const land = RIVER_LEVEL + 0.35 + smoothstep(4000, 14000, out) * 3;
    const h = inside ? -30 : land + (RIVER_LEVEL + 0.08 - land) * wet;   // water: its own surface, over the sea plane
    pos.set([x / U, h, y / U], k);
    // paddy blocks (each ~1.2 km a tone), dikes between, orchard strips, sand on the estuary's shore
    const bx = Math.floor(x / 1200), by = Math.floor(y / 900), t = hashAt(bx, by, 17);
    c.copy(C.rice).lerp(t < 0.35 ? C.ripe : t < 0.7 ? C.young : C.rice, 0.6);
    if (hashAt(bx, by, 29) > 0.8) c.copy(C.orchard);
    if (Math.abs(((x % 1200) + 1200) % 1200 - 600) > 560 || Math.abs(((y % 900) + 900) % 900 - 450) > 410) c.lerp(C.dike, 0.6);
    if (estuary(x, y) > 0.2) c.lerp(C.sand, 0.7);
    c.lerp(tmpW.copy(C.river).lerp(C.sea, sea), wet);
    c.lerp(C.haze, Math.min(0.55, out / 16000));
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
  return m;
}

/** Palm / dừa lines along the far canals and a few dikes. */
function palms(): { trunks: THREE.InstancedMesh; crowns: THREE.InstancedMesh } {
  const spots: { x: number; y: number; s: number }[] = [];
  const line = (a: { x: number; y: number }, b: { x: number; y: number }, off: number) => {
    const len = Math.hypot(b.x - a.x, b.y - a.y), n = Math.floor(len / 70);
    const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
    for (let i = 0; i < n; i++) {
      const t = (i + hashAt(i, off, 3) * 0.6) / n, x = a.x + (b.x - a.x) * t + nx * off, y = a.y + (b.y - a.y) * t + ny * off;
      const out = Math.max(DOMAIN.x0 - x, x - DOMAIN.x1, DOMAIN.y0 - y, y - DOMAIN.y1, 0);
      if (out < 200 || out > 9000 || backdropWater(x, y) || hashAt(x, y, 5) < 0.25) continue;
      spots.push({ x, y, s: 0.8 + hashAt(x, y, 9) * 0.6 });
    }
  };
  for (const c of FAR_CANALS) { line(c[0], c[1], 70); line(c[0], c[1], -70); }
  for (const r of [FAR_RIVER, WEST_RIVER]) for (let i = 0; i < r.length - 1; i++) { line(r[i], r[i + 1], 320); line(r[i], r[i + 1], -320); }
  // the world's rim: a tree line just past the channel round it
  const e = 1400;
  const rim = [{ x: DOMAIN.x0 - e, y: DOMAIN.y0 - e }, { x: DOMAIN.x1 + e, y: DOMAIN.y0 - e }, { x: DOMAIN.x1 + e, y: DOMAIN.y1 + e }, { x: DOMAIN.x0 - e, y: DOMAIN.y1 + e }];
  for (let i = 0; i < 4; i++) line(rim[i], rim[(i + 1) % 4], 0);
  const trunkGeo = new THREE.CylinderGeometry(0.12, 0.2, 5, 5).translate(0, 2.5, 0);
  const crownGeo = new THREE.ConeGeometry(2.2, 1.6, 6).translate(0, 5.2, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x7a5a3a, flatShading: true }), spots.length);
  const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshLambertMaterial({ color: 0x3f7a35, flatShading: true }), spots.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), ax = new THREE.Vector3(0, 1, 0);
  spots.forEach((o, i) => {
    q.setFromAxisAngle(ax, hashAt(o.x, o.y, 11) * Math.PI * 2);
    m.compose(p.set(o.x / U, RIVER_LEVEL + 0.3, o.y / U), q, s.setScalar(o.s * 1.6));
    trunks.setMatrixAt(i, m);
    crowns.setMatrixAt(i, m);
  });
  trunks.name = "backdrop-palms";
  return { trunks, crowns };
}

/** Three ridgelines on the north / east horizon (a quarter ring from west-north-west round to south-east). */
function ranges(): { mesh: THREE.Mesh; clouds: THREE.Mesh } {
  const cx = WORLD_W / 2, cy = WORLD_H / 2;
  const parts: THREE.BufferGeometry[] = [], cloudParts: THREE.BufferGeometry[] = [];
  const layers = [
    { r: 6800, h: 40, col: 0x5f7f78 }, { r: 9000, h: 65, col: 0x809e9e }, { r: 12000, h: 100, col: 0xa6bcc2 },
  ];
  const a0 = -Math.PI * 0.95, a1 = Math.PI * 0.2, n = 160;   // from the west-north-west over the north to the south-east
  const c = new THREE.Color();
  layers.forEach((L, li) => {
    const pos: number[] = [], cols: number[] = [], idx: number[] = [];
    const peakAt = (i: number) => Math.pow(Math.max(0, fbm(i / 9 + li * 13, li * 7.7, 4) * 0.9 + 0.55), 1.6) * L.h * (0.55 + 0.45 * Math.sin((i / n) * Math.PI));
    for (let i = 0; i <= n; i++) {
      const a = a0 + (a1 - a0) * (i / n);
      const peak = peakAt(i);
      const x = cx + Math.cos(a) * L.r, y = cy + Math.sin(a) * L.r * 0.8;
      // both ends taper down into the haze (the west end most: it shows past the estuary), no cut against the sky
      const tn = i / n, env = smoothstep(0, 0.3, tn) * smoothstep(0, 0.15, 1 - tn);
      pos.push(x / U, -2, y / U, x / U, RIVER_LEVEL - 1 + (7 + peak) * env, y / U);
      c.set(L.col).lerp(C.haze, 1 - env);
      cols.push(c.r * 0.85, c.g * 0.85, c.b * 0.85);
      c.lerp(new THREE.Color(0xe6eef0), li === 2 ? 0.35 : peak > L.h * 0.8 ? 0.25 : 0);   // pale tops far off
      cols.push(c.r, c.g, c.b);
      if (i < n) { const b = i * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
      // cloud caps on the high peaks toward Núi Mây Xanh (the north-east)
      // (on a summit only: higher than both neighbours; the cap sits on it, wrapped round the ridge)
      if (li < 2 && peak > L.h * 0.6 && peak > peakAt(i - 1) && peak > peakAt(i + 1) && a > -Math.PI * 0.6 && a < 0) {
        const cl = new THREE.IcosahedronGeometry(1, 1).scale(L.h * 0.3, L.h * 0.07, L.h * 0.3);
        cl.translate(x / U, RIVER_LEVEL + 6 + peak - L.h * 0.02, y / U);
        cloudParts.push(cl);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
    g.setIndex(idx);
    parts.push(g);
  });
  const mesh = new THREE.Mesh(mergeGeometries(parts)!, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false }));
  mesh.name = "backdrop-ranges";
  parts.forEach((p) => p.dispose());
  const clouds = new THREE.Mesh(cloudParts.length ? mergeGeometries(cloudParts.map((g) => g.toNonIndexed()))! : new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({ color: 0xf4f7f8, transparent: true, opacity: 0.85, fog: false }));
  clouds.name = "backdrop-clouds";
  cloudParts.forEach((p) => p.dispose());
  return { mesh, clouds };
}

export interface Backdrop {
  /** The far land (uses the terrain's material: set it on `land.material`). */
  land: THREE.Mesh;
  root: THREE.Group;
  /** The far ranges and their clouds take the sky: haze toward the horizon colour, dark at night. */
  tint(horizon: THREE.Color, night: number): void;
  dispose(): void;
}

export function buildBackdrop(): Backdrop {
  const land = farLand();
  const root = new THREE.Group();
  root.name = "backdrop";
  const { trunks, crowns } = palms();
  const { mesh, clouds } = ranges();
  root.add(trunks, crowns, mesh, clouds);
  for (const o of [trunks, crowns, mesh, clouds, land]) { o.matrixAutoUpdate = false; o.updateMatrix(); o.frustumCulled = o !== trunks && o !== crowns; }
  const rm = mesh.material as THREE.MeshBasicMaterial, cm = clouds.material as THREE.MeshBasicMaterial;
  const white = new THREE.Color(1, 1, 1);
  return {
    land, root,
    tint(horizon, night) {
      rm.color.copy(white).lerp(horizon, 0.25).multiplyScalar(1 - 0.75 * night);
      cm.color.copy(white).lerp(horizon, 0.3).multiplyScalar(1 - 0.7 * night);
    },
    dispose() {
      land.geometry.dispose();
      root.traverse((o) => {
        const x = o as THREE.Mesh;
        if (!x.isMesh) return;
        x.geometry.dispose();
        (x.material as THREE.Material).dispose();
      });
    },
  };
}
