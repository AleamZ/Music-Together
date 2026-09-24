export type PresenceMode = "classic" | "game";
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
