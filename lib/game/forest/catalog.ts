// The forest's static tables — supabase/migrations/0096_forest_professions.sql is authoritative; tests/unit/forest.test.ts
// pins every row equal to the SQL. Display and prediction only: every outcome is the server's.

export type TreeId = "cay_tre" | "cay_keo" | "cay_thong" | "cay_soi" | "cay_go_do" | "cay_tram_huong" | "cay_than_moc";
export type LogId = "go_tre" | "go_keo" | "go_thong" | "go_soi" | "go_do" | "go_tram_huong" | "go_than_moc";

export interface TreeKind {
  id: TreeId; name: string;
  /** Strikes to fell it. */
  need: number;
  respawnMin: number; log: LogId; logs: number;
  /** Xu per log (full price). */
  price: number;
  /** Hiếm or rarer. */
  rare: boolean;
  /** The kind hash (0…999) below this is this kind (the first row whose upto exceeds it). */
  upto: number;
}

export const TREES: readonly TreeKind[] = [
  { id: "cay_tre", name: "Tre", need: 3, respawnMin: 2, log: "go_tre", logs: 2, price: 12, rare: false, upto: 350 },
  { id: "cay_keo", name: "Keo", need: 4, respawnMin: 3, log: "go_keo", logs: 2, price: 18, rare: false, upto: 650 },
  { id: "cay_thong", name: "Thông", need: 5, respawnMin: 5, log: "go_thong", logs: 2, price: 28, rare: false, upto: 820 },
  { id: "cay_soi", name: "Sồi", need: 7, respawnMin: 8, log: "go_soi", logs: 2, price: 45, rare: true, upto: 920 },
  { id: "cay_go_do", name: "Gõ đỏ", need: 9, respawnMin: 15, log: "go_do", logs: 2, price: 75, rare: true, upto: 970 },
  { id: "cay_tram_huong", name: "Trầm hương", need: 12, respawnMin: 45, log: "go_tram_huong", logs: 1, price: 220, rare: true, upto: 993 },
  { id: "cay_than_moc", name: "Thần mộc", need: 16, respawnMin: 120, log: "go_than_moc", logs: 1, price: 480, rare: true, upto: 1000 },
];

export const LOG_NAME: Readonly<Record<LogId, string>> = {
  go_tre: "Gỗ tre", go_keo: "Gỗ keo", go_thong: "Gỗ thông", go_soi: "Gỗ sồi", go_do: "Gỗ gõ đỏ",
  go_tram_huong: "Gỗ trầm hương", go_than_moc: "Gỗ thần mộc",
};

/** 0096 _tree_of: the kind of the tree k (0…7) of forest cell (cx, cy). */
export function treeOf(cx: number, cy: number, k: number): TreeKind {
  const v = (((cx * 7919 + cy * 104729 + k * 1543) % 1000) + 1000) % 1000;
  return TREES.find((t) => v < t.upto) ?? TREES[TREES.length - 1];
}

export const treeKey = (cx: number, cy: number, k: number): string => `${cx}:${cy}:${k}`;
export const treeById = (id: string): TreeKind | null => TREES.find((t) => t.id === id) ?? null;
export const logPrice = (id: string): number => TREES.find((t) => t.log === id)?.price ?? 0;

/** The day's full-price logs (from the 41st: half price). */
export const DAILY_FULL_LOGS = 40;
/** Seconds between two chopping rounds, the stamina of one. */
export const CHOP_COOLDOWN_S = 1.5;
export const CHOP_STAMINA = 4;

export type ToolKind = "rod" | "hoe" | "pick" | "pan" | "scale" | "hammer" | "saw" | "gloves" | "bow" | "axe";
export interface ToolDef { id: string; prof: string; name: string; kind: ToolKind; durability: number; power: number; price: number; starter: boolean }

