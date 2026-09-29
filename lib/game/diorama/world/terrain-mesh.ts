import * as THREE from "three";
import { cumulative, nearestOn, ROADS, TRAILS } from "@/lib/game/world/roads";
import { CHUNK_PX, CHUNKS_X } from "@/lib/game/world/scenery";
import {
  DOMAIN, fbm, heightAt, rectDistance, riverAt, RIVER_BANK, smoothstep, streamAt, STREAM_HALF_W, zoneUnder,
} from "@/lib/game/world/terrain";
import { ZONE_IDS } from "@/lib/game/world/zones";

// Browser only: the heightmap (lib/game/world/terrain.ts) as chunk meshes. Each chunk is CHUNK_PX square, meshed at
// one of three steps (8/16/32 px) by the distance to the camera, with a skirt hanging from its rim so neighbours at
// another step never show a crack. Vertex colours paint the land: meadow greens with patches, the darker forest
// floor, sand at the water's edge, rock on the cliffs and peaks, the roads' dirt. Inside a zone the land sinks under
// the zone's own diorama.

export const LOD_STEPS = [8, 16, 32] as const;
const SKIRT = 3;
/** The land inside a zone sits this far below the zone's ground (hidden under its plinth). */
const UNDER_ZONE = 0.45;

const C = {
  meadow: new THREE.Color(0x86b64c), meadowDark: new THREE.Color(0x5f9a3c), hay: new THREE.Color(0xb7c064),
  forest: new THREE.Color(0x4a7f36), zoneGrass: new THREE.Color(0x6aa23c), sand: new THREE.Color(0xdcc38c),
  bed: new THREE.Color(0x5b7f70), rock: new THREE.Color(0x9c9a86), rockDark: new THREE.Color(0x7f8270),
  peak: new THREE.Color(0xc9c7bd), road: new THREE.Color(0xc79a5f), trail: new THREE.Color(0xb89c6c),
};

interface PathGeo { pts: readonly { x: number; y: number }[]; cum: number[]; hw: number; trail: boolean }
const PATHS: PathGeo[] = [
  ...ROADS.map((r) => ({ pts: r.pts, cum: cumulative(r.pts), hw: r.w / 2, trail: false })),
  ...TRAILS.map((r) => ({ pts: r.pts, cum: cumulative(r.pts), hw: r.w / 2, trail: true })),
];

const tmp = new THREE.Color();

/** The land's colour at px (x, y), height h, slope s (rise over run). */
export function landColor(x: number, y: number, h: number, s: number, out: THREE.Color): THREE.Color {
  const n = fbm(x / 260, y / 260, 3), n2 = fbm(x / 90 + 40, y / 90, 2);
  out.copy(C.meadow).lerp(C.meadowDark, smoothstep(-0.25, 0.35, n));
  out.lerp(C.hay, smoothstep(0.25, 0.55, n2) * 0.45);
  const forest = smoothstep(-0.12, 0.32, fbm(x / 430 + 5, y / 430 - 3, 3));
  out.lerp(C.forest, forest * 0.55 + smoothstep(600, 300, y) * 0.3);
  // near a zone: its own grass, so the plinth's edge melts in
  let dz = Infinity;
  for (const id of ZONE_IDS) dz = Math.min(dz, rectDistance(id, x, y));
  out.lerp(C.zoneGrass, (1 - smoothstep(0, 48, dz)) * 0.8);
  // rock on the cliffs and up the mountains, pale on the peaks
  out.lerp(tmp.copy(C.rock).lerp(C.rockDark, smoothstep(-0.3, 0.3, n2)), Math.max(smoothstep(0.9, 1.8, s), smoothstep(20, 34, h) * 0.8));
  out.lerp(C.peak, smoothstep(30, 46, h) * 0.8);
  // water's edge: sand, the bed under it
  const r = riverAt(x, y);
  if (!r.inZone && r.d < r.hw + 34) out.lerp(r.d < r.hw - 6 ? C.bed : C.sand, r.d < r.hw - 6 ? 1 : 1 - smoothstep(r.hw + 14, r.hw + 34, r.d));
  const st = streamAt(x, y);
  if (st.d < STREAM_HALF_W + 12) out.lerp(st.d < STREAM_HALF_W - 3 ? C.bed : C.sand, 1 - smoothstep(STREAM_HALF_W + 4, STREAM_HALF_W + 12, st.d));
  // roads and trails
  for (const p of PATHS) {
    const d = nearestOn(p.pts, p.cum, x, y).d;
    if (d < p.hw + 6) out.lerp(p.trail ? C.trail : C.road, 1 - smoothstep(p.hw - 3, p.hw + 6, d));
  }
  if (h < RIVER_BANK - 0.1 && r.d > r.hw) out.lerp(C.bed, 0.3);
  return out;
}

