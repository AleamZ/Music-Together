import type { Vec } from "@/lib/game/types";
import { toWorld } from "@/lib/game/world/zones";
import { GROUNDBAIT_RADIUS_PX, GROUNDBAIT_WEIGHT } from "./gear";

// 0117 (supabase/migrations/0117_groundbait_spots.sql): ổ thính — a groundbait belongs to the spot it was thrown on, in
// that room, and works for anyone fishing within 48 px of it. Pure: the read RPC's rows, the label, the HUD line, where
// a spot is drawn (2D map px, or world px on the unified world / in 3D) and which spot I stand in.

/** A spot is refreshed by the same kind within the radius: +10 min, at most this long left and this many bags. */
export const GROUNDBAIT_CAP_MINUTES = 20;
export const GROUNDBAIT_MAX_STACKS = 3;
/** New spots: at most this many per room and map, and this many thrown first by one player. */
export const GROUNDBAIT_ROOM_LIMIT = 8;
export const GROUNDBAIT_PLAYER_LIMIT = 2;
/** How often the HUD asks the server for the room's spots (ms). */
export const GROUNDBAIT_POLL_MS = 15_000;

export type GroundbaitMap = "pond" | "song_cai" | "wild";

/** One active ổ thính, as groundbait_spots() returns it; `untilMs` is local wall time (from the server's left_ms). */
export interface GroundbaitSpotView {
  id: number;
  item: string;
  /** The shop name ("Thính cám gạo"). */
  name: string;
  map: GroundbaitMap;
  /** 'pond': the cell's centre (pond px); 'song_cai': Sông Cái px; 'wild': world px. */
  x: number;
  y: number;
  stacks: number;
  untilMs: number;
  /** The first thrower's name (null: gone). */
  by: string | null;
  mine: boolean;
}

/** Each kind's tint on the water (the bag's colour): cám gạo pale, tôm khô pink-orange, thơm green, tanh violet. */
export const GROUNDBAIT_TINT: Readonly<Record<string, string>> = {
  gb_cam: "#e9d79a", gb_tom: "#f08a5d", gb_thom: "#8fd16a", gb_tanh: "#b98ae0",
};
export const tintOf = (item: string): string => GROUNDBAIT_TINT[item] ?? "#e9d79a";
/** The tint as a three.js colour number. */
export const tintHex = (item: string): number => parseInt(tintOf(item).slice(1), 16);

const MAPS: readonly GroundbaitMap[] = ["pond", "song_cai", "wild"];

/** groundbait_spots()'s rows → views; `nowMs` local wall time (left_ms is counted on the server). Bad rows dropped. */
export function parseGroundbaitSpots(raw: unknown, nowMs: number): GroundbaitSpotView[] {
  if (!Array.isArray(raw)) return [];
  const out: GroundbaitSpotView[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const map = o.map as GroundbaitMap, x = Number(o.x), y = Number(o.y), left = Number(o.left_ms);
    if (!MAPS.includes(map) || !Number.isFinite(x) || !Number.isFinite(y) || typeof o.item !== "string") continue;
    const until = Number.isFinite(left) ? nowMs + left : Date.parse(String(o.until ?? ""));
    if (!Number.isFinite(until) || until <= nowMs) continue;
    out.push({
      id: Number(o.id) || 0, item: o.item, name: typeof o.name === "string" && o.name ? o.name : o.item, map, x, y,
      stacks: Math.max(1, Math.min(GROUNDBAIT_MAX_STACKS, Number(o.stacks) || 1)), untilMs: until,
      by: typeof o.by === "string" ? o.by : null, mine: o.mine === true,
    });
  }
  return out;
}

/** The spots still working at `nowMs`. */
export const liveSpots = (spots: readonly GroundbaitSpotView[], nowMs: number): GroundbaitSpotView[] =>
  spots.filter((s) => s.untilMs > nowMs);

/** "7:12" (m:ss), at least 0:00. */
export function leftText(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** "Ổ thính cám gạo" from "Thính cám gạo". */
export function spotName(name: string): string {
  const n = name.trim();
  return `Ổ ${n.charAt(0).toLowerCase()}${n.slice(1)}`;
}

/** The label over a spot: "Ổ thính cám gạo · còn 7:12 · của X" (×2 / ×3 when topped up). */
export function spotLabel(s: GroundbaitSpotView, nowMs: number): string {
  const who = s.mine ? "của bạn" : s.by ? `của ${s.by}` : null;
  return [`${spotName(s.name)}${s.stacks > 1 ? ` ×${s.stacks}` : ""}`, `còn ${leftText(s.untilMs - nowMs)}`, who].filter(Boolean).join(" · ");
}

/** The 3D label: whole minutes only (a label texture per second would pile up). */
export function spotLabel3d(s: GroundbaitSpotView, nowMs: number): string {
  const m = Math.max(1, Math.ceil((s.untilMs - nowMs) / 60_000));
  return `🌾 ${spotName(s.name)} · còn ${m} phút${s.by ? ` · ${s.mine ? "bạn" : s.by}` : ""}`;
}

/** The fishing HUD's line while I stand in a spot. */
export function spotHudText(s: GroundbaitSpotView, nowMs: number): string {
  return `🌾 Đang câu trong ${spotName(s.name).toLowerCase()} · còn ${leftText(s.untilMs - nowMs)} (cá ưa thính này ×${GROUNDBAIT_WEIGHT} tỉ lệ)`;
}

/** Where the engine draws a spot: on the unified world in world px (the pond / Sông Cái zone's origin added; the wild is
 *  world px already); on a per-map game in that map's px, only on its own map; null when not on this view. */
export function spotPoint(s: Pick<GroundbaitSpotView, "map" | "x" | "y">, view: { world: boolean; mapId: string | null }): Vec | null {
  if (view.world) return s.map === "wild" ? { x: s.x, y: s.y } : toWorld(s.map, s);
  return s.map !== "wild" && view.mapId === s.map ? { x: s.x, y: s.y } : null;
}

/** The spot (already in view px, with its point) I stand in: the nearest within the radius, a tie the newest. */
export function spotAt<T extends { at: Vec; spot: GroundbaitSpotView }>(spots: readonly T[], me: Vec | null, nowMs: number,
                                                                        radius = GROUNDBAIT_RADIUS_PX): T | null {
  if (!me) return null;
  let best: T | null = null, bestD = Infinity;
  for (const s of spots) {
    if (s.spot.untilMs <= nowMs) continue;
    const d = Math.hypot(s.at.x - me.x, s.at.y - me.y);
    if (d > radius) continue;
    if (d < bestD || (d === bestD && best && s.spot.id > best.spot.id)) { best = s; bestD = d; }
  }
  return best;
}
