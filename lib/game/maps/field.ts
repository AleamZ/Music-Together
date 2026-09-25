import { ANH_HAI_LOOK, CHU_TAM_LOOK, CO_UT_LOOK } from "@/lib/game/look";
import { FIELD_EAST_ARRIVE, FIELD_WEST_ARRIVE, HALL_FIELD_ARRIVE, POND_FIELD_ARRIVE } from "./arrivals";
import { overlaps } from "./rect";
import type { GameMap, Interactable, Npc, PlotGeom, PropPlacement, Rect } from "./types";

// "Đồng ruộng": the room's rice field (spec §6.2). Pure layout + collision; the painter is field-art.ts.

export const FIELD_W = 800;
export const FIELD_H = 480;
export const FIELD_CELL = 8;

/** Mương: the canal across the map (water, blocked) and its two plank bridges (walkable over it). */
export const CANAL: Rect = { x: 56, y: 176, w: 708, h: 32 };
export const BRIDGES: Rect[] = [{ x: 196, y: 170, w: 32, h: 44 }, { x: 548, y: 170, w: 32, h: 44 }];

const PLOT_W = 128;
const PLOT_XS = [72, 224, 376, 528];
const PRIVATE_Y = 52;
const PRIVATE_H = 96;
const VILLAGE_YS = [228, 328];
const VILLAGE_H = 76;

/** Plots 1–4 (đất tư) in a row north of the canal; 5–10 (đất làng) in two rows of three south of it. Their
 *  interiors are walkable. The name post stands on the dike at a corner. */
export const FIELD_PLOTS: PlotGeom[] = [
  ...PLOT_XS.map((x, i): PlotGeom => ({
    no: i + 1, kind: "private", rect: { x, y: PRIVATE_Y, w: PLOT_W, h: PRIVATE_H }, post: { x: x + 10, y: PRIVATE_Y + PRIVATE_H + 10 },
  })),
  ...VILLAGE_YS.flatMap((y, row) => PLOT_XS.slice(0, 3).map((x, i): PlotGeom => ({
    no: 5 + row * 3 + i, kind: "village", rect: { x, y, w: PLOT_W, h: VILLAGE_H }, post: { x: x + 10, y: y - 4 },
  }))),
];

/** Hợp tác xã (chú Tám), Tiệm vật tư nông nghiệp (anh Hai), Vựa lúa (cô Út) and the pump house (decoration). */
export const COOP: Rect = { x: 680, y: 44, w: 112, h: 92 };
export const FARM_SHOP: Rect = { x: 584, y: 268, w: 92, h: 60 };
export const RICE_DEPOT: Rect = { x: 696, y: 268, w: 96, h: 60 };
export const PUMP_HOUSE: Rect = { x: 36, y: 164, w: 32, h: 48 };

/** Sân phơi: four concrete drying squares (walkable). */
export const DRYING_YARD: Rect = { x: 564, y: 384, w: 224, h: 72 };
export const DRYING_SQUARES: Rect[] = [0, 1, 2, 3].map((i) => ({ x: 572 + i * 54, y: 392, w: 46, h: 56 }));

export const FIELD_SOLIDS: Rect[] = [
  { x: 0, y: 0, w: 800, h: 40 },      // bamboo and coconut palms along the north edge
  COOP, FARM_SHOP, RICE_DEPOT, PUMP_HOUSE,
  { x: 34, y: 94, w: 14, h: 10 },     // "Về sảnh" sign post
  { x: 778, y: 230, w: 12, h: 10 },   // "Về ao cá" sign post
  { x: 12, y: 296, w: 12, h: 8 },     // palm trunk W
  { x: 514, y: 466, w: 12, h: 8 },    // palm trunk S
  { x: 542, y: 346, w: 12, h: 8 },    // banana plant
  { x: 528, y: 424, w: 24, h: 10 },   // haystack
];

function plotUse(g: PlotGeom): Interactable {
  const north = g.kind === "private";
  return {
    id: `plot_${g.no}`, kind: "plot", label: `Thửa ${g.no}`, prompt: `Xem thửa ${g.no}`, rect: g.rect, plot: g.no,
    use: { x: g.rect.x + PLOT_W / 2, y: north ? g.rect.y + g.rect.h + 16 : g.rect.y - 10 },
    face: north ? "up" : "down",
  };
}

