// v20.2: the dojo's and the refereed pipeline's RPCs (0049_fight_matches.sql, 0050_dojo.sql) and their answers,
// parsed defensively. The server is authoritative: the client shows what it answers.

import { supabase } from "@/lib/supabase";
import type { MatchParams, State } from "./engine";
import { parseRingState } from "./rings";

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const ints = (v: unknown): number[] => (Array.isArray(v) ? v.map((x) => num(x) ?? 0) : []);

export interface Enrollment {
  style: string;
  rank: number;
  rankAtMs: number;
  enrolledAtMs: number;
  cooldownUntilMs: number | null;
  nextExamMs: number | null;
}

export interface LiveMatch {
  id: string;
  status: string;
  params: MatchParams;
  startedAtMs: number;
  simFrame: number;
}

export interface LiveExam {
  id: string;
  style: string;
  targetRank: number;
  fee: number;
  kataSeed: number;
  status: "kata" | "spar";
  startedAtMs: number;
  expiresAtMs: number;
  match: LiveMatch | null;
}

export interface DojoState {
  enrollments: Enrollment[];
  uniforms: string[];
  wearing: string | null;
  prevOutfit: string | null;
  exam: LiveExam | null;
  serverNowMs: number;
  coins?: number;
}

function parseMatch(v: unknown): LiveMatch | null {
  const m = obj(v);
  const id = str(m?.id), started = num(m?.started_at_ms), params = obj(m?.params);
  if (!m || !id || started === null || !params) return null;
  return { id, status: str(m.status) ?? "live", params: params as unknown as MatchParams, startedAtMs: started, simFrame: num(m.sim_frame) ?? 0 };
}

export function parseDojoState(data: unknown): DojoState | null {
  const r = obj(data);
  const now = num(r?.server_now_ms);
  if (!r || now === null) return null;
  const enrollments: Enrollment[] = [];
  for (const e of Array.isArray(r.enrollments) ? r.enrollments : []) {
    const o = obj(e);
    const style = str(o?.style), rank = num(o?.rank);
    if (!o || !style || rank === null) continue;
    enrollments.push({
      style, rank, rankAtMs: num(o.rank_at_ms) ?? 0, enrolledAtMs: num(o.enrolled_at_ms) ?? 0,
      cooldownUntilMs: num(o.cooldown_until_ms), nextExamMs: num(o.next_exam_ms),
    });
  }
  const x = obj(r.exam);
  let exam: LiveExam | null = null;
  if (x && str(x.id) && str(x.style) && (x.status === "kata" || x.status === "spar")) {
    exam = {
      id: str(x.id)!, style: str(x.style)!, targetRank: num(x.target_rank) ?? 1, fee: num(x.fee) ?? 0, kataSeed: num(x.kata_seed) ?? 0,
      status: x.status, startedAtMs: num(x.started_at_ms) ?? 0, expiresAtMs: num(x.expires_at_ms) ?? 0, match: parseMatch(x.match),
    };
  }
  const out: DojoState = {
    enrollments,
    uniforms: Array.isArray(r.uniforms) ? r.uniforms.filter((u): u is string => typeof u === "string") : [],
    wearing: str(r.wearing), prevOutfit: str(r.prev_outfit), exam, serverNowMs: now,
  };
  const coins = num(r.coins);
  if (coins !== null) out.coins = coins;
  return out;
}

export interface AnticheatEnvelope { code: string; strike: number; banned: boolean }
const parseAc = (v: unknown): AnticheatEnvelope | null => {
  const a = obj(obj(v)?.anticheat);
  const code = str(a?.code);
  return a && code ? { code, strike: num(a.strike) ?? 0, banned: a.banned === true } : null;
};

export interface ExamStart {
  examId: string;
  kataSeed: number;
  notes: number;
  tpb: number;
  half: boolean;
  passPct: number;
  expiresAtMs: number;
  coins: number | null;
  state: DojoState | null;
  serverNowMs: number;
}

