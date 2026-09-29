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

/** A chunk's mesh as plain arrays (world units, absolute: px / 16) — built on the main thread or in the terrain worker. */
export interface ChunkArrays { pos: Float32Array; nor: Float32Array; col: Float32Array; idx: Uint16Array | Uint32Array }

/** The coarsest step: every level's rim follows this grid (linearly between its samples), so neighbours at different
 *  levels share the same edge line, normals and colours — no cracks and no seam lines between LODs. */
const RIM_STEP = LOD_STEPS[LOD_STEPS.length - 1];

interface Sample { h: number; n: [number, number, number]; c: [number, number, number] }

/** A vertex exactly as the coarsest level computes it (its height, central-difference normal and colour). */
function coarseSample(x: number, y: number, c: THREE.Color, v3: THREE.Vector3): Sample {
  const s = RIM_STEP, u = s / 16;
  const h = meshHeight(x, y);
  const dx = meshHeight(x + s, y) - meshHeight(x - s, y), dz = meshHeight(x, y + s) - meshHeight(x, y - s);
  v3.set(-dx, 2 * u, -dz).normalize();
  landColor(x, y, h, Math.hypot(dx, dz) / (2 * u), c);
  return { h, n: [v3.x, v3.y, v3.z], c: [c.r, c.g, c.b] };
}

/** The chunk's mesh arrays at a step (px): an (n+1)² grid plus a skirt hanging from its rim. */
export function chunkArrays(chunk: number, step: number): ChunkArrays {
  const cx = chunk % CHUNKS_X, cy = Math.floor(chunk / CHUNKS_X);
  const x0 = DOMAIN.x0 + cx * CHUNK_PX, y0 = DOMAIN.y0 + cy * CHUNK_PX;
  const n = CHUNK_PX / step;
  const N = n + 3;                                     // with a one-sample border for the normals
  const H = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) H[j * N + i] = meshHeight(x0 + (i - 1) * step, y0 + (j - 1) * step);
  const verts = (n + 1) * (n + 1), rim = 4 * n;
  const pos = new Float32Array((verts + rim) * 3), nor = new Float32Array((verts + rim) * 3), col = new Float32Array((verts + rim) * 3);
  const u = step / 16, v3 = new THREE.Vector3(), c = new THREE.Color();
  const cache = new Map<number, Sample>();
  const coarse = (x: number, y: number): Sample => {
    const key = x * 100003 + y;
    let s = cache.get(key);
    if (!s) { s = coarseSample(x, y, c, v3); cache.set(key, s); }
    return s;
  };
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const k = j * (n + 1) + i, x = x0 + i * step, y = y0 + j * step;
    if (i === 0 || j === 0 || i === n || j === n) {
      // on the rim: between the two coarse samples along this edge
      const alongX = j === 0 || j === n;
      const off = alongX ? x - x0 : y - y0, a = Math.floor(off / RIM_STEP) * RIM_STEP, t = (off - a) / RIM_STEP;
      const A = alongX ? coarse(x0 + a, y) : coarse(x, y0 + a);
      const B = t > 0 ? (alongX ? coarse(x0 + a + RIM_STEP, y) : coarse(x, y0 + a + RIM_STEP)) : A;
      pos.set([x / 16, A.h + (B.h - A.h) * t, y / 16], k * 3);
      v3.set(A.n[0] + (B.n[0] - A.n[0]) * t, A.n[1] + (B.n[1] - A.n[1]) * t, A.n[2] + (B.n[2] - A.n[2]) * t).normalize();
      nor.set([v3.x, v3.y, v3.z], k * 3);
      col.set([A.c[0] + (B.c[0] - A.c[0]) * t, A.c[1] + (B.c[1] - A.c[1]) * t, A.c[2] + (B.c[2] - A.c[2]) * t], k * 3);
      continue;
    }
    const hi = (j + 1) * N + (i + 1);
    const h = H[hi];
    pos.set([x / 16, h, y / 16], k * 3);
    const dx = H[hi + 1] - H[hi - 1], dz = H[hi + N] - H[hi - N];
    v3.set(-dx, 2 * u, -dz).normalize();
    nor.set([v3.x, v3.y, v3.z], k * 3);
    landColor(x, y, h, Math.hypot(dx, dz) / (2 * u), c);
    col.set([c.r, c.g, c.b], k * 3);
  }
  // the skirt: the rim's vertices again, SKIRT units lower (same colour: it only ever shows through a crack)
  const rimIdx: number[] = [];
  for (let i = 0; i < n; i++) rimIdx.push(i);                               // north, west → east
  for (let j = 0; j < n; j++) rimIdx.push(j * (n + 1) + n);                 // east, north → south
  for (let i = n; i > 0; i--) rimIdx.push(n * (n + 1) + i);                 // south, east → west
  for (let j = n; j > 0; j--) rimIdx.push(j * (n + 1));                     // west, south → north
  rimIdx.forEach((src, r) => {
    const k = verts + r;
    pos.set([pos[src * 3], pos[src * 3 + 1] - SKIRT, pos[src * 3 + 2]], k * 3);
    nor.set([nor[src * 3], nor[src * 3 + 1], nor[src * 3 + 2]], k * 3);
    col.set([col[src * 3], col[src * 3 + 1], col[src * 3 + 2]], k * 3);
  });
  const total = (n * n * 6) + rim * 12;
  const idx = verts + rim > 65535 ? new Uint32Array(total) : new Uint16Array(total);
  let w = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = j * (n + 1) + i, b = a + 1, d = a + n + 1, e = d + 1;
    idx[w++] = a; idx[w++] = d; idx[w++] = b; idx[w++] = b; idx[w++] = d; idx[w++] = e;
  }
  for (let r = 0; r < rim; r++) {
    const a = rimIdx[r], b = rimIdx[(r + 1) % rim], a2 = verts + r, b2 = verts + ((r + 1) % rim);
    for (const v of [a, b, a2, b, b2, a2, a, a2, b, b, a2, b2]) idx[w++] = v;  // both faces: the skirt may be seen from either side
  }
  return { pos, nor, col, idx };
}

/** Arrays → a geometry (the worker's result, or a main-thread build). */
export function geometryFromArrays(a: ChunkArrays): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(a.pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(a.nor, 3));
  g.setAttribute("color", new THREE.BufferAttribute(a.col, 3));
  g.setIndex(new THREE.BufferAttribute(a.idx, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/** The chunk (cx, cy)'s mesh geometry at a step (px), built here and now. */
export function chunkGeometry(chunk: number, step: number): THREE.BufferGeometry {
  return geometryFromArrays(chunkArrays(chunk, step));
}
