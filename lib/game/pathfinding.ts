import type { GameMap } from "@/lib/game/maps/types";
import type { Vec } from "@/lib/game/types";
import { cellBlocked, isBlockedAt } from "@/lib/game/movement";

export const MAX_PATH_POINTS = 32;

export function cellCenter(map: GameMap, c: number, r: number): Vec {
  return { x: c * map.cell + map.cell / 2, y: r * map.cell + map.cell / 2 };
}

export function nearestWalkableCell(map: GameMap, c: number, r: number, radius = 3): { c: number; r: number } | null {
  let best: { c: number; r: number } | null = null;
  let bestD = Infinity;
  for (let dr = -radius; dr <= radius; dr++) for (let dc = -radius; dc <= radius; dc++) {
    const cc = c + dc, rr = r + dr;
    if (cellBlocked(map, cc, rr)) continue;
    const d = dc * dc + dr * dr;
    if (d < bestD) { bestD = d; best = { c: cc, r: rr }; }
  }
  return best;
}

class MinHeap {
  private ids: number[] = [];
  private pri: number[] = [];
  get size(): number { return this.ids.length; }
  push(id: number, p: number): void {
    this.ids.push(id);
    this.pri.push(p);
    let i = this.ids.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.pri[parent] <= this.pri[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }
  pop(): number {
    const top = this.ids[0];
    const lastId = this.ids.pop()!, lastP = this.pri.pop()!;
    if (this.ids.length > 0) {
      this.ids[0] = lastId;
      this.pri[0] = lastP;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < this.ids.length && this.pri[l] < this.pri[m]) m = l;
        if (r < this.ids.length && this.pri[r] < this.pri[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number): void {
    [this.ids[a], this.ids[b]] = [this.ids[b], this.ids[a]];
    [this.pri[a], this.pri[b]] = [this.pri[b], this.pri[a]];
  }
}

/** A* over the 8-px grid (8 neighbours, no corner cutting, octile heuristic).
 *  Returns cell-centre waypoints (start cell excluded) ending exactly at `to` when it is free;
 *  a blocked target snaps to the nearest walkable cell within 3 cells; unreachable → null. */
export function findPath(map: GameMap, from: Vec, to: Vec, maxNodes = 5000): Vec[] | null {
  const cols = map.cols;
  const sc = Math.floor(from.x / map.cell), sr = Math.floor(from.y / map.cell);
  let gc = Math.floor(to.x / map.cell), gr = Math.floor(to.y / map.cell);
  let exactEnd: Vec | null = isBlockedAt(map, to.x, to.y) ? null : { x: to.x, y: to.y };
  if (cellBlocked(map, gc, gr)) {
    const alt = nearestWalkableCell(map, gc, gr, 3);
    if (!alt) return null;
    gc = alt.c;
    gr = alt.r;
    exactEnd = null;
  }
  const goalPoint = exactEnd ?? cellCenter(map, gc, gr);
  if (sc === gc && sr === gr) return [goalPoint];
  const n = cols * map.rows;
  const g = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const heap = new MinHeap();
  const start = sr * cols + sc, goal = gr * cols + gc;
  const h = (c: number, r: number) => {
    const dx = Math.abs(c - gc), dy = Math.abs(r - gr);
    return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
  };
  g[start] = 0;
  heap.push(start, h(sc, sr));
  let expanded = 0;
  while (heap.size > 0) {
    const cur = heap.pop();
    if (cur === goal) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (++expanded > maxNodes) return null;
    const cc = cur % cols, cr = (cur - cc) / cols;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (dc === 0 && dr === 0) continue;
      const nc = cc + dc, nr = cr + dr;
      if (cellBlocked(map, nc, nr)) continue;
      if (dc !== 0 && dr !== 0 && (cellBlocked(map, cc + dc, cr) || cellBlocked(map, cc, cr + dr))) continue;
      const ni = nr * cols + nc;
      if (closed[ni]) continue;
      const ng = g[cur] + (dc !== 0 && dr !== 0 ? Math.SQRT2 : 1);
      if (ng < g[ni]) {
        g[ni] = ng;
        came[ni] = cur;
        heap.push(ni, ng + h(nc, nr));
      }
    }
  }
  if (came[goal] === -1) return null;
  const pts: Vec[] = [];
  for (let i = goal; i !== start; i = came[i]) {
    const c = i % cols;
    pts.push(cellCenter(map, c, (i - c) / cols));
  }
  pts.reverse();
  pts[pts.length - 1] = goalPoint;
  return pts;
}

/** Can the feet box travel in a straight line from a to b? (sampled every 2 px) */
export function lineClear(map: GameMap, a: Vec, b: Vec): boolean {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 2));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    if (isBlockedAt(map, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) return false;
  }
  return true;
}

/** Greedy string-pulling: keep only the waypoints needed to stay in line of sight (≤ 32 points). */
export function smoothPath(map: GameMap, from: Vec, points: Vec[]): Vec[] {
  const out: Vec[] = [];
  let anchor = from;
  let i = 0;
  while (i < points.length) {
    let j = points.length - 1;
    while (j > i && !lineClear(map, anchor, points[j])) j--;
    out.push(points[j]);
    anchor = points[j];
    i = j + 1;
  }
  return out.length > MAX_PATH_POINTS ? out.slice(0, MAX_PATH_POINTS) : out;
}
