// v20.3 Bãi đất trống: the rings' rules as the client shows them (0051_bai_dat.sql is authoritative; the unit test
// fight-pvp-sql.test.ts pins these numbers against it), and ring_state's answer parsed defensively. Pure.

import { formatXu } from "@/lib/game/fishing/catalog";
import type { MatchParams } from "./engine";

/** The stake presets (xu); 0 is a friendly ("giao hữu"). */
export const STAKES = [0, 100, 500, 1000, 2000, 5000, 10000] as const;
/** The burned fee on a won pot, per cent (owner ruling, 2026-09-28). */
export const FEE_PCT = 5;
/** fight_config's defaults. */
export const DEFAULT_CAPS = { maxLiveRoom: 2, maxLiveAll: 4, maxStakedDay: 15, maxPairDay: 3, maxFriendlyPairDay: 10 } as const;
/** A corner held this long with the other empty is released; an offer lapses after OFFER_LAPSE_MS. */
export const CORNER_HOLD_MS = 5 * 60_000;
export const OFFER_LAPSE_MS = 30_000;
/** Both absent this long voids a match; this long after frame 0 it is decided (overtime). */
export const VOID_ABSENT_MS = 120_000;
export const OVERTIME_MS = 20 * 60_000;
/** The vitals needed to fight (R6). */
export const RING_MIN_VITALS = 10;
/** Bystanders poll ring_state this often while a ring they can see is occupied; a hint fetches it this soon. */
export const RING_POLL_MS = 5000;
export const RING_HINT_DELAY_MS = 150;
/** The Tin làng item's threshold. */
export const NEWS_STAKE = 5000;

/** The pot, the burned fee and what the winner takes. */
export function winnings(stake: number, feePct = FEE_PCT): { pot: number; fee: number; won: number } {
  const pot = 2 * stake;
  const fee = Math.floor((pot * feePct) / 100);
  return { pot, fee, won: pot - fee };
}

export const stakeText = (stake: number): string => (stake === 0 ? "Giao hữu" : formatXu(stake));

export interface RingFighter {
  id: string;
  name: string;
  /** The worn uniform's style key and engine id (null: none worn). */
  style: string | null;
  idx: number | null;
  rank: number | null;
  wins: number;
  losses: number;
  draws: number;
  lockedUntilMs: number | null;
}

