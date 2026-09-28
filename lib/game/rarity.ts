// v21 #88: one rarity scale for fish, ores, herbs, potions and tools. Tier numbers 1–6 are what the server stores
// (craft_items.rarity, pickaxe_kinds.rarity); fish keep their 1–5 (fish_species.rarity: Thường, Khá, Hiếm, Quý, Huyền
// thoại), which map onto the first five tiers unchanged. Pure.

export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary" | "mythic";

export const RARITIES: readonly Rarity[] = ["common", "uncommon", "rare", "epic", "legendary", "mythic"];

export interface RarityInfo {
  id: Rarity;
  tier: number;
  /** Vietnamese label. */
  label: string;
  /** Text colour (tiers 1–5 are the fishing colours of v14, unchanged). */
  color: string;
  /** A soft background for chips and card edges. */
  bg: string;
}

export const RARITY_INFO: Readonly<Record<Rarity, RarityInfo>> = {
  common:    { id: "common",    tier: 1, label: "Thường",      color: "#9aa0a6", bg: "#ecebe6" },
  uncommon:  { id: "uncommon",  tier: 2, label: "Khá",         color: "#4caf50", bg: "#dcefd6" },
  rare:      { id: "rare",      tier: 3, label: "Hiếm",        color: "#2f80ed", bg: "#d8e6f6" },
  epic:      { id: "epic",      tier: 4, label: "Quý",         color: "#9b51e0", bg: "#eadcf4" },
  legendary: { id: "legendary", tier: 5, label: "Huyền thoại", color: "#f2994a", bg: "#f8e6c4" },
  mythic:    { id: "mythic",    tier: 6, label: "Thần thoại",  color: "#e0443a", bg: "#f6d6d6" },
};

/** The rarity of a stored tier (clamped to 1–6; anything not a number is common). */
export function rarityOfTier(tier: number | null | undefined): Rarity {
  const t = typeof tier === "number" && Number.isFinite(tier) ? Math.min(6, Math.max(1, Math.round(tier))) : 1;
  return RARITIES[t - 1];
}

/** A fish species' rarity (1–5 → Common … Legendary). */
export const fishRarity = (fishTier: number | null | undefined): Rarity => rarityOfTier(Math.min(5, fishTier ?? 1));

/** The info of a stored tier. */
export const rarityInfo = (tier: number | null | undefined): RarityInfo => RARITY_INFO[rarityOfTier(tier)];
