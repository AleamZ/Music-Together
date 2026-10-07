// The forest's static tables — supabase/migrations/0096_forest_professions.sql is authoritative (0097: the tools and the
// dishes; 0103, econ v2: the log and dish prices, the quality %, the day's logs); tests/unit/forest.test.ts pins every row
// equal to the SQL. Display and prediction only: every outcome is the server's.

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
  { id: "cay_tre", name: "Tre", need: 3, respawnMin: 2, log: "go_tre", logs: 2, price: 4, rare: false, upto: 350 },
  { id: "cay_keo", name: "Keo", need: 4, respawnMin: 3, log: "go_keo", logs: 2, price: 6, rare: false, upto: 650 },
  { id: "cay_thong", name: "Thông", need: 5, respawnMin: 5, log: "go_thong", logs: 2, price: 9, rare: false, upto: 820 },
  { id: "cay_soi", name: "Sồi", need: 7, respawnMin: 8, log: "go_soi", logs: 2, price: 15, rare: true, upto: 920 },
  { id: "cay_go_do", name: "Gõ đỏ", need: 9, respawnMin: 15, log: "go_do", logs: 2, price: 25, rare: true, upto: 970 },
  { id: "cay_tram_huong", name: "Trầm hương", need: 12, respawnMin: 45, log: "go_tram_huong", logs: 1, price: 73, rare: true, upto: 993 },
  { id: "cay_than_moc", name: "Thần mộc", need: 16, respawnMin: 120, log: "go_than_moc", logs: 1, price: 160, rare: true, upto: 1000 },
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

/** The day's full-price logs (econ v2, 0103: from the 31st, half price) and the day's most (then chop_start refuses). */
export const DAILY_FULL_LOGS = 30;
export const DAILY_MAX_LOGS = 150;
/** Seconds between two chopping rounds, the stamina of one. */
export const CHOP_COOLDOWN_S = 1.5;
export const CHOP_STAMINA = 4;

export type ToolKind = "rod" | "hoe" | "pick" | "pan" | "scale" | "hammer" | "saw" | "gloves" | "bow" | "axe";
export interface ToolDef {
  id: string; prof: string; name: string; kind: ToolKind; durability: number;
  /** An axe's strike; a bow's / a pan's tier. */
  power: number; price: number; starter: boolean;
  /** tool_repair: xu a missing point. */
  repairPp: number;
}

/** 0097 _prof_tools_catalog (forest-content's bow / pot / axe tiers): a starter ("tập sự") tool per nghề, all sold. */
export const TOOLS: readonly ToolDef[] = [
  { id: "can_cau_tap_su", prof: "ngu_dan", name: "Cần câu tập sự", kind: "rod", durability: 60, power: 1, price: 60, starter: true, repairPp: 1 },
  { id: "cuoc_tap_su", prof: "nong_dan", name: "Cuốc tập sự", kind: "hoe", durability: 60, power: 1, price: 60, starter: true, repairPp: 1 },
  { id: "cuoc_chim_tap_su", prof: "tho_mo", name: "Cuốc chim tập sự", kind: "pick", durability: 60, power: 1, price: 80, starter: true, repairPp: 1 },
  { id: "chao_tap_su", prof: "dau_bep", name: "Chảo tập sự", kind: "pan", durability: 60, power: 1, price: 80, starter: true, repairPp: 1 },
  { id: "can_hang_tap_su", prof: "thuong_nhan", name: "Cân hàng tập sự", kind: "scale", durability: 60, power: 1, price: 60, starter: true, repairPp: 1 },
  { id: "bua_ren_tap_su", prof: "tho_ren", name: "Búa rèn tập sự", kind: "hammer", durability: 60, power: 1, price: 80, starter: true, repairPp: 1 },
  { id: "cua_tap_su", prof: "tho_moc", name: "Cưa tập sự", kind: "saw", durability: 60, power: 1, price: 80, starter: true, repairPp: 1 },
  { id: "gang_tay_tap_su", prof: "vo_si", name: "Găng tay tập sự", kind: "gloves", durability: 60, power: 1, price: 60, starter: true, repairPp: 1 },
  { id: "cung_tap_su", prof: "tho_san", name: "Cung tập sự", kind: "bow", durability: 60, power: 1, price: 100, starter: true, repairPp: 1 },
  { id: "riu_tap_su", prof: "tieu_phu", name: "Rìu tập sự", kind: "axe", durability: 60, power: 1, price: 80, starter: true, repairPp: 1 },
  { id: "cung_tre", prof: "tho_san", name: "Cung tre", kind: "bow", durability: 60, power: 1, price: 280, starter: false, repairPp: 2 },
  { id: "cung_go_tram", prof: "tho_san", name: "Cung gỗ tràm", kind: "bow", durability: 110, power: 2, price: 850, starter: false, repairPp: 3 },
  { id: "cung_go_cung", prof: "tho_san", name: "Cung gỗ cứng", kind: "bow", durability: 180, power: 3, price: 1800, starter: false, repairPp: 4 },
  { id: "noi_dat", prof: "dau_bep", name: "Nồi đất", kind: "pan", durability: 70, power: 1, price: 240, starter: false, repairPp: 1 },
  { id: "chao_gang", prof: "dau_bep", name: "Chảo gang", kind: "pan", durability: 130, power: 2, price: 720, starter: false, repairPp: 2 },
  { id: "noi_gang", prof: "dau_bep", name: "Nồi gang", kind: "pan", durability: 210, power: 3, price: 1500, starter: false, repairPp: 3 },
  { id: "riu_sat", prof: "tieu_phu", name: "Rìu sắt", kind: "axe", durability: 80, power: 2, price: 300, starter: false, repairPp: 2 },
  { id: "riu_thep", prof: "tieu_phu", name: "Rìu thép", kind: "axe", durability: 140, power: 3, price: 900, starter: false, repairPp: 3 },
  { id: "riu_thep_toi", prof: "tieu_phu", name: "Rìu thép tôi", kind: "axe", durability: 220, power: 4, price: 1900, starter: false, repairPp: 4 },
  { id: "riu_tinh_luyen", prof: "tieu_phu", name: "Rìu tinh luyện", kind: "axe", durability: 300, power: 4, price: 4500, starter: false, repairPp: 4 },
];
export const toolById = (id: string): ToolDef | null => TOOLS.find((t) => t.id === id) ?? null;
/** 0121 _bow_bonus: the points a bow of this tier adds to a hunt's chance (5 a tier above the first). */
export const bowBonus = (tier: number): number => 5 * Math.max(0, tier - 1);
/** 0121 _pan_bonus: the points a pan of this tier adds to a dish's score (4 a tier above the first). */
export const panBonus = (tier: number): number => 4 * Math.max(0, tier - 1);
/** The most one sale at the stall takes (wood_sell / cook_sell / wild_sell refuse more as a bad quantity). */
export const SELL_MAX = 999;
export const starterOf = (prof: string): ToolDef | null => TOOLS.find((t) => t.prof === prof && t.starter) ?? null;

