import type { Interactable } from "@/lib/game/maps/types";
import type { Facing, Vec } from "@/lib/game/types";

// Sông Cái (v22, 0086): the river's water, rocks and shoals. Mirrors public._river_geo(); tests/unit/river.test.ts pins
// them equal. Pure.

export const RIVER_W = 960;
export const RIVER_H = 480;
export const RIVER_CELL = 8;

export const RIVER = {
  /** The water band between the banks (inclusive). */
  x0: 48, y0: 80, x1: 944, y1: 400,
  /** Rocks and the island: [x, y, r] — no water inside. */
  rocks: [[300, 150, 18], [520, 330, 22], [700, 120, 16], [820, 300, 20], [620, 230, 44]] as ReadonlyArray<readonly [number, number, number]>,
  /** Bãi cá: casting inside one lifts a common roll more often. */
  shoals: [[250, 300, 56], [560, 140, 56], [860, 210, 50]] as ReadonlyArray<readonly [number, number, number]>,
  shoalNames: ["Bãi Lau", "Ghềnh Đá Đỏ", "Vũng Ngát"],
  /** Where the boat lands on the river, and back on the pond (Cầu ao's pier). */
  arrive: { x: 80, y: 240 },
  pier: { x: 378, y: 206 },
} as const;

/** Is (x, y) on the water? `grow` > 0 is the server's lenient check (the hull: the band grown, the rocks shrunk). */
export function riverWater(x: number, y: number, grow = 0): boolean {
  if (x < RIVER.x0 - grow || x > RIVER.x1 + grow || y < RIVER.y0 - grow || y > RIVER.y1 + grow) return false;
  return RIVER.rocks.every(([cx, cy, r]) => (x - cx) ** 2 + (y - cy) ** 2 >= (r - grow) ** 2);
}

/** The shoal (index) at (x, y), or -1. */
export const shoalAt = (x: number, y: number): number => RIVER.shoals.findIndex(([cx, cy, r]) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r);
export const onShoal = (x: number, y: number): boolean => shoalAt(x, y) >= 0;

/** The river cast prompt wherever the boat floats and no map spot is in range: a fish_spot whose use point is where I
 *  float, the line going where I face. Null off the water. */
export function riverInteractable(feet: Vec, facing: Facing): Interactable | null {
  const x = Math.round(feet.x), y = Math.round(feet.y);
  if (!riverWater(x, y)) return null;
  const s = shoalAt(x, y);
  const col = Math.floor(x / RIVER_CELL), row = Math.floor(y / RIVER_CELL);
  return {
    id: `river_${col}_${row}`, kind: "fish_spot", label: s >= 0 ? RIVER.shoalNames[s] : "Sông Cái",
    prompt: s >= 0 ? `Quăng cần · ${RIVER.shoalNames[s]} (bãi cá)` : "Quăng cần",
    rect: { x: col * RIVER_CELL, y: row * RIVER_CELL, w: RIVER_CELL, h: RIVER_CELL }, use: { x, y }, face: facing,
  };
}
