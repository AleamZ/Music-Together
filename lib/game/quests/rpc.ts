// v21 quests: the RPCs of 0071_quests.sql. The server owns the offers, the progress (from game_events) and the rewards.
import { supabase } from "@/lib/supabase";
import type { QuestCat, QuestStatus } from "./model";

const num = (v: unknown, d = 0): number =>
  typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const CATS: readonly QuestCat[] = ["daily", "weekly", "npc", "explore"];
const STATUSES: readonly QuestStatus[] = ["locked", "available", "active", "done", "claimed"];

export interface Quest {
  id: string; cat: QuestCat; title: string; descr: string; goal: number; progress: number;
  coins: number; xp: number; chain: string | null; status: QuestStatus;
}
export interface CompanyQuest {
  id: number; title: string; descr: string; goal: number; progress: number; coins: number; xp: number;
  mine: number; contributors: number;
}
export interface QuestState {
  quests: Quest[];
  company: CompanyQuest | null;
  companyClaimable: { id: number; title: string; coins: number; xp: number }[];
  visited: string[];
  paid?: number;
  xp?: number;
  coins?: number;
}

export function parseQuestState(data: unknown): QuestState {
  const r = obj(data);
  const quests: Quest[] = [];
  for (const raw of arr(r.quests)) {
    const q = obj(raw);
    const cat = CATS.find((c) => c === q.cat);
    const status = STATUSES.find((s) => s === q.status);
    if (!cat || !status) continue;
    quests.push({
      id: str(q.id), cat, title: str(q.title), descr: str(q.descr), goal: num(q.goal, 1), progress: num(q.progress),
      coins: num(q.coins), xp: num(q.xp), chain: typeof q.chain === "string" ? q.chain : null, status,
    });
  }
  const c = r.company ? obj(r.company) : null;
  const out: QuestState = {
    quests,
    company: c ? {
      id: num(c.id), title: str(c.title), descr: str(c.descr), goal: num(c.goal, 1), progress: num(c.progress),
      coins: num(c.coins), xp: num(c.xp), mine: num(c.mine), contributors: num(c.contributors),
    } : null,
    companyClaimable: arr(r.company_claimable).map((x) => {
      const k = obj(x);
      return { id: num(k.id), title: str(k.title), coins: num(k.coins), xp: num(k.xp) };
    }),
    visited: arr(r.visited).filter((x): x is string => typeof x === "string"),
  };
  if (r.paid !== undefined) out.paid = num(r.paid);
  if (r.xp !== undefined) out.xp = num(r.xp);
  if (r.coins !== undefined) out.coins = num(r.coins);
  return out;
}

/** An anti-cheat envelope (a refused position claim) comes back instead of a state. */
function isEnvelope(data: unknown): boolean {
  return !Array.isArray(obj(data).quests);
}

async function rpc(fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data;
}

async function questCall(fn: string, args: Record<string, unknown>): Promise<QuestState> {
  const data = await rpc(fn, args);
  if (isEnvelope(data)) throw new Error("too far");
  return parseQuestState(data);
}

export const questState = (token: string) => questCall("quest_state", { p_session_token: token });
export const questAccept = (token: string, quest: string, at: { x: number; y: number }) =>
  questCall("quest_accept", { p_session_token: token, p_quest: quest, p_x: Math.round(at.x), p_y: Math.round(at.y) });
export const questClaim = (token: string, quest: string, at: { x: number; y: number } | null) =>
  questCall("quest_claim", {
    p_session_token: token, p_quest: quest, p_x: at ? Math.round(at.x) : null, p_y: at ? Math.round(at.y) : null,
  });
export const questCompanyClaim = (token: string) => questCall("quest_company_claim", { p_session_token: token });

// ---------- login calendar ----------
export interface LoginState {
  claimedToday: boolean; streak: number; total: number; rewards: number[];
  claimed?: boolean; amount?: number; paid?: number; slot?: number; coins?: number;
}
export function parseLoginState(data: unknown): LoginState {
  const r = obj(data);
  const out: LoginState = {
    claimedToday: r.claimed_today === true, streak: num(r.streak), total: num(r.total),
    rewards: arr(r.rewards).map((x) => num(x)),
  };
  if (r.claimed !== undefined) out.claimed = r.claimed === true;
  if (r.amount !== undefined) out.amount = num(r.amount);
  if (r.paid !== undefined) out.paid = num(r.paid);
  if (r.slot !== undefined) out.slot = num(r.slot);
  if (r.coins !== undefined) out.coins = num(r.coins);
  return out;
}
export const loginState = async (token: string) => parseLoginState(await rpc("login_state", { p_session_token: token }));
export const claimLoginReward = async (token: string) =>
  parseLoginState(await rpc("claim_login_reward", { p_session_token: token }));

