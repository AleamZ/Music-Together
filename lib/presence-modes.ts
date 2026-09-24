import type { MapId } from "@/lib/game/maps/types";
import type { ViewMode } from "@/lib/view-mode";

export type PresenceMode = ViewMode;
export interface PresenceMeta { name?: unknown; online_at?: unknown; mode?: unknown; map?: unknown }
/** `map`: the game map the member walks on (v14); null in the classic view. */
export interface PresenceEntry { accountId: string; name: string; mode: PresenceMode; map: MapId | null }

const onlineAt = (m: PresenceMeta): number => (typeof m.online_at === "string" ? Date.parse(m.online_at) || 0 : 0);

/** Presence state (key = account id, one meta per open tab) → one entry per account.
 *  An account counts as "game" when ANY of its tabs is in game mode; its map comes from the game tab that tracked
 *  last (an old client without a map is in the hall). Sorted by account id. */
export function aggregatePresenceModes(state: Record<string, PresenceMeta[] | undefined>): PresenceEntry[] {
  const out: PresenceEntry[] = [];
  for (const [accountId, metas] of Object.entries(state)) {
    if (!metas || metas.length === 0) continue;
    const name = metas.map((m) => m.name).find((n): n is string => typeof n === "string" && n.length > 0) ?? "";
    const games = metas.filter((m) => m.mode === "game");
    if (games.length === 0) {
      out.push({ accountId, name, mode: "classic", map: null });
      continue;
    }
    const latest = games.reduce((a, b) => (onlineAt(b) > onlineAt(a) ? b : a));
    out.push({ accountId, name, mode: "game", map: latest.map === "pond" ? "pond" : "hall" });
  }
  return out.sort((a, b) => (a.accountId < b.accountId ? -1 : a.accountId > b.accountId ? 1 : 0));
}

export interface MapMember { accountId: string; name: string; classic: boolean }

/** Who is on which map (me included): classic-view members count in the hall. */
export function mapCounts(presence: readonly PresenceEntry[]): Record<MapId, MapMember[]> {
  const out: Record<MapId, MapMember[]> = { hall: [], pond: [] };
  for (const p of presence) {
    const classic = p.mode === "classic";
    out[classic ? "hall" : p.map ?? "hall"].push({ accountId: p.accountId, name: p.name, classic });
  }
  return out;
}

/** Supabase allows 5 presence calls per client per 30 s; one is kept in reserve for re-tracks after a reconnect. */
export const PRESENCE_BUDGET = { max: 4, windowMs: 30_000 } as const;

/** ms to wait before the next presence track() so that at most `max` calls fall inside any `windowMs` window (0 = now). */
export function presenceDelay(sentAt: readonly number[], now: number, budget: { max: number; windowMs: number } = PRESENCE_BUDGET): number {
  const recent = sentAt.filter((t) => now - t < budget.windowMs).sort((a, b) => a - b);
  if (recent.length < budget.max) return 0;
  return recent[recent.length - budget.max] + budget.windowMs - now;
}
