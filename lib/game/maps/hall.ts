import { FIELD_WEST_ARRIVE, HALL_FIELD_ARRIVE, POND_ARRIVE } from "./arrivals";
import { overlaps } from "./rect";
import type { GameMap, Interactable, PropPlacement, Rect, Seating, Spot } from "./types";

export { overlaps };

export const HALL_W = 640;
export const HALL_H = 400;
export const HALL_CELL = 8;

/** Y of the river bank at x (water below it). Shared with the art so collision and pixels agree. */
export function hallShoreY(x: number): number {
  return 338 + 5 * Math.sin(x / 40) + 2 * Math.sin(x / 13);
}

/** Góc đánh bài (v16 spec §5): the plank deck in the south-west, between palm A and palm B. */
export const CARD_DECK: Rect = { x: 62, y: 240, w: 182, h: 86 };

/** Each card table's rect covers the table and its stools (west, east and south); the north side stays open for the use
 *  spot. Then the "Góc đánh bài" sign and the corner's light pole. */
export const CARD_SOLIDS: Rect[] = [
  { x: 78, y: 272, w: 40, h: 26 },    // Tiến lên table + 4 stools
  { x: 130, y: 296, w: 52, h: 26 },   // Cào mat + 6 cushions
  { x: 188, y: 272, w: 52, h: 27 },   // poker table + 6 stools
  { x: 150, y: 242, w: 14, h: 10 },   // "Góc đánh bài" sign
  { x: 238, y: 246, w: 4, h: 4 },     // light pole of the corner
];

export const HALL_SOLIDS: Rect[] = [
  { x: 0, y: 0, w: 72, h: 150 },      // bamboo grove
  { x: 232, y: 0, w: 176, h: 140 },   // stage + backstage
  { x: 466, y: 0, w: 138, h: 106 },   // café counter "Quầy nước" + behind it
  { x: 84, y: 192, w: 12, h: 8 },     // palm A trunk (hammock anchor)
  { x: 24, y: 322, w: 12, h: 8 },     // palm B trunk
  { x: 620, y: 120, w: 12, h: 8 },    // palm C trunk
  { x: 100, y: 188, w: 62, h: 14 },   // hammock
  { x: 166, y: 196, w: 8, h: 8 },     // hammock post
  { x: 456, y: 192, w: 28, h: 12 },   // table 1
  { x: 546, y: 192, w: 28, h: 12 },   // table 2
  { x: 501, y: 250, w: 28, h: 12 },   // table 3
  { x: 584, y: 250, w: 24, h: 12 },   // notice board
  { x: 484, y: 314, w: 14, h: 10 },   // dock sign
  { x: 34, y: 222, w: 14, h: 10 },    // "Ra đồng" sign
  { x: 204, y: 138, w: 12, h: 8 },    // banana plant west of the stage
  { x: 434, y: 132, w: 12, h: 8 },    // banana plant east of the stage
  { x: 158, y: 184, w: 4, h: 4 },     // light pole west
  { x: 444, y: 166, w: 4, h: 4 },     // light pole east
  ...CARD_SOLIDS,
];

/** Walkable even over water. */
export const HALL_WALKABLE: Rect[] = [{ x: 500, y: 316, w: 32, h: 84 }]; // wooden dock

export const HALL_INTERACTABLES: Interactable[] = [
  { id: "dj_booth", kind: "dj_booth", label: "Quầy DJ", prompt: "Mở hàng đợi", rect: { x: 296, y: 106, w: 48, h: 34 }, use: { x: 320, y: 152 } },
  { id: "notice_board", kind: "notice_board", label: "Bảng tin", prompt: "Xem bảng tin", rect: { x: 582, y: 228, w: 28, h: 34 }, use: { x: 596, y: 270 } },
  {
    id: "dock_sign", kind: "portal", label: "Bến câu cá", prompt: "Xuống ao câu cá", rect: { x: 482, y: 300, w: 18, h: 24 },
    use: { x: 516, y: 334 }, to: { map: "pond", arrive: POND_ARRIVE },
  },
  {
    id: "field_sign", kind: "portal", label: "Ra đồng", prompt: "Ra đồng ruộng", rect: { x: 31, y: 206, w: 18, h: 26 },
    use: { x: HALL_FIELD_ARRIVE.x, y: HALL_FIELD_ARRIVE.y }, to: { map: "field", arrive: FIELD_WEST_ARRIVE },
  },
  {
    id: "cards_tienlen", kind: "card_table", game: "tienlen", label: "Bàn Tiến lên", prompt: "Vào bàn Tiến lên",
    rect: { x: 76, y: 268, w: 44, h: 30 }, use: { x: 98, y: 266 }, face: "down",
  },
  {
    id: "cards_cao", kind: "card_table", game: "cao", label: "Chiếu Cào", prompt: "Vào chiếu Cào",
    rect: { x: 128, y: 294, w: 56, h: 28 }, use: { x: 156, y: 290 }, face: "down",
  },
  {
    id: "cards_poker", kind: "card_table", game: "poker", label: "Bàn Poker", prompt: "Vào bàn Poker",
    rect: { x: 187, y: 268, w: 54, h: 31 }, use: { x: 214, y: 266 }, face: "down",
  },
  {
    id: "cards_sign", kind: "card_rules", label: "Góc đánh bài", prompt: "Đọc Sổ luật",
    rect: { x: 147, y: 226, w: 18, h: 26 }, use: { x: 156, y: 262 }, face: "up",
  },
];

