import { CITY_PLACES } from "@/lib/game/maps/city";
import { WORLD_H, WORLD_W, type ZoneId } from "./zones";

// The world map's small helpers: a zone's name and the whole-world view. P4: the map itself is worldmap.ts (the base
// image from the world data) and worldmap-canvas.ts (drawing it and the overlays).

export interface MapView { x0: number; y0: number; scale: number }

/** The name a zone is shown under ("Ngoài đồng" for the wild). */
export function zoneName(z: ZoneId): string {
  return z === "wild" ? "Ngoài đồng" : CITY_PLACES[z]?.name ?? z;
}

/** A view that shows the whole world in a w × h canvas. */
export function fitWorld(w: number, h: number): MapView {
  const scale = Math.min(w / WORLD_W, h / WORLD_H);
  return { x0: -(w / scale - WORLD_W) / 2, y0: -(h / scale - WORLD_H) / 2, scale };
}
