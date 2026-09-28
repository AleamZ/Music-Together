import { BAI_DAT_ARRIVE, MARKET_BRIDGE_ARRIVE, MO_DA_ARRIVE } from "./arrivals";
import { cityMapPost } from "./city-post";
import { overlaps } from "./rect";
import type { GameMap, Interactable, PropPlacement, Rect } from "./types";

// "Bãi đất trống" (v20.3, spec §v20.3 "Map"): an empty lot across the bridge from Chợ Lớn's south-east canal wall — packed
// dirt and weeds, four boxing rings under tin roofs (the PvP rings), a stack of tires, a broken brick wall on the east, a
// water tap, the "Bảng thành tích" board, a punching bag and the city-map post. Pure layout + collision; the painter
// is bai-dat-art.ts.

export const BAI_W = 800;
export const BAI_H = 400;
export const BAI_CELL = 8;

/** The four rings (their floors are walkable; the roof posts at the corners are solid). Shade (R7): 0051's _in_shade. */
export const RING_RECTS: readonly Rect[] = [
  { x: 100, y: 100, w: 200, h: 100 },
  { x: 500, y: 100, w: 200, h: 100 },
  { x: 100, y: 260, w: 200, h: 100 },
  { x: 500, y: 260, w: 200, h: 100 },
];

/** Góc Đỏ at (x + 16, y + h/2) facing right, Góc Xanh at (x + w − 16, y + h/2) facing left. */
export function cornerSpot(ring: number, corner: "red" | "blue"): { x: number; y: number; dir: "left" | "right" } {
  const r = RING_RECTS[ring - 1];
  return corner === "red" ? { x: r.x + 16, y: r.y + r.h / 2, dir: "right" } : { x: r.x + r.w - 16, y: r.y + r.h / 2, dir: "left" };
}

/** The roof posts: one at each ring corner. */
export const RING_POSTS: readonly Rect[] = RING_RECTS.flatMap((r) => [
  { x: r.x, y: r.y, w: 6, h: 6 }, { x: r.x + r.w - 6, y: r.y, w: 6, h: 6 },
  { x: r.x, y: r.y + r.h - 6, w: 6, h: 6 }, { x: r.x + r.w - 6, y: r.y + r.h - 6, w: 6, h: 6 },
]);

/** The canal along the north with the little bridge back to Chợ Lớn (x 384–416). */
export const BRIDGE: Rect = { x: 384, y: 0, w: 32, h: 26 };
export const BAI_CITY_POST = cityMapPost(340, 44);
/** The PvP records board ("Bảng thành tích"): the room's top 10 by wins this week. */
export const RECORDS_BOARD = { x: 400, y: 250 } as const;
/** The practice bag in the south-west corner. */
export const BAI_BAG = { x: 60, y: 330 } as const;
/** Decoration: the tire stack, the water tap, the broken wall on the east (its standing pieces). */
export const TIRES: Rect = { x: 386, y: 146, w: 28, h: 16 };
export const TAP = { x: 60, y: 228 } as const;
export const BROKEN_WALL: readonly Rect[] = [
  { x: 748, y: 56, w: 12, h: 110 }, { x: 748, y: 200, w: 12, h: 44 }, { x: 748, y: 292, w: 12, h: 76 },
];

export const BAI_SOLIDS: Rect[] = [
  { x: 0, y: 0, w: BRIDGE.x, h: 24 },                                   // the canal, west of the bridge
  { x: BRIDGE.x + BRIDGE.w, y: 0, w: BAI_W - BRIDGE.x - BRIDGE.w, h: 24 },   // …and east of it
  { x: 0, y: 384, w: BAI_W, h: 16 },                                    // the back fence along the south
  { x: 784, y: 24, w: 16, h: 360 },                                     // the east edge behind the wall
  BAI_CITY_POST.solid,
  ...RING_POSTS,
  TIRES,
  { x: TAP.x - 3, y: TAP.y - 4, w: 6, h: 4 },
  ...BROKEN_WALL,
  { x: RECORDS_BOARD.x - 8, y: RECORDS_BOARD.y - 6, w: 16, h: 6 },
  { x: BAI_BAG.x - 4, y: BAI_BAG.y - 6, w: 12, h: 6 },
  { x: 423, y: 26, w: 6, h: 6 },                                        // the "Về Chợ Lớn" sign post
];

