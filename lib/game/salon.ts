// v18.6 anh Ba's salon at Chợ Lớn: the salon_style RPC of 0029_fashion2.sql. The server owns the prices and the hair
// lists; these are display copies (pinned equal by tests).
import { supabase } from "@/lib/supabase";
import { HAIR_COLORS, HAIR_STYLES, type HairColor, type HairStyle } from "./types";

export interface HairPick { hair: HairStyle; hairColor: HairColor }

export const SALON_STYLE_PRICE = 300;
export const SALON_COLOR_PRICE = 500;
export const SALON_BOTH_PRICE = 700;

/** What anh Ba charges to go from `cur` to `next`: 300 for the style only, 500 for the colour only, 700 for both, and
 *  null when nothing changes (the server refuses that with 'no change'). */
export function salonPrice(cur: HairPick, next: HairPick): number | null {
  const style = cur.hair !== next.hair, color = cur.hairColor !== next.hairColor;
  if (style && color) return SALON_BOTH_PRICE;
  if (style) return SALON_STYLE_PRICE;
  if (color) return SALON_COLOR_PRICE;
  return null;
}

export interface SalonResult extends HairPick { paid: number; coins: number }

export async function salonStyle(token: string, hair: HairStyle, color: HairColor): Promise<SalonResult> {
  const { data, error } = await supabase.rpc("salon_style", { p_session_token: token, p_hair: hair, p_hair_color: color });
  if (error) throw error;
  const r = (data ?? {}) as Record<string, unknown>;
  const h = String(r.hair ?? hair), c = String(r.hair_color ?? color);
  return {
    hair: (HAIR_STYLES as readonly string[]).includes(h) ? (h as HairStyle) : hair,
    hairColor: (HAIR_COLORS as readonly string[]).includes(c) ? (c as HairColor) : color,
    paid: Number(r.paid ?? 0),
    coins: Number(r.coins ?? 0),
  };
}

export function salonErrorMessage(e: unknown): string {
  const msg = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e);
  if (msg.includes("no change")) return "Kiểu tóc này bạn đang để rồi — chọn kiểu hoặc màu khác nhé.";
  if (msg.includes("insufficient funds")) return "Không đủ xu để làm tóc.";
  if (msg.includes("hair not for this gender")) return "Kiểu tóc này anh Ba không làm cho dáng người của bạn.";
  if (msg.includes("invalid option")) return "Anh Ba không làm kiểu tóc này.";
  if (msg.includes("no character")) return "Bạn cần tạo nhân vật trước đã.";
  return "Chưa làm tóc được, thử lại nhé.";
}