/** Classic-mode members stand behind the café tables (the table sprite hides their legs). */
export const HALL_SEATS: Spot[] = [
  { x: 462, y: 190, dir: "down" }, { x: 478, y: 190, dir: "down" },
  { x: 552, y: 190, dir: "down" }, { x: 568, y: 190, dir: "down" },
  { x: 507, y: 246, dir: "down" }, { x: 523, y: 246, dir: "down" },
];
export const HALL_STAND_SPOTS: Spot[] = [
  { x: 180, y: 172, dir: "down" }, { x: 452, y: 158, dir: "down" }, { x: 300, y: 300, dir: "left" },
  { x: 430, y: 300, dir: "left" }, { x: 260, y: 306, dir: "up" }, { x: 380, y: 168, dir: "down" },
];
/** A classic-mode DJ is drawn on the stage behind the mixer. */
export const HALL_DJ_SPOT: Spot = { x: 320, y: 124, dir: "down" };
export const HALL_SEATING: Seating = { djSpot: HALL_DJ_SPOT, seats: HALL_SEATS, standSpots: HALL_STAND_SPOTS };
/** Entering game mode: the dirt path at the east edge, facing into the café. */
export const HALL_SPAWN: Spot = { x: 612, y: 300, dir: "left" };

export const HALL_PROPS: PropPlacement[] = [
  { kind: "palm", x: 90, y: 198, h: 72, lean: 0.35, seed: 3 },
  { kind: "palm", x: 30, y: 328, h: 64, lean: 0.45, seed: 7 },
  { kind: "palm", x: 626, y: 126, h: 70, lean: -0.5, seed: 11 },
  { kind: "hammock", x: 96, y: 202, x2: 170 },
  { kind: "post", x: 170, y: 204 },
  { kind: "mixer", x: 320, y: 130 },
  { kind: "table", x: 470, y: 204 },
  { kind: "table", x: 560, y: 204 },
  { kind: "table", x: 515, y: 262 },
  { kind: "board", x: 596, y: 262 },
  { kind: "sign", x: 491, y: 324 },
  { kind: "sign", x: 40, y: 232, icon: "rice" },
  { kind: "banana", x: 210, y: 146 },
  { kind: "banana", x: 440, y: 140 },
  { kind: "lightpole", x: 160, y: 188 },
  { kind: "lightpole", x: 446, y: 170 },
  { kind: "card_table", x: 98, y: 298, game: "tienlen" },
  { kind: "card_table", x: 156, y: 322, game: "cao" },
  { kind: "card_table", x: 214, y: 299, game: "poker" },
  { kind: "sign", x: 156, y: 252, icon: "cards" },
  { kind: "lightpole", x: 240, y: 250 },
];

/** Overhead string lights: [x1, y1, x2, y2, sag] in world px (drawn above everything). */
export const LIGHT_STRINGS: ReadonlyArray<readonly [number, number, number, number, number]> = [
  [246, 24, 100, 128, 10],   // stage west pole → palm A crown
  [394, 24, 612, 58, 12],    // stage east pole → palm C crown
  [160, 152, 446, 134, 14],  // across the yard between the light poles
  [100, 128, 240, 214, 10],  // palm A crown → the card corner's pole
];

export function buildHallMap(): GameMap {
  const cols = HALL_W / HALL_CELL, rows = HALL_H / HALL_CELL;
  const blocked = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const cell = { x: c * HALL_CELL, y: r * HALL_CELL, w: HALL_CELL, h: HALL_CELL };
    const cx = cell.x + HALL_CELL / 2, cy = cell.y + HALL_CELL / 2;
    let b = cy >= hallShoreY(cx) - 6 || HALL_SOLIDS.some((s) => overlaps(s, cell));
    if (HALL_WALKABLE.some((s) => overlaps(s, cell))) b = false;
    blocked[r * cols + c] = b ? 1 : 0;
  }
  return {
    id: "hall", width: HALL_W, height: HALL_H, cell: HALL_CELL, cols, rows, blocked,
    spawn: HALL_SPAWN, seating: HALL_SEATING, interactables: HALL_INTERACTABLES, props: HALL_PROPS, npcs: [], plots: [],
  };
}
