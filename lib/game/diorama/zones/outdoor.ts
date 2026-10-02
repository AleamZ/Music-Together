import * as THREE from "three";
import type { GameMap, MapId } from "@/lib/game/maps/types";
import type { Built } from "../build";
import { buildBaiDatZone } from "./bai_dat";
import { buildFieldZone } from "./field";
import { buildHamNgamZone } from "./ham_ngam";
import { buildMoDaZone } from "./mo_da";
import { rigOf, type OutdoorBuilder, type OutdoorOptions } from "./outdoor-kit";
import { buildSongCaiZone } from "./song_cai";

// Browser only: the outdoor zones built straight from their map data (field, Bãi đất, Mỏ đá, Sông Cái; the Hầm đấu ngầm too), each a
// `(map, opts) => THREE.Group` with its runtime hooks on userData.rig — wrapped here as the pond's `Built` so
// DioramaView drives them unchanged (lamps, bulbs, sway, roofs, quality thinning; animateWater hands over to the zone).

export const OUTDOOR_BUILDERS: Partial<Record<MapId, OutdoorBuilder>> = {
  field: buildFieldZone,
  bai_dat: buildBaiDatZone,
  mo_da: buildMoDaZone,
  ham_ngam: buildHamNgamZone,
  song_cai: buildSongCaiZone,
};

/** A zone group as the view's Built. */
export function builtFromGroup(root: THREE.Group): Built {
  const rig = rigOf(root);
  const water = rig.water ?? new THREE.Mesh();
  return {
    root, water, waterBase: new Float32Array(0), thinnable: rig.thinnable, sway: rig.sway, lamps: rig.lamps, bulbs: rig.bulbs,
    flowers: null, roofs: rig.roofs, animate: rig.animate, setPlots: rig.setPlots, cave: rig.cave, dispose: rig.dispose,
  };
}

/** The outdoor zone's scene for a map (null: not one of these). */
export function outdoorScene(map: GameMap, opts: OutdoorOptions = {}): { built: Built; heightAt: (x: number, y: number) => number } | null {
  const build = OUTDOOR_BUILDERS[map.id];
  if (!build) return null;
  const root = build(map, opts);
  return { built: builtFromGroup(root), heightAt: rigOf(root).heightAt };
}
