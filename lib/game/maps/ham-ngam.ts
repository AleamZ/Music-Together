import { TU_SEO_LOOK } from "@/lib/game/fight/npc";
import { HAM_ARRIVE, MARKET_HATCH_ARRIVE } from "./arrivals";
import { cityMapPost } from "./city-post";
import { overlaps } from "./rect";
import type { GameMap, Interactable, Npc, PropPlacement, Rect } from "./types";

// "Hầm đấu ngầm" (v20.4, spec §v20.4 "The map"): a hidden cellar under Chợ Lớn's manhole — bare concrete, hanging bulbs,
// anh Tư Sẹo's table (the queue, the ladder, the cups), the "Bảng xếp hạng ngầm", the chain-link cage in the middle
// (cup and rated matches are shown there; spectators stand around it), the iron door of the bot ladder ("Cửa thách
// đấu") and the ladder back up to the hatch. Indoors (0041's _in_shade: an unlisted map), hidden from the city map.
// Pure layout + collision; the painter is ham-ngam-art.ts.

export const HAM_W = 480;
export const HAM_H = 320;
export const HAM_CELL = 8;

/** The concrete wall along the north (bulbs and pipes on it). */
export const HAM_WALL_H = 40;
/** The ladder up to the manhole, on the north wall. */
export const HAM_LADDER: Rect = { x: 40, y: 4, w: 16, h: 36 };
/** The chain-link cage (solid: the fighters are inside, in the overlay). */
export const CAGE: Rect = { x: 176, y: 128, w: 128, h: 96 };
/** The cage's four watch spots (use points), one per side, each facing the cage. */
export const CAGE_WATCH: ReadonlyArray<{ id: string; rect: Rect; use: { x: number; y: number }; face: "up" | "down" | "left" | "right" }> = [
  { id: "cage_n", rect: { x: 176, y: 128, w: 128, h: 16 }, use: { x: 240, y: 116 }, face: "down" },
  { id: "cage_s", rect: { x: 176, y: 208, w: 128, h: 16 }, use: { x: 240, y: 236 }, face: "up" },
  { id: "cage_w", rect: { x: 176, y: 144, w: 20, h: 64 }, use: { x: 164, y: 176 }, face: "right" },
  { id: "cage_e", rect: { x: 284, y: 144, w: 20, h: 64 }, use: { x: 316, y: 176 }, face: "left" },
];
/** anh Tư Sẹo behind his table, the "Bảng xếp hạng ngầm", the ladder's iron door on the west wall. */
export const TU_SEO_SPOT = { x: 400, y: 62, dir: "down" as const };
export const TU_SEO_TABLE = { x: 400, y: 84 } as const;
export const UG_BOARD = { x: 240, y: 56 } as const;
export const LADDER_DOOR: Rect = { x: 0, y: 228, w: 20, h: 40 };
/** Decoration: crates and an oil drum. */
export const CRATES: Rect = { x: 404, y: 236, w: 32, h: 24 };
export const DRUM = { x: 110, y: 276 } as const;
export const HAM_CITY_POST = cityMapPost(100, 70);

export const HAM_SOLIDS: Rect[] = [
  { x: 0, y: 0, w: HAM_W, h: HAM_WALL_H },                               // the north wall (the ladder is on it)
  { x: 0, y: HAM_WALL_H, w: 20, h: HAM_H - HAM_WALL_H },                  // the west wall (with the ladder's door)
  { x: HAM_W - 12, y: HAM_WALL_H, w: 12, h: HAM_H - HAM_WALL_H },         // the east wall
  { x: 0, y: HAM_H - 16, w: HAM_W, h: 16 },                               // the south wall
  CAGE,
  HAM_CITY_POST.solid,
  { x: UG_BOARD.x - 8, y: UG_BOARD.y - 6, w: 16, h: 6 },
  { x: TU_SEO_TABLE.x - 16, y: TU_SEO_TABLE.y - 8, w: 32, h: 8 },
  CRATES,
  { x: DRUM.x - 8, y: DRUM.y - 8, w: 16, h: 8 },
];

export const HAM_INTERACTABLES: Interactable[] = [
  HAM_CITY_POST.interactable,
  {
    id: "ham_ngam_exit", kind: "portal", label: "Lên Chợ Lớn", prompt: "Leo thang lên Chợ Lớn", rect: { x: 36, y: 8, w: 24, h: 32 },
    use: { x: 48, y: 52 }, face: "up", to: { map: "market", arrive: MARKET_HATCH_ARRIVE },
  },
  {
    id: "tu_seo", kind: "ug_organizer", label: "Anh Tư Sẹo", prompt: "Nói chuyện với anh Tư Sẹo (kèo, giải)",
    rect: { x: TU_SEO_TABLE.x - 16, y: 40, w: 32, h: 44 }, use: { x: TU_SEO_TABLE.x, y: 100 }, face: "up",
  },
  {
    id: "ug_board", kind: "ug_board", label: "Bảng xếp hạng ngầm", prompt: "Xem bảng xếp hạng ngầm",
    rect: { x: UG_BOARD.x - 14, y: UG_BOARD.y - 34, w: 28, h: 34 }, use: { x: UG_BOARD.x, y: UG_BOARD.y + 14 }, face: "up",
  },
  {
    id: "ug_door", kind: "ug_door", label: "Cửa thách đấu", prompt: "Vào Tầng hầm (thách đấu 10 tầng)",
    rect: LADDER_DOOR, use: { x: 36, y: 248 }, face: "left",
  },
  ...CAGE_WATCH.map((w): Interactable => ({
    id: w.id, kind: "cage_watch", label: "Lồng đấu", prompt: "Xem trận", rect: w.rect, use: { ...w.use }, face: w.face,
  })),
];

/** The cage's watch spots are hidden while no match is live there (GameShell: GameEngine.setHidden). */
export const CAGE_WATCH_IDS: readonly string[] = CAGE_WATCH.map((w) => w.id);

export const HAM_PROPS: PropPlacement[] = [
  HAM_CITY_POST.prop,
  { kind: "board", x: UG_BOARD.x, y: UG_BOARD.y },
  { kind: "table", x: TU_SEO_TABLE.x, y: TU_SEO_TABLE.y },
];

export const HAM_NPCS: Npc[] = [{ id: "tu_seo", name: "Anh Tư Sẹo", look: TU_SEO_LOOK, spot: TU_SEO_SPOT }];

export { HAM_ARRIVE };

export function buildHamNgamMap(): GameMap {
  const cols = HAM_W / HAM_CELL, rows = HAM_H / HAM_CELL;
  const blocked = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const cell = { x: c * HAM_CELL, y: r * HAM_CELL, w: HAM_CELL, h: HAM_CELL };
    blocked[r * cols + c] = HAM_SOLIDS.some((s) => overlaps(s, cell)) ? 1 : 0;
  }
  return {
    id: "ham_ngam", width: HAM_W, height: HAM_H, cell: HAM_CELL, cols, rows, blocked,
    spawn: HAM_ARRIVE, seating: null, interactables: HAM_INTERACTABLES, props: HAM_PROPS, npcs: HAM_NPCS, plots: [],
  };
}
