import { supabase } from "@/lib/supabase";
import { HAIR_COLORS, HAIR_STYLES, SKIN_TONES, type ItemSlot, type Look } from "@/lib/game/types";

export interface CatalogItem { id: string; slot: ItemSlot; name: string; price: number; starter: boolean; sort_order: number }
export interface CharacterRow {
  account_id: string; skin: string; hair: string; hair_color: string;
  hat: string | null; top: string; bottom: string; shoes: string; neck: string | null;
}

export const DEFAULT_LOOK: Look = {
  skin: "warm", hair: "short", hairColor: "black",
  hat: "hat_nonla", top: "top_baba_yellow", bottom: "bottom_shorts_red", shoes: "shoes_dep_blue", neck: "neck_khanran",
};

function pick<T extends string>(list: readonly T[], v: string, fallback: T): T {
  return (list as readonly string[]).includes(v) ? (v as T) : fallback;
}

export function lookFromRow(row: CharacterRow): Look {
  return {
    skin: pick(SKIN_TONES, row.skin, DEFAULT_LOOK.skin),
    hair: pick(HAIR_STYLES, row.hair, DEFAULT_LOOK.hair),
    hairColor: pick(HAIR_COLORS, row.hair_color, DEFAULT_LOOK.hairColor),
    hat: row.hat ?? null,
    top: row.top,
    bottom: row.bottom,
    shoes: row.shoes,
    neck: row.neck ?? null,
  };
}

export type LookProblem = "option" | "slot" | "missing";

/** Mirrors save_character: body options from the fixed lists; items must be starter catalog items in the
 *  matching slot; top/bottom/shoes are required. null = valid. */
export function validateLook(look: Look, catalog: CatalogItem[]): LookProblem | null {
  if (!SKIN_TONES.includes(look.skin) || !HAIR_STYLES.includes(look.hair) || !HAIR_COLORS.includes(look.hairColor)) return "option";
  const byId = new Map(catalog.map((c) => [c.id, c] as const));
  const check = (id: string | null, slot: ItemSlot, required: boolean): LookProblem | null => {
    if (id === null || id === undefined) return required ? "missing" : null;
    const it = byId.get(id);
    return it && it.slot === slot && it.starter ? null : "slot";
  };
  return check(look.hat, "hat", false) ?? check(look.top, "top", true) ?? check(look.bottom, "bottom", true)
    ?? check(look.shoes, "shoes", true) ?? check(look.neck, "neck", false);
}

let catalogPromise: Promise<CatalogItem[]> | null = null;
/** Starter catalog (cached per page load; a failed fetch is retried next call). */
export function fetchCatalog(): Promise<CatalogItem[]> {
  if (!catalogPromise) {
    catalogPromise = (async () => {
      const { data, error } = await supabase
        .from("item_catalog").select("id, slot, name, price, starter, sort_order")
        .order("slot").order("sort_order");
      if (error) { catalogPromise = null; throw error; }
      return (data ?? []) as CatalogItem[];
    })();
  }
  return catalogPromise;
}

const LOOK_COLUMNS = "account_id, skin, hair, hair_color, hat, top, bottom, shoes, neck";

/** Looks of the given accounts; accounts without a character are simply absent from the map. */
export async function fetchCharacters(accountIds: string[]): Promise<Map<string, Look>> {
  const out = new Map<string, Look>();
  if (accountIds.length === 0) return out;
  const { data, error } = await supabase.from("characters").select(LOOK_COLUMNS).in("account_id", accountIds);
  if (error) throw error;
  for (const row of (data ?? []) as CharacterRow[]) out.set(row.account_id, lookFromRow(row));
  return out;
}

export async function saveCharacter(token: string, look: Look): Promise<Look> {
  const { data, error } = await supabase.rpc("save_character", {
    p_session_token: token, p_skin: look.skin, p_hair: look.hair, p_hair_color: look.hairColor,
    p_hat: look.hat, p_top: look.top, p_bottom: look.bottom, p_shoes: look.shoes, p_neck: look.neck,
  });
  if (error) throw error;
  return lookFromRow((Array.isArray(data) ? data[0] : data) as CharacterRow);
}

export function characterErrorMessage(err: unknown): string {
  const msg = (err as { message?: string } | null)?.message ?? "";
  if (msg.includes("invalid session")) return "Phiên đăng nhập đã hết hạn — hãy đăng nhập lại.";
  if (msg.includes("item not available")) return "Món đồ này chưa dùng được.";
  if (msg.includes("invalid character option")) return "Lựa chọn ngoại hình không hợp lệ.";
  return "Không lưu được nhân vật — thử lại nhé.";
}
