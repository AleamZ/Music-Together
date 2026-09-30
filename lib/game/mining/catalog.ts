// The mine's catalogs (v21 #19, #26, #89): 0072's seed rows, mirrored for the panels. tests/unit/mining.test.ts pins
// every row against supabase/migrations/0072_mining_crafting.sql, the prices and fees against 0103_econ_crafts.sql (econ v2:
// ores ÷ 4, potion fees). The server decides every price, roll and cost.

export type CraftKind = "ore" | "herb" | "potion";

export interface CraftItem {
  id: string;
  kind: CraftKind;
  name: string;
  /** 1 Common … 6 Mythic (lib/game/rarity.ts). */
  rarity: number;
  /** What chú Tám pays (ores, herbs). */
  price: number | null;
  /** Ores: good strikes needed; the least pickaxe tier. */
  hardness: number | null;
  minTier: number | null;
  /** Ores, herbs: the node's wait once taken (s). */
  respawnS: number | null;
  xp: number;
  icon: string;
}

const i = (id: string, kind: CraftKind, name: string, rarity: number, price: number | null, hardness: number | null,
  minTier: number | null, respawnS: number | null, xp: number, icon: string): CraftItem =>
  ({ id, kind, name, rarity, price, hardness, minTier, respawnS, xp, icon });

export const CRAFT_ITEMS: readonly CraftItem[] = [
  i("ore_da", "ore", "Đá", 1, 1, 2, 1, 30, 2, "🪨"),
  i("ore_than", "ore", "Than", 1, 3, 2, 1, 45, 3, "⚫"),
  i("ore_dong", "ore", "Quặng đồng", 2, 6, 3, 1, 90, 5, "🟠"),
  i("ore_sat", "ore", "Quặng sắt", 2, 10, 3, 2, 120, 6, "⚙️"),
  i("ore_bac", "ore", "Quặng bạc", 3, 20, 4, 2, 180, 10, "🥈"),
  i("ore_vang", "ore", "Quặng vàng", 3, 40, 4, 3, 300, 15, "🥇"),
  i("ore_ngoc", "ore", "Ngọc lục bảo", 4, 80, 4, 3, 420, 22, "💚"),
  i("ore_kimcuong", "ore", "Kim cương", 5, 175, 5, 4, 600, 35, "💎"),
  i("ore_tinhthe", "ore", "Tinh thể lửa", 6, 500, 5, 4, 900, 70, "🔥"),
  i("herb_nam", "herb", "Nấm hang", 1, 3, null, null, 60, 1, "🍄"),
  i("herb_reu", "herb", "Rêu phát sáng", 2, 8, null, null, 90, 2, "🌿"),
  i("herb_linhchi", "herb", "Nấm linh chi", 3, 30, null, null, 180, 4, "🍂"),
  i("pot_hunger", "potion", "Cháo nấm bồi bổ", 1, null, null, null, null, 0, "🥣"),
  i("pot_thirst", "potion", "Nước rêu mát lành", 1, null, null, null, null, 0, "🧃"),
  i("pot_canh", "potion", "Canh cá hồi sức", 2, null, null, null, null, 0, "🍲"),
  i("pot_cure", "potion", "Thuốc giải cảm", 2, null, null, null, null, 0, "💊"),
  i("pot_miner", "potion", "Thuốc thợ mỏ", 3, null, null, null, null, 0, "⛏️"),
  i("pot_luck", "potion", "Thuốc may mắn", 3, null, null, null, null, 0, "🍀"),
  i("pot_luck2", "potion", "Tiên dược vận may", 5, null, null, null, null, 0, "✨"),
];

export const craftItem = (id: string): CraftItem | undefined => CRAFT_ITEMS.find((x) => x.id === id);
/** A display name for any ingredient id ('fish' = any fish in the bag). */
export const ingredientName = (id: string): string => (id === "fish" ? "Cá (bất kỳ)" : craftItem(id)?.name ?? id);

export interface Pickaxe { id: string; name: string; tier: number; price: number; durability: number; rarity: number }
export const PICKAXES: readonly Pickaxe[] = [
  { id: "pick_da", name: "Cuốc chim đá", tier: 1, price: 150, durability: 60, rarity: 1 },
  { id: "pick_sat", name: "Cuốc chim sắt", tier: 2, price: 900, durability: 150, rarity: 2 },
  { id: "pick_thep", name: "Cuốc chim thép", tier: 3, price: 3500, durability: 300, rarity: 3 },
  { id: "pick_kc", name: "Cuốc chim kim cương", tier: 4, price: 12000, durability: 600, rarity: 4 },
];
export const pickaxe = (id: string): Pickaxe | undefined => PICKAXES.find((p) => p.id === id);

