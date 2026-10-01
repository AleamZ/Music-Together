import type { Rect } from "@/lib/game/maps/types";
import type { Vec } from "@/lib/game/types";

// The road out to Sông Cái (0116): ONE source for the route, read by every view of it — the world's road network and
// collision (roads.ts ROADS, wild.ts, compose.ts), the 2D world map and minimap (worldmap-canvas.ts), the 3D world
// (lib/game/diorama/world/song-cai-route.ts, the song_cai diorama's reeds) — and mirrored by the server
// (0116_song_cai_route.sql _song_cai_landing(): the landing and the dock's foot; tests/unit/song-cai-route.test.ts pins
// them equal and every waypoint walkable). World px. Pure data.
//
//   Ao cá's south exit ─ the hall–pond road ─ the JUNCTION (signpost "→ Sông Cái (cấp 3)") ─ south down the bank ─
//   the LANDING (Bến đò Sông Cái: board the ghe, level gate) ─ the DOCK's planks out over the reeds ─ its FOOT in the
//   river, where the ghe comes in (the arrival on Sông Cái after the row).

export interface SongCaiRoute {
  /** The road's id in ROADS. */
  id: string;
  /** Where it leaves the hall–pond road (a corner of that road). */
  junction: Vec;
  /** The road's waypoints, junction → landing (walkable, `w` px wide). */
  pts: readonly Vec[];
  w: number;
  /** The signpost at the junction (its post: a little east of the new road, south of the old one). */
  sign: { x: number; y: number; text: string };
  /** The landing's height (units): the bank a step above Sông Cái's plateau (the road ramps 1.2 → this). */
  landingElev: number;
  /** Bến đò Sông Cái: where one stands to board (the road's end). */
  landing: Vec;
  /** The dock's planks, from the bank out over the reeds into the river (drawn; not walked: the ghe takes you). */
  dock: Rect;
  /** The dock's foot in the river: where the ghe lands you on Sông Cái (zone-local of song_cai: dockFootLocal). */
  dockFoot: Vec;
}

export const SONG_CAI_ROUTE: SongCaiRoute = {
  id: "pond_song_cai",
  junction: { x: 1312, y: 1500 },
  pts: [{ x: 1312, y: 1500 }, { x: 1312, y: 1536 }, { x: 1312, y: 1568 }],
  w: 32,
  sign: { x: 1342, y: 1528, text: "→ Sông Cái (cấp 3)" },
  landingElev: 0.9,
  landing: { x: 1312, y: 1568 },
  dock: { x: 1302, y: 1584, w: 20, h: 116 },
  dockFoot: { x: 1312, y: 1704 },
};

/** The route's level (0070's map_levels song_cai). */
export const SONG_CAI_LEVEL = 3;

/** The dock's foot in Sông Cái's own px (the zone's origin is (960, 1600): lib/game/world/zones.ts). */
export const SONG_CAI_DOCK_LOCAL: Vec = { x: SONG_CAI_ROUTE.dockFoot.x - 960, y: SONG_CAI_ROUTE.dockFoot.y - 1600 };

/** How near (px) the landing one must stand to board (the server's _pos_on_zone radius). */
export const LANDING_NEAR = 48;
