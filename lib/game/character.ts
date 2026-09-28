import { supabase } from "@/lib/supabase";
import { DEFAULT_LOOK } from "@/lib/game/look";
import { GENDERS, HAIR_COLORS, HAIR_STYLES, SKIN_TONES, hairFitsGender, type Gender, type HairColor, type HairStyle, type ItemSlot, type Look } from "@/lib/game/types";

/** Catalog slots: the Look slots plus `outfit`, a full-body piece (added by 0024) drawn over top + bottom. */
export type CatalogSlot = ItemSlot | "outfit";
/** Who may wear an item (0024): "unisex" (default), or only the "nam" / "nu" body. */
export type ItemGender = "unisex" | Gender;
export const ITEM_GENDERS: readonly ItemGender[] = ["unisex", "nam", "nu"];

export interface CatalogItem {
  id: string; slot: CatalogSlot; name: string; price: number; starter: boolean; sort_order: number;
  /** Added by 0024; absent (older payloads) reads as "unisex". */
  gender?: ItemGender | null;
}

/** May a `gender` body wear this item? Unisex (or untagged) items fit everyone. */
export function itemFitsGender(item: Pick<CatalogItem, "gender">, gender: Gender): boolean {
  const g = item.gender ?? "unisex";
  return g === "unisex" || g === gender;
}
export interface CharacterRow {
  account_id: string; skin: string; hair: string; hair_color: string;
  hat: string | null; top: string | null; bottom: string | null; shoes: string; neck: string | null;
  /** Added by 0029; absent reads as none. */
  wrist?: string | null;
  hairpin?: string | null;
  /** Added by 0023; rows without it (older payloads) read as "nam". */
  gender?: string | null;
  /** Added by 0024; absent reads as no outfit. */
  outfit?: string | null;
  /** Added by 0051 (v20.3): the worn uniform's rank; absent reads as none. */
  belt?: number | null;
  /** Added by 0052 (v20.4): the newest underground season title (the name tag). */
  ug_title?: string | null;
  /** Added by 0070 (v21): the level and the worn title (the name tag). */
  pg_level?: number | null;
  pg_title?: string | null;
}

export { DEFAULT_LOOK };

/** A new character's hair (0029 save_character inserts it; hair changes only at the salon). */
export const DEFAULT_HAIR: Record<Gender, { hair: HairStyle; hairColor: HairColor }> = {
  nam: { hair: "short", hairColor: "black" },
  nu: { hair: "long", hairColor: "black" },
};

/** Hair after switching the body from `from` to `to` (0035 save_character does the same): a style the new body is not
 *  offered falls back to that body's default style (colour kept); unchanged body keeps whatever is worn. */
export function hairForBody(hair: HairStyle, from: Gender, to: Gender): HairStyle {
  if (from === to || hairFitsGender(hair, to)) return hair;
  return DEFAULT_HAIR[to].hair;
}

function pick<T extends string>(list: readonly T[], v: string, fallback: T): T {
  return (list as readonly string[]).includes(v) ? (v as T) : fallback;
}

export function lookFromRow(row: CharacterRow): Look {
  return {
    skin: pick(SKIN_TONES, row.skin, DEFAULT_LOOK.skin),
    hair: pick(HAIR_STYLES, row.hair, DEFAULT_LOOK.hair),
    hairColor: pick(HAIR_COLORS, row.hair_color, DEFAULT_LOOK.hairColor),
    hat: row.hat ?? null,
    top: row.top ?? null,
    bottom: row.bottom ?? null,
    shoes: row.shoes,
    neck: row.neck ?? null,
    wrist: row.wrist ?? null,
    hairpin: row.hairpin ?? null,
    gender: pick(GENDERS, row.gender ?? "", "nam" as Gender),
    outfit: row.outfit ?? null,
    ...(typeof row.belt === "number" && row.belt >= 0 && row.belt <= 4 ? { belt: row.belt } : {}),
    ...(typeof row.ug_title === "string" && row.ug_title.length > 0 && row.ug_title.length <= 40 ? { ugTitle: row.ug_title } : {}),
    ...(typeof row.pg_level === "number" && row.pg_level >= 1 && row.pg_level <= 99 ? { pgLevel: row.pg_level } : {}),
    ...(typeof row.pg_title === "string" && row.pg_title.length > 0 && row.pg_title.length <= 40 ? { pgTitle: row.pg_title } : {}),
  };
}

export type LookProblem = "option" | "slot" | "missing" | "gender";

/** Mirrors save_character: body options from the fixed lists; items must be catalog items in the
 *  matching slot, starter or owned; only shoes are required (top/bottom may be left empty, 0029); every worn item
 *  must fit the body's gender. null = valid. */
