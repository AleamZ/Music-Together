// Client side of the fishing config tables (spec §7): types, rarity names and colours, number formats. Pure.

import { rarityInfo } from "@/lib/game/rarity";

export type Rarity = 1 | 2 | 3 | 4 | 5;
// v21 #88: the names and colours are the shared rarity scale's first five tiers (lib/game/rarity.ts).
const tier = (r: Rarity) => rarityInfo(r);
export const RARITY_NAME: Record<Rarity, string> = { 1: tier(1).label, 2: tier(2).label, 3: tier(3).label, 4: tier(4).label, 5: tier(5).label };
export const RARITY_COLOR: Record<Rarity, string> = { 1: tier(1).color, 2: tier(2).color, 3: tier(3).color, 4: tier(4).color, 5: tier(5).color };

export function isRarity(v: unknown): v is Rarity {
  return v === 1 || v === 2 || v === 3 || v === 4 || v === 5;
}

export interface FishSpecies {
  id: string; name: string; rarity: Rarity; minG: number; maxG: number; pricePerKg: number; difficulty: number; sortOrder: number;
}

export type ShopKind = "rod" | "bobber" | "bait" | "bait_box" | "bucket" | "net" | "fishing_kit";
/** The shop_items kinds the fishing shop sells (the farm items share the table since v15). */
export const FISHING_KINDS: readonly ShopKind[] = ["rod", "bobber", "bait", "bait_box", "bucket", "net", "fishing_kit"];
const SHOP_KINDS: readonly string[] = FISHING_KINDS;

export interface ShopItem {
  id: string;
  kind: ShopKind;
  name: string;
  /** null = not sold (starter gear, dug worms). */
  price: number | null;
  /** Everyone owns it. */
  starter: boolean;
  sortOrder: number;
  zonePct: number | null; weightK: number | null; rareMult: number;
  windowMs: number | null; biteMinMs: number | null; biteMaxMs: number | null; showsRarity: boolean;
  multHiem: number; multQuy: number; multLegend: number;
  capacity: number | null;
  /** v18.2: a rod's or net's max durability (net: throws); null = unbreakable (rod_wood). */
  durability?: number | null;
  /** v18.2: a net's radius in px (a big net, ≥ 32, brings one more fish). */
  radiusPx?: number | null;
  /** v18.2: bait: the bite wait × this (< 1 = a boosting bait, which also raises a shore bite to 80%). */
  biteBoost?: number;
}

export interface FishingCatalog { species: FishSpecies[]; items: ShopItem[] }

/** Rows as PostgREST returns them. */
export interface SpeciesRow {
  id: string; name: string; rarity: number; min_g: number; max_g: number; price_per_kg: number; difficulty: number; sort_order: number;
}
export interface ShopItemRow {
  id: string; kind: string; name: string; price: number | null; starter: boolean; sort_order: number;
  zone_pct: number | null; weight_k: number | null; rare_mult: number;
  window_ms: number | null; bite_min_ms: number | null; bite_max_ms: number | null; shows_rarity: boolean;
  mult_hiem: number; mult_quy: number; mult_legend: number; capacity: number | null;
  /** v18.2 (absent before 0034). */
  durability?: number | null; radius_px?: number | null; bite_boost?: number | null;
}

export function speciesFromRow(r: SpeciesRow): FishSpecies {
  return {
    id: r.id, name: r.name, rarity: isRarity(r.rarity) ? r.rarity : 1, minG: r.min_g, maxG: r.max_g,
    pricePerKg: r.price_per_kg, difficulty: r.difficulty, sortOrder: r.sort_order,
  };
}

export function shopItemFromRow(r: ShopItemRow): ShopItem {
  return {
    id: r.id, kind: SHOP_KINDS.includes(r.kind) ? (r.kind as ShopKind) : "bait", name: r.name, price: r.price,
    starter: r.starter, sortOrder: r.sort_order,
    zonePct: r.zone_pct, weightK: r.weight_k, rareMult: r.rare_mult ?? 1,
    windowMs: r.window_ms, biteMinMs: r.bite_min_ms, biteMaxMs: r.bite_max_ms, showsRarity: r.shows_rarity,
    multHiem: r.mult_hiem ?? 1, multQuy: r.mult_quy ?? 1, multLegend: r.mult_legend ?? 1, capacity: r.capacity,
    durability: r.durability ?? null, radiusPx: r.radius_px ?? null, biteBoost: r.bite_boost ?? 1,
  };
}

/** "350 g" under 1 kg; otherwise tenths rounded half up with a decimal comma: 1150 → "1,2 kg" (same rule as SQL `_weight_text`). */
export function formatWeight(g: number): string {
  if (g < 1000) return `${g} g`;
  const tenths = Math.round(g / 100);
  return `${Math.floor(tenths / 10)},${tenths % 10} kg`;
}

/** 1230 → "1.230 xu". */
export function formatXu(n: number): string {
  return `${n.toLocaleString("vi-VN")} xu`;
}

/** 1.5 → "1,5"; float4 noise (1.2000000476837158) is rounded away. */
const decimal = (n: number): string => String(Math.round(n * 100) / 100).replace(".", ",");

/** The effect line shown in the shop and the bag. */
export function describeItem(it: ShopItem): string {
  switch (it.kind) {
    case "rod": {
      const parts = [`Vùng giữ cá ${it.zonePct ?? 25}%`];
      if ((it.weightK ?? 2) < 2) parts.push("cá nặng hơn");
      if (it.rareMult > 1) parts.push(`cá hiếm +${Math.round((it.rareMult - 1) * 100)}%`);
      if (it.durability != null) parts.push(`bền ${it.durability} lần`);
      return parts.join(" · ");
    }
    case "bobber": {
      const parts = [`Giật cần trong ${decimal((it.windowMs ?? 1500) / 1000)} giây`];
      if ((it.biteMaxMs ?? 10_000) < 10_000) parts.push("cá cắn nhanh hơn");
      if (it.showsRarity) parts.push("báo độ hiếm");
      return parts.join(" · ");
    }
    case "bait":
      if ((it.biteBoost ?? 1) < 1) return `Cá cắn nhanh hơn, gần bờ dễ cắn · cá hiếm ×${decimal(it.multHiem)}`;
      if (it.multLegend > it.multHiem) return `Cá hiếm ×${decimal(it.multHiem)}, huyền thoại ×${decimal(it.multLegend)}`;
      if (it.multHiem > 1) return `Cá hiếm trở lên ×${decimal(it.multHiem)}`;
      return "Mồi thường — đào ở bãi trùn";
    case "bait_box":
      return `Chứa ${it.capacity ?? 0} mồi`;
    case "bucket":
      return `Đựng ${it.capacity ?? 0} con cá`;
    case "fishing_kit":
      return `Gồm Hộp mồi ${it.capacity ?? 0} (chứa ${it.capacity ?? 0} mồi) và Thùng cá ${it.capacity ?? 0} (đựng ${it.capacity ?? 0} con cá)`;
    case "net":
      return `Quăng ${it.durability ?? 0} lần · 2–5 cá thường${(it.radiusPx ?? 0) >= 32 ? " · lưới rộng, thêm 1 con" : ""}`;
  }
}
