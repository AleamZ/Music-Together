import { RIVER, RIVER_CELL, RIVER_H, RIVER_W, riverWater } from "@/lib/game/river/geometry";
import { SONG_CAI_ARRIVE } from "./arrivals";
import { cityMapPost } from "./city-post";
import { overlaps } from "./rect";
import type { GameMap, Interactable, Npc, PropPlacement, Rect } from "./types";

// "Sông Cái" (v22, 0086): the big river past the pond, reached only by boat (Bến ghe on Cầu ao → the rowing minigame).
// Everyone here floats in their ghe: the walkable cells ARE the water (between the reedy banks, around four rocks and a
// little island); three shoals (bãi cá) glitter where the big fish gather. The west jetty (Bến sông) rows back to the
// pond. Outdoors. Pure layout + collision; the painter is song-cai-art.ts; the water mirrors 0086's _river_water.

export const SC_CITY_POST = cityMapPost(96, 78);

/** The west jetty's planks (land: the boat moors beside it). */
export const JETTY: Rect = { x: 0, y: 226, w: 60, h: 28 };

export const SC_INTERACTABLES: Interactable[] = [
  SC_CITY_POST.interactable,
  {
    id: "river_dock", kind: "river_dock", label: "Bến sông", prompt: "Chèo ghe về Ao cá",
    rect: { x: JETTY.x, y: JETTY.y - 10, w: JETTY.w, h: JETTY.h + 10 }, use: { x: SONG_CAI_ARRIVE.x, y: SONG_CAI_ARRIVE.y }, face: "left",
  },
];

export const SC_PROPS: PropPlacement[] = [
  SC_CITY_POST.prop,
  { kind: "palm", x: 170, y: 60, h: 64, lean: 0.3, seed: 31 },
  { kind: "palm", x: 420, y: 56, h: 70, lean: -0.25, seed: 37 },
  { kind: "palm", x: 760, y: 62, h: 60, lean: 0.35, seed: 41 },
  { kind: "palm", x: 300, y: 450, h: 66, lean: -0.3, seed: 43 },
  { kind: "palm", x: 640, y: 456, h: 62, lean: 0.25, seed: 47 },
  { kind: "palm", x: 900, y: 452, h: 68, lean: -0.35, seed: 53 },
  { kind: "banana", x: 520, y: 60 },
  { kind: "banana", x: 120, y: 448 },
  { kind: "banana", x: 780, y: 446 },
  { kind: "sign", x: 20, y: 222, icon: "fish" },
];

export const SC_NPCS: Npc[] = [
  {
    id: "ong_nam_do", name: "Ông Năm đò", spot: { x: 30, y: 246, dir: "right" },
    look: { skin: "tan", hair: "short", hairColor: "silver", hat: "hat_nonla", top: "top_baba_white", bottom: "bottom_pants_black", shoes: "shoes_dep_brown", neck: "neck_khanran" },
  },
];

export const SC_SOLIDS: Rect[] = [SC_CITY_POST.solid, JETTY];

export function buildSongCaiMap(): GameMap {
  const cols = RIVER_W / RIVER_CELL, rows = RIVER_H / RIVER_CELL;
  const blocked = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const cell = { x: c * RIVER_CELL, y: r * RIVER_CELL, w: RIVER_CELL, h: RIVER_CELL };
    const water = riverWater(cell.x + RIVER_CELL / 2, cell.y + RIVER_CELL / 2);
    blocked[r * cols + c] = !water || SC_SOLIDS.some((s) => overlaps(s, cell)) ? 1 : 0;
  }
  return {
    id: "song_cai", width: RIVER_W, height: RIVER_H, cell: RIVER_CELL, cols, rows, blocked,
    spawn: SONG_CAI_ARRIVE, seating: null, interactables: SC_INTERACTABLES, props: SC_PROPS, npcs: SC_NPCS, plots: [],
  };
}

export { RIVER };