export function parseExamStart(data: unknown): ExamStart | null {
  const r = obj(data);
  const id = str(r?.exam_id), seed = num(r?.kata_seed), now = num(r?.server_now_ms);
  if (!r || !id || seed === null || now === null) return null;
  return {
    examId: id, kataSeed: seed, notes: num(r.notes) ?? 0, tpb: num(r.ticks_per_beat) ?? 40, half: r.half === true,
    passPct: num(r.pass_pct) ?? 60, expiresAtMs: num(r.expires_at_ms) ?? 0, coins: num(r.coins), state: parseDojoState(r.state), serverNowMs: now,
  };
}

export interface KataResult {
  passed: boolean;
  /** {points, perfect, good, miss, extra, worst} (null: malformed or a stale exam). */
  score: number[] | null;
  max: number;
  passPct: number;
  cooldownUntilMs: number | null;
  match: { id: string; params: MatchParams; startedAtMs: number } | null;
  /** A stale submit (the exam already ended): its status. */
  status: string | null;
  anticheat: AnticheatEnvelope | null;
  state: DojoState | null;
  serverNowMs: number;
}

export function parseKataResult(data: unknown): KataResult | null {
  const r = obj(data);
  const now = num(r?.server_now_ms);
  if (!r || now === null) return null;
  const m = obj(r.match);
  const mid = str(m?.id), mp = obj(m?.params), ms = num(m?.started_at_ms);
  return {
    passed: r.passed === true, score: Array.isArray(r.score) ? ints(r.score) : null, max: num(r.max) ?? 0, passPct: num(r.pass_pct) ?? 0,
    cooldownUntilMs: num(r.cooldown_until_ms),
    match: mid && mp && ms !== null ? { id: mid, params: mp as unknown as MatchParams, startedAtMs: ms } : null,
    status: str(r.status), anticheat: parseAc(r), state: parseDojoState(r.state), serverNowMs: now,
  };
}

export interface MatchResult {
  /** 1 or 2, 0 a draw (and 0 for a void). */
  winner: number;
  endReason: string;
  rounds: { reason: number; winner: number; hp1: number; hp2: number; frame: number }[];
  roundsPlayed: number;
  vitals: { hunger: number; thirst: number };
  exam: { passed: boolean; style: string; rank: number; belt: string | null; cooldownUntilMs: number | null } | null;
  /** v20.3: a void (both absent) or a disputed match (a conflict): nobody won, the stakes came back. */
  void?: boolean;
  /** v20.3 a ring match's money: the stake, the pot, the burned fee, what the winner took, the records (by side). */
  pvp?: { stake: number; pot: number; fee: number; won: number; records: Record<"1" | "2", { wins: number; losses: number; draws: number }> | null };
  /** v20.4 an underground match: what moved (entry, prize, fee, refund), the ratings by side, the ladder's floor, the cup. */
  ug?: UgResult;
  /** v20.4: a called match nobody (or only one) showed up for. */
  noshow?: boolean;
}

export interface UgResult {
  kind: string; entry: number; pot: number; fee: number; won: number; refund: number; requeued: boolean;
  floor: number | null; boss: string | null; first: boolean;
  rating: { factor: number; bySide: Partial<Record<"1" | "2", { rating: number; delta: number; tier: string }>> } | null;
  round: string | null; champion: string | null; championWon: number; runnerUpWon: number; cupVoid: boolean;
}

function parseUg(v: unknown): UgResult | null {
  const u = obj(v);
  if (!u) return null;
  const rt = obj(u.rating);
  const side = (k: "1" | "2") => {
    const o = obj(rt?.[k]);
    return o ? { rating: num(o.rating) ?? 0, delta: num(o.delta) ?? 0, tier: str(o.tier) ?? "" } : undefined;
  };
  const bySide: Partial<Record<"1" | "2", { rating: number; delta: number; tier: string }>> = {};
  const s1 = side("1"), s2 = side("2");
  if (s1) bySide["1"] = s1;
  if (s2) bySide["2"] = s2;
  return {
    kind: str(u.kind) ?? "", entry: num(u.entry) ?? 0, pot: num(u.pot) ?? 0, fee: num(u.fee) ?? 0, won: num(u.won) ?? 0, refund: num(u.refund) ?? 0,
    requeued: u.requeued === true, floor: num(u.floor), boss: str(u.boss), first: u.first === true,
    rating: rt ? { factor: num(rt.factor) ?? 1, bySide } : null,
    round: str(u.round), champion: str(u.champion), championWon: num(u.champion_won) ?? 0, runnerUpWon: num(u.runner_up_won) ?? 0,
    cupVoid: u.cup_void === true,
  };
}

