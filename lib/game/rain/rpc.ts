import { supabase } from "@/lib/supabase";
import { parseRain, type RainState, type UmbrellaKind } from "./model";

// v18.9: the umbrella RPCs of 0038_rain.sql.

async function call(fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data;
}

export async function rainState(token: string): Promise<RainState | null> {
  return parseRain(await call("rain_state", { p_session_token: token }));
}

/** Buy an umbrella: the new state (my coins are the caller's to reload). */
export async function buyUmbrella(token: string, kind: UmbrellaKind): Promise<RainState | null> {
  return parseRain(await call("umbrella_buy", { p_session_token: token, p_kind: kind }));
}

/** Hold umbrella `id` (null: put it away). */
export async function holdUmbrella(token: string, id: number | null): Promise<RainState | null> {
  return parseRain(await call("umbrella_hold", { p_session_token: token, p_id: id }));
}
