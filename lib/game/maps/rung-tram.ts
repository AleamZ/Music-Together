import { forestAt } from "@/lib/game/world/forest-grid";
import { RUNG_TRAM_ARRIVE, BAI_DAT_FROM_RUNG } from "./arrivals";
import { cityMapPost } from "./city-post";
import { overlaps } from "./rect";
import type { GameMap, Interactable } from "./types";

// "Rừng tràm" (0097): the 2D game's way into the forest. The map IS a window of the world's rừng tràm — its px plus
// RUNG_TRAM_ORIGIN are world px (0097 _forest_origin), so the animals and the trees a 2D player hunts and chops are
// the very ones a 3D player meets in the wild. Walkable where the server's forest grid is forest (64 px cells), solid
// elsewhere; the west path leads back to Bãi đất trống's south gate. The trees (the scenery's tràm) are drawn live over
// the ground (lib/game/forest/trees2d.ts) so a felled one disappears for everyone. Pure layout + collision; the painter
// is rung-tram-art.ts.

export const RT_W = 640;
export const RT_H = 384;
export const RT_CELL = 8;
/** Its px + this = world px (0097 _forest_origin; lib/game/forest/catalog.ts RUNG_TRAM_ORIGIN). */
export const RT_ORIGIN = { x: 2112, y: 1600 } as const;

/** The path out, on the west edge. */
export const RT_EXIT = { x: 0, y: 208, w: 24, h: 32 } as const;

export const RT_CITY_POST = cityMapPost(72, 196);

export const RT_INTERACTABLES: Interactable[] = [
  RT_CITY_POST.interactable,
  {
    id: "rung_tram_exit", kind: "portal", label: "Về Bãi đất trống", prompt: "Ra khỏi rừng, về Bãi đất trống",
    rect: { ...RT_EXIT }, use: { x: 20, y: 224 }, face: "left", to: { map: "bai_dat", arrive: BAI_DAT_FROM_RUNG },
  },
];

/** Is the map px (x, y) on the forest (the server's grid)? */
export const rtForest = (x: number, y: number): boolean =>
  forestAt(Math.floor((x + RT_ORIGIN.x) / 64), Math.floor((y + RT_ORIGIN.y) / 64));

export function buildRungTramMap(): GameMap {
  const cols = RT_W / RT_CELL, rows = RT_H / RT_CELL;
  const blocked = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = c * RT_CELL + RT_CELL / 2, y = r * RT_CELL + RT_CELL / 2;
    const exit = x < RT_EXIT.x + RT_EXIT.w + 8 && y >= RT_EXIT.y && y < RT_EXIT.y + RT_EXIT.h;
    const post = overlaps(RT_CITY_POST.solid, { x: c * RT_CELL, y: r * RT_CELL, w: RT_CELL, h: RT_CELL });
    blocked[r * cols + c] = (rtForest(x, y) || exit) && !post ? 0 : 1;
  }
  return {
    id: "rung_tram", width: RT_W, height: RT_H, cell: RT_CELL, cols, rows, blocked,
    spawn: RUNG_TRAM_ARRIVE, seating: null, interactables: RT_INTERACTABLES, props: [RT_CITY_POST.prop], npcs: [], plots: [],
  };
}