function parseResult(v: unknown): MatchResult | null {
  const r = obj(v);
  const w = num(r?.winner);
  if (!r || (w === null && r.void !== true)) return null;
  const vit = obj(r.vitals);
  const ex = obj(r.exam);
  const pvp = obj(r.pvp);
  const recs = obj(pvp?.records);
  const rec = (k: string) => {
    const o = obj(recs?.[k]);
    return { wins: num(o?.wins) ?? 0, losses: num(o?.losses) ?? 0, draws: num(o?.draws) ?? 0 };
  };
  const extra: Pick<MatchResult, "void" | "pvp" | "ug" | "noshow"> = {};
  if (r.void === true) extra.void = true;
  const ug = parseUg(r.ug);
  if (ug) extra.ug = ug;
  if (r.noshow === true) extra.noshow = true;
  if (pvp) {
    extra.pvp = {
      stake: num(pvp.stake) ?? 0, pot: num(pvp.pot) ?? 0, fee: num(pvp.fee) ?? 0, won: num(pvp.won) ?? 0,
      records: recs ? { "1": rec("1"), "2": rec("2") } : null,
    };
  }
  return {
    ...extra,
    winner: w ?? 0, endReason: str(r.end_reason) ?? "",
    rounds: (Array.isArray(r.rounds) ? r.rounds : []).map((x) => {
      const o = obj(x) ?? {};
      return { reason: num(o.reason) ?? 0, winner: num(o.winner) ?? 0, hp1: num(o.hp1) ?? 0, hp2: num(o.hp2) ?? 0, frame: num(o.frame) ?? 0 };
    }),
    roundsPlayed: num(r.rounds_played) ?? 1,
    vitals: { hunger: num(vit?.hunger) ?? 0, thirst: num(vit?.thirst) ?? 0 },
    exam: ex ? { passed: ex.passed === true, style: str(ex.style) ?? "", rank: num(ex.rank) ?? 0, belt: str(ex.belt), cooldownUntilMs: num(ex.cooldown_until_ms) } : null,
  };
}

export interface PushAnswer {
  status: string;
  simFrame: number;
  /** My frontier (−1: none). */
  frontier: number | null;
  /** v20.3: the frontier of my `seen` log (the opponent's inputs as I received them; −1 none). */
  seenFrontier: number | null;
  result: MatchResult | null;
  resync: boolean;
  anticheat: AnticheatEnvelope | null;
  serverNowMs: number;
  /** v20.3 fight_claim: whether the claim won, else how long to wait (ms). */
  claimed?: boolean;
  waitMs?: number | null;
}

export function parsePushAnswer(data: unknown): PushAnswer | null {
  const r = obj(data);
  const now = num(r?.server_now_ms), side = num(r?.side) ?? 1;
  if (!r || now === null || typeof r.status !== "string") return null;
  const fr = Array.isArray(r.frontiers) ? num(r.frontiers[side - 1]) : null;
  const seen = Array.isArray(r.seen) ? num(r.seen[side - 1]) : null;
  const out: PushAnswer = {
    status: r.status, simFrame: num(r.sim_frame) ?? 0, frontier: fr, seenFrontier: seen, result: parseResult(r.result), resync: r.resync === true,
    anticheat: parseAc(r), serverNowMs: now,
  };
  if (typeof r.claimed === "boolean") {
    out.claimed = r.claimed;
    out.waitMs = num(r.wait_ms);
  }
  return out;
}

export interface FightStateAnswer extends PushAnswer {
  params: MatchParams | null;
  startedAtMs: number;
  runs: number[];
  sim: State;
  /** v20.3 PvP: the opponent's canonical runs from frame 0 up to both frontiers (procedure R). */
  oppRuns: number[];
}

export function parseFightState(data: unknown): FightStateAnswer | null {
  const p = parsePushAnswer(data);
  const r = obj(data);
  if (!p || !r) return null;
  return {
    ...p, params: (obj(r.params) as unknown as MatchParams) ?? null, startedAtMs: num(r.started_at_ms) ?? 0, runs: ints(r.runs), sim: ints(r.sim),
    oppRuns: ints(r.opp_runs),
  };
}

