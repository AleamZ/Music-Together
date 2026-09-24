import type { ViewMode } from "@/lib/view-mode";

export type PresenceMode = ViewMode;
export interface PresenceMeta { name?: unknown; online_at?: unknown; mode?: unknown }
export interface PresenceEntry { accountId: string; name: string; mode: PresenceMode }

/** Presence state (key = account id, one meta per open tab) → one entry per account.
 *  An account counts as "game" when ANY of its tabs is in game mode. Sorted by account id. */
export function aggregatePresenceModes(state: Record<string, PresenceMeta[] | undefined>): PresenceEntry[] {
  const out: PresenceEntry[] = [];
  for (const [accountId, metas] of Object.entries(state)) {
    if (!metas || metas.length === 0) continue;
    const name = metas.map((m) => m.name).find((n): n is string => typeof n === "string" && n.length > 0) ?? "";
    const mode: PresenceMode = metas.some((m) => m.mode === "game") ? "game" : "classic";
    out.push({ accountId, name, mode });
  }
  return out.sort((a, b) => (a.accountId < b.accountId ? -1 : a.accountId > b.accountId ? 1 : 0));
}

/** Supabase allows 5 presence calls per client per 30 s; one is kept in reserve for re-tracks after a reconnect. */
export const PRESENCE_BUDGET = { max: 4, windowMs: 30_000 } as const;

/** ms to wait before the next presence track() so that at most `max` calls fall inside any `windowMs` window (0 = now). */
export function presenceDelay(sentAt: readonly number[], now: number, budget: { max: number; windowMs: number } = PRESENCE_BUDGET): number {
  const recent = sentAt.filter((t) => now - t < budget.windowMs).sort((a, b) => a - b);
  if (recent.length < budget.max) return 0;
  return recent[recent.length - budget.max] + budget.windowMs - now;
}
