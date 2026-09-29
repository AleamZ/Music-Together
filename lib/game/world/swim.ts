import { isPondWater } from "@/lib/game/fishing/shore";
import type { GameMap } from "@/lib/game/maps/types";
import type { WorldMap } from "./compose";
import { ZONES } from "./zones";

// P3: swimming in the pond zone of the world (v18.1 swim mode, lib/game/swim.ts buildSwimMap for the per-map pond): the
// world's collision grid with the pond's open water walkable. Null when the pond zone is locked (not stamped). Pure.

export function worldSwimMap(w: WorldMap): GameMap | null {
  if (!w.zones.includes("pond")) return null;
  const z = ZONES.pond, c0 = z.ox / w.cell, r0 = z.oy / w.cell;
  const blocked = new Uint8Array(w.blocked);
  for (let r = 0; r < z.h / w.cell; r++) for (let c = 0; c < z.w / w.cell; c++) {
    if (isPondWater(c, r)) blocked[(r0 + r) * w.cols + c0 + c] = 0;
  }
  return { ...(w as unknown as GameMap), blocked };
}