/** An RPC call with its round trip (for the server clock). */
async function call<T>(fn: string, args: Record<string, unknown>, parse: (d: unknown) => T | null): Promise<{ value: T; sentAt: number; receivedAt: number }> {
  const sentAt = Date.now();
  const { data, error } = await supabase.rpc(fn, args);
  const receivedAt = Date.now();
  if (error) throw error;
  const value = parse(data);
  if (value === null) throw new Error("bad answer");
  return { value, sentAt, receivedAt };
}

export const dojoState = (token: string) => call("dojo_state", { p_session_token: token }, parseDojoState);
export const dojoEnroll = (token: string, style: string) => call("dojo_enroll", { p_session_token: token, p_style: style }, parseDojoState);
export const dojoExamStart = (token: string, style: string) => call("dojo_exam_start", { p_session_token: token, p_style: style }, parseExamStart);
export const dojoKataSubmit = (token: string, exam: string, presses: number[]) =>
  call("dojo_kata_submit", { p_session_token: token, p_exam: exam, p_presses: presses }, parseKataResult);
export const fightPush = (token: string, match: string, from: number, runs: number[], hashFrame: number | null, hash: number | null) =>
  call("fight_push", {
    p_session_token: token, p_match: match, p_from: from, p_runs: runs, p_hash_frame: hashFrame, p_hash: hash,
  }, parsePushAnswer);
/** v20.3 a ring match's push: my runs, what I saw of the opponent, my newest confirmed checkpoint, my stall frames. */
export const fightPushPvp = (token: string, match: string, p: {
  from: number; runs: number[]; seenFrom: number; seenRuns: number[]; hashFrame: number | null; hash: number | null; stall: number;
}) =>
  call("fight_push", {
    p_session_token: token, p_match: match, p_from: p.from, p_runs: p.runs, p_seen_from: p.seenFrom, p_seen_runs: p.seenRuns,
    p_hash_frame: p.hashFrame, p_hash: p.hash, p_stall: p.stall,
  }, parsePushAnswer);
export const fightClaim = (token: string, match: string) => call("fight_claim", { p_session_token: token, p_match: match }, parsePushAnswer);
export const fightState = (token: string, match: string) => call("fight_state", { p_session_token: token, p_match: match }, parseFightState);
export const fightForfeit = (token: string, match: string) => call("fight_forfeit", { p_session_token: token, p_match: match }, parsePushAnswer);

export interface WearAnswer { outfit: string | null; prevOutfit: string | null }
const parseWear = (d: unknown): WearAnswer | null => {
  const r = obj(d);
  return r ? { outfit: str(r.outfit), prevOutfit: str(r.prev_outfit) } : null;
};
export const fightWearUniform = (token: string, style: string) => call("fight_wear_uniform", { p_session_token: token, p_style: style }, parseWear);
export const fightUnwearUniform = (token: string) => call("fight_unwear_uniform", { p_session_token: token }, parseWear);

// ---------- v20.3 the rings (0051_bai_dat.sql) ----------
const ringCall = (fn: string, args: Record<string, unknown>) => call(fn, args, parseRingState);
export const ringState = (roomId: string, token: string) => ringCall("ring_state", { p_room_id: roomId, p_session_token: token });
export const ringTake = (roomId: string, token: string, ring: number, corner: "red" | "blue") =>
  ringCall("ring_take", { p_room_id: roomId, p_session_token: token, p_ring: ring, p_corner: corner });
export const ringLeave = (roomId: string, token: string, ring: number) =>
  ringCall("ring_leave", { p_room_id: roomId, p_session_token: token, p_ring: ring });
export const ringOffer = (roomId: string, token: string, ring: number, stake: number, n: number) =>
  ringCall("ring_offer", { p_room_id: roomId, p_session_token: token, p_ring: ring, p_stake: stake, p_n: n });
export const ringAccept = (roomId: string, token: string, ring: number, v: number, n: number) =>
  ringCall("ring_accept", { p_room_id: roomId, p_session_token: token, p_ring: ring, p_v: v, p_n: n });

