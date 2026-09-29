import type { MapId } from "@/lib/game/maps/types";
import type { Vec } from "@/lib/game/types";
import {
  bridgeAt, heightGrid, KNOLLS, MAX_WALK_HEIGHT, MAX_WALK_SLOPE, onPath, slopeAtCell, waterAt,
} from "./terrain";
export { ROADS, TRAILS, type Road, type Trail } from "./roads";
import { WORLD_CELL, WORLD_H, WORLD_W, ZONES, type OutdoorMapId } from "./zones";

// The wild: the filler between the zones (spec §1). compose.ts turns it into collision; the 3D renderer
// (lib/game/diorama/world) draws it. World px throughout. The land is terrain.ts's heightmap; here it is blocked where
//   - the ground is a cliff (steeper than MAX_WALK_SLOPE) or mountain (above MAX_WALK_HEIGHT): the rim mountains, the
//     northern ridge's crest, the knolls,
//   - the forest belt along the north edge (scenery),
//   - water: the river winding across the south and the pond's stream (the bridges on the trails cross the river),
//   - a reed bank around Sông Cái (the zone is boat water, reached from the pond's pier: no walking in),
//   - the world's rim (one cell).
// Roads and trails are walkable whatever lies under them; each road joins the two ends of an old portal pair.
/** Which edge of a zone a portal's opening runs to. */
export type Side = "top" | "bottom" | "left" | "right";

/** A portal of the old maps that becomes an opening in its zone's wall: a corridor from its use point to `side`. */
export interface Opening { zone: OutdoorMapId; portal: string; side: Side }

/** Every outdoor portal (the hầm's hatch stays a hatch: an interior). */
export const OPENINGS: readonly Opening[] = [
  { zone: "hall", portal: "dock_sign", side: "bottom" },
  { zone: "hall", portal: "field_sign", side: "left" },
  { zone: "hall", portal: "market_sign", side: "right" },
  { zone: "pond", portal: "pond_exit", side: "bottom" },
  { zone: "pond", portal: "field_bridge", side: "bottom" },
  { zone: "field", portal: "field_to_hall", side: "top" },
  { zone: "field", portal: "field_to_pond", side: "right" },
  { zone: "market", portal: "market_exit", side: "left" },
  { zone: "market", portal: "market_to_khu_nha", side: "right" },
  { zone: "market", portal: "market_to_bai_dat", side: "bottom" },
  { zone: "khu_nha", portal: "khu_nha_exit", side: "left" },
  { zone: "bai_dat", portal: "bai_dat_exit", side: "top" },
  { zone: "bai_dat", portal: "mo_da_gate", side: "right" },
  { zone: "mo_da", portal: "mo_da_exit", side: "left" },
];

/** An opening's corridor width, px. */
export const OPENING_W = 24;

/** A way across that is not walking: the boat from Cầu ao's pier to Sông Cái's jetty (0086's river_row_*). Zone-local. */
export interface Link { kind: "boat"; from: { zone: MapId; p: Vec }; to: { zone: MapId; p: Vec } }

export const LINKS: readonly Link[] = [
  { kind: "boat", from: { zone: "pond", p: { x: 378, y: 206 } }, to: { zone: "song_cai", p: { x: 80, y: 240 } } },
];


/** The forest belt along the north edge (scenery). */
export const FOREST = { y1: 400 } as const;

/** Sông Cái's reed bank: this many px round the zone are blocked (no walking into boat water). */
export const REED_BANK = 24;

/** The bridges: where the trails cross the river (their deck is walkable). */
export const BRIDGES: readonly { id: string; trail: string }[] = [
  { id: "B1", trail: "trail_b1" },
  { id: "B2", trail: "trail_b2" },
];

/** Knolls (blocked rocky mounds), as before the heightmap. */
export const HILLS = KNOLLS;

function nearSongCai(x: number, y: number): boolean {
  const z = ZONES.song_cai;
  return x >= z.ox - REED_BANK && x < z.ox + z.w + REED_BANK && y >= z.oy - REED_BANK && y < z.oy + z.h + REED_BANK;
}

/** Is this wild point blocked (before the roads are laid over it)? */
export function wildBlocked(x: number, y: number): boolean {
  if (x < 8 || y < 8 || x >= WORLD_W - 8 || y >= WORLD_H - 8) return true;
  if (y < FOREST.y1) return true;
  if (waterAt(x, y) !== null) return bridgeAt(x, y) === null;
  if (nearSongCai(x, y)) return true;
  if (KNOLLS.some((h) => (x - h.x) ** 2 + (y - h.y) ** 2 <= h.r ** 2)) return true;
  const g = heightGrid(), c = Math.floor(x / WORLD_CELL), r = Math.floor(y / WORLD_CELL);
  if (g.h[r * g.cols + c] > MAX_WALK_HEIGHT) return true;
  return slopeAtCell(g, c, r) > MAX_WALK_SLOPE;
}

/** Is this point on a road or a trail? */
export function onRoad(x: number, y: number): boolean {
  return onPath(x, y);
}