export type RecipeId = "ca_loc_nuong_trui" | "canh_chua_ca_loc" | "ca_ro_kho_tieu" | "bong_sung_xao_toi" | "goi_bong_dien_dien"
  | "chuot_dong_nuong_sa" | "com_tam_suon" | "lau_mam_ca_linh" | "chao_ga_rung" | "chao_ran_dau_xanh";
export type CookStep = "slice" | "stir" | "fire";
/** A dish's timed buff: an existing player_buffs kind, or 0097's hunt_chance. */
export type DishBuff = "stamina_regen" | "rare_fish" | "speed" | "strength" | "hunt_chance";
export interface Recipe {
  id: RecipeId; name: string; meat: string | null; meatQty: number;
  /** A fish of the catch (fish_species id) and how many. */
  fish: string | null; fishQty: number;
  /** The bought ingredients (xu). */
  fee: number; steps: CookStep[]; price: number; stamina: number;
  buff: DishBuff | null; buffValue: number; buffMin: number;
}

const R = (id: RecipeId, name: string, meat: string | null, meatQty: number, fish: string | null, fishQty: number, fee: number,
  steps: CookStep[], price: number, stamina: number, buff: DishBuff | null, buffValue: number, buffMin: number): Recipe =>
  ({ id, name, meat, meatQty, fish, fishQty, fee, steps, price, stamina, buff, buffValue, buffMin });

/** 0097 _cook_recipes — forest-content's ten Mekong dishes (the Đầu bếp's only; a pan needed). Econ v2 (0103) prices:
 *  a fee-only dish sells for 0.8 × its fee (it is for buffs and stamina); an ingredient dish for its fee + 1.3 × the
 *  ingredients' NPC value (meat at the stall's price; fish at its expected catch at the wooden rod, M = S = 1, on 0101's
 *  fish prices: cá lóc 10.33, cá rô 5.33, cá sặc 4.43) + 20. */
