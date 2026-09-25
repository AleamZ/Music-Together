import { CHU_TU_LOOK, CO_BA_LOOK } from "@/lib/game/look";
import type { Vec } from "@/lib/game/types";
import { FIELD_EAST_ARRIVE, HALL_DOCK_ARRIVE, POND_ARRIVE, POND_FIELD_ARRIVE } from "./arrivals";
import { overlaps } from "./rect";
import type { GameMap, Interactable, Npc, PropPlacement, Rect, Spot } from "./types";

// "Ao cá": the Miền Tây fishing pond (spec §5.3). Pure layout + collision; the painter is pond-art.ts.

export const POND_W = 640;
export const POND_H = 400;
export const POND_CELL = 8;

/** The pond is an irregular oval around (POND_CX, POND_CY). */
export const POND_CX = 300;
export const POND_CY = 180;
export const POND_RX = 180;
export const POND_RY = 105;

/** Radius factor of the shore at `angle` (radians). Shared with the art so collision and pixels agree. */
export function pondEdge(angle: number): number {
  return 1 + 0.04 * Math.sin(3 * angle + 0.6) + 0.025 * Math.sin(5 * angle + 2.1);
}

/** Is (x, y) inside the pond grown by `grow` px (a negative `grow` shrinks it)? */
export function inPond(x: number, y: number, grow = 0): boolean {
  const dx = (x - POND_CX) / (POND_RX + grow), dy = (y - POND_CY) / (POND_RY + grow);
  const e = pondEdge(Math.atan2(dy, dx));
  return dx * dx + dy * dy < e * e;
}

/** Bãi trùn: the dark dirt patch in the west where the worms are dug. Shared with the art. */
export function inDirtPatch(x: number, y: number): boolean {
  const dx = (x - 66) / 42, dy = (y - 228) / 76;
  const n = Math.sin(x * 0.2) * 0.06 + Math.sin(y * 0.13) * 0.06;
  return dx * dx + dy * dy < 1 + n;
}

/** Cầu ao: a T of planks from the south bank into the water. Walkable although it is over the pond. */
export const POND_PLATFORM: Rect[] = [
  { x: 200, y: 200, w: 200, h: 24 },  // the bar
  { x: 288, y: 224, w: 24, h: 72 },   // the stem down to the bank
];

export function onPlatform(x: number, y: number): boolean {
  return POND_PLATFORM.some((p) => x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h);
}

export const POND_SOLIDS: Rect[] = [
  { x: 0, y: 0, w: 640, h: 44 },      // bamboo along the north edge
  { x: 516, y: 40, w: 116, h: 86 },   // Vựa cá stall (cô Ba stands inside)
  { x: 516, y: 196, w: 116, h: 98 },  // Tiệm đồ câu hut (chú Tư stands inside)
  { x: 496, y: 158, w: 24, h: 10 },   // Bảng kỷ lục posts
  { x: 345, y: 350, w: 14, h: 10 },   // "Bến vào" sign post
  { x: 184, y: 370, w: 14, h: 10 },   // "Cầu khỉ ra đồng" sign post
  { x: 34, y: 94, w: 12, h: 8 },      // palm trunk NW
  { x: 620, y: 174, w: 12, h: 8 },    // palm trunk E
  { x: 18, y: 354, w: 12, h: 8 },     // palm trunk SW
  { x: 114, y: 316, w: 12, h: 8 },    // banana plant W
  { x: 464, y: 336, w: 12, h: 8 },    // banana plant SE
];

/** Fishing spots on the platform's edges, each facing open water. */
export const POND_FISH_SPOTS: Spot[] = [
  { x: 252, y: 204, dir: "up" }, { x: 300, y: 204, dir: "up" }, { x: 348, y: 204, dir: "up" },
  { x: 206, y: 212, dir: "left" }, { x: 394, y: 212, dir: "right" }, { x: 292, y: 262, dir: "left" },
];

/** Worm mounds on the dirt patch (walkable; you dig standing just below one). */
export const DIG_MOUNDS: Vec[] = [{ x: 56, y: 172 }, { x: 84, y: 208 }, { x: 50, y: 246 }, { x: 82, y: 282 }];

