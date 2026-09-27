import { cellOf, isPondWater } from "@/lib/game/fishing/shore";
import type { GameMap } from "@/lib/game/maps/types";
import type { Vec } from "@/lib/game/types";

// v18.1: swim mode after a big fish pulls the angler into the pond (spec §18.1). Pure rules; the engine applies them.

/** Swimming is at half the walk speed. */
export const SWIM_SPEED = 0.5;
/** After climbing out, water drips from the sprite this long ("ướt"). */
export const WET_MS = 4000;
/** The `sw` movement flag others see (absent = dry): 1 swimming, 2 wet. */
export type SwimCode = 1 | 2;
export const isSwimCode = (v: unknown): v is SwimCode => v === 1 || v === 2;

/** The collision grid of a swimmer: the map's, with the open water walkable (solids stay blocked). Pond only; null
 *  elsewhere (no other map has swimmable water). */
export function buildSwimMap(map: GameMap): GameMap | null {
  if (map.id !== "pond") return null;
  const blocked = new Uint8Array(map.blocked);
  for (let r = 0; r < map.rows; r++) for (let c = 0; c < map.cols; c++) if (isPondWater(c, r)) blocked[r * map.cols + c] = 0;
  return { ...map, blocked };
}

/** Is a swimmer whose feet are at `p` still in the water? Stepping onto any other cell (a bank, the platform) ends it. */
export function inWater(p: Vec): boolean {
  const { col, row } = cellOf(p);
  return isPondWater(col, row);
}

/** The speed factor of a swimmer (1 on land). */
export const swimSpeed = (swimming: boolean): number => (swimming ? SWIM_SPEED : 1);
