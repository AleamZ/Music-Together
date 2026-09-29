import type { MapId } from "@/lib/game/maps/types";
import type { Vec } from "@/lib/game/types";
import { WORLD_H, WORLD_W, type OutdoorMapId } from "./zones";

// The wild: the filler between the zones (spec §1). DATA ONLY — compose.ts turns it into collision; the painters (P2)
// turn it into ground. World px throughout. Everything here is open ground unless listed:
//   - the forest belt along the north edge (scenery: blocked),
//   - a few hills (blocked mounds, never on a road),
//   - the river band along the south (water: blocked, except its two bridges and the Sông Cái zone itself, which is
//     boat water reached from the pond's pier),
//   - the world's rim (one cell).
// Roads are walkable whatever lies under them; each joins the two ends of an old portal pair.

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

/** A road: a polyline in world px, `w` px wide, joining two openings' ends (`a`, `b`: "zone:portal"). */
export interface Road { id: string; a: string; b: string; pts: readonly Vec[]; w: number }

// The openings' ends on the zone edges (world px), worked out from the portals' use points (see OPENINGS):
//   hall dock (1476, 880)    hall west (960, 716)     hall east (1600, 680)
//   pond exit (1312, 1440)   pond bridge (1150, 1440)
//   field north (60, 560)    field east (800, 804)
//   market west (1760, 724)  market east (3040, 676)  market south (2940, 880)
//   khu_nha west (3200, 676) bai_dat north (2800, 1040) bai_dat east (3200, 1308) mo_da west (3360, 1240)
export const ROADS: readonly Road[] = [
  { id: "hall_pond", a: "hall:dock_sign", b: "pond:pond_exit", w: 32,
    pts: [{ x: 1476, y: 880 }, { x: 1476, y: 960 }, { x: 1680, y: 960 }, { x: 1680, y: 1500 }, { x: 1312, y: 1500 }, { x: 1312, y: 1440 }] },
  { id: "hall_field", a: "hall:field_sign", b: "field:field_to_hall", w: 32,
    pts: [{ x: 960, y: 716 }, { x: 880, y: 716 }, { x: 880, y: 520 }, { x: 60, y: 520 }, { x: 60, y: 560 }] },
  { id: "field_pond", a: "field:field_to_pond", b: "pond:field_bridge", w: 32,
    pts: [{ x: 800, y: 804 }, { x: 880, y: 804 }, { x: 880, y: 1500 }, { x: 1150, y: 1500 }, { x: 1150, y: 1440 }] },
  { id: "hall_market", a: "hall:market_sign", b: "market:market_exit", w: 40,
    pts: [{ x: 1600, y: 680 }, { x: 1680, y: 680 }, { x: 1680, y: 724 }, { x: 1760, y: 724 }] },
  { id: "market_khu_nha", a: "market:market_to_khu_nha", b: "khu_nha:khu_nha_exit", w: 40,
    pts: [{ x: 3040, y: 676 }, { x: 3200, y: 676 }] },
  { id: "market_bai_dat", a: "market:market_to_bai_dat", b: "bai_dat:bai_dat_exit", w: 32,
    pts: [{ x: 2940, y: 880 }, { x: 2940, y: 960 }, { x: 2800, y: 960 }, { x: 2800, y: 1040 }] },
  { id: "bai_dat_mo_da", a: "bai_dat:mo_da_gate", b: "mo_da:mo_da_exit", w: 32,
    pts: [{ x: 3200, y: 1308 }, { x: 3280, y: 1308 }, { x: 3280, y: 1240 }, { x: 3360, y: 1240 }] },
];

/** A way across that is not walking: the boat from Cầu ao's pier to Sông Cái's jetty (0086's river_row_*). Zone-local. */
export interface Link { kind: "boat"; from: { zone: MapId; p: Vec }; to: { zone: MapId; p: Vec } }

export const LINKS: readonly Link[] = [
  { kind: "boat", from: { zone: "pond", p: { x: 378, y: 206 } }, to: { zone: "song_cai", p: { x: 80, y: 240 } } },
];

/** The forest belt along the north edge (scenery). */
export const FOREST = { y1: 400 } as const;

/** The river band along the south: water from y0 to y1, the south bank below it; the bridges cross it. */
export const RIVER_BAND = { y0: 1560, y1: 2160 } as const;
export const BRIDGES: readonly { id: string; x: number; w: number }[] = [
  { id: "B1", x: 400, w: 48 },
  { id: "B2", x: 2600, w: 48 },
];

/** Hills (blocked mounds): centre and radius, world px. */
export const HILLS: readonly { x: number; y: number; r: number }[] = [
  { x: 4090, y: 900, r: 60 },
  { x: 4090, y: 1300, r: 60 },
  { x: 2100, y: 1250, r: 90 },
  { x: 3700, y: 1540, r: 70 },
];

/** Is this wild point blocked (before the roads are laid over it)? */
export function wildBlocked(x: number, y: number): boolean {
  if (x < 8 || y < 8 || x >= WORLD_W - 8 || y >= WORLD_H - 8) return true;
  if (y < FOREST.y1) return true;
  if (y >= RIVER_BAND.y0 && y < RIVER_BAND.y1 && !BRIDGES.some((b) => x >= b.x && x < b.x + b.w)) return true;
  return HILLS.some((h) => (x - h.x) ** 2 + (y - h.y) ** 2 <= h.r ** 2);
}

/** Is this point on a road? */
export function onRoad(x: number, y: number): boolean {
  return ROADS.some((r) => {
    for (let i = 1; i < r.pts.length; i++) {
      const a = r.pts[i - 1], b = r.pts[i], h = r.w / 2;
      if (x >= Math.min(a.x, b.x) - h && x <= Math.max(a.x, b.x) + h && y >= Math.min(a.y, b.y) - h && y <= Math.max(a.y, b.y) + h) return true;
    }
    return false;
  });
}
