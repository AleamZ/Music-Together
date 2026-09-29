import { inPond, onPlatform } from "@/lib/game/maps/pond";
import type { GameMap, MapId } from "@/lib/game/maps/types";
import { buildDiorama, WATER_Y, type Built } from "../build";
import { buildPondLayout } from "../layout";
import { hallLayout } from "./hall";
import { khuNhaLayout } from "./khu_nha";
import { zoneHeightAt, type ZoneLayout, type ZoneOpts } from "./kit";
import { marketLayout } from "./market";
import { outdoorScene } from "./outdoor";
import { renderZone } from "./render";
import { pixelizeTree } from "../pixeltex";

// Browser only: which diorama a map gets. The pond keeps its own builder (layout.ts + build.ts); the zones (the hall,
// Chợ Lớn, Khu nhà) go through ZoneLayout + renderZone.

export const ZONE_LAYOUTS: Partial<Record<MapId, (map: GameMap, opts?: ZoneOpts) => ZoneLayout>> = {
  hall: hallLayout,
  market: marketLayout,
  khu_nha: khuNhaLayout,
};

export interface MapScene {
  built: Built;
  /** The height (3D units) a character's feet stand at, at map px (x, y). */
  heightAt: (x: number, y: number) => number;
}

/** Every map scene with the pixel texels (pixeltex.ts). */
export function buildMapScene(map: GameMap, opts: ZoneOpts = {}): MapScene {
  const s = buildMapSceneRaw(map, opts);
  pixelizeTree(s.built.root);
  return s;
}

function buildMapSceneRaw(map: GameMap, opts: ZoneOpts): MapScene {
  const outdoor = outdoorScene(map, opts);                  // field, Bãi đất, Mỏ đá, Sông Cái (zones/outdoor.ts)
  if (outdoor) return outdoor;
  const zone = ZONE_LAYOUTS[map.id];
  if (zone) {
    const L = zone(map, opts);
    return { built: renderZone(L, opts), heightAt: (x, y) => zoneHeightAt(L, x, y) / 16 };
  }
  return {
    built: buildDiorama(buildPondLayout(map, opts)),
    heightAt: (x, y) => (onPlatform(x, y) ? 0.12 : inPond(x, y, -2) ? WATER_Y - 0.9 : 0),
  };
}