export interface BoardRow { name: string; wins: number; losses: number; draws: number }
export function parseBoard(data: unknown): BoardRow[] | null {
  const r = obj(data);
  if (!r || !Array.isArray(r.rows)) return null;
  return r.rows.map((x) => {
    const o = obj(x) ?? {};
    return { name: str(o.name) ?? "?", wins: num(o.wins) ?? 0, losses: num(o.losses) ?? 0, draws: num(o.draws) ?? 0 };
  });
}
export const ringBoard = (roomId: string, token: string) => call("ring_board", { p_room_id: roomId, p_session_token: token }, parseBoard);

// ---------- v20.3 admin: "Xem lại trận" ----------
export interface AdminFightRow {
  id: string; status: string; endReason: string | null; winner: number | null; stake: number; ring: number | null;
  p1: string; p2: string; createdAt: string; endedAt: string | null; resyncs: number; simFrame: number;
}
export interface AdminConflictRow { id: number; matchId: string; reporter: string; reported: string; fromFrame: number; toFrame: number; createdAt: string }
export interface AdminFightList { matches: AdminFightRow[]; conflicts: AdminConflictRow[] }
export function parseAdminFightList(data: unknown): AdminFightList | null {
  const r = obj(data);
  if (!r) return null;
  return {
    matches: (Array.isArray(r.matches) ? r.matches : []).map((x) => {
      const o = obj(x) ?? {};
      return {
        id: str(o.id) ?? "", status: str(o.status) ?? "", endReason: str(o.end_reason), winner: num(o.winner), stake: num(o.stake) ?? 0,
        ring: num(o.ring), p1: str(o.p1) ?? "?", p2: str(o.p2) ?? "?", createdAt: str(o.created_at) ?? "", endedAt: str(o.ended_at),
        resyncs: num(o.resyncs) ?? 0, simFrame: num(o.sim_frame) ?? 0,
      };
    }),
    conflicts: (Array.isArray(r.conflicts) ? r.conflicts : []).map((x) => {
      const o = obj(x) ?? {};
      return {
        id: num(o.id) ?? 0, matchId: str(o.match_id) ?? "", reporter: str(o.reporter) ?? "?", reported: str(o.reported) ?? "?",
        fromFrame: num(o.from_frame) ?? 0, toFrame: num(o.to_frame) ?? 0, createdAt: str(o.created_at) ?? "",
      };
    }),
  };
}
export interface AdminFightLog {
  id: string; status: string; params: MatchParams; p1: string; p2: string | null; simFrame: number; result: MatchResult | null;
  logs: { side: number; runs: number[]; frontier: number; seenRuns: number[]; seenFrontier: number | null; stallFrames: number; badHashes: number }[];
  conflicts: { reporter: string; reported: string; fromFrame: number; toFrame: number }[];
}
export function parseAdminFightLog(data: unknown): AdminFightLog | null {
  const r = obj(data);
  const id = str(r?.id), params = obj(r?.params);
  if (!r || !id || !params) return null;
  return {
    id, status: str(r.status) ?? "", params: params as unknown as MatchParams, p1: str(r.p1) ?? "?", p2: str(r.p2),
    simFrame: num(r.sim_frame) ?? 0, result: parseResult(r.result),
    logs: (Array.isArray(r.logs) ? r.logs : []).map((x) => {
      const o = obj(x) ?? {};
      return {
        side: num(o.side) ?? 1, runs: ints(o.runs), frontier: num(o.frontier) ?? -1, seenRuns: ints(o.seen_runs),
        seenFrontier: num(o.seen_frontier), stallFrames: num(o.stall_frames) ?? 0, badHashes: num(o.bad_hashes) ?? 0,
      };
    }),
    conflicts: (Array.isArray(r.conflicts) ? r.conflicts : []).map((x) => {
      const o = obj(x) ?? {};
      return { reporter: str(o.reporter) ?? "?", reported: str(o.reported) ?? "?", fromFrame: num(o.from_frame) ?? 0, toFrame: num(o.to_frame) ?? 0 };
    }),
  };
}
export const adminFightList = (token: string) => call("admin_fight_list", { p_session_token: token }, parseAdminFightList);
export const adminFightLog = (token: string, match: string) => call("admin_fight_log", { p_session_token: token, p_match: match }, parseAdminFightLog);
