// Pure: the zones' cure for z-fighting. The dioramas are built from hundreds of axis-aligned boxes; wherever two of them
// have a face in the same plane (a trim strip flush with a wall, a sign panel flush with its frame, a plank line lying
// on a deck) and those faces overlap, the depth buffer cannot tell which is in front and the surface flickers as the
// camera moves ("chớp layer"). Two faces a hair apart flicker too, from far enough away. `separateCoplanar` finds every
// such pair and pushes the smaller box's face out past the bigger one's by `sep` — so the detail (the trim, the panel,
// the plank) always wins, by a margin the depth buffer resolves at the views' distances.

/** An axis-aligned box: min corner (x, y, z) and size (w, d, h) along x, y, z. Units are the caller's. */
export interface AABB { x: number; y: number; z: number; w: number; d: number; h: number }

type Axis = 0 | 1 | 2;
const lo = (b: AABB, a: Axis) => (a === 0 ? b.x : a === 1 ? b.y : b.z);
const len = (b: AABB, a: Axis) => (a === 0 ? b.w : a === 1 ? b.d : b.h);
function setSpan(b: AABB, a: Axis, min: number, size: number): void {
  if (a === 0) { b.x = min; b.w = size; } else if (a === 1) { b.y = min; b.d = size; } else { b.z = min; b.h = size; }
}
const vol = (b: AABB) => b.w * b.d * b.h;

/** Do the two boxes' faces normal to `axis` overlap (positive area in the other two axes)? */
function faceOverlap(a: AABB, b: AABB, axis: Axis): boolean {
  for (const o of [0, 1, 2] as const) {
    if (o === axis) continue;
    const a0 = lo(a, o), a1 = a0 + len(a, o), b0 = lo(b, o), b1 = b0 + len(b, o);
    if (Math.min(a1, b1) - Math.max(a0, b0) <= 1e-6) return false;
  }
  return true;
}

/**
 * Push apart every pair of same-facing faces closer than `sep` that overlap: the smaller box (by volume) grows past the
 * bigger one's face by `sep`. In place; returns how many faces moved. `cell` buckets the boxes (the caller's units) so
 * big layouts stay fast; `skip` leaves boxes out (e.g. hidden or roof pieces that fade).
 */
export function separateCoplanar<T extends AABB>(boxes: T[], sep: number, cell: number, skip?: (b: T) => boolean): number {
  const list = skip ? boxes.filter((b) => !skip(b)) : boxes.slice();
  const grid = new Map<string, number[]>();
  const cellsOf = (b: AABB, pad: number): string[] => {
    const out: string[] = [];
    const x0 = Math.floor((b.x - pad) / cell), x1 = Math.floor((b.x + b.w + pad) / cell);
    const y0 = Math.floor((b.y - pad) / cell), y1 = Math.floor((b.y + b.d + pad) / cell);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) out.push(`${cx},${cy}`);
    return out;
  };
  list.forEach((b, i) => { for (const k of cellsOf(b, sep)) { const l = grid.get(k); if (l) l.push(i); else grid.set(k, [i]); } });
  let moved = 0;
  for (let pass = 0; pass < 6; pass++) {
    let changed = 0;
    const seen = new Set<number>();
    for (const l of grid.values()) {
      for (let p = 0; p < l.length; p++) for (let q = p + 1; q < l.length; q++) {
        const i = Math.min(l[p], l[q]), j = Math.max(l[p], l[q]);
        const key = i * 1_000_003 + j;
        if (seen.has(key)) continue;
        seen.add(key);
        const A = list[i], B = list[j];
        const [small, big] = vol(A) <= vol(B) ? [A, B] : [B, A];
        for (const axis of [0, 1, 2] as const) {
          if (!faceOverlap(small, big, axis)) continue;
          const s0 = lo(small, axis), s1 = s0 + len(small, axis), b0 = lo(big, axis), b1 = b0 + len(big, axis);
          // the + face (max side): too close → the small box's max goes past the big one's by sep
          if (Math.abs(s1 - b1) < sep - 1e-6) { setSpan(small, axis, s0, b1 + sep - s0); changed++; }
          // the − face (min side)
          const n0 = lo(small, axis), n1 = n0 + len(small, axis);
          if (Math.abs(n0 - b0) < sep - 1e-6) { setSpan(small, axis, b0 - sep, n1 - (b0 - sep)); changed++; }
        }
      }
    }
    moved += changed;
    if (!changed) break;
  }
  return moved;
}