/** The renderer's height: the terrain, sunk inside the zones. */
export function meshHeight(x: number, y: number): number {
  const h = heightAt(x, y);
  return zoneUnder(x, y) ? h - UNDER_ZONE : h;
}

/** The chunk (cx, cy)'s mesh geometry at a step (px); world units, absolute (px / 16). */
export function chunkGeometry(chunk: number, step: number): THREE.BufferGeometry {
  const cx = chunk % CHUNKS_X, cy = Math.floor(chunk / CHUNKS_X);
  const x0 = DOMAIN.x0 + cx * CHUNK_PX, y0 = DOMAIN.y0 + cy * CHUNK_PX;
  const n = CHUNK_PX / step;
  const N = n + 3;                                     // with a one-sample border for the normals
  const H = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) H[j * N + i] = meshHeight(x0 + (i - 1) * step, y0 + (j - 1) * step);
  const verts = (n + 1) * (n + 1), rim = 4 * n;
  const pos = new Float32Array((verts + rim) * 3), nor = new Float32Array((verts + rim) * 3), col = new Float32Array((verts + rim) * 3);
  const u = step / 16, v3 = new THREE.Vector3(), c = new THREE.Color();
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const k = j * (n + 1) + i, hi = (j + 1) * N + (i + 1);
    const h = H[hi], x = x0 + i * step, y = y0 + j * step;
    pos.set([x / 16, h, y / 16], k * 3);
    const dx = H[hi + 1] - H[hi - 1], dz = H[hi + N] - H[hi - N];
    v3.set(-dx, 2 * u, -dz).normalize();
    nor.set([v3.x, v3.y, v3.z], k * 3);
    const s = Math.hypot(dx, dz) / (2 * u);
    landColor(x, y, h, s, c);
    col.set([c.r, c.g, c.b], k * 3);
  }
  // the skirt: the rim's vertices again, SKIRT units lower
  const rimIdx: number[] = [];
  for (let i = 0; i < n; i++) rimIdx.push(i);                               // north, west → east
  for (let j = 0; j < n; j++) rimIdx.push(j * (n + 1) + n);                 // east, north → south
  for (let i = n; i > 0; i--) rimIdx.push(n * (n + 1) + i);                 // south, east → west
  for (let j = n; j > 0; j--) rimIdx.push(j * (n + 1));                     // west, south → north
  rimIdx.forEach((src, r) => {
    const k = verts + r;
    pos.set([pos[src * 3], pos[src * 3 + 1] - SKIRT, pos[src * 3 + 2]], k * 3);
    nor.set([nor[src * 3], nor[src * 3 + 1], nor[src * 3 + 2]], k * 3);
    col.set([col[src * 3] * 0.8, col[src * 3 + 1] * 0.8, col[src * 3 + 2] * 0.8], k * 3);
  });
  const idx: number[] = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = j * (n + 1) + i, b = a + 1, d = a + n + 1, e = d + 1;
    idx.push(a, d, b, b, d, e);
  }
  for (let r = 0; r < rim; r++) {
    const a = rimIdx[r], b = rimIdx[(r + 1) % rim], a2 = verts + r, b2 = verts + ((r + 1) % rim);
    idx.push(a, b, a2, b, b2, a2, a, a2, b, b, a2, b2);                     // both faces: the skirt may be seen from either side
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setIndex(verts + rim > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}
