import { AnticheatError, screenAnswer } from "@/lib/anticheat";
import { supabase } from "@/lib/supabase";
import { publishVitals } from "@/lib/game/vitals-rpc";
import { extrasErrorText, parseBattleBoard, parseExtrasState, type BattleBoard, type ExtrasState, type Heat, type MachineId } from "./extras";
import { fishingErrorMessage, type StartCast } from "./rpc";
import { isRarity } from "./catalog";
import { parseFishingState } from "./state";

// Supabase calls for the v21 fishing extras (0076). A flagged answer (a refused position claim) throws an AnticheatError.

async function call(fn: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc(fn, args);
  const flagged = screenAnswer(data, error);
  if (error) throw error;
  if (flagged) throw new AnticheatError(flagged);
  return (data ?? {}) as Record<string, unknown>;
}

function extras(raw: unknown): ExtrasState {
  const s = parseExtrasState(raw);
  if (!s) throw new Error("bad extras state");
  return s;
}
function board(raw: unknown): BattleBoard {
  const b = parseBattleBoard(raw);
  if (!b) throw new Error("bad battle board");
  return b;
}

/** Vietnamese text for an extras RPC error. */
export function extrasErrorMessage(err: unknown): string {
  const msg = err && typeof err === "object" && typeof (err as { message?: unknown }).message === "string" ? (err as { message: string }).message : "";
  return extrasErrorText(msg) ?? fishingErrorMessage(err);
}

export const fetchExtras = async (token: string) => extras(await call("fishing_extras_state", { p_session_token: token }));
export const buyBoat = async (roomId: string, token: string) => extras(await call("buy_boat", { p_room_id: roomId, p_session_token: token }));
export const boardBoat = async (roomId: string, token: string) => extras(await call("board_boat", { p_room_id: roomId, p_session_token: token }));
export const leaveBoat = async (roomId: string, token: string) => extras(await call("leave_boat", { p_room_id: roomId, p_session_token: token }));

/** start_boat_cast: start_cast's answer, from the boat's deck; the cast then goes on through hook_cast / finish_cast. */
export async function startBoatCast(roomId: string, token: string): Promise<StartCast> {
  const r = await call("start_boat_cast", { p_room_id: roomId, p_session_token: token });
  publishVitals(r.vitals);
  const state = parseFishingState(r.state);
  if (!state) throw new Error("bad fishing state");
  return {
    castId: String(r.cast_id), biteMs: Number(r.bite_ms), windowMs: Number(r.window_ms), difficulty: Number(r.difficulty),
    minReelMs: Number(r.min_reel_ms), zonePct: Number(r.zone_pct), rarity: isRarity(r.rarity) ? r.rarity : null,
    baitSwitched: r.bait_switched === true, spot: "dock", bites: r.bites !== false,
    reelSeed: null, serverHook: true, abandoned: null, state,
  };
}

export const fetchBattles = async (roomId: string, token: string) => board(await call("fb_state", { p_room_id: roomId, p_session_token: token }));
export const createBattle = async (roomId: string, token: string, fee: number, durationS: number) =>
  board(await call("fb_create", { p_room_id: roomId, p_session_token: token, p_fee: fee, p_duration_s: durationS }));
export const joinBattle = async (roomId: string, token: string, id: string) =>
  board(await call("fb_join", { p_room_id: roomId, p_session_token: token, p_battle: id }));
export const leaveBattle = async (roomId: string, token: string, id: string) =>
  board(await call("fb_leave", { p_room_id: roomId, p_session_token: token, p_battle: id }));
export const startBattle = async (roomId: string, token: string, id: string) =>
  board(await call("fb_start", { p_room_id: roomId, p_session_token: token, p_battle: id }));

export type DigAnswer = { result: "found"; loot: number; jackpot: boolean } | { result: "miss"; heat: Heat };
export async function digTreasure(roomId: string, token: string, mapId: string, map: string, x: number, y: number): Promise<DigAnswer> {
  const r = await call("dig_treasure", { p_room_id: roomId, p_session_token: token, p_map_id: mapId, p_map: map, p_x: Math.round(x), p_y: Math.round(y) });
  if (r.result === "found") return { result: "found", loot: Number(r.loot), jackpot: r.jackpot === true };
  const heat: Heat = r.heat === "hot" || r.heat === "warm" || r.heat === "wrong_map" ? r.heat : "cold";
  return { result: "miss", heat };
}

export const buyMachine = async (token: string, machine: MachineId) => extras(await call("buy_machine", { p_session_token: token, p_machine: machine }));
export const machineWater = async (roomId: string, token: string, plot: number, level: number) =>
  void await call("machine_water", { p_room_id: roomId, p_session_token: token, p_plot: plot, p_level: level });
export const machineHarvest = async (roomId: string, token: string, plot: number) =>
  void await call("machine_harvest", { p_room_id: roomId, p_session_token: token, p_plot: plot });
export const processStart = async (token: string, recipe: string, batches: number) =>
  extras(await call("process_start", { p_session_token: token, p_recipe: recipe, p_batches: batches }));
export const processCollect = async (token: string) => extras(await call("process_collect", { p_session_token: token }));
export const sellGoods = async (token: string, recipe: string, qty: number) =>
  extras(await call("sell_goods", { p_session_token: token, p_recipe: recipe, p_qty: qty }));
