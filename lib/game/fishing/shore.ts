import { inPond, onPlatform, POND_CELL, POND_H, POND_SOLIDS, POND_W } from "@/lib/game/maps/pond";
import { overlaps } from "@/lib/game/maps/rect";
import type { GameMap, Interactable } from "@/lib/game/maps/types";
import type { Facing, Vec } from "@/lib/game/types";

// v18.1 Câu gần bờ: where on the pond map a cast may start. Mirrors `_pond_spot` of 0031_pond_life.sql cell for cell
// (tests/unit/pond-shore.test.ts pins the constants): a cell is judged at its centre, like buildPondMap. Pure.

export type CastSpot = "dock" | "shore";

const COLS = POND_W / POND_CELL, ROWS = POND_H / POND_CELL;

/** 4-neighbours, in the order a shore cast prefers to face them. */
const NEIGHBOURS: ReadonlyArray<{ dc: number; dr: number; face: Facing }> = [
  { dc: 0, dr: -1, face: "up" }, { dc: -1, dr: 0, face: "left" }, { dc: 1, dr: 0, face: "right" }, { dc: 0, dr: 1, face: "down" },
];

const centre = (i: number) => i * POND_CELL + POND_CELL / 2;
const inGrid = (c: number, r: number) => c >= 0 && r >= 0 && c < COLS && r < ROWS;

/** Is pond cell (c, r) open water (in the pond, off the Cầu ao platform)? */
export function isPondWater(c: number, r: number): boolean {
  if (!inGrid(c, r)) return false;
  const x = centre(c), y = centre(r);
  return inPond(x, y, 6) && !onPlatform(x, y);
}

/** The kind of cast spot pond cell (c, r) is: "dock" on the platform, "shore" on other walkable ground, each only next to
 *  water (4-neighbours); null otherwise. */
export function pondSpotKind(c: number, r: number): CastSpot | null {
  if (!inGrid(c, r)) return null;
  const x = centre(c), y = centre(r);
  const dock = onPlatform(x, y);
  if (!dock) {
    if (inPond(x, y, 6)) return null;
    const cell = { x: c * POND_CELL, y: r * POND_CELL, w: POND_CELL, h: POND_CELL };
    if (POND_SOLIDS.some((s) => overlaps(s, cell))) return null;
  }
  return NEIGHBOURS.some((n) => isPondWater(c + n.dc, r + n.dr)) ? (dock ? "dock" : "shore") : null;
}

/** The cell the feet stand in. */
export function cellOf(p: Vec): { col: number; row: number } {
  return { col: Math.floor(p.x / POND_CELL), row: Math.floor(p.y / POND_CELL) };
}

/**
 * The cast prompt when my feet stand on a pond cast cell and no map spot is in range: a fish_spot whose use point is
 * where I stand, facing a water neighbour (my facing first when it looks at water). Null anywhere else.
 */
export function shoreInteractable(map: GameMap, feet: Vec, facing: Facing): Interactable | null {
  if (map.id !== "pond") return null;
  const { col, row } = cellOf(feet);
  const kind = pondSpotKind(col, row);
  if (!kind) return null;
  const order = [...NEIGHBOURS].sort((a, b) => Number(b.face === facing) - Number(a.face === facing));
  const n = order.find((q) => isPondWater(col + q.dc, row + q.dr));
  if (!n) return null;
  const use = { x: Math.round(feet.x), y: Math.round(feet.y) };
  return {
    id: `${kind}_${col}_${row}`, kind: "fish_spot", label: kind === "shore" ? "Bờ ao" : "Cầu ao",
    prompt: kind === "shore" ? "Quăng cần ở bờ (ít cá cắn)" : "Quăng cần",
    rect: { x: col * POND_CELL, y: row * POND_CELL, w: POND_CELL, h: POND_CELL }, use, face: n.face,
  };
}

/** The water cell centre nearest to `p` (null when the map has none): where an angler pulled in by a fish surfaces. */
export function nearestWater(p: Vec): Vec | null {
  let best: Vec | null = null, bestD = Infinity;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (!isPondWater(c, r)) continue;
    const x = centre(c), y = centre(r), d = (x - p.x) ** 2 + (y - p.y) ** 2;
    if (d < bestD) { bestD = d; best = { x, y }; }
  }
  return best;
}

/** Every open-water cell of the pond (the leaping fish pick one). */
export function pondWaterCells(): Vec[] {
  const out: Vec[] = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (isPondWater(c, r)) out.push({ x: centre(c), y: centre(r) });
  return out;
}
