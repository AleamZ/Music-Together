import { buildFieldMap } from "./field";
import { paintField } from "./field-art";
import { buildHallMap } from "./hall";
import { paintHall } from "./hall-art";
import { buildPondMap } from "./pond";
import { paintPond } from "./pond-art";
import type { SceneArt } from "./scene-art";
import type { GameMap, MapId } from "./types";

// Every map of the room world (spec §5.1): built once, painted once per page.

const maps = new Map<MapId, GameMap>();
const arts = new Map<MapId, SceneArt>();

function build(id: MapId): GameMap {
  switch (id) {
    case "hall": return buildHallMap();
    case "pond": return buildPondMap();
    case "field": return buildFieldMap();
  }
}

function paint(map: GameMap): SceneArt {
  switch (map.id) {
    case "hall": return paintHall(map);
    case "pond": return paintPond(map);
    case "field": return paintField(map);
  }
}

/** The map with this id (pure; cached). */
export function getMap(id: MapId): GameMap {
  let m = maps.get(id);
  if (!m) {
    m = build(id);
    maps.set(id, m);
  }
  return m;
}

/** The map's painted scene (browser only: canvas). Cached, so walking back and forth does not repaint. */
export function paintMap(map: GameMap): SceneArt {
  let a = arts.get(map.id);
  if (!a) {
    a = paint(map);
    arts.set(map.id, a);
  }
  return a;
}
