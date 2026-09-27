// v18.5 Đường ra chợ: the vehicle RPCs of 0027_vehicles.sql. The server owns the prices, the ownership and the skip charge.
import { supabase } from "@/lib/supabase";

function owned(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export async function vehiclesState(token: string): Promise<{ owned: string[] }> {
  const { data, error } = await supabase.rpc("vehicles_state", { p_session_token: token });
  if (error) throw error;
  return { owned: owned(((data ?? {}) as Record<string, unknown>).owned) };
}

export async function buyVehicle(token: string, vehicle: string): Promise<{ owned: string[]; coins: number }> {
  const { data, error } = await supabase.rpc("buy_vehicle", { p_session_token: token, p_vehicle: vehicle });
  if (error) throw error;
  const r = (data ?? {}) as Record<string, unknown>;
  return { owned: owned(r.owned), coins: Number(r.coins ?? 0) };
}

/** ông Tám buys an owned vehicle back at half its price (0028). */
export async function sellVehicle(token: string, vehicle: string): Promise<{ owned: string[]; coins: number }> {
  const { data, error } = await supabase.rpc("sell_vehicle", { p_session_token: token, p_vehicle: vehicle });
  if (error) throw error;
  const r = (data ?? {}) as Record<string, unknown>;
  return { owned: owned(r.owned), coins: Number(r.coins ?? 0) };
}

/** What ông Tám pays back for a vehicle: half its price, rounded down (mirrors sell_vehicle). */
export const sellBackPrice = (price: number): number => Math.floor((price * 50) / 100);

/** Bỏ qua (20 xu): the xe ôm takes you the rest of the way. */
export async function skipTrip(token: string): Promise<{ coins: number }> {
  const { data, error } = await supabase.rpc("skip_trip", { p_session_token: token });
  if (error) throw error;
  return { coins: Number(((data ?? {}) as Record<string, unknown>).coins ?? 0) };
}

export function travelErrorMessage(msg: string): string {
  if (msg.includes("already owned")) return "Bạn đã có xe này rồi.";
  if (msg.includes("not owned")) return "Bạn không có xe này để bán.";
  if (msg.includes("insufficient funds")) return "Không đủ xu để mua xe này.";
  if (msg.includes("unknown vehicle")) return "Ông Tám không bán loại xe này.";
  return "Không mua được, thử lại nhé.";
}