export interface RingOffer { stake: number; by: 1 | 2; v: number; atMs: number; redOk: boolean; blueOk: boolean; redN: number | null; blueN: number | null }
export interface RingMatchInfo { id: string; status: string; stake: number; startedAtMs: number; round: number; phase: number; w1: number; w2: number }
export interface RingView {
  ring: number;
  v: number;
  red: RingFighter | null;
  blue: RingFighter | null;
  redSinceMs: number | null;
  blueSinceMs: number | null;
  offer: RingOffer | null;
  match: RingMatchInfo | null;
}
export interface StartedMatch { id: string; params: MatchParams; startedAtMs: number; side: 1 | 2; stake: number }
export interface MyRingMatch extends StartedMatch { roomId: string | null; ring: number; foe: RingFighter | null }
export interface RingState {
  rings: RingView[];
  mine: MyRingMatch | null;
  lockedUntilMs: number | null;
  liveRoom: number;
  liveAll: number;
  feePct: number;
  serverNowMs: number;
  /** An action's refusal (an answer, not an error) and whose side it names. */
  refused: string | null;
  who: "red" | "blue" | null;
  /** ring_accept's new match. */
  match: StartedMatch | null;
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

function parseFighter(v: unknown): RingFighter | null {
  const o = obj(v);
  const id = str(o?.id);
  if (!o || !id) return null;
  return {
    id, name: str(o.name) ?? "?", style: str(o.style), idx: num(o.idx), rank: num(o.rank),
    wins: num(o.wins) ?? 0, losses: num(o.losses) ?? 0, draws: num(o.draws) ?? 0, lockedUntilMs: num(o.locked_until_ms),
  };
}

function parseStarted(v: unknown): StartedMatch | null {
  const o = obj(v);
  const id = str(o?.id), params = obj(o?.params), at = num(o?.started_at_ms), side = num(o?.side);
  if (!o || !id || !params || at === null || (side !== 1 && side !== 2)) return null;
  return { id, params: params as unknown as MatchParams, startedAtMs: at, side, stake: num(o.stake) ?? 0 };
}

export function parseRingState(data: unknown): RingState | null {
  const r = obj(data);
  const now = num(r?.server_now_ms);
  if (!r || now === null || !Array.isArray(r.rings)) return null;
  const rings: RingView[] = [];
  for (const x of r.rings) {
    const o = obj(x);
    const n = num(o?.ring);
    if (!o || n === null || n < 1 || n > 4) continue;
    const of = obj(o.offer), m = obj(o.match);
    const by = num(of?.by);
    rings.push({
      ring: n, v: num(o.v) ?? 0, red: parseFighter(o.red), blue: parseFighter(o.blue),
      redSinceMs: num(o.red_since_ms), blueSinceMs: num(o.blue_since_ms),
      offer: of && (by === 1 || by === 2) ? {
        stake: num(of.stake) ?? 0, by, v: num(of.v) ?? 0, atMs: num(of.at_ms) ?? 0, redOk: of.red_ok === true, blueOk: of.blue_ok === true,
        redN: num(of.red_n), blueN: num(of.blue_n),
      } : null,
      match: m && str(m.id) ? {
        id: str(m.id)!, status: str(m.status) ?? "live", stake: num(m.stake) ?? 0, startedAtMs: num(m.started_at_ms) ?? 0,
        round: num(m.round) ?? 1, phase: num(m.phase) ?? 0, w1: num(m.w1) ?? 0, w2: num(m.w2) ?? 0,
      } : null,
    });
  }
  rings.sort((a, b) => a.ring - b.ring);
  const mine = obj(r.mine);
  const started = parseStarted(mine);
  const who = r.who === "red" || r.who === "blue" ? r.who : null;
  return {
    rings,
    mine: started && mine ? { ...started, roomId: str(mine.room_id), ring: num(mine.ring) ?? 1, foe: parseFighter(mine.foe) } : null,
    lockedUntilMs: num(r.locked_until_ms), liveRoom: num(r.live_room) ?? 0, liveAll: num(r.live_all) ?? 0,
    feePct: num(obj(r.config)?.fee_pct) ?? FEE_PCT, serverNowMs: now,
    refused: str(r.refused), who, match: parseStarted(r.match),
  };
}

/** Where I stand: my ring and corner, or null. */
export function myCorner(state: RingState | null, accountId: string): { ring: number; corner: "red" | "blue"; view: RingView } | null {
  for (const v of state?.rings ?? []) {
    if (v.red?.id === accountId) return { ring: v.ring, corner: "red", view: v };
    if (v.blue?.id === accountId) return { ring: v.ring, corner: "blue", view: v };
  }
  return null;
}

/** The label a bystander sees over a ring (plan ruling P2); null for an empty ring. */
export function ringLabel(v: RingView): string | null {
  if (v.match) {
    const round = Math.max(1, v.match.round);
    return `⚔️ Hiệp ${round} · ${v.match.w1}–${v.match.w2}${v.match.stake > 0 ? ` · ${stakeText(v.match.stake)}` : ""}`;
  }
  if (v.red && v.blue) return `${v.red.name} ⚔ ${v.blue.name}${v.offer ? ` · ${stakeText(v.offer.stake)}?` : ""}`;
  const one = v.red ?? v.blue;
  if (one) return `${v.red ? "Góc Đỏ" : "Góc Xanh"}: ${one.name} · chờ đối thủ`;
  return null;
}

/** Any ring occupied (bystanders poll while one is). */
export const anyOccupied = (s: RingState | null): boolean => (s?.rings ?? []).some((v) => v.red || v.blue || v.match);

/** A fighter's record line: "3 thắng · 1 thua · 0 hòa". */
export const recordText = (f: Pick<RingFighter, "wins" | "losses" | "draws">): string => `${f.wins} thắng · ${f.losses} thua · ${f.draws} hòa`;
