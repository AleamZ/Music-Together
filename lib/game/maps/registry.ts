import { buildHallMap } from "./hall";
import { paintHall } from "./hall-art";
import { buildPondMap } from "./pond";
import { paintPond } from "./pond-art";
import type { SceneArt } from "./scene-art";
import type { GameMap, MapId } from "./types";

// Every map of the room world (spec §5.1): built once, painted once per page.

const maps = new Map<MapId, GameMap>();
const arts = new Map<MapId, SceneArt>();

/** The map with this id (pure; cached). */
export function getMap(id: MapId): GameMap {
  let m = maps.get(id);
  if (!m) {
    m = id === "pond" ? buildPondMap() : buildHallMap();
    maps.set(id, m);
  }
  return m;
}

/** The map's painted scene (browser only: canvas). Cached, so walking back and forth does not repaint. */
export function paintMap(map: GameMap): SceneArt {
  let a = arts.get(map.id);
  if (!a) {
    a = map.id === "pond" ? paintPond(map) : paintHall(map);
    arts.set(map.id, a);
  }
  return a;
}
