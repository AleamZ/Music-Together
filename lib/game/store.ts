import { supabase } from "@/lib/supabase";
import { itemFitsGender, type CatalogItem, type CatalogSlot, type ItemGender } from "./character";
import type { Gender, Look } from "./types";

/** The 20 shape-based garments + 3 shoes of 0024_fashion_models.sql (docs/superpowers/fashion-models-contract.md). */
export const FASHION_MODELS: ReadonlyArray<{ id: string; name: string; slot: CatalogSlot; gender: ItemGender; price: number }> = [
  { id: "fm_hoodie", name: "Áo hoodie", slot: "top", gender: "unisex", price: 900 },
  { id: "fm_denim_jacket", name: "Áo khoác jean", slot: "top", gender: "unisex", price: 1200 },
  { id: "fm_school_shirt", name: "Sơ mi đồng phục", slot: "top", gender: "unisex", price: 600 },
  { id: "fm_ao_dai", name: "Áo dài", slot: "outfit", gender: "nu", price: 2500 },
  { id: "fm_ao_ba_ba", name: "Áo bà ba", slot: "top", gender: "unisex", price: 700 },
  { id: "fm_sailor_top", name: "Áo cổ thủy thủ", slot: "top", gender: "unisex", price: 800 },
  { id: "fm_varsity", name: "Áo bomber bóng chày", slot: "top", gender: "unisex", price: 1400 },
  { id: "fm_cardigan", name: "Áo cardigan", slot: "top", gender: "unisex", price: 1000 },
  { id: "fm_tank_top", name: "Áo ba lỗ", slot: "top", gender: "unisex", price: 400 },
  { id: "fm_raincoat", name: "Áo mưa", slot: "top", gender: "unisex", price: 900 },
  { id: "fm_kimono", name: "Áo kimono", slot: "outfit", gender: "unisex", price: 2200 },
  { id: "fm_jersey", name: "Áo đá banh", slot: "top", gender: "unisex", price: 800 },
  { id: "fm_chef_coat", name: "Áo đầu bếp", slot: "top", gender: "unisex", price: 1100 },
  { id: "fm_suit", name: "Áo vest", slot: "top", gender: "unisex", price: 1800 },
  { id: "fm_puffer", name: "Áo phao", slot: "top", gender: "unisex", price: 1600 },
  { id: "fm_pleated_skirt", name: "Váy xếp ly", slot: "bottom", gender: "nu", price: 700 },
  { id: "fm_maxi_dress", name: "Đầm maxi", slot: "outfit", gender: "nu", price: 2000 },
  { id: "fm_overalls", name: "Quần yếm", slot: "outfit", gender: "unisex", price: 1300 },
  { id: "fm_cargo_shorts", name: "Quần short túi hộp", slot: "bottom", gender: "unisex", price: 600 },
  { id: "fm_rolled_jeans", name: "Quần jean xắn gấu", slot: "bottom", gender: "unisex", price: 900 },
  { id: "fm_boots", name: "Giày bốt", slot: "shoes", gender: "unisex", price: 1000 },
  { id: "fm_sneakers", name: "Giày sneaker", slot: "shoes", gender: "unisex", price: 800 },
  { id: "fm_sandals", name: "Dép quai hậu", slot: "shoes", gender: "unisex", price: 300 },
];

/** ♂ / ♀ tag for a gender-only item; null for unisex. */
export function genderTag(item: Pick<CatalogItem, "gender">): string | null {
  if (item.gender === "nam") return "♂";
  if (item.gender === "nu") return "♀";
  return null;
}

/** Store tabs: one per garment slot, plus "accessory" ("💍 Phụ kiện") covering neck, wrist and hairpin. */
export type StoreCategory = "all" | "hat" | "top" | "bottom" | "outfit" | "shoes" | "accessory";
export const ACCESSORY_SLOTS: readonly CatalogSlot[] = ["neck", "wrist", "hairpin"];

export function categoryMatches(category: Exclude<StoreCategory, "all">, slot: CatalogSlot): boolean {
  return category === "accessory" ? ACCESSORY_SLOTS.includes(slot) : slot === category;
}

/** After an item leaves the wardrobe (sold / given away): unequip it, mirroring 0029 (top/bottom → null, not a starter). */
export function unequipItem(look: Look, itemId: string): Look | null {
  const next: Look = { ...look };
  let changed = false;
  for (const k of ["hat", "top", "bottom", "neck", "outfit", "wrist", "hairpin"] as const) {
    if (next[k] === itemId) { next[k] = null; changed = true; }
  }
  if (next.shoes === itemId) { next.shoes = "shoes_dep_blue"; changed = true; }
  return changed ? next : null;
}

