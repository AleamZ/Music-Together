import { AnticheatError, screenAnswer } from "@/lib/anticheat";
import { supabase } from "@/lib/supabase";
import { publishVitals } from "@/lib/game/vitals-rpc";
import { isRarity } from "@/lib/game/fishing/catalog";
import type { StartCast } from "@/lib/game/fishing/rpc";
import { parseFishingState } from "@/lib/game/fishing/state";
import type { Facing } from "@/lib/game/types";
import type { MapId } from "@/lib/game/maps/types";

// Supabase calls for Sông Cái and the treasure dig (0086). A flagged answer (a refused claim / input) throws an
// AnticheatError; the caller shows its modal.

async function call(fn: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc(fn, args);
  const flagged = screenAnswer(data, error);
  if (error) throw error;
  if (flagged) throw new AnticheatError(flagged);
  return (data ?? {}) as Record<string, unknown>;
}
const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export type RowDir = "out" | "home";
export interface RowStart { dir: RowDir; seed: number; need: number }
export type RowFinish =
  | { result: "arrived"; hits: number; need: number; pass: boolean; to: { map: MapId; x: number; y: number; dir: Facing } }
  | { result: "drift"; why: "missed" | "expired" | "refused"; hits: number; need: number };

export function parseRowStart(raw: unknown): RowStart | null {
  const r = obj(obj(raw).row);
  if ((r.dir !== "out" && r.dir !== "home") || typeof r.seed !== "number" || typeof r.need !== "number") return null;
  return { dir: r.dir, seed: r.seed, need: r.need };
}

export function parseRowFinish(raw: unknown): RowFinish {
  const o = obj(raw);
  if (o.result === "arrived") {
    const t = obj(o.to);
    const dir: Facing = t.dir === "down" || t.dir === "up" || t.dir === "left" ? t.dir : "right";
    return { result: "arrived", hits: num(o.hits), need: num(o.need), pass: o.pass !== false, to: { map: t.map === "pond" ? "pond" : "song_cai", x: num(t.x), y: num(t.y), dir } };
  }
  const why = o.why === "expired" || o.why === "refused" ? o.why : "missed";
  return { result: "drift", why, hits: num(o.hits), need: num(o.need) };
}

export async function rowStart(roomId: string, token: string, dir: RowDir, at?: { x: number; y: number }): Promise<RowStart> {
  const r = parseRowStart(await call("river_row_start", {
    p_room_id: roomId, p_session_token: token, p_dir: dir,
    p_x: at ? Math.round(at.x) : null, p_y: at ? Math.round(at.y) : null,
  }));
  if (!r) throw new Error("bad row");
  return r;
}

export const rowFinish = async (roomId: string, token: string, strokes: readonly number[], ticks: number): Promise<RowFinish> =>
  parseRowFinish(await call("river_row_finish", { p_room_id: roomId, p_session_token: token, p_strokes: strokes, p_ticks: ticks }));

/** start_river_cast: start_cast's answer from the boat on Sông Cái; the cast then goes on through hook_cast / finish_cast. */
export async function startRiverCast(roomId: string, token: string, x: number, y: number): Promise<StartCast> {
  const r = await call("start_river_cast", { p_room_id: roomId, p_session_token: token, p_x: Math.round(x), p_y: Math.round(y) });
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

// --- the treasure dig
export type PingAnswer = { band: number } | { wait: true } | { wrongMap: true };
export function parsePing(raw: unknown): PingAnswer {
  const o = obj(raw);
  if (o.heat === "wrong_map") return { wrongMap: true };
  if (typeof o.band === "number") return { band: o.band };
  return { wait: true };
}
export const treasurePing = async (roomId: string, token: string, mapId: string, map: string, x: number, y: number) =>
  parsePing(await call("treasure_ping", { p_room_id: roomId, p_session_token: token, p_map_id: mapId, p_map: map, p_x: Math.round(x), p_y: Math.round(y) }));

export type DigStart =
  | { result: "dig"; seed: number; need: number; win: number }
  | { result: "miss"; heat: "hot" | "warm" | "cold" | "wrong_map" };
export function parseDigStart(raw: unknown): DigStart {
  const o = obj(raw);
  if (o.result === "dig") {
    const d = obj(o.dig);
    return { result: "dig", seed: num(d.seed), need: num(d.need, 3), win: num(d.win, 120) };
  }
  const heat = o.heat === "hot" || o.heat === "warm" || o.heat === "wrong_map" ? o.heat : "cold";
  return { result: "miss", heat };
}
export const treasureDigStart = async (roomId: string, token: string, mapId: string, map: string, x: number, y: number) =>
  parseDigStart(await call("treasure_dig_start", { p_room_id: roomId, p_session_token: token, p_map_id: mapId, p_map: map, p_x: Math.round(x), p_y: Math.round(y) }));

export type DigFinish =
  | { result: "found"; loot: number; jackpot: boolean; clean: boolean }
  | { result: "lost"; why: "expired" | "refused" | "gave_up" };
export function parseDigFinish(raw: unknown): DigFinish {
  const o = obj(raw);
  if (o.result === "found") return { result: "found", loot: num(o.loot), jackpot: o.jackpot === true, clean: o.clean === true };
  return { result: "lost", why: o.why === "expired" || o.why === "refused" ? o.why : "gave_up" };
}
export const treasureDigFinish = async (roomId: string, token: string, strikes: readonly number[], ticks: number, pass: boolean) =>
  parseDigFinish(await call("treasure_dig_finish", { p_room_id: roomId, p_session_token: token, p_strikes: strikes, p_ticks: ticks, p_pass: pass }));
