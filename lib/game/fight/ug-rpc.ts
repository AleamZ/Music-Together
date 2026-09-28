// v20.4 the underground's RPCs (0052_underground.sql) and their answers, parsed defensively. The server is
// authoritative: the client shows what it answers.

import { supabase } from "@/lib/supabase";
import type { MatchParams } from "./engine";
import { tierOf, type TierKey } from "./underground";

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export interface UgMe {
  rating: number;
  rated: number;
  tier: TierKey;
  peak: number;
  bestTier: TierKey;
  titles: string[];
  ratedToday: number;
  ladderToday: number;
  cupsToday: number;
}
export interface UgQueue { tier: number; rating: number; joinedAtMs: number; head: boolean }
export interface UgBoss {
  floor: number; name: string; style: string; level: number; hpPct: number; entry: number; prize: number;
  styleByRound: string[] | null; cleared: boolean; clears: number; attempts: number;
}
export interface UgSlot { a: string | null; b: string | null; match: string | null; winner: string | null }
export interface UgBracket { seeds: string[]; semis: [UgSlot, UgSlot]; final: UgSlot }
export interface UgCupEntry { id: string; name: string; seed: number | null; placed: number | null; rating: number }
export interface UgCup {
  id: string; tier: number; status: "open" | "running" | "done" | "void"; createdAtMs: number; bracket: UgBracket | null;
  currentMatch: string | null; entries: UgCupEntry[];
}
export interface UgFoe { id: string; name: string; rating: number | null }
/** My live underground match: a called PvP match (ready bits, the deadline) or a ladder match. */
export interface UgMine {
  id: string; kind: "ug_rated" | "ug_cup" | "ug_ladder"; roomId: string | null; side: 1 | 2; params: MatchParams; entry: number;
  ready: number; startedAtMs: number; callUntilMs: number | null; ref: string | null; foe: UgFoe | null;
}
/** A live PvP match of the room (the cage's spectators). */
export interface UgLive {
  id: string; kind: "ug_rated" | "ug_cup"; p1: string; p2: string; p1Name: string; p2Name: string; ready: number;
  round: number; w1: number; w2: number; params: MatchParams; startedAtMs: number;
}
export interface UgState {
  unlocked: boolean;
  season: number;
  seasonEndsMs: number | null;
  me: UgMe | null;
  queue: UgQueue | null;
  queued: Record<string, number>;
  bosses: UgBoss[];
  cups: UgCup[];
  mine: UgMine | null;
  live: UgLive[];
  serverNowMs: number;
  /** An action's refusal (an answer, not an error). */
  refused: string | null;
  /** ug_ladder_start / ug_ready's match. */
  match: UgMine | null;
}

const tierKey = (v: unknown, rating: number): TierKey => {
  const s = str(v);
  return s === "tep_riu" || s === "ca_ro" || s === "ca_loc" || s === "ca_map" || s === "thuy_quai" ? s : tierOf(rating).key;
};

function parseSlot(v: unknown): UgSlot {
  const o = obj(v) ?? {};
  return { a: str(o.a), b: str(o.b), match: str(o.match), winner: str(o.winner) };
}

function parseMine(v: unknown): UgMine | null {
  const o = obj(v);
  const id = str(o?.id), kind = o?.kind, params = obj(o?.params), side = num(o?.side);
  if (!o || !id || !params || (kind !== "ug_rated" && kind !== "ug_cup" && kind !== "ug_ladder") || (side !== 1 && side !== 2)) return null;
  const f = obj(o.foe);
  return {
    id, kind, roomId: str(o.room_id), side, params: params as unknown as MatchParams, entry: num(o.entry) ?? 0,
    ready: num(o.ready) ?? 3, startedAtMs: num(o.started_at_ms) ?? 0, callUntilMs: num(o.call_until_ms), ref: str(o.ref) ?? (num(o.floor) !== null ? String(num(o.floor)) : null),
    foe: f && str(f.id) ? { id: str(f.id)!, name: str(f.name) ?? "?", rating: num(f.rating) } : null,
  };
}

