// Client side of the fishing config tables (spec §7): types, rarity names and colours, number formats. Pure.

export type Rarity = 1 | 2 | 3 | 4 | 5;
export const RARITY_NAME: Record<Rarity, string> = { 1: "Thường", 2: "Khá", 3: "Hiếm", 4: "Quý", 5: "Huyền thoại" };
export const RARITY_COLOR: Record<Rarity, string> = { 1: "#9aa0a6", 2: "#4caf50", 3: "#2f80ed", 4: "#9b51e0", 5: "#f2994a" };

export function isRarity(v: unknown): v is Rarity {
  return v === 1 || v === 2 || v === 3 || v === 4 || v === 5;
}

export interface FishSpecies {
  id: string; name: string; rarity: Rarity; minG: number; maxG: number; pricePerKg: number; difficulty: number; sortOrder: number;
}

export type ShopKind = "rod" | "bobber" | "bait" | "bait_box" | "bucket";
const SHOP_KINDS: readonly string[] = ["rod", "bobber", "bait", "bait_box", "bucket"];

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
      return parts.join(" · ");
    }
    case "bobber": {
      const parts = [`Giật cần trong ${decimal((it.windowMs ?? 1500) / 1000)} giây`];
      if ((it.biteMaxMs ?? 10_000) < 10_000) parts.push("cá cắn nhanh hơn");
      if (it.showsRarity) parts.push("báo độ hiếm");
      return parts.join(" · ");
    }
    case "bait":
      if (it.multLegend > it.multHiem) return `Cá hiếm ×${decimal(it.multHiem)}, huyền thoại ×${decimal(it.multLegend)}`;
      if (it.multHiem > 1) return `Cá hiếm trở lên ×${decimal(it.multHiem)}`;
      return "Mồi thường — đào ở bãi trùn";
    case "bait_box":
      return `Chứa ${it.capacity ?? 0} mồi`;
    case "bucket":
      return `Đựng ${it.capacity ?? 0} con cá`;
  }
}
