// v20.2: the dojo's and the refereed pipeline's RPCs (0049_fight_matches.sql, 0050_dojo.sql) and their answers,
// parsed defensively. The server is authoritative: the client shows what it answers.

import { supabase } from "@/lib/supabase";
import type { MatchParams, State } from "./engine";

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
  winner: number;
  endReason: string;
  rounds: { reason: number; winner: number; hp1: number; hp2: number; frame: number }[];
  roundsPlayed: number;
  vitals: { hunger: number; thirst: number };
  exam: { passed: boolean; style: string; rank: number; belt: string | null; cooldownUntilMs: number | null } | null;
}

function parseResult(v: unknown): MatchResult | null {
  const r = obj(v);
  const w = num(r?.winner);
  if (!r || w === null) return null;
  const vit = obj(r.vitals);
  const ex = obj(r.exam);
  return {
    winner: w, endReason: str(r.end_reason) ?? "",
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
  result: MatchResult | null;
  resync: boolean;
  anticheat: AnticheatEnvelope | null;
  serverNowMs: number;
}

export function parsePushAnswer(data: unknown): PushAnswer | null {
  const r = obj(data);
  const now = num(r?.server_now_ms), side = num(r?.side) ?? 1;
  if (!r || now === null || typeof r.status !== "string") return null;
  const fr = Array.isArray(r.frontiers) ? num(r.frontiers[side - 1]) : null;
  return {
    status: r.status, simFrame: num(r.sim_frame) ?? 0, frontier: fr, result: parseResult(r.result), resync: r.resync === true,
    anticheat: parseAc(r), serverNowMs: now,
  };
}

export interface FightStateAnswer extends PushAnswer {
  params: MatchParams | null;
  startedAtMs: number;
  runs: number[];
  sim: State;
}

export function parseFightState(data: unknown): FightStateAnswer | null {
  const p = parsePushAnswer(data);
  const r = obj(data);
  if (!p || !r) return null;
  return { ...p, params: (obj(r.params) as unknown as MatchParams) ?? null, startedAtMs: num(r.started_at_ms) ?? 0, runs: ints(r.runs), sim: ints(r.sim) };
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
export const fightState = (token: string, match: string) => call("fight_state", { p_session_token: token, p_match: match }, parseFightState);
export const fightForfeit = (token: string, match: string) => call("fight_forfeit", { p_session_token: token, p_match: match }, parsePushAnswer);

export interface WearAnswer { outfit: string | null; prevOutfit: string | null }
const parseWear = (d: unknown): WearAnswer | null => {
  const r = obj(d);
  return r ? { outfit: str(r.outfit), prevOutfit: str(r.prev_outfit) } : null;
};
export const fightWearUniform = (token: string, style: string) => call("fight_wear_uniform", { p_session_token: token, p_style: style }, parseWear);
export const fightUnwearUniform = (token: string) => call("fight_unwear_uniform", { p_session_token: token }, parseWear);