/** 0096 _prof_tools_catalog: a starter ("tập sự") tool per nghề and the axes the stall sells. */
export const TOOLS: readonly ToolDef[] = [
  { id: "can_cau_tap_su", prof: "ngu_dan", name: "Cần câu tập sự", kind: "rod", durability: 60, power: 1, price: 0, starter: true },
  { id: "cuoc_tap_su", prof: "nong_dan", name: "Cuốc tập sự", kind: "hoe", durability: 60, power: 1, price: 0, starter: true },
  { id: "cuoc_chim_tap_su", prof: "tho_mo", name: "Cuốc chim tập sự", kind: "pick", durability: 60, power: 1, price: 0, starter: true },
  { id: "chao_tap_su", prof: "dau_bep", name: "Chảo tập sự", kind: "pan", durability: 60, power: 1, price: 0, starter: true },
  { id: "can_hang_tap_su", prof: "thuong_nhan", name: "Cân hàng tập sự", kind: "scale", durability: 60, power: 1, price: 0, starter: true },
  { id: "bua_ren_tap_su", prof: "tho_ren", name: "Búa rèn tập sự", kind: "hammer", durability: 60, power: 1, price: 0, starter: true },
  { id: "cua_tap_su", prof: "tho_moc", name: "Cưa tập sự", kind: "saw", durability: 60, power: 1, price: 0, starter: true },
  { id: "gang_tay_tap_su", prof: "vo_si", name: "Găng tay tập sự", kind: "gloves", durability: 60, power: 1, price: 0, starter: true },
  { id: "cung_tap_su", prof: "tho_san", name: "Cung tập sự", kind: "bow", durability: 60, power: 1, price: 0, starter: true },
  { id: "riu_tap_su", prof: "tieu_phu", name: "Rìu tập sự", kind: "axe", durability: 60, power: 1, price: 80, starter: true },
  { id: "riu_sat", prof: "tieu_phu", name: "Rìu sắt", kind: "axe", durability: 120, power: 2, price: 450, starter: false },
  { id: "riu_thep", prof: "tieu_phu", name: "Rìu thép", kind: "axe", durability: 200, power: 3, price: 1600, starter: false },
  { id: "riu_tinh_luyen", prof: "tieu_phu", name: "Rìu tinh luyện", kind: "axe", durability: 300, power: 4, price: 4500, starter: false },
];
export const toolById = (id: string): ToolDef | null => TOOLS.find((t) => t.id === id) ?? null;
export const starterOf = (prof: string): ToolDef | null => TOOLS.find((t) => t.prof === prof && t.starter) ?? null;

export type RecipeId = "com_thit_tho" | "com_rau_nam";
export type CookStep = "slice" | "stir" | "fire";
export interface Recipe { id: RecipeId; name: string; meat: string | null; meatQty: number; fee: number; steps: CookStep[]; price: number; stamina: number }

/** 0096 _cook_recipes (the Đầu bếp's only). */
export const RECIPES: readonly Recipe[] = [
  { id: "com_thit_tho", name: "Cơm thịt thỏ", meat: "thit_tho", meatQty: 1, fee: 20, steps: ["slice", "fire"], price: 140, stamina: 15 },
  { id: "com_rau_nam", name: "Cơm rau nấm", meat: null, meatQty: 0, fee: 60, steps: ["slice", "stir", "fire"], price: 100, stamina: 12 },
];
export const recipeById = (id: string): Recipe | null => RECIPES.find((r) => r.id === id) ?? null;

export const QUALITY_NAME = ["Hỏng", "Đạt", "Ngon", "Tuyệt phẩm"] as const;
/** 0096 _cook_quality. */
export const cookQuality = (score: number): 0 | 1 | 2 | 3 => (score >= 90 ? 3 : score >= 70 ? 2 : score >= 40 ? 1 : 0);
/** 0096 _cook_pct: the quality's % of the price and the stamina. */
export const cookPct = (q: number): number => (q === 3 ? 150 : q === 2 ? 125 : q === 1 ? 100 : 20);
/** cook_sell's pay for one dish; cook_eat's stamina. */
export const dishPrice = (r: Recipe, q: number): number => Math.floor((r.price * cookPct(q)) / 100);
export const dishStamina = (r: Recipe, q: number): number => (q === 0 ? 0 : Math.floor((r.stamina * cookPct(q)) / 100));
