import { AnticheatError, screenAnswer } from "@/lib/anticheat";
import { supabase } from "@/lib/supabase";
import { parseHeat, type HeatState } from "./model";

// v18.10: the heat and swim RPCs of 0033_heat_swim.sql. Cells are 8-px pond cells, a position claim since 0057: a refused
// one answers with the anti-cheat envelope (`too far`), thrown here as an AnticheatError.

async function call(fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.rpc(fn, args);
  const flagged = screenAnswer(data, error);
  if (error) throw error;
  if (flagged) throw new AnticheatError(flagged);
  return data;
}

export async function heatState(roomId: string, token: string): Promise<HeatState | null> {
  return parseHeat(await call("heat_state", { p_room_id: roomId, p_session_token: token }));
}

export async function warmUpStart(roomId: string, token: string, col: number, row: number): Promise<HeatState | null> {
  return parseHeat(await call("warm_up_start", { p_room_id: roomId, p_session_token: token, p_col: col, p_row: row }));
}

export async function warmUpFinish(roomId: string, token: string): Promise<HeatState | null> {
  return parseHeat(await call("warm_up_finish", { p_room_id: roomId, p_session_token: token }));
}

/** Jump in: the state, and whether the jump cramped. */
export async function jumpIn(roomId: string, token: string, col: number, row: number): Promise<{ heat: HeatState | null; cramp: boolean }> {
  const data = await call("jump_in", { p_room_id: roomId, p_session_token: token, p_col: col, p_row: row });
  const cramp = !!data && typeof data === "object" && (data as Record<string, unknown>).cramp === true;
  return { heat: parseHeat(data), cramp };
}

export async function leaveWater(roomId: string, token: string): Promise<HeatState | null> {
  return parseHeat(await call("leave_water", { p_room_id: roomId, p_session_token: token }));
}

export async function rescueSwimmer(roomId: string, token: string, victim: string, col: number, row: number): Promise<void> {
  await call("rescue_swimmer", { p_room_id: roomId, p_session_token: token, p_victim: victim, p_col: col, p_row: row });
}