export const BAI_INTERACTABLES: Interactable[] = [
  BAI_CITY_POST.interactable,
  {
    id: "bai_dat_exit", kind: "portal", label: "Về Chợ Lớn", prompt: "Qua cầu về Chợ Lớn", rect: { x: 388, y: 0, w: 24, h: 24 },
    use: { x: 400, y: 36 }, face: "up", to: { map: "market", arrive: MARKET_BRIDGE_ARRIVE },
  },
  // v21 #19: the gap in the broken east wall leads into Mỏ đá
  {
    id: "mo_da_gate", kind: "portal", label: "Mỏ đá", prompt: "Vào Mỏ đá", rect: { x: 762, y: 248, w: 22, h: 40 },
    use: { x: 748, y: 268 }, face: "right", to: { map: "mo_da", arrive: MO_DA_ARRIVE },
  },
  ...RING_RECTS.flatMap((_, i): Interactable[] => (["red", "blue"] as const).map((corner) => {
    const s = cornerSpot(i + 1, corner);
    return {
      id: `ring_${i + 1}_${corner}`, kind: "ring_corner", label: `Sàn ${i + 1} · ${corner === "red" ? "Góc Đỏ" : "Góc Xanh"}`,
      prompt: `Vào ${corner === "red" ? "Góc Đỏ" : "Góc Xanh"} · sàn ${i + 1}`,
      rect: { x: s.x - 10, y: s.y - 20, w: 20, h: 26 }, use: { x: s.x, y: s.y }, face: s.dir, ring: i + 1, corner,
    };
  })),
  {
    id: "ring_board", kind: "ring_board", label: "Bảng thành tích", prompt: "Xem bảng thành tích",
    rect: { x: RECORDS_BOARD.x - 16, y: RECORDS_BOARD.y - 32, w: 32, h: 32 }, use: { x: RECORDS_BOARD.x, y: RECORDS_BOARD.y + 14 }, face: "up",
  },
  {
    id: "bai_dat_bag", kind: "punch_bag", label: "Bao cát · Luyện võ", prompt: "Luyện võ (bao cát)",
    rect: { x: BAI_BAG.x - 13, y: BAI_BAG.y - 36, w: 26, h: 36 }, use: { x: BAI_BAG.x, y: BAI_BAG.y - 18 }, face: "down",
  },
];

export const BAI_PROPS: PropPlacement[] = [
  BAI_CITY_POST.prop,
  { kind: "board", x: RECORDS_BOARD.x, y: RECORDS_BOARD.y },
  { kind: "punch_bag", x: BAI_BAG.x, y: BAI_BAG.y },
  { kind: "sign", x: 426, y: 32, icon: "market" },
  { kind: "sign", x: 772, y: 246 },                                     // v21 #19: "Mỏ đá"
];

export { BAI_DAT_ARRIVE };

export function buildBaiDatMap(): GameMap {
  const cols = BAI_W / BAI_CELL, rows = BAI_H / BAI_CELL;
  const blocked = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const cell = { x: c * BAI_CELL, y: r * BAI_CELL, w: BAI_CELL, h: BAI_CELL };
    blocked[r * cols + c] = BAI_SOLIDS.some((s) => overlaps(s, cell)) ? 1 : 0;
  }
  return {
    id: "bai_dat", width: BAI_W, height: BAI_H, cell: BAI_CELL, cols, rows, blocked,
    spawn: BAI_DAT_ARRIVE, seating: null, interactables: BAI_INTERACTABLES, props: BAI_PROPS, npcs: [], plots: [],
  };
}
