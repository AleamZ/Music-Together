import { FOREST_GRID } from "./forest-grid.data";
import { inTramForest } from "./scenery";
import { WORLD_H, WORLD_W } from "./zones";

// The rừng tràm as the SERVER knows it: a 64 px grid over the world, a cell being forest when its centre is
// (scenery.ts inTramForest). supabase/migrations/0096_forest_professions.sql seeds public.world_forest from the same
// rows (forest-grid.data.ts); tests/unit/forest-grid.test.ts pins the data equal to inTramForest AND to the migration.
// If the terrain changes the forest, WRITE_FOREST_GRID=1 vitest tests/unit/forest-grid.test.ts rewrites the data file
// and a new migration must re-seed world_forest (the server's rules follow this grid, not the drawn trees).
//   * wild animals spawn only on a CORE cell (it and its 8 neighbours forest: the wander path, ≤ 60 px, stays in);
//   * hunting / trapping / photographing and chopping need the player NEAR the forest (their cell or a neighbour);
//   * a choppable tree stands on a forest cell.

export const FOREST_CELL = 64;
export const FOREST_COLS = Math.ceil(WORLD_W / FOREST_CELL);
export const FOREST_ROWS = Math.ceil(WORLD_H / FOREST_CELL);

/** The grid from the scenery (slow-ish: ~2 300 noise samples) — the generator and the pin. */
export function computeForestGrid(): string[] {
  const rows: string[] = [];
  for (let cy = 0; cy < FOREST_ROWS; cy++) {
    let r = "";
    for (let cx = 0; cx < FOREST_COLS; cx++) r += inTramForest((cx + 0.5) * FOREST_CELL, (cy + 0.5) * FOREST_CELL) ? "1" : "0";
    rows.push(r);
  }
  return rows;
}

export const forestCellOf = (x: number, y: number): { cx: number; cy: number } =>
  ({ cx: Math.floor(x / FOREST_CELL), cy: Math.floor(y / FOREST_CELL) });

/** Is the cell forest (the seeded grid)? Outside the world: no. */
export function forestAt(cx: number, cy: number): boolean {
  return cy >= 0 && cy < FOREST_GRID.length && cx >= 0 && cx < FOREST_COLS && FOREST_GRID[cy][cx] === "1";
}

/** 0096 _in_forest: the point's cell is forest. */
export const inForest = (x: number, y: number): boolean => {
  const c = forestCellOf(x, y);
  return forestAt(c.cx, c.cy);
};

/** 0096 _near_forest: the point's cell or one of its 8 neighbours is forest (where a hunter or woodcutter may stand). */
export function nearForest(x: number, y: number): boolean {
  const c = forestCellOf(x, y);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (forestAt(c.cx + dx, c.cy + dy)) return true;
  return false;
}

/** 0096 world_forest.core: the cell and its 8 neighbours are forest (an animal's home). */
export function forestCore(cx: number, cy: number): boolean {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!forestAt(cx + dx, cy + dy)) return false;
  return true;
}
