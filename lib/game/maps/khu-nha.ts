import { ANH_TU_LOOK, BAO_VE_LOOK } from "@/lib/game/housing/npc";
import { KHU_NHA_ARRIVE, MARKET_EAST_ARRIVE } from "./arrivals";
import { cityMapPost } from "./city-post";
import { overlaps } from "./rect";
import type { GameMap, Interactable, Npc, PropPlacement, Rect } from "./types";

// "Khu nhà" (v19.2, spec §19.2): the residential quarter east of Chợ Lớn — the Chung cư Phú Mỹ block (12 apartments over 3
// floors × 4), the eight fenced lots of v19.3, the Sàn bất động sản office (v19.4), a small park and the
// canal. Pure layout + collision; the painter is khu-nha-art.ts.

export const KHU_W = 800;
export const KHU_H = 400;
export const KHU_CELL = 8;

/** The city-map signpost near the way in. */
export const KHU_CITY_POST = cityMapPost(120, 192);

/** Chung cư Phú Mỹ: the block (solid) and its lobby door, where chú Sáu keeps the keys. */
export const APT_BLOCK: Rect = { x: 272, y: 40, w: 256, h: 130 };
export const APT_LOBBY: Rect = { x: 384, y: 130, w: 32, h: 40 };
/** The Sàn bất động sản office (v19.4), and its glass door, where anh Tư the broker keeps the listings. */
export const ESTATE_OFFICE: Rect = { x: 584, y: 60, w: 128, h: 100 };
export const ESTATE_DOOR: Rect = { x: 631, y: 100, w: 34, h: 60 };
/** Two old townhouses west of the block (decoration). */
export const TOWNHOUSES: Rect = { x: 40, y: 40, w: 200, h: 96 };
/** The eight fenced lots of v19.3 ("sắp mở"). */
export const LOTS: readonly Rect[] = [
  { x: 40, y: 244, w: 88, h: 56 }, { x: 140, y: 244, w: 88, h: 56 }, { x: 40, y: 314, w: 88, h: 56 }, { x: 140, y: 314, w: 88, h: 56 },
  { x: 572, y: 244, w: 88, h: 56 }, { x: 672, y: 244, w: 88, h: 56 }, { x: 572, y: 314, w: 88, h: 56 }, { x: 672, y: 314, w: 88, h: 56 },
];
/** The park's trees (palm bases) and lamps. */
export const PARK_PALMS: ReadonlyArray<{ x: number; y: number }> = [{ x: 300, y: 300 }, { x: 500, y: 300 }, { x: 400, y: 360 }];
export const KHU_LAMPS: ReadonlyArray<{ x: number; y: number }> = [{ x: 256, y: 200 }, { x: 544, y: 200 }, { x: 760, y: 200 }];

export const KHU_SOLIDS: Rect[] = [
  KHU_CITY_POST.solid,
  { x: 0, y: 0, w: 800, h: 40 },         // the houses behind
  TOWNHOUSES,
  APT_BLOCK,
  ESTATE_OFFICE,
  { x: 780, y: 40, w: 20, h: 344 },      // the east wall
  ...LOTS,
  { x: 0, y: 384, w: 800, h: 16 },       // the canal wall
  { x: 10, y: 190, w: 14, h: 10 },       // the "Về Chợ Lớn" sign post
  ...PARK_PALMS.map((p) => ({ x: p.x - 4, y: p.y - 4, w: 8, h: 6 })),
  ...KHU_LAMPS.map((p) => ({ x: p.x - 2, y: p.y - 4, w: 4, h: 4 })),
];

export const KHU_INTERACTABLES: Interactable[] = [
  KHU_CITY_POST.interactable,
  {
    id: "khu_nha_exit", kind: "portal", label: "Về Chợ Lớn", prompt: "Về Chợ Lớn", rect: { x: 8, y: 176, w: 18, h: 24 },
    use: { x: 40, y: 196 }, to: { map: "market", arrive: MARKET_EAST_ARRIVE },
  },
  {
    id: "apartment", kind: "apartment", label: "Chung cư Phú Mỹ", prompt: "Vào chung cư · chú Sáu", rect: APT_LOBBY,
    use: { x: 400, y: 184 }, face: "up",
  },
  // v19.3: each lot's gate, on its north side (the top row from the street, the bottom row from the lane between)
  ...LOTS.map((r, i): Interactable => ({
    id: `lot_${i + 1}`, kind: "lot", label: `Lô đất ${i + 1}`, prompt: `Lô đất ${i + 1}`, rect: r,
    use: { x: r.x + r.w / 2, y: r.y < 300 ? r.y - 8 : r.y - 6 }, face: "down", lot: i + 1,
  })),
  // v19.4: the Sàn bất động sản office's door
  {
    id: "estate", kind: "estate", label: "Sàn bất động sản", prompt: "Sàn bất động sản · anh Tư", rect: ESTATE_DOOR,
    use: { x: 648, y: 176 }, face: "up",
  },
];

export const KHU_NPCS: Npc[] = [
  { id: "chu_sau_bao_ve", name: "chú Sáu", look: BAO_VE_LOOK, spot: { x: 436, y: 162, dir: "down" } },
  { id: "anh_tu_moi_gioi", name: "anh Tư", look: ANH_TU_LOOK, spot: { x: 692, y: 156, dir: "down" } },   // v19.4
];

export const KHU_PROPS: PropPlacement[] = [
  KHU_CITY_POST.prop,
  { kind: "sign", x: 17, y: 200, icon: "market" },
  ...PARK_PALMS.map((p, i): PropPlacement => ({ kind: "palm", x: p.x, y: p.y, h: 46 + i * 6, lean: i % 2 ? 2 : -2, seed: 190 + i })),
  ...KHU_LAMPS.map((p): PropPlacement => ({ kind: "lightpole", x: p.x, y: p.y })),
];

export { KHU_NHA_ARRIVE };

export function buildKhuNhaMap(): GameMap {
  const cols = KHU_W / KHU_CELL, rows = KHU_H / KHU_CELL;
  const blocked = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const cell = { x: c * KHU_CELL, y: r * KHU_CELL, w: KHU_CELL, h: KHU_CELL };
    blocked[r * cols + c] = KHU_SOLIDS.some((s) => overlaps(s, cell)) ? 1 : 0;
  }
  return {
    id: "khu_nha", width: KHU_W, height: KHU_H, cell: KHU_CELL, cols, rows, blocked,
    spawn: KHU_NHA_ARRIVE, seating: null, interactables: KHU_INTERACTABLES, props: KHU_PROPS, npcs: KHU_NPCS, plots: [],
  };
}