export type PotionEffect = "hunger" | "thirst" | "vitals" | "cure" | "luck" | "miner";
export interface Recipe { id: string; effect: PotionEffect; amount: number; durationS: number; fee: number; ingredients: Readonly<Record<string, number>> }
export const RECIPES: readonly Recipe[] = [
  { id: "pot_hunger", effect: "hunger", amount: 40, durationS: 0, fee: 60, ingredients: { herb_nam: 2 } },
  { id: "pot_thirst", effect: "thirst", amount: 40, durationS: 0, fee: 25, ingredients: { herb_reu: 2 } },
  { id: "pot_canh", effect: "vitals", amount: 60, durationS: 0, fee: 120, ingredients: { fish: 1, herb_nam: 1 } },
  { id: "pot_cure", effect: "cure", amount: 0, durationS: 0, fee: 30, ingredients: { herb_linhchi: 1, herb_reu: 1, ore_than: 1 } },
  { id: "pot_miner", effect: "miner", amount: 1, durationS: 600, fee: 300, ingredients: { herb_linhchi: 1, ore_sat: 2, ore_bac: 1 } },
  { id: "pot_luck", effect: "luck", amount: 1, durationS: 600, fee: 150, ingredients: { herb_linhchi: 2, ore_vang: 1 } },
  { id: "pot_luck2", effect: "luck", amount: 2, durationS: 1800, fee: 600, ingredients: { herb_linhchi: 3, ore_ngoc: 1, ore_kimcuong: 1 } },
];

/** What a potion does, in words. */
export function effectText(r: Recipe): string {
  switch (r.effect) {
    case "hunger": return `+${r.amount} no`;
    case "thirst": return `+${r.amount} khát`;
    case "vitals": return `+${r.amount} no và khát`;
    case "cure": return "Khỏi cảm lạnh, hết say nắng";
    case "luck": return `May mắn ×${r.amount} trong ${r.durationS / 60} phút (dễ câu cá hiếm hơn)`;
    case "miner": return `+1 quặng mỗi lần đào trong ${r.durationS / 60} phút`;
  }
}

export const BUFF_NAME: Readonly<Record<"luck" | "miner", string>> = { luck: "🍀 May mắn", miner: "⛏️ Thợ mỏ" };

/** The node pools (public._mine_pool): zone → [item, weight]. Nodes 1–4 zone 1, 5–8 zone 2, 9–10 zone 3, 11–13 zone 4,
 *  14 zone 5. */
export const NODE_POOLS: Readonly<Record<number, ReadonlyArray<readonly [string, number]>>> = {
  1: [["ore_da", 45], ["ore_than", 30], ["ore_dong", 15], ["ore_sat", 8], ["ore_bac", 2]],
  2: [["ore_da", 15], ["ore_than", 20], ["ore_dong", 25], ["ore_sat", 22], ["ore_bac", 10], ["ore_vang", 6], ["ore_ngoc", 2]],
  3: [["ore_than", 10], ["ore_sat", 25], ["ore_bac", 25], ["ore_vang", 20], ["ore_ngoc", 12], ["ore_kimcuong", 7], ["ore_tinhthe", 1]],
  4: [["herb_nam", 60], ["herb_reu", 35], ["herb_linhchi", 5]],
  5: [["herb_nam", 30], ["herb_reu", 50], ["herb_linhchi", 20]],
};
export const nodeZone = (node: number): number =>
  node <= 4 ? 1 : node <= 8 ? 2 : node <= 10 ? 3 : node <= 13 ? 4 : 5;

/** The anvil (public._upgrade_*): materials per step (level → level + 1), success ‰, coins, max durability. */
export const UPGRADE_MATS: ReadonlyArray<Readonly<Record<string, number>>> = [
  { ore_dong: 3 }, { ore_sat: 3 }, { ore_bac: 3 }, { ore_vang: 3, ore_ngoc: 1 }, { ore_kimcuong: 1, ore_ngoc: 2 },
];
export const UPGRADE_CHANCE: readonly number[] = [900, 750, 600, 450, 300];
export const MAX_UPGRADE = 5;

/** Econ v2 (0103): digs a Vietnam day (mine_start), the stamina of a herb gather (gather_herb). */
export const DAILY_DIGS = 200;
export const HERB_STAMINA = 1;
/** Coins a try (0103: the floor 200 × (level + 1), so a starter rod or stone pick no longer upgrades for pocket change). */
export const upgradeCoins = (price: number | null, level: number): number =>
  Math.max(200 * (level + 1), Math.floor(((price ?? 0) * (level + 1)) / 4));
export const upgradeMax = (base: number | null, level: number): number | null => (base === null ? null : Math.floor((base * (100 + 20 * level)) / 100));

/** What an upgrade level does, in words. */
export function upgradeEffectText(kind: "rod" | "net" | "pickaxe", level: number): string {
  if (level <= 0) return "Chưa nâng cấp";
  const dur = `độ bền +${20 * level}%`;
  if (kind === "rod") return `${dur}, ${3 * level}% cá lên một bậc hiếm`;
  if (kind === "pickaxe") return `${dur}, vùng trúng +${12 * level}‰`;
  return dur;
}
