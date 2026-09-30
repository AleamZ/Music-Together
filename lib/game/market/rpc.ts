// Chợ Lớn's restaurant RPC (v18.4): eat_meal charges the coins, consumes the fish and restores the bars server-side.
import { supabase } from "@/lib/supabase";
import { parseVitals, type VitalsState } from "@/lib/game/vitals-rpc";

/** `discount` (econ v2, 0105): the xu taken off for the fish (the percentage `discountPct`, capped at 3 × its price). */
export interface MealResult { paid: number; discountPct: number; discount: number; coins: number; vitals: VitalsState | null }

export async function eatMeal(token: string, itemId: string, fishId: string | null): Promise<MealResult> {
  const { data, error } = await supabase.rpc("eat_meal", { p_session_token: token, p_item: itemId, p_fish_id: fishId });
  if (error) throw error;
  const r = (data ?? {}) as Record<string, unknown>;
  return {
    paid: Number(r.paid ?? 0), discountPct: Number(r.discount_pct ?? 0), discount: Number(r.discount ?? 0), coins: Number(r.coins ?? 0),
    vitals: parseVitals(r.vitals),
  };
}

export function marketErrorMessage(msg: string): string {
  if (msg.includes("insufficient funds")) return "Không đủ xu để gọi món này.";
  if (msg.includes("fish not found")) return "Con cá đó không còn trong túi.";
  if (msg.includes("not a fish dish")) return "Món này không nấu bằng cá.";
  if (msg.includes("unknown meal")) return "Thực đơn không có món này.";
  return "Không gọi món được, thử lại nhé.";
}
