import type { MapId } from "@/lib/game/maps/types";
import type { Vec } from "@/lib/game/types";

// The unified world (docs/superpowers/specs/2026-09-29-unified-world-design.md §1–2): every outdoor map is a ZONE, a
// rectangle at a fixed offset in one 4160 × 2240 px world. (zone, local x, y) and (world x, y) are the same position
// written two ways; the gameplay RPCs keep speaking zone-local, so a client sends serverPos(world). The rest of the world
// is "wild" (roads, forest, hills, the river band: lib/game/world/wild.ts), whose local coords ARE world coords.
// Interiors (the hầm; Mỏ đá, underground since P2 — entered from the mine mouth on the eastern hills; houses and flats)
// are not in the world: entered by a door, a hatch or a tunnel, as before, each on its own map and realtime topic.
// Mirrored by 0088_unified_world.sql (_world_zones, _zone_to_world, _world_to_zone); tests/unit/world-zones.test.ts pins them.

export const WORLD_W = 4160;
export const WORLD_H = 2240;
/** One collision cell, as every map's. */
export const WORLD_CELL = 8;

export type ZoneId = MapId | "wild";
/** A map that is a zone of the world (every map but the interiors). */
export type OutdoorMapId = Exclude<MapId, "ham_ngam" | "mo_da">;

export interface ZoneRect { ox: number; oy: number; w: number; h: number }

/** The zones' rectangles (spec §1). Their sizes are the maps' (0086's _pos_maps). */
export const ZONES: Readonly<Record<OutdoorMapId, ZoneRect>> = {
  field: { ox: 0, oy: 560, w: 800, h: 480 },
  hall: { ox: 960, oy: 480, w: 640, h: 400 },
  pond: { ox: 960, oy: 1040, w: 640, h: 400 },
  market: { ox: 1760, oy: 480, w: 1280, h: 400 },
  khu_nha: { ox: 3200, oy: 480, w: 800, h: 400 },
  bai_dat: { ox: 2400, oy: 1040, w: 800, h: 400 },
  song_cai: { ox: 960, oy: 1600, w: 960, h: 480 },
};

/** The wild's "rect": the whole world (it is whatever no zone covers). */
export const WILD: ZoneRect = { ox: 0, oy: 0, w: WORLD_W, h: WORLD_H };

/** The zones in a fixed order (the SQL's). */
export const ZONE_IDS: readonly OutdoorMapId[] = ["field", "hall", "pond", "market", "khu_nha", "bai_dat", "song_cai"];

/** Maps entered by a door, a hatch or the mine's tunnel: no place in the world (their own map and topic). */
export const INTERIORS: readonly MapId[] = ["ham_ngam", "mo_da"];

export function isInterior(map: ZoneId): boolean {
  return (INTERIORS as readonly string[]).includes(map);
}

export function isZone(map: ZoneId): map is OutdoorMapId {
  return map in ZONES;
}

/** The rectangle of a zone (the wild: the whole world); null for an interior. */
export function zoneRect(zone: ZoneId): ZoneRect | null {
  if (zone === "wild") return WILD;
  return isZone(zone) ? ZONES[zone] : null;
}

/** Zone-local px → world px; null for an interior. */
export function toWorld(zone: ZoneId, p: Vec): Vec | null {
  const r = zoneRect(zone);
  return r ? { x: p.x + r.ox, y: p.y + r.oy } : null;
}

/** The zone at a world point: the first zone whose rect holds it (half-open), else "wild". */
export function zoneAt(w: Vec): ZoneId {
  for (const id of ZONE_IDS) {
    const r = ZONES[id];
    if (w.x >= r.ox && w.x < r.ox + r.w && w.y >= r.oy && w.y < r.oy + r.h) return id;
  }
  return "wild";
}

/** World px → the zone and its local px. */
export function toLocal(w: Vec): { zone: ZoneId; p: Vec } {
  const zone = zoneAt(w);
  const r = zoneRect(zone)!;
  return { zone, p: { x: w.x - r.ox, y: w.y - r.oy } };
}

/** What an RPC is sent for a world position: the zone and its local px, rounded (the payloads stay zone-local). */
export function serverPos(w: Vec): { map: ZoneId; x: number; y: number } {
  const { zone, p } = toLocal({ x: Math.round(w.x), y: Math.round(w.y) });
  return { map: zone, x: p.x, y: p.y };
}

/** Is the point inside the world? */
export function inWorld(w: Vec): boolean {
  return w.x >= 0 && w.y >= 0 && w.x < WORLD_W && w.y < WORLD_H;
}
