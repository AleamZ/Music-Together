// Client side of the farm config (spec §7, §8.1, §9): varieties, farm items, the land prices and number formats. Pure.

export type FarmItemKind = "seed" | "fertilizer" | "pesticide" | "critter_box";
export type FertKind = "manure" | "phosphate" | "urea" | "potash" | "npk";
export type PestTarget = "insect" | "hopper" | "fungus";

/** The shop_items kinds the farm shop sells (the fishing shop sells the others). */
export const FARM_KINDS: readonly FarmItemKind[] = ["seed", "fertilizer", "pesticide", "critter_box"];
const FERTS: readonly string[] = ["manure", "phosphate", "urea", "potash", "npk"];
const TARGETS: readonly string[] = ["insect", "hopper", "fungus"];

export interface Variety { id: string; name: string; scale: number; baseKg: number; pricePerKg: number; blastMult: number; sortOrder: number }

export interface FarmItem {
  id: string;
  kind: FarmItemKind;
  name: string;
  price: number | null;
  sortOrder: number;
  /** seed: the variety it grows. */
  variety: string | null;
  fert: FertKind | null;
  pestTarget: PestTarget | null;
  /** critter_box (v15.2). */
  capacity: number | null;
}

export interface FarmCatalog { varieties: Variety[]; items: FarmItem[] }

/** Rows as PostgREST returns them. */
export interface VarietyRow { id: string; name: string; scale: number; base_kg: number; price_per_kg: number; blast_mult: number; sort_order: number }
export interface FarmItemRow {
  id: string; kind: string; name: string; price: number | null; sort_order: number;
  variety: string | null; fert: string | null; pest_target: string | null; capacity: number | null;
}

export function varietyFromRow(r: VarietyRow): Variety {
  return {
    id: r.id, name: r.name, scale: Number(r.scale), baseKg: r.base_kg, pricePerKg: r.price_per_kg,
    blastMult: Number(r.blast_mult ?? 1), sortOrder: r.sort_order,
  };
}

export function farmItemFromRow(r: FarmItemRow): FarmItem {
  return {
    id: r.id, kind: (FARM_KINDS as readonly string[]).includes(r.kind) ? (r.kind as FarmItemKind) : "seed", name: r.name,
    price: r.price, sortOrder: r.sort_order, variety: r.variety ?? null,
    fert: r.fert !== null && FERTS.includes(r.fert) ? (r.fert as FertKind) : null,
    pestTarget: r.pest_target !== null && TARGETS.includes(r.pest_target) ? (r.pest_target as PestTarget) : null,
    capacity: r.capacity ?? null,
  };
}

// The land rules' numbers — the server's constants in 0013 (spec §7).
export const RENT_PRICE = 250;
export const PLOT_PRICE = 4000;
export const SELL_BACK_PRICE = 2000;
export const LEASE_HOURS = 96;
export const SUBLEASE_MAX = 5000;
export const SALE_MAX = 1_000_000;
export const FARM_LIMIT = 2;
export const OFFER_HOURS = 24;
export const DRY_HOURS = 3;
export const DRYING_SLOTS = 4;
/** A farm consumable stacks up to this many. */
export const ITEM_CAP = 99;

/** What cô Út pays: dry rice at the full price per kg, wet rice at 70 % (the same integer arithmetic as sell_rice). */
export function ricePrice(kg: number, pricePerKg: number, dry: boolean): number {
  return dry ? kg * pricePerKg : Math.floor((kg * pricePerKg * 7) / 10);
}

/** Hours from soaking to ripe with prompt actions: 2 + 56·s (spec §8.1). */
export function ripeAfterHours(v: Variety): number {
  return Math.round(2 + 56 * v.scale);
}

/** The one-line use of a farm item, shown in the shop. */
export function describeFarmItem(it: FarmItem, varieties: readonly Variety[]): string {
  switch (it.kind) {
    case "seed": {
      const v = varieties.find((x) => x.id === it.variety);
      return v ? `Chín sau ~${ripeAfterHours(v)} giờ · ${v.baseKg} kg/thửa · ${v.pricePerKg} xu/kg lúa khô` : "Hạt giống lúa";
    }
    case "fertilizer":
      switch (it.fert) {
        case "manure":
        case "phosphate": return "Bón lót — trước khi cấy";
        case "urea": return "Bón thúc đẻ nhánh";
        case "potash": return "Bón đón đòng";
        case "npk": return "Bón thúc đẻ nhánh hoặc đón đòng";
        default: return "Phân bón";
      }
    case "pesticide":
      switch (it.pestTarget) {
        case "insect": return "Trị sâu cuốn lá";
        case "hopper": return "Trị rầy nâu";
        case "fungus": return "Trị đạo ôn lá và đạo ôn cổ bông";
        default: return "Thuốc bảo vệ thực vật";
      }
    case "critter_box":
      return `Đựng ${it.capacity ?? 0} con cua, ốc`;
  }
}