export function validateLook(look: Look, catalog: CatalogItem[], ownedItemIds?: Set<string> | readonly string[]): LookProblem | null {
  if (!SKIN_TONES.includes(look.skin) || !HAIR_STYLES.includes(look.hair) || !HAIR_COLORS.includes(look.hairColor)
    || (look.gender !== undefined && !GENDERS.includes(look.gender))) return "option";
  const byId = new Map(catalog.map((c) => [c.id, c] as const));
  const ownedSet = ownedItemIds instanceof Set ? ownedItemIds : new Set(ownedItemIds ?? []);
  const check = (id: string | null | undefined, slot: CatalogSlot, required: boolean): LookProblem | null => {
    if (id === null || id === undefined) return required ? "missing" : null;
    const it = byId.get(id);
    return it && it.slot === slot && (it.starter || ownedSet.has(it.id)) ? null : "slot";
  };
  const slotProblem = check(look.hat, "hat", false) ?? check(look.top, "top", false) ?? check(look.bottom, "bottom", false)
    ?? check(look.shoes, "shoes", true) ?? check(look.neck, "neck", false) ?? check(look.outfit, "outfit", false)
    ?? check(look.wrist, "wrist", false) ?? check(look.hairpin, "hairpin", false);
  if (slotProblem) return slotProblem;
  const gender: Gender = look.gender ?? "nam";
  const worn = [look.hat, look.top, look.bottom, look.shoes, look.neck, look.outfit, look.wrist, look.hairpin];
  return worn.some((id) => { const it = id ? byId.get(id) : undefined; return it !== undefined && !itemFitsGender(it, gender); })
    ? "gender" : null;
}

let catalogPromise: Promise<CatalogItem[]> | null = null;
/** Starter catalog (cached per page load; a failed fetch is retried next call). */
export function fetchCatalog(): Promise<CatalogItem[]> {
  if (!catalogPromise) {
    catalogPromise = (async () => {
      const { data, error } = await supabase
        .from("item_catalog").select("id, slot, name, price, starter, sort_order, gender")
        .order("slot").order("sort_order");
      if (error) { catalogPromise = null; throw error; }
      return (data ?? []) as CatalogItem[];
    })();
  }
  return catalogPromise;
}

const LOOK_COLUMNS = "account_id, skin, hair, hair_color, hat, top, bottom, shoes, neck, gender, outfit, wrist, hairpin";
/** v20.3 / v20.4: the extra columns (0051's belt, 0052's ug_title); a database without them yet is read without them, once
 *  and for all this page. */
const EXTRA_COLUMNS = ["belt, ug_title, pg_level, pg_title", "belt, ug_title", "belt", ""] as const;
let extra = 0;

/** Looks of the given accounts; accounts without a character are simply absent from the map. */
export async function fetchCharacters(accountIds: string[]): Promise<Map<string, Look>> {
  const out = new Map<string, Look>();
  if (accountIds.length === 0) return out;
  const run = (cols: string) => supabase.from("characters").select(cols).in("account_id", accountIds);
  const cols = () => (EXTRA_COLUMNS[extra] ? `${LOOK_COLUMNS}, ${EXTRA_COLUMNS[extra]}` : LOOK_COLUMNS);
  let res = await run(cols());
  while (res.error && extra < EXTRA_COLUMNS.length - 1 && (res.error.code === "42703" || /belt|ug_title|pg_level|pg_title/.test(res.error.message ?? ""))) {
    // no belt means no 0051, so no 0052 either: straight to the plain columns; no ug_title: drop only that
    extra = /belt/.test(res.error.message ?? "") ? EXTRA_COLUMNS.length - 1 : /ug_title/.test(res.error.message ?? "") ? EXTRA_COLUMNS.indexOf("belt") : extra + 1;   // v21: no pg_* drops only those
    res = await run(cols());
  }
  if (res.error) throw res.error;
  for (const row of (res.data ?? []) as unknown as CharacterRow[]) out.set(row.account_id, lookFromRow(row));
  return out;
}

export async function saveCharacter(token: string, look: Look): Promise<Look> {
  const { data, error } = await supabase.rpc("save_character", {
    p_session_token: token, p_skin: look.skin, p_hair: look.hair, p_hair_color: look.hairColor,
    p_hat: look.hat, p_top: look.top, p_bottom: look.bottom, p_shoes: look.shoes, p_neck: look.neck, p_gender: look.gender ?? "nam",
    p_outfit: look.outfit ?? null, p_wrist: look.wrist ?? null, p_hairpin: look.hairpin ?? null,
  });
  if (error) throw error;
  return lookFromRow((Array.isArray(data) ? data[0] : data) as CharacterRow);
}

export function characterErrorMessage(err: unknown): string {
  const msg = (err as { message?: string } | null)?.message ?? "";
  if (msg.includes("invalid session")) return "Phiên đăng nhập đã hết hạn — hãy đăng nhập lại.";
  if (msg.includes("item not for this gender")) return "Món đồ này không hợp với giới tính của nhân vật.";
  if (msg.includes("item not available")) return "Món đồ này chưa dùng được.";
  if (msg.includes("invalid character option")) return "Lựa chọn ngoại hình không hợp lệ.";
  return "Không lưu được nhân vật — thử lại nhé.";
}

/**
 * A wardrobe row's heading: plain `prefix`, then the chosen item's `name` (shown lighter), never naming the category twice.
 * "Mũ: " + "Nón lá"; "" + "Áo bà ba vàng" when the name already starts with the label (any case); "Khăn: " + "Không" for an
 * empty slot; just the label (`name` null) while the catalog loads or when the chosen id is not in it.
 */
export function rowHeading(label: string, chosen: string | null, catalog: CatalogItem[] | null): { prefix: string; name: string | null } {
  if (!catalog) return { prefix: label, name: null };
  if (chosen === null) return { prefix: `${label}: `, name: "Không" };
  const name = catalog.find((c) => c.id === chosen)?.name;
  if (name === undefined) return { prefix: label, name: null };
  return { prefix: name.toLowerCase().startsWith(label.toLowerCase()) ? "" : `${label}: `, name };
}
