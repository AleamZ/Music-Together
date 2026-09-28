import { supabase } from "@/lib/supabase";
import { parseProfState, parseStamina, type ProfState, type StaminaState } from "./model";
import type { ProfId } from "./catalog";

async function call(fn: string, args: Record<string, unknown>): Promise<ProfState> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  const s = parseProfState(data);
  if (!s) throw new Error("bad answer");
  return s;
}

export const professionState = (token: string) => call("profession_state", { p_session_token: token });
export const professionChoose = (token: string, prof: ProfId) =>
  call("profession_choose", { p_session_token: token, p_prof: prof });
export const skillLearn = (token: string, node: string) => call("skill_learn", { p_session_token: token, p_node: node });
export const skillReset = (token: string, prof: ProfId) => call("skill_reset", { p_session_token: token, p_prof: prof });

/** The stamina heartbeat: the sprint milliseconds since the last one, and whether I lie in the hammock. */
export async function staminaTick(token: string, runMs: number, resting: boolean): Promise<StaminaState | null> {
  const { data, error } = await supabase.rpc("stamina_tick", {
    p_session_token: token, p_run_ms: Math.max(0, Math.min(60000, Math.round(runMs))), p_resting: resting,
  });
  if (error) throw error;
  return parseStamina(data);
}