export const RECIPES: readonly Recipe[] = [
  R("ca_loc_nuong_trui", "Cá lóc nướng trui", null, 0, "ca_loc", 1, 10, ["fire", "slice", "stir"], 43, 12, null, 0, 0),
  R("canh_chua_ca_loc", "Canh chua cá lóc", null, 0, "ca_loc", 1, 10, ["slice", "fire", "stir"], 43, 16, "stamina_regen", 20, 10),
  R("ca_ro_kho_tieu", "Cá rô kho tiêu", null, 0, "ca_ro", 2, 10, ["stir", "fire"], 44, 11, "rare_fish", 5, 12),
  R("bong_sung_xao_toi", "Bông súng xào tỏi", null, 0, null, 0, 80, ["slice", "fire", "stir"], 64, 9, "speed", 5, 10),
  R("goi_bong_dien_dien", "Gỏi bông điên điển", null, 0, null, 0, 120, ["slice", "fire", "stir"], 96, 13, "strength", 10, 12),
  R("chuot_dong_nuong_sa", "Chuột đồng nướng sả", "thit_chuot_dong", 2, null, 0, 10, ["slice", "stir", "fire"], 121, 15, "hunt_chance", 3, 12),
  R("com_tam_suon", "Cơm tấm sườn", null, 0, null, 0, 120, ["slice", "fire", "stir"], 96, 18, null, 0, 0),
  R("lau_mam_ca_linh", "Lẩu mắm cá linh", null, 0, "ca_sac", 2, 26, ["slice", "fire", "stir"], 58, 22, "rare_fish", 10, 15),
  R("chao_ga_rung", "Cháo gà rừng", "thit_ga_rung", 1, null, 0, 13, ["slice", "fire", "stir"], 144, 20, "stamina_regen", 30, 12),
  R("chao_ran_dau_xanh", "Cháo rắn đậu xanh", "thit_ran_ri_ca", 1, null, 0, 16, ["slice", "fire", "stir"], 166, 21, "hunt_chance", 5, 15),
];
/** forest-content's "cooked" toasts. */
export const COOKED_TOAST: Readonly<Record<RecipeId, string>> = {
  ca_loc_nuong_trui: "Cá lóc nướng trui thơm phức, xong rồi!",
  canh_chua_ca_loc: "Canh chua cá lóc nóng hổi đây!",
  ca_ro_kho_tieu: "Cá rô kho tiêu đậm đà, xong rồi!",
  bong_sung_xao_toi: "Bông súng xào tỏi giòn ngon đây!",
  goi_bong_dien_dien: "Gỏi bông điên điển trộn xong rồi!",
  chuot_dong_nuong_sa: "Chuột đồng nướng sả thơm lừng!",
  com_tam_suon: "Cơm tấm sườn nóng hổi đây!",
  lau_mam_ca_linh: "Lẩu mắm cá linh sôi rồi nghen!",
  chao_ga_rung: "Cháo gà rừng ấm bụng đây!",
  chao_ran_dau_xanh: "Cháo rắn đậu xanh chín rồi!",
};
export const recipeById = (id: string): Recipe | null => RECIPES.find((r) => r.id === id) ?? null;

export const QUALITY_NAME = ["Hỏng", "Đạt", "Ngon", "Tuyệt phẩm"] as const;
/** 0096 _cook_quality. */
export const cookQuality = (score: number): 0 | 1 | 2 | 3 => (score >= 90 ? 3 : score >= 70 ? 2 : score >= 40 ? 1 : 0);
/** _cook_pct (0103: 20 / 100 / 110 / 125, was 20 / 100 / 125 / 150): the quality's % of the price, the stamina and the buff. */
export const cookPct = (q: number): number => (q === 3 ? 125 : q === 2 ? 110 : q === 1 ? 100 : 20);
/** cook_sell's value of one dish (before the thương lái); cook_eat's stamina (0103: half of the recipe's × the quality's %). */
export const dishPrice = (r: Recipe, q: number): number => Math.floor((r.price * cookPct(q)) / 100);
export const dishStamina = (r: Recipe, q: number): number => (q === 0 ? 0 : Math.floor((r.stamina * cookPct(q)) / 200));
/** The stamina a dish costs to cook (0103, cook_start). */
export const COOK_STAMINA = 2;

export const DISH_BUFF_TEXT: Readonly<Record<DishBuff, (v: number) => string>> = {
  stamina_regen: (v) => `hồi thể lực +${v}%`, rare_fish: (v) => `+${v}% cá hiếm`, speed: (v) => `+${v}% tốc độ`,
  strength: (v) => `bớt ${v}% thể lực khi làm`, hunt_chance: (v) => `+${v} điểm % săn`,
};
/** cook_eat's buff minutes (× the quality's %; Hỏng: none). */
export const dishBuffMin = (r: Recipe, q: number): number => (q === 0 || !r.buff ? 0 : Math.floor((r.buffMin * cookPct(q)) / 100));
/** tool_repair's price: the tool's price a point × the missing points. */
export const repairCost = (t: ToolDef, durability: number, max: number): number => t.repairPp * Math.max(0, max - durability);
/** The fish of the catch the dishes use. */
export const FISH_NAME: Readonly<Record<string, string>> = { ca_loc: "Cá lóc", ca_ro: "Cá rô đồng", ca_sac: "Cá sặc rằn" };
/** 0097 Rừng tràm (the 2D map): its px + this = world px (_forest_origin). */
export const RUNG_TRAM_ORIGIN = { x: 2112, y: 1600 } as const;
