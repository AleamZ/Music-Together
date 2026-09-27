import { cellOf, isPondWater, pondSpotKind } from "@/lib/game/fishing/shore";
import { POND_CELL, POND_H, POND_W } from "@/lib/game/maps/pond";
import type { Facing, Vec } from "@/lib/game/types";

// v18.10: where on the pond one may jump in, warm up and be pulled out. Pure; the server checks the same cells with
// `_pond_spot` (0031).

const COLS = POND_W / POND_CELL, ROWS = POND_H / POND_CELL;
const centre = (i: number) => i * POND_CELL + POND_CELL / 2;
const STEP: Record<Facing, { dc: number; dr: number }> = {
  up: { dc: 0, dr: -1 }, down: { dc: 0, dr: 1 }, left: { dc: -1, dr: 0 }, right: { dc: 1, dr: 0 },
};

/** The pond cell I stand on when it is a shore or dock cell by the water (where the actions are offered), else null. */
export function edgeCell(feet: Vec): { col: number; row: number } | null {
  const { col, row } = cellOf(feet);
  return pondSpotKind(col, row) ? { col, row } : null;
}

/** Where a jump from `feet` lands: the water cell next to mine (the one I face first), at its centre; null if none. */
export function jumpTarget(feet: Vec, facing: Facing): Vec | null {
  const { col, row } = cellOf(feet);
  if (!pondSpotKind(col, row)) return null;
  const order: Facing[] = [facing, "up", "left", "right", "down"];
  for (const f of order) {
    const c = col + STEP[f].dc, r = row + STEP[f].dr;
    if (isPondWater(c, r)) return { x: centre(c), y: centre(r) };
  }
  return null;
}

/** The shore (or dock) cell centre nearest to `p`: where a rescued swimmer is set down. */
export function nearestEdge(p: Vec): Vec | null {
  let best: Vec | null = null, bestD = Infinity;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (!pondSpotKind(c, r)) continue;
    const x = centre(c), y = centre(r), d = (x - p.x) ** 2 + (y - p.y) ** 2;
    if (d < bestD) { bestD = d; best = { x, y }; }
  }
  return best;
}