/** A fishing spot's click rect: the water in front of it, so tapping near the spot walks there and casts. */
function waterRect(s: Spot): Rect {
  switch (s.dir) {
    case "up": return { x: s.x - 16, y: s.y - 84, w: 32, h: 36 };
    case "down": return { x: s.x - 16, y: s.y + 8, w: 32, h: 36 };
    case "left": return { x: s.x - 56, y: s.y - 18, w: 40, h: 26 };
    case "right": return { x: s.x + 16, y: s.y - 18, w: 40, h: 26 };
  }
}

export const POND_INTERACTABLES: Interactable[] = [
  {
    id: "pond_exit", kind: "portal", label: "Bến vào", prompt: "Về sảnh nhạc", rect: { x: 343, y: 334, w: 18, h: 26 },
    use: { x: 352, y: 374 }, to: { map: "hall", arrive: HALL_DOCK_ARRIVE },
  },
  {
    id: "field_bridge", kind: "portal", label: "Cầu khỉ ra đồng", prompt: "Qua cầu khỉ ra đồng", rect: { x: 181, y: 354, w: 18, h: 26 },
    use: { x: POND_FIELD_ARRIVE.x, y: POND_FIELD_ARRIVE.y }, to: { map: "field", arrive: FIELD_EAST_ARRIVE },
  },
  ...POND_FISH_SPOTS.map((s, i): Interactable => ({
    id: `fish_${i + 1}`, kind: "fish_spot", label: "Chỗ câu", prompt: "Quăng cần", rect: waterRect(s), use: { x: s.x, y: s.y }, face: s.dir,
  })),
  ...DIG_MOUNDS.map((m, i): Interactable => ({
    id: `dig_${i + 1}`, kind: "dig_spot", label: "Bãi trùn", prompt: "Đào trùn", rect: { x: m.x - 10, y: m.y - 6, w: 20, h: 12 },
    use: { x: m.x, y: m.y + 12 },
  })),
  { id: "depot", kind: "depot", label: "Vựa cá", prompt: "Bán cá · cô Ba", rect: { x: 522, y: 64, w: 104, h: 62 }, use: { x: 570, y: 140 } },
  { id: "shop", kind: "shop", label: "Tiệm đồ câu", prompt: "Tiệm đồ câu · chú Tư", rect: { x: 522, y: 228, w: 104, h: 66 }, use: { x: 576, y: 308 } },
  { id: "records", kind: "records", label: "Bảng kỷ lục", prompt: "Xem bảng kỷ lục", rect: { x: 494, y: 134, w: 28, h: 34 }, use: { x: 508, y: 182 } },
];

/** The shopkeepers stand behind their counters (inside blocked cells), facing the customers. */
export const POND_NPCS: Npc[] = [
  { id: "co_ba", name: "cô Ba", look: CO_BA_LOOK, spot: { x: 560, y: 110, dir: "down" } },
  { id: "chu_tu", name: "chú Tư", look: CHU_TU_LOOK, spot: { x: 576, y: 278, dir: "down" } },
];

export const POND_PROPS: PropPlacement[] = [
  { kind: "palm", x: 40, y: 100, h: 70, lean: 0.35, seed: 5 },
  { kind: "palm", x: 626, y: 180, h: 66, lean: 0.25, seed: 9 },
  { kind: "palm", x: 24, y: 360, h: 62, lean: 0.4, seed: 13 },
  { kind: "banana", x: 120, y: 324 },
  { kind: "banana", x: 470, y: 344 },
  { kind: "stall_front", x: 574, y: 126 },
  { kind: "hut_front", x: 576, y: 294 },
  { kind: "records", x: 508, y: 168 },
  { kind: "sign", x: 352, y: 360, icon: "note" },
  { kind: "sign", x: 190, y: 380, icon: "rice" },
];

export function buildPondMap(): GameMap {
  const cols = POND_W / POND_CELL, rows = POND_H / POND_CELL;
  const blocked = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const cell = { x: c * POND_CELL, y: r * POND_CELL, w: POND_CELL, h: POND_CELL };
    const cx = cell.x + POND_CELL / 2, cy = cell.y + POND_CELL / 2;
    let b = inPond(cx, cy, 6) || POND_SOLIDS.some((s) => overlaps(s, cell));
    if (POND_PLATFORM.some((s) => overlaps(s, cell))) b = false;
    blocked[r * cols + c] = b ? 1 : 0;
  }
  return {
    id: "pond", width: POND_W, height: POND_H, cell: POND_CELL, cols, rows, blocked,
    spawn: POND_ARRIVE, seating: null, interactables: POND_INTERACTABLES, props: POND_PROPS, npcs: POND_NPCS, plots: [],
  };
}
