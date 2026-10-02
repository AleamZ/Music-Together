// v21 progression: the RPCs of 0070_progression.sql. The server derives every level, achievement and collection from
// its own game_events; the client only reads, picks a title and asks to fast-travel.
import { supabase } from "@/lib/supabase";
import type { MapId } from "@/lib/game/maps/types";
import { MAP_IDS } from "@/lib/game/maps/types";
import { TELEPORT_FEE, type BoardId } from "./model";

export interface Achievement {
  id: string; name: string; descr: string; stat: string; goal: number; reward: number; title: string | null;
  /** Unlocked at (ISO), or null. */
  at: string | null;
}
export interface FishdexEntry { species: string; name: string; rarity: number; caught: number; bestG: number }
export interface Collection { id: string; name: string; reward: number; have: number; total: number; at: string | null }
export interface Waypoint { id: string; name: string; map: string; minLevel: number; found: boolean }

export interface ProgressState {
  level: number;
  xp: number;
  /** The worn title's achievement id. */
  title: string | null;
  today: { fish: number; earn: number; fight: number; grant: number };
  stats: { fishTotal: number; species: number; biggestG: number; biggestSpecies: string | null; earnedTotal: number; farmEarned: number; fightWins: number; level: number };
  achievements: Achievement[];
  fishdex: FishdexEntry[];
  collections: Collection[];
  other: Record<"pets" | "outfits" | "crops", { have: number; total: number }>;
  waypoints: Waypoint[];
  atWaypoint: string | null;
  teleportFee: number;
  mapLevels: Record<string, number>;
}

const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.map(obj) : []);

export function parseProgress(data: unknown): ProgressState {
  const r = obj(data);
  const t = obj(r.today), s = obj(r.stats), o = obj(r.other);
  const pair = (v: unknown) => ({ have: num(obj(v).have), total: num(obj(v).total) });
  const mapLevels: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj(r.map_levels))) mapLevels[k] = num(v, 1);
  return {
    level: Math.max(1, num(r.level, 1)), xp: num(r.xp), title: str(r.title),
    today: { fish: num(t.fish), earn: num(t.earn), fight: num(t.fight), grant: num(t.grant) },
    stats: {
      fishTotal: num(s.fish_total), species: num(s.species), biggestG: num(s.biggest_g), biggestSpecies: str(s.biggest_species),
      earnedTotal: num(s.earned_total), farmEarned: num(s.farm_earned), fightWins: num(s.fight_wins), level: num(s.level, 1),
    },
    achievements: arr(r.achievements).map((a) => ({
      id: String(a.id ?? ""), name: String(a.name ?? ""), descr: String(a.descr ?? ""), stat: String(a.stat ?? ""),
      goal: num(a.goal), reward: num(a.reward), title: str(a.title), at: str(a.at),
    })),
    fishdex: arr(r.fishdex).map((f) => ({ species: String(f.species ?? ""), name: String(f.name ?? ""), rarity: num(f.rarity, 1), caught: num(f.caught), bestG: num(f.best_g) })),
    collections: arr(r.collections).map((c) => ({ id: String(c.id ?? ""), name: String(c.name ?? ""), reward: num(c.reward), have: num(c.have), total: num(c.total), at: str(c.at) })),
    other: { pets: pair(o.pets), outfits: pair(o.outfits), crops: pair(o.crops) },
    waypoints: arr(r.waypoints).map((w) => ({ id: String(w.id ?? ""), name: String(w.name ?? ""), map: String(w.map ?? ""), minLevel: num(w.min_level, 1), found: w.found === true })),
    atWaypoint: str(r.at_waypoint),
    teleportFee: num(r.teleport_fee, TELEPORT_FEE),
    mapLevels,
  };
}

/** The worn title's text (null: none). */
export const titleText = (s: ProgressState | null): string | null =>
  s?.title ? s.achievements.find((a) => a.id === s.title)?.title ?? null : null;

export interface BoardRow { id: string; name: string; value: number; level: number; extra: string | null }
export function parseBoard(data: unknown): { rows: BoardRow[]; me: string | null } {
  const r = obj(data);
  return {
    rows: arr(r.rows).map((x) => ({ id: String(x.id ?? ""), name: String(x.name ?? "?"), value: num(x.value), level: num(x.level, 1), extra: str(x.extra) })),
    me: str(r.me),
  };
}

export interface TeleportResult { coins: number; to: { id: string; map: MapId; x: number; y: number; dir: "up" | "down" | "left" | "right" } }
export function parseTeleport(data: unknown): TeleportResult | null {
  const r = obj(data), to = obj(r.to);
  const map = to.map as MapId;
  if (r.ok !== true || !MAP_IDS.includes(map)) return null;
  const dir = to.dir === "up" || to.dir === "left" || to.dir === "right" ? to.dir : "down";
  return { coins: num(r.coins), to: { id: String(to.id ?? ""), map, x: num(to.x), y: num(to.y), dir } };
}

async function rpc(fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data;
}

export const progressState = async (token: string) => parseProgress(await rpc("progress_state", { p_session_token: token }));
export const setTitle = async (token: string, achievement: string | null) =>
  parseProgress(await rpc("progress_set_title", { p_session_token: token, p_achievement: achievement }));
export const leaderboard = async (token: string, board: BoardId) =>
  parseBoard(await rpc("progress_leaderboard", { p_session_token: token, p_board: board }));
export const waypointTravel = async (token: string, to: string) =>
  parseTeleport(await rpc("waypoint_travel", { p_session_token: token, p_to: to }));
