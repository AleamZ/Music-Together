import { BAI_MINE_ARRIVE, MO_DA_ARRIVE } from "./arrivals";
import { cityMapPost } from "./city-post";
import { overlaps } from "./rect";
import type { GameMap, Interactable, Npc, PropPlacement, Rect } from "./types";

// "Mỏ đá" (v21 #19): a quarry cave through the gap in Bãi đất trống's broken east wall — a rock face along the north,
// ten ore rocks (shallow by the entrance, rich deep in the south-east), four glowing herb patches, chú Tám's shed (he
// buys ore and sells pickaxes), the anvil (upgrades) and bà Sáu's cauldron (potions). Indoors (0041's _in_shade: an
// unlisted map). Pure layout + collision; the painter is mo-da-art.ts. The use spots are pinned to 0072's
// _mine_node_use / _mine_spot by tests/unit/mining-map.test.ts.

export const MO_W = 640;
export const MO_H = 400;
export const MO_CELL = 8;
export const MO_WALL_H = 56;

export interface MineNodeGeom { no: number; kind: "ore" | "herb"; x: number; y: number; rect: Rect; use: { x: number; y: number } }

/** Ore rocks 1–10: the base centre (x, y); the rock is 24 × 16 above it; one stands 14 px below it. */
const ORE_AT: ReadonlyArray<readonly [number, number]> = [
  [100, 110], [200, 96], [300, 110], [400, 96],        // zone 1: shallow
  [500, 120], [580, 160], [180, 200], [330, 210],      // zone 2
  [560, 300], [470, 350],                              // zone 3: deep
];
/** Herb patches 11–14: their centre; one stands 12 px below. */
const HERB_AT: ReadonlyArray<readonly [number, number]> = [[90, 330], [240, 350], [600, 80], [400, 300]];

export const MINE_NODES: readonly MineNodeGeom[] = [
  ...ORE_AT.map(([x, y], k): MineNodeGeom => ({
    no: k + 1, kind: "ore", x, y, rect: { x: x - 12, y: y - 16, w: 24, h: 16 }, use: { x, y: y + 14 },
  })),
  ...HERB_AT.map(([x, y], k): MineNodeGeom => ({
    no: k + 11, kind: "herb", x, y, rect: { x: x - 12, y: y - 10, w: 24, h: 14 }, use: { x, y: y + 12 },
  })),
];

/** chú Tám's shed (ore buyer, pickaxes), the anvil, bà Sáu's cauldron. */
export const SHED = { x: 120, y: 258 } as const;          // the counter's centre-top
export const ANVIL = { x: 200, y: 290 } as const;
export const CAULDRON = { x: 320, y: 330 } as const;
export const SHOP_USE = { x: 120, y: 282 } as const;
export const ANVIL_USE = { x: 200, y: 306 } as const;
export const CAULDRON_USE = { x: 320, y: 346 } as const;
export const MO_CITY_POST = cityMapPost(60, 78);

export const MO_SOLIDS: Rect[] = [
  { x: 0, y: 0, w: MO_W, h: MO_WALL_H },                           // the rock face
  { x: 0, y: MO_H - 16, w: MO_W, h: 16 },                          // the south wall
  { x: MO_W - 16, y: 0, w: 16, h: MO_H },                          // the east wall
  { x: 0, y: 0, w: 12, h: 184 }, { x: 0, y: 216, w: 12, h: 184 },  // the west wall around the gate
  ...MINE_NODES.filter((n) => n.kind === "ore").map((n) => n.rect),
  MO_CITY_POST.solid,
  { x: SHED.x - 28, y: 200, w: 56, h: 68 },                        // the shed (the counter at its front)
  { x: ANVIL.x - 10, y: ANVIL.y - 8, w: 20, h: 8 },
  { x: CAULDRON.x - 12, y: CAULDRON.y - 10, w: 24, h: 12 },
];

export const MO_INTERACTABLES: Interactable[] = [
  MO_CITY_POST.interactable,
  {
    id: "mo_da_exit", kind: "portal", label: "Về Bãi đất trống", prompt: "Ra khỏi mỏ (Bãi đất trống)",
    rect: { x: 0, y: 184, w: 16, h: 32 }, use: { x: 28, y: 200 }, face: "left", to: { map: "bai_dat", arrive: BAI_MINE_ARRIVE },
  },
  ...MINE_NODES.map((n): Interactable => ({
    id: `mine_${n.no}`, kind: n.kind === "ore" ? "mine_node" : "herb_node",
    label: n.kind === "ore" ? `Mỏ quặng ${n.no}` : "Bãi thảo dược", prompt: n.kind === "ore" ? "Đào quặng" : "Hái thảo dược",
    rect: n.rect, use: { ...n.use }, face: "up", spot: n.no,
  })),
  {
    id: "mine_shop", kind: "mine_shop", label: "Lán chú Tám", prompt: "Bán quặng · mua cuốc (chú Tám)",
    rect: { x: SHED.x - 28, y: 200, w: 56, h: 68 }, use: { ...SHOP_USE }, face: "up",
  },
  {
    id: "mine_anvil", kind: "anvil", label: "Đe rèn", prompt: "Nâng cấp đồ nghề",
    rect: { x: ANVIL.x - 12, y: ANVIL.y - 20, w: 24, h: 22 }, use: { ...ANVIL_USE }, face: "up",
  },
  {
    id: "mine_cauldron", kind: "cauldron", label: "Vạc thuốc bà Sáu", prompt: "Nấu thuốc (bà Sáu)",
    rect: { x: CAULDRON.x - 14, y: CAULDRON.y - 26, w: 28, h: 28 }, use: { ...CAULDRON_USE }, face: "up",
  },
];

export const MO_PROPS: PropPlacement[] = [MO_CITY_POST.prop];

export const MO_NPCS: Npc[] = [
  {
    id: "chu_tam_mo", name: "Chú Tám thợ mỏ", spot: { x: SHED.x, y: 244, dir: "down" },
    look: { skin: "tan", hair: "short", hairColor: "black", hat: "hat_nonla", top: "top_baba_white", bottom: "bottom_pants_black", shoes: "shoes_dep_blue", neck: "neck_khanran" },
  },
  {
    id: "ba_sau", name: "Bà Sáu thầy thuốc", spot: { x: CAULDRON.x + 30, y: CAULDRON.y - 4, dir: "left" },
    look: { skin: "warm", hair: "long", hairColor: "black", hat: null, top: "top_baba_pink", bottom: "bottom_pants_black", shoes: "shoes_dep_brown", neck: null, gender: "nu" },
  },
];

export { MO_DA_ARRIVE };

export function buildMoDaMap(): GameMap {
  const cols = MO_W / MO_CELL, rows = MO_H / MO_CELL;
  const blocked = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const cell = { x: c * MO_CELL, y: r * MO_CELL, w: MO_CELL, h: MO_CELL };
    blocked[r * cols + c] = MO_SOLIDS.some((s) => overlaps(s, cell)) ? 1 : 0;
  }
  return {
    id: "mo_da", width: MO_W, height: MO_H, cell: MO_CELL, cols, rows, blocked,
    spawn: MO_DA_ARRIVE, seating: null, interactables: MO_INTERACTABLES, props: MO_PROPS, npcs: MO_NPCS, plots: [],
  };
}
