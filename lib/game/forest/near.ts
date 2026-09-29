// Which tree I would chop (0096): the rừng tràm's drawn trees (scenery.ts scatterTrees, kind "tram") on forest cells of
// the server's grid, numbered 0…7 per cell in scatter order — the server knows a tree only as "cx:cy:k" on a forest
// cell within one cell of me, so this is the client's pick of a real, visible tree for that key.
import { scatterTrees } from "@/lib/game/world/scenery";
import { FOREST_CELL, forestAt } from "@/lib/game/world/forest-grid";

export interface NearTree { cx: number; cy: number; k: number; x: number; y: number; d: number }

/** At most this many trees a cell (the server takes k 0…7). */
export const TREES_PER_CELL = 8;
/** How close (px) I must stand to a tree to chop it. */
export const CHOP_REACH = 44;

let byCell: Map<string, Array<{ x: number; y: number }>> | null = null;

/** The choppable trees of a cell (cached for the world). */
export function cellTrees(cx: number, cy: number): ReadonlyArray<{ x: number; y: number }> {
  if (!byCell) {
    byCell = new Map();
    for (const t of scatterTrees()) {
      if (t.kind !== "tram") continue;
      const tx = Math.floor(t.x / FOREST_CELL), ty = Math.floor(t.y / FOREST_CELL);
      if (!forestAt(tx, ty)) continue;
      const key = `${tx}:${ty}`;
      const list = byCell.get(key) ?? [];
      if (list.length < TREES_PER_CELL) list.push({ x: t.x, y: t.y });
      byCell.set(key, list);
    }
  }
  return byCell.get(`${cx}:${cy}`) ?? [];
}

/** The nearest choppable tree within `reach` px of (x, y), or null. */
export function nearestTree(x: number, y: number, reach = CHOP_REACH): NearTree | null {
  const cx0 = Math.floor(x / FOREST_CELL), cy0 = Math.floor(y / FOREST_CELL);
  let best: NearTree | null = null;
  for (let cy = cy0 - 1; cy <= cy0 + 1; cy++) for (let cx = cx0 - 1; cx <= cx0 + 1; cx++) {
    cellTrees(cx, cy).forEach((t, k) => {
      const d = Math.hypot(t.x - x, t.y - y);
      if (d <= reach && (!best || d < best.d)) best = { cx, cy, k, x: t.x, y: t.y, d };
    });
  }
  return best;
}

/** 0097: the world px of felled trees ("cx:cy:k" keys), for the 3D Forest's stumps. */
export function felledPoints(keys: readonly string[]): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (const key of keys) {
    const [cx, cy, k] = key.split(":").map(Number);
    const t = cellTrees(cx, cy)[k];
    if (t) out.push({ x: t.x, y: t.y });
  }
  return out;
}
