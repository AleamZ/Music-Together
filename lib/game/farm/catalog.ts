// Client side of the farm config (spec §7, §8.1, §9; v15.2 §8.2, §9): varieties, hoa-màu crops, farm items, the land
// prices and number formats. Pure.

export type FarmItemKind = "seed" | "fertilizer" | "pesticide" | "critter_box" | "tool";
export type FertKind = "manure" | "phosphate" | "urea" | "potash" | "npk";
export type PestTarget = "insect" | "hopper" | "fungus";

/** The shop_items kinds the farm shop sells (the fishing shop sells the others). */
export const FARM_KINDS: readonly FarmItemKind[] = ["seed", "fertilizer", "pesticide", "critter_box", "tool"];
const FERTS: readonly string[] = ["manure", "phosphate", "urea", "potash", "npk"];
const TARGETS: readonly string[] = ["insect", "hopper", "fungus"];

export interface Variety { id: string; name: string; scale: number; baseKg: number; pricePerKg: number; blastMult: number; sortOrder: number }

export interface FarmItem {
  id: string;
  kind: FarmItemKind;
  name: string;
  price: number | null;
  sortOrder: number;
  /** A rice seed: the variety it grows. */
  variety: string | null;
  /** A hoa-màu seed (v15.2): the upland crop it grows. */
  upland: string | null;
  fert: FertKind | null;
  pestTarget: PestTarget | null;
  /** critter_box (v15.2). */
  capacity: number | null;
}

export type UplandMethod = "cutting" | "direct" | "nursery";

/** A growth stage (v15.2 §8.2): it lasts until `untilH` hours after P, and accepts these water levels. */
export interface UplandStage { id: string; name: string; untilH: number; water: number[] }

/** A care row (§8.5): a fertilizer window ("fert") or a hand job ("act"). */
export interface UplandCare {
  id: string;
  kind: "fert" | "act";
  name: string;
  items: string[];
  halfItems: string[];
  fromH: number;
  toH: number;
  halfFromH: number;
  halfToH: number;
  penHalf: number;
  penMissing: number;
}

/** A pest slot (§8.6): its hidden roll fires between fromH and toH after P. */
export interface UplandPest {
  slot: number;
  kind: string;
  name: string;
  fromH: number;
  toH: number;
  chance: number;
  dryMult: number;
  wetMult: number;
  remedy: string;
}

/** A hoa-màu crop, one upland_crops row (§8.2): hours count from P, the planting (or the transplant of a nursery crop). */
export interface UplandCrop {
  id: string;
  name: string;
  sortOrder: number;
  method: UplandMethod;
  plantLabel: string;
  transplantLabel: string | null;
  harvestLabel: string;
  harvestAnim: "dig" | "pick";
  baseKg: number;
  pricePerKg: number;
  nurseryReadyH: number | null;
  nurseryOldH: number | null;
  stages: UplandStage[];
  ripeWater: number[];
  ripeWindowH: number;
  overRate: number;
  lostAfterH: number;
  /** Each picking's share in percent (40, 35, 25). */
  pickings: number[];
  pickGapH: number | null;
  rotFromH: number | null;
  rotRate: number | null;
  rotCap: number | null;
  cares: UplandCare[];
  pests: UplandPest[];
}

export interface FarmCatalog { varieties: Variety[]; uplands: UplandCrop[]; items: FarmItem[] }

/** Rows as PostgREST returns them. */
export interface VarietyRow { id: string; name: string; scale: number; base_kg: number; price_per_kg: number; blast_mult: number; sort_order: number }
export interface FarmItemRow {
  id: string; kind: string; name: string; price: number | null; sort_order: number;
  variety: string | null; fert: string | null; pest_target: string | null; capacity: number | null;
  /** From 0016 on. */
  upland?: string | null;
}
export interface UplandCropRow {
  id: string; name: string; sort_order: number; method: string; plant_label: string; transplant_label: string | null;
  harvest_label: string; harvest_anim: string; base_kg: number; price_per_kg: number; nursery_ready_h: number | null;
  nursery_old_h: number | null; stages: unknown; ripe_water: unknown; ripe_window_h: number; over_rate: number;
  lost_after_h: number; pickings: unknown; pick_gap_h: number | null; rot_from_h: number | null; rot_rate: number | null;
  rot_cap: number | null; cares: unknown; pests: unknown;
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
    price: r.price, sortOrder: r.sort_order, variety: r.variety ?? null, upland: r.upland ?? null,
    fert: r.fert !== null && FERTS.includes(r.fert) ? (r.fert as FertKind) : null,
    pestTarget: r.pest_target !== null && TARGETS.includes(r.pest_target) ? (r.pest_target as PestTarget) : null,
    capacity: r.capacity ?? null,
  };
}

