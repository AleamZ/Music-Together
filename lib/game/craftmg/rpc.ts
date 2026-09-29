import { AnticheatError, screenAnswer } from "@/lib/anticheat";
import { supabase } from "@/lib/supabase";
import { parseExtrasState, type ExtrasState } from "@/lib/game/fishing/extras";
import { parseMineState, type MineState } from "@/lib/game/mining/rpc";

// Supabase calls for the v22 crafting minigames (0084): *_start returns the round's seed, *_finish sends only the inputs
// (the server replays them). A flagged answer throws an AnticheatError.

export type CraftGame = "brew" | "anvil" | "sort";
export interface CraftRound { game: CraftGame; seed: number; label: string }

async function call(fn: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc(fn, args);
  const flagged = screenAnswer(data, error);
  if (error) throw error;
  if (flagged) throw new AnticheatError(flagged);
  return (data ?? {}) as Record<string, unknown>;
}
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
function mine(r: Record<string, unknown>): MineState {
  const s = parseMineState(r.state);
  if (!s) throw new Error("bad mine state");
  return s;
}
function extras(r: Record<string, unknown>): ExtrasState {
  const s = parseExtrasState(r.extras);
  if (!s) throw new Error("bad extras state");
  return s;
}
function seedOf(r: Record<string, unknown>): number {
  const s = obj(r.round).seed;
  if (typeof s !== "number") throw new Error("bad round");
  return s >>> 0;
}
/** 'lost' answers: expired / refused. */
export type Lost = { result: "lost"; why: "expired" | "refused" };
const lost = (r: Record<string, unknown>): Lost => ({ result: "lost", why: r.why === "expired" ? "expired" : "refused" });

export async function brewStart(token: string, recipe: string, qty: number): Promise<{ seed: number; state: MineState }> {
  const r = await call("brew_start", { p_session_token: token, p_recipe: recipe, p_qty: qty });
  return { seed: seedOf(r), state: mine(r) };
}
export type BrewAnswer = { result: "brewed"; potion: string; qty: number; quality: 1 | 2 | 3; bonus: number } | Lost;
export async function brewFinish(token: string, toggles: readonly number[], score: number): Promise<{ answer: BrewAnswer; state: MineState }> {
  const r = await call("brew_finish", { p_session_token: token, p_toggles: toggles, p_score: score });
  if (r.result !== "brewed") return { answer: lost(r), state: mine(r) };
  const b = obj(r.brewed);
  const q = num(b.quality, 1);
  return { answer: { result: "brewed", potion: String(b.potion ?? ""), qty: num(b.qty, 1), quality: q === 3 ? 3 : q === 2 ? 2 : 1, bonus: num(b.bonus) }, state: mine(r) };
}

export async function upgradeStart(token: string, item: string): Promise<{ seed: number; chance: number; state: MineState }> {
  const r = await call("upgrade_start", { p_session_token: token, p_item: item });
  return { seed: seedOf(r), chance: num(obj(r.round).chance), state: mine(r) };
}
export type AnvilAnswer = { result: "done"; item: string; ok: boolean; level: number; chance: number; nudge: number; final: number } | Lost;
export async function upgradeFinish(token: string, strikes: readonly number[], ticks: number, score: number): Promise<{ answer: AnvilAnswer; state: MineState }> {
  const r = await call("upgrade_finish", { p_session_token: token, p_strikes: strikes, p_ticks: ticks, p_score: score });
  if (r.result !== "done") return { answer: lost(r), state: mine(r) };
  const u = obj(r.upgrade);
  return {
    answer: { result: "done", item: String(u.item ?? ""), ok: u.ok === true, level: num(u.level), chance: num(u.chance), nudge: num(u.nudge), final: num(u.final) },
    state: mine(r),
  };
}

export async function sortStart(token: string): Promise<{ seed: number; state: ExtrasState }> {
  const r = await call("process_sort_start", { p_session_token: token });
  return { seed: seedOf(r), state: extras(r) };
}
export type SortAnswer = { result: "collected"; score: number; pct: number; bonus: number } | Lost;
export async function sortFinish(token: string, ticks: readonly number[], dirs: readonly number[], score: number): Promise<{ answer: SortAnswer; state: ExtrasState }> {
  const r = await call("process_sort_finish", { p_session_token: token, p_ticks: ticks, p_dirs: dirs, p_score: score });
  if (r.result !== "collected") return { answer: lost(r), state: extras(r) };
  return { answer: { result: "collected", score: num(r.score), pct: num(r.bonus_pct), bonus: num(r.bonus) }, state: extras(r) };
}
