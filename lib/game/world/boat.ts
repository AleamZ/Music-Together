import { riverWater } from "@/lib/game/river/geometry";
import type { GameMap, Interactable } from "@/lib/game/maps/types";
import type { Facing } from "@/lib/game/types";
import type { WorldMap } from "./compose";
import { CANAL_HALF_W, canalDist, riverAt } from "./terrain";
import { WORLD_H, WORLD_W, ZONES, zoneAt } from "./zones";

// 0095 (the seamless river): the boat rows the whole river and its canals, not only Sông Cái's rect. World px. Pure.
//   - in Sông Cái: the zone's own water (river/geometry.ts riverWater, zone-local);
//   - in the wild: the river band (terrain.ts riverAt: d < hw) and the canals (canalDist < CANAL_HALF_W), inside the world;
//   - any other zone: no boat water.
// The server (0095 _river_world_water) mirrors this leniently: the river band grown by RIVER_GROW, the canals by
// CANAL_GROW (tests/unit/world-boat.test.ts pins every client boat cell inside the server's mask).

export const RIVER_GROW = 24;
export const CANAL_GROW = 8;
/** The server's river half-width bound (terrain.ts riverHalfWidth ≤ 104 + 64 + 16) plus the hull. */
export const SERVER_RIVER_HW = 184 + RIVER_GROW;

const RIVER_Y0 = 1560 - 200, RIVER_Y1 = 1990 + 200;

/** Is world (x, y) water the boat floats on? */
export function boatWater(x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= WORLD_W || y >= WORLD_H) return false;
  const z = zoneAt({ x, y });
  if (z === "song_cai") {
    const lx = x - ZONES.song_cai.ox;
    if (riverWater(lx, y - ZONES.song_cai.oy)) return true;
    // the zone's two short ends (outside its 48…944 band): the river runs on through them to the wild's
    if (lx >= 56 && lx <= 936) return false;
    const r = riverAt(x, y);
    return r.d < r.hw;
  }
  if (z !== "wild") return false;
  if (y > RIVER_Y0 && y < RIVER_Y1) {                    // the river band (its centreline spans y 1560…1990)
    const r = riverAt(x, y);
    if (!r.inZone && r.d < r.hw) return true;
  }
  return canalDist(x, y, 40) < CANAL_HALF_W;
}

/** The world's collision grid for the boat: only boat water open (land, banks and bridges' piers closed). Built once. */
export function worldBoatMap(w: WorldMap): GameMap {
  const blocked = new Uint8Array(w.cols * w.rows).fill(1);
  for (let r = 0; r < w.rows; r++) for (let c = 0; c < w.cols; c++) {
    if (boatWater(c * w.cell + w.cell / 2, r * w.cell + w.cell / 2)) blocked[r * w.cols + c] = 0;
  }
  return { ...(w as unknown as GameMap), blocked };
}

/** The cast prompt from the boat on the wild's river / canals (map 'wild', world px). Null off that water. */
export function wildBoatInteractable(x: number, y: number, facing: Facing): Interactable | null {
  const ix = Math.round(x), iy = Math.round(y);
  if (zoneAt({ x: ix, y: iy }) !== "wild" || !boatWater(ix, iy)) return null;
  const col = Math.floor(ix / 8), row = Math.floor(iy / 8), canal = !(riverAt(ix, iy).d < riverAt(ix, iy).hw);
  const label = canal ? "Kênh rạch" : "Sông Cái";
  return {
    id: `boatw_${col}_${row}`, kind: "fish_spot", label, prompt: `Quăng cần · ${label}`,
    rect: { x: col * 8, y: row * 8, w: 8, h: 8 }, use: { x: ix, y: iy }, face: facing,
  };
}

export const isWildBoatSpot = (it: { id: string }): boolean => it.id.startsWith("boatw_");