const rows = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : [];
const nums = (v: unknown): number[] => (Array.isArray(v) ? v.map(Number).filter(Number.isFinite) : []);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
const numOr = (v: unknown, d: number): number => numOrNull(v) ?? d;
const text = (v: unknown): string => (typeof v === "string" ? v : "");

export function uplandFromRow(r: UplandCropRow): UplandCrop {
  return {
    id: r.id, name: r.name, sortOrder: r.sort_order,
    method: r.method === "direct" || r.method === "nursery" ? r.method : "cutting",
    plantLabel: r.plant_label, transplantLabel: r.transplant_label ?? null, harvestLabel: r.harvest_label,
    harvestAnim: r.harvest_anim === "dig" ? "dig" : "pick",
    baseKg: r.base_kg, pricePerKg: r.price_per_kg,
    nurseryReadyH: numOrNull(r.nursery_ready_h), nurseryOldH: numOrNull(r.nursery_old_h),
    stages: rows(r.stages).map((x) => ({ id: text(x.id), name: text(x.name), untilH: numOr(x.until_h, 0), water: nums(x.water) })),
    ripeWater: nums(r.ripe_water), ripeWindowH: numOr(r.ripe_window_h, 0), overRate: numOr(r.over_rate, 0),
    lostAfterH: numOr(r.lost_after_h, 0), pickings: nums(r.pickings), pickGapH: numOrNull(r.pick_gap_h),
    rotFromH: numOrNull(r.rot_from_h), rotRate: numOrNull(r.rot_rate), rotCap: numOrNull(r.rot_cap),
    cares: rows(r.cares).map((x) => ({
      id: text(x.id), kind: x.kind === "act" ? "act" : "fert", name: text(x.name), items: strs(x.items), halfItems: strs(x.half_items),
      fromH: numOr(x.from_h, 0), toH: numOr(x.to_h, 0), halfFromH: numOr(x.half_from_h, 0), halfToH: numOr(x.half_to_h, 0),
      penHalf: numOr(x.pen_half, 0), penMissing: numOr(x.pen_missing, 0),
    })),
    pests: rows(r.pests).map((x) => ({
      slot: numOr(x.slot, 0), kind: text(x.kind), name: text(x.name), fromH: numOr(x.from_h, 0), toH: numOr(x.to_h, 0),
      chance: numOr(x.chance, 0), dryMult: numOr(x.dry_mult, 1), wetMult: numOr(x.wet_mult, 1), remedy: text(x.remedy),
    })),
  };
}

/** Hours from P to picking k's ripe time: the last stage's end, plus pick_gap_h per later picking (0016 `_up_hours`). */
export function uplandHours(u: UplandCrop, k: number): number {
  return (u.stages[u.stages.length - 1]?.untilH ?? 0) + (u.pickGapH ?? 0) * (k - 1);
}

// The land rules' numbers — the server's constants in 0013 (spec §7; the prices are economy spec §3.1).
export const RENT_PRICE = 10_000;
export const PLOT_PRICE = 800_000;
export const SELL_BACK_PRICE = 400_000;
export const LEASE_HOURS = 96;
export const SUBLEASE_MAX = 100_000;
export const SALE_MAX = 5_000_000;
export const FARM_LIMIT = 2;
export const OFFER_HOURS = 24;
export const DRY_HOURS = 3;
export const DRYING_SLOTS = 4;
/** Batches one account may dry at a time in a room. */
export const DRYING_PER_ACCOUNT = 2;
/** A crop's water log: at most this many entries, and this many in any hour (0013's `_farm_do_water`). */
export const WATER_LOG_MAX = 60;
export const WATER_PER_HOUR = 6;
/** A farm consumable stacks up to this many. */
export const ITEM_CAP = 99;

