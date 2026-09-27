// v19.3: the lot grid's shape and the roof styles — no dependencies, so the engine and the art can use them
// (lib/game/housing/house.ts re-exports them with the rest of the rules).

export const LOT_COUNT = 8;
export const LOT_COLS = 20;
export const LOT_ROWS = 14;
export const LOT_TILE = 16;
export const CELL_COUNT = LOT_COLS * LOT_ROWS;

export type Roof = "ngoi" | "tole" | "la" | "bang";
export const ROOFS: ReadonlyArray<{ id: Roof; name: string }> = [
  { id: "ngoi", name: "Ngói đỏ" }, { id: "tole", name: "Tôn xanh" }, { id: "la", name: "Lá dừa" }, { id: "bang", name: "Mái bằng" },
];

/** What the street shows of one lot (house_list's lots). */
export interface HouseDraw { lot: number; owned: boolean; grid: string | null; roof: Roof }