export interface StoreFilter {
  tab: "store" | "my_items";
  category: StoreCategory;
  ownedIds: ReadonlySet<string>;
  /** "Hợp với tôi": hide items the player's body cannot wear. */
  fitsMe: boolean;
  gender: Gender;
}

/** v20.2: a dojo uniform (vp_*): granted by the Võ đường, never bought, sold or given. */
export const isUniformItem = (id: string): boolean => id.startsWith("vp_");

/** Items shown in the fashion store grid: never starters; the store tab lists everything, "my items" the owned ones. */
export function filterStoreItems(catalog: readonly CatalogItem[], f: StoreFilter): CatalogItem[] {
  return catalog.filter((item) => {
    if (item.starter) return false;
    if (f.tab === "store" && isUniformItem(item.id)) return false;             // v20.2: granted by the dojo, never sold
    if (f.tab === "my_items" && !f.ownedIds.has(item.id)) return false;
    if (f.category !== "all" && !categoryMatches(f.category, item.slot)) return false;
    if (f.fitsMe && !itemFitsGender(item, f.gender)) return false;
    return true;
  });
}

export interface WardrobeState {
  coins: number;
  items: string[];
}

export interface BuyResult {
  ok: boolean;
  item_id: string;
  coins: number;
}

export interface SellResult {
  ok: boolean;
  item_id: string;
  refund: number;
  coins: number;
}

export interface TransferResult {
  ok: boolean;
  item_id: string;
  sender_id: string;
  recipient_id: string;
}

/** Fetches the player's xu balance and owned fashion item ids. */
export async function fetchMyWardrobe(token: string): Promise<WardrobeState> {
  const { data, error } = await supabase.rpc("get_my_wardrobe", {
    p_session_token: token,
  });
  if (error) throw error;
  const res = data as { coins?: number; items?: string[] };
  return {
    coins: res?.coins ?? 0,
    items: Array.isArray(res?.items) ? res.items : [],
  };
}

/** Buys a fashion item using coins from the player's wallet. */
export async function buyFashionItem(token: string, itemId: string): Promise<BuyResult> {
  const { data, error } = await supabase.rpc("buy_fashion_item", {
    p_session_token: token,
    p_item_id: itemId,
  });
  if (error) throw error;
  return data as BuyResult;
}

/** Sells an owned fashion item back to the store for a 50% refund. */
export async function sellFashionItem(token: string, itemId: string): Promise<SellResult> {
  const { data, error } = await supabase.rpc("sell_fashion_item", {
    p_session_token: token,
    p_item_id: itemId,
  });
  if (error) throw error;
  return data as SellResult;
}

/** Transfers/passes an owned fashion item to another player in the room. */
export async function transferFashionItem(
  token: string,
  targetAccountId: string,
  itemId: string
): Promise<TransferResult> {
  const { data, error } = await supabase.rpc("transfer_fashion_item", {
    p_session_token: token,
    p_target_account_id: targetAccountId,
    p_item_id: itemId,
  });
  if (error) throw error;
  return data as TransferResult;
}

export function storeErrorMessage(err: unknown): string {
  const msg = (err as { message?: string } | null)?.message ?? "";
  if (msg.includes("insufficient funds")) return "Bạn không đủ xu để mua món này!";
  if (msg.includes("already owned")) return "Bạn đã sở hữu món đồ này rồi!";
  if (msg.includes("item is free starter")) return "Món đồ này đã có sẵn miễn phí trong tủ đồ.";
  if (msg.includes("recipient already owns item")) return "Người nhận đã có món đồ này rồi!";
  if (msg.includes("not owned")) return "Bạn chưa sở hữu món đồ này.";
  if (msg.includes("cannot sell item")) return "Không thể bán món đồ này.";
  if (msg.includes("cannot transfer item")) return "Không thể tặng món đồ này.";
  if (msg.includes("invalid target account")) return "Tài khoản người nhận không hợp lệ.";
  if (msg === "uniform" || msg.includes("uniform")) return "Võ phục do võ đường cấp — không mua, bán hay tặng được.";
  if (msg.includes("invalid session")) return "Phiên đăng nhập đã hết hạn — hãy đăng nhập lại.";
  return "Giao dịch không thành công — vui lòng thử lại!";
}