// The v15.2 tools and rules — the server's constants in 0016.
export const TOOL_SICKLE = "tool_sickle";
export const TOOL_SPRAYER = "tool_sprayer";
/** A rice plot is cut in this many parts (v15.2 §6.1). */
export const HARVEST_PARTS = 6;
/** The co-op's harvester: xu per part still uncut, and how long it runs (§6.3, R9). */
export const HARVESTER_PART_PRICE = 500;
export const HARVESTER_MS = 30_000;
/** harvest_part accepts a success from this long after its begin_work, and until the window ends (R6). */
export const PART_GATE_MS = 8_000;
export const PART_WINDOW_MS = 120_000;
/** The client claims a won round this long after the begin_work answer (§6.2). */
export const PART_WAIT_MS = 9_000;
/** begin_work needs this much left on a lease: a rice round (its play and its 9 s claim), and a transplant or a picking
 *  (R11). */
export const LEASE_ROUND_MS = 25_000;
export const LEASE_ACTION_MS = 5_000;
/** One bottle loads the sprayer's tank with this many sprays (§7). */
export const TANK_CHARGES = 3;
/** A hoa-màu crop records at most this many hand jobs (0016 `_farm_do_tend`). */
export const TEND_MAX = 20;
/** The hand jobs tend_crop's hard check takes (bad_work, 0016): the plot panel offers a config act only from these. */
export const TEND_ACTS: readonly string[] = ["lat_day", "vun_goc"];

/** What the harvester costs for a plot with `parts` already cut. */
export function harvesterPrice(parts: number): number {
  return HARVESTER_PART_PRICE * (HARVEST_PARTS - parts);
}

/** What cô Út pays for hoa màu, fresh: kg · price_per_kg (sell_produce). */
export function producePrice(kg: number, u: UplandCrop): number {
  return kg * u.pricePerKg;
}

/** What cô Út pays: dry rice at the full price per kg, wet rice at 70 % (the same integer arithmetic as sell_rice). */
export function ricePrice(kg: number, pricePerKg: number, dry: boolean): number {
  return dry ? kg * pricePerKg : Math.floor((kg * pricePerKg * 7) / 10);
}

/** Hours from soaking to ripe with prompt actions: 2 + 56·s (spec §8.1). */
export function ripeAfterHours(v: Variety): number {
  return Math.round(2 + 56 * v.scale);
}

/** A hoa-màu seed's line (§9): how it is planted, when it is ripe, the yield and the price. */
function describeUpland(u: UplandCrop): string {
  const how = u.method === "cutting" ? "Trồng dây" : u.method === "direct" ? "Gieo thẳng" : `Ươm ${u.nurseryReadyH ?? 0} giờ rồi trồng`;
  const n = u.pickings.length, h = uplandHours(u, 1);
  return `${how} · ${n > 1 ? `lứa đầu ~${h} giờ, ${n} lứa` : `chín ~${h} giờ`} · ${u.baseKg} kg/thửa · `
    + `${u.pricePerKg.toLocaleString("vi-VN")} xu/kg`;
}

/** The one-line use of a farm item, shown in the shop. */
export function describeFarmItem(it: FarmItem, varieties: readonly Variety[], uplands: readonly UplandCrop[] = []): string {
  switch (it.kind) {
    case "seed": {
      const u = uplands.find((x) => x.id === it.upland);
      if (u) return describeUpland(u);
      const v = varieties.find((x) => x.id === it.variety);
      return v ? `Chín sau ~${ripeAfterHours(v)} giờ · ${v.baseKg} kg/thửa · ${v.pricePerKg.toLocaleString("vi-VN")} xu/kg lúa khô` : "Hạt giống lúa";
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
        case "insect": return "Trị sâu cuốn lá, sùng khoai, sâu keo, bọ trĩ";
        case "hopper": return "Trị rầy nâu";
        case "fungus": return "Trị đạo ôn lá, đạo ôn cổ bông, thán thư";
        default: return "Thuốc bảo vệ thực vật";
      }
    case "critter_box":
      return `Đựng ${it.capacity ?? 0} con cua, ốc`;
    case "tool":
      return it.id === TOOL_SPRAYER ? "Nạp 1 chai thuốc được 3 lần xịt — mua một lần" : "Gặt lúa tay, 6 phần — mua một lần";
  }
}