export function parseUgState(data: unknown): UgState | null {
  const r = obj(data);
  const now = num(r?.server_now_ms);
  if (!r || now === null) return null;
  const empty: UgState = {
    unlocked: r.unlocked === true, season: num(r.season) ?? 0, seasonEndsMs: num(r.season_ends_ms), me: null, queue: null, queued: {},
    bosses: [], cups: [], mine: null, live: [], serverNowMs: now, refused: str(r.refused), match: parseMine(r.match),
  };
  if (!empty.unlocked) return empty;
  const me = obj(r.me);
  if (me) {
    const rating = num(me.rating) ?? 1000, peak = num(me.peak) ?? rating;
    empty.me = {
      rating, rated: num(me.rated) ?? 0, tier: tierKey(me.tier, rating), peak, bestTier: tierKey(me.best_tier, peak),
      titles: arr(me.titles).filter((t): t is string => typeof t === "string"),
      ratedToday: num(me.rated_today) ?? 0, ladderToday: num(me.ladder_today) ?? 0, cupsToday: num(me.cups_today) ?? 0,
    };
  }
  const q = obj(r.queue);
  if (q && num(q.tier) !== null) empty.queue = { tier: num(q.tier)!, rating: num(q.rating) ?? 1000, joinedAtMs: num(q.joined_at_ms) ?? now, head: q.head === true };
  const qd = obj(r.queued) ?? {};
  for (const k of Object.keys(qd)) empty.queued[k] = num(qd[k]) ?? 0;
  empty.bosses = arr(r.bosses).map((x) => {
    const o = obj(x) ?? {};
    return {
      floor: num(o.floor) ?? 0, name: str(o.name) ?? "?", style: str(o.style) ?? "", level: num(o.level) ?? 1, hpPct: num(o.hp_pct) ?? 100,
      entry: num(o.entry) ?? 0, prize: num(o.prize) ?? 0, styleByRound: Array.isArray(o.style_by_round) ? o.style_by_round.filter((s): s is string => typeof s === "string") : null,
      cleared: o.cleared === true, clears: num(o.clears) ?? 0, attempts: num(o.attempts) ?? 0,
    };
  }).filter((b) => b.floor >= 1 && b.floor <= 10);
  empty.cups = arr(r.cups).flatMap((x): UgCup[] => {
    const o = obj(x);
    const id = str(o?.id), st = o?.status;
    if (!o || !id || (st !== "open" && st !== "running" && st !== "done" && st !== "void")) return [];
    const b = obj(o.bracket);
    const semis = arr(b?.semis);
    return [{
      id, tier: num(o.tier) ?? 0, status: st, createdAtMs: num(o.created_at_ms) ?? 0, currentMatch: str(o.current_match),
      bracket: b ? { seeds: arr(b.seeds).filter((s): s is string => typeof s === "string"), semis: [parseSlot(semis[0]), parseSlot(semis[1])], final: parseSlot(b.final) } : null,
      entries: arr(o.entries).map((e) => {
        const eo = obj(e) ?? {};
        return { id: str(eo.id) ?? "", name: str(eo.name) ?? "?", seed: num(eo.seed), placed: num(eo.placed), rating: num(eo.rating) ?? 1000 };
      }),
    }];
  });
  empty.mine = parseMine(r.mine);
  empty.live = arr(r.live).flatMap((x): UgLive[] => {
    const o = obj(x);
    const id = str(o?.id), kind = o?.kind, params = obj(o?.params), p1 = str(o?.p1), p2 = str(o?.p2);
    if (!o || !id || !params || !p1 || !p2 || (kind !== "ug_rated" && kind !== "ug_cup")) return [];
    return [{
      id, kind, p1, p2, p1Name: str(o.p1_name) ?? "?", p2Name: str(o.p2_name) ?? "?", ready: num(o.ready) ?? 0,
      round: num(o.round) ?? 1, w1: num(o.w1) ?? 0, w2: num(o.w2) ?? 0, params: params as unknown as MatchParams, startedAtMs: num(o.started_at_ms) ?? 0,
    }];
  });
  return empty;
}

export interface UgBoardRow { name: string; rating: number; tier: TierKey; me: boolean }
export interface UgBoard { season: number; room: UgBoardRow[]; global: UgBoardRow[] }
export function parseUgBoard(data: unknown): UgBoard | null {
  const r = obj(data);
  if (!r) return null;
  const rows = (v: unknown): UgBoardRow[] => arr(v).map((x) => {
    const o = obj(x) ?? {};
    const rating = num(o.rating) ?? 1000;
    return { name: str(o.name) ?? "?", rating, tier: tierKey(o.tier, rating), me: o.me === true };
  });
  return { season: num(r.season) ?? 0, room: rows(r.room), global: rows(r.global) };
}

async function call<T>(fn: string, args: Record<string, unknown>, parse: (d: unknown) => T | null): Promise<{ value: T; sentAt: number; receivedAt: number }> {
  const sentAt = Date.now();
  const { data, error } = await supabase.rpc(fn, args);
  const receivedAt = Date.now();
  if (error) throw error;
  const value = parse(data);
  if (value === null) throw new Error("bad answer");
  return { value, sentAt, receivedAt };
}

const base = (roomId: string, token: string) => ({ p_room_id: roomId, p_session_token: token });
export const ugStatus = (roomId: string, token: string) => call("ug_status", base(roomId, token), parseUgState);
export const ugEnter = (roomId: string, token: string) => call("ug_enter", base(roomId, token), parseUgState);
export const ugQueueJoin = (roomId: string, token: string, tier: number) => call("ug_queue_join", { ...base(roomId, token), p_tier: tier }, parseUgState);
export const ugQueueLeave = (roomId: string, token: string) => call("ug_queue_leave", base(roomId, token), parseUgState);
export const ugReady = (roomId: string, token: string, match: string, n: number) =>
  call("ug_ready", { ...base(roomId, token), p_match: match, p_n: n }, parseUgState);
export const ugLadderStart = (roomId: string, token: string, floor: number) => call("ug_ladder_start", { ...base(roomId, token), p_floor: floor }, parseUgState);
export const ugCupJoin = (roomId: string, token: string, tier: number) => call("ug_cup_join", { ...base(roomId, token), p_tier: tier }, parseUgState);
export const ugCupLeave = (roomId: string, token: string) => call("ug_cup_leave", base(roomId, token), parseUgState);
export const ugCupState = (roomId: string, token: string) => call("ug_cup_state", base(roomId, token), parseUgState);
export const ugBoard = (roomId: string, token: string) => call("ug_board", base(roomId, token), parseUgBoard);