export const FIELD_INTERACTABLES: Interactable[] = [
  {
    id: "field_to_hall", kind: "portal", label: "Về sảnh", prompt: "Về sảnh nhạc", rect: { x: 31, y: 78, w: 18, h: 26 },
    use: { x: FIELD_WEST_ARRIVE.x, y: FIELD_WEST_ARRIVE.y }, to: { map: "hall", arrive: HALL_FIELD_ARRIVE },
  },
  {
    id: "field_to_pond", kind: "portal", label: "Về ao cá", prompt: "Qua cầu khỉ về ao cá", rect: { x: 775, y: 214, w: 18, h: 26 },
    use: { x: FIELD_EAST_ARRIVE.x, y: FIELD_EAST_ARRIVE.y }, to: { map: "pond", arrive: POND_FIELD_ARRIVE },
  },
  { id: "coop", kind: "coop", label: "Hợp tác xã", prompt: "Hợp tác xã · chú Tám", rect: { x: 688, y: 96, w: 96, h: 40 }, use: { x: 736, y: 152 } },
  { id: "farm_shop", kind: "farm_shop", label: "Tiệm vật tư nông nghiệp", prompt: "Tiệm vật tư · anh Hai", rect: { x: 588, y: 288, w: 84, h: 40 }, use: { x: 630, y: 344 } },
  { id: "rice_depot", kind: "rice_depot", label: "Vựa lúa", prompt: "Vựa lúa · cô Út", rect: { x: 700, y: 288, w: 88, h: 40 }, use: { x: 744, y: 344 } },
  { id: "drying", kind: "drying", label: "Sân phơi", prompt: "Sân phơi lúa", rect: DRYING_YARD, use: { x: 676, y: 372 } },
  ...FIELD_PLOTS.map(plotUse),
];

/** The three keepers stand behind their counters (inside blocked cells), facing the customers. */
export const FIELD_NPCS: Npc[] = [
  { id: "chu_tam", name: "chú Tám", look: CHU_TAM_LOOK, spot: { x: 736, y: 128, dir: "down" } },
  { id: "anh_hai", name: "anh Hai", look: ANH_HAI_LOOK, spot: { x: 630, y: 320, dir: "down" } },
  { id: "co_ut", name: "cô Út", look: CO_UT_LOOK, spot: { x: 744, y: 320, dir: "down" } },
];

export const FIELD_PROPS: PropPlacement[] = [
  { kind: "sign", x: 41, y: 104, icon: "note" },
  { kind: "sign", x: 784, y: 240, icon: "fish" },
  { kind: "coop_front", x: 736, y: 136 },
  { kind: "farmshop_front", x: 630, y: 328 },
  { kind: "ricedepot_front", x: 744, y: 328 },
  { kind: "pump", x: 52, y: 212 },
  { kind: "palm", x: 18, y: 302, h: 66, lean: 0.3, seed: 21 },
  { kind: "palm", x: 520, y: 472, h: 60, lean: -0.35, seed: 23 },
  { kind: "banana", x: 548, y: 354 },
  { kind: "haystack", x: 540, y: 434 },
  { kind: "scarecrow", x: 212, y: 318 },
  ...FIELD_PLOTS.map((g): PropPlacement => ({ kind: "namepost", x: g.post.x, y: g.post.y })),
];

export function buildFieldMap(): GameMap {
  const cols = FIELD_W / FIELD_CELL, rows = FIELD_H / FIELD_CELL;
  const blocked = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const cell = { x: c * FIELD_CELL, y: r * FIELD_CELL, w: FIELD_CELL, h: FIELD_CELL };
    const water = overlaps(CANAL, cell) && !BRIDGES.some((b) => overlaps(b, cell));
    blocked[r * cols + c] = water || FIELD_SOLIDS.some((s) => overlaps(s, cell)) ? 1 : 0;
  }
  return {
    id: "field", width: FIELD_W, height: FIELD_H, cell: FIELD_CELL, cols, rows, blocked,
    spawn: FIELD_WEST_ARRIVE, seating: null, interactables: FIELD_INTERACTABLES, props: FIELD_PROPS, npcs: FIELD_NPCS,
    plots: FIELD_PLOTS,
  };
}