// ---------- album ----------
export interface PhotoMeta { id: number; w: number; h: number; map: string | null; caption: string; at: string }
export function parsePhotos(data: unknown): PhotoMeta[] {
  return arr(obj(data).photos).map((x) => {
    const p = obj(x);
    return { id: num(p.id), w: num(p.w), h: num(p.h), map: typeof p.map === "string" ? p.map : null, caption: str(p.caption), at: str(p.at) };
  });
}
export const photoList = async (token: string) => parsePhotos(await rpc("photo_list", { p_session_token: token }));
export const photoGet = async (token: string, id: number) => str(obj(await rpc("photo_get", { p_session_token: token, p_id: id })).data);
export const photoSave = async (token: string, dataUrl: string, w: number, h: number, map: string, caption = "") =>
  parsePhotos(await rpc("photo_save", { p_session_token: token, p_data: dataUrl, p_w: w, p_h: h, p_map: map, p_caption: caption }));
export const photoDelete = async (token: string, id: number) => parsePhotos(await rpc("photo_delete", { p_session_token: token, p_id: id }));

// ---------- 2v2 tag team ----------
export interface ArenaTeam { id: string; name: string; code: string | null; rating: number; wins: number; losses: number; a: string; b: string | null; leader: boolean }
export interface ArenaSeries {
  id: string; status: "open" | "live" | "done" | "void"; stake: number; bout: number; scoreA: number; scoreB: number;
  teamA: { id: string; name: string }; teamB: { id: string; name: string }; winner: string | null; pair: string[] | null;
}
export interface ArenaRank { id: string; name: string; rating: number; wins: number; losses: number; full: boolean; a: string; b: string | null }
export interface ArenaState { team: ArenaTeam | null; series: ArenaSeries[]; ranking: ArenaRank[] }

const SERIES_STATUS = ["open", "live", "done", "void"] as const;
export function parseArenaState(data: unknown): ArenaState {
  const r = obj(data);
  const t = r.team ? obj(r.team) : null;
  const team = (v: unknown) => { const o = obj(v); return { id: str(o.id), name: str(o.name) }; };
  return {
    team: t ? {
      id: str(t.id), name: str(t.name), code: typeof t.code === "string" ? t.code : null, rating: num(t.rating, 1000),
      wins: num(t.wins), losses: num(t.losses), a: str(t.a), b: typeof t.b === "string" ? t.b : null, leader: t.leader === true,
    } : null,
    series: arr(r.series).flatMap((x) => {
      const s = obj(x);
      const status = SERIES_STATUS.find((k) => k === s.status);
      if (!status) return [];
      return [{
        id: str(s.id), status, stake: num(s.stake), bout: num(s.bout, 1), scoreA: num(s.score_a), scoreB: num(s.score_b),
        teamA: team(s.team_a), teamB: team(s.team_b), winner: typeof s.winner === "string" ? s.winner : null,
        pair: Array.isArray(s.pair) ? s.pair.map((p) => str(p)) : null,
      }];
    }),
    ranking: arr(r.ranking).map((x) => {
      const k = obj(x);
      return {
        id: str(k.id), name: str(k.name), rating: num(k.rating, 1000), wins: num(k.wins), losses: num(k.losses),
        full: k.full === true, a: str(k.a), b: typeof k.b === "string" ? k.b : null,
      };
    }),
  };
}
const arenaCall = async (fn: string, args: Record<string, unknown>) => parseArenaState(await rpc(fn, args));
export const arenaState = (token: string) => arenaCall("arena_state", { p_session_token: token });
export const arenaTeamCreate = (token: string, name: string) => arenaCall("arena_team_create", { p_session_token: token, p_name: name });
export const arenaTeamJoin = (token: string, code: string) => arenaCall("arena_team_join", { p_session_token: token, p_code: code });
export const arenaTeamLeave = (token: string) => arenaCall("arena_team_leave", { p_session_token: token });
export const arenaChallenge = (token: string, team: string, stake: number) =>
  arenaCall("arena_challenge", { p_session_token: token, p_team: team, p_stake: stake });
export const arenaAccept = (token: string, series: string) => arenaCall("arena_accept", { p_session_token: token, p_series: series });
export const arenaCancel = (token: string, series: string) => arenaCall("arena_cancel", { p_session_token: token, p_series: series });
