import { useCallback, useSyncExternalStore } from "react";
import { CHANGELOG_ID } from "./changelog";

/** When the bulletin went out; it pops up once per browser for CHANGELOG_POPUP_MS after this. */
export const CHANGELOG_PUBLISHED_AT = Date.parse("2026-09-28T00:00:00+07:00");
export const CHANGELOG_POPUP_MS = 7 * 24 * 60 * 60 * 1000;
export const CHANGELOG_SEEN_KEY = "mt.news.changelogSeen";

/** Pure rule: pop up while fresh and not yet seen in this browser. */
export function changelogDue(seen: string | null, now: number, id = CHANGELOG_ID): boolean {
  return seen !== id && now >= CHANGELOG_PUBLISHED_AT && now < CHANGELOG_PUBLISHED_AT + CHANGELOG_POPUP_MS;
}

// Storage can throw (private mode, blocked site data): the in-memory mark keeps a closed popup closed for this visit.
let memo: string | null = null;
const listeners = new Set<() => void>();

function readSeen(): string | null {
  try {
    return window.localStorage.getItem(CHANGELOG_SEEN_KEY) ?? memo;
  } catch {
    return memo;
  }
}

export function markChangelogSeen(id = CHANGELOG_ID): void {
  memo = id;
  try {
    window.localStorage.setItem(CHANGELOG_SEEN_KEY, id);
  } catch {
    /* kept in memory only */
  }
  listeners.forEach((l) => l());
}

/** Test hook: forget the in-memory mark. */
export function resetChangelogSeenMemo(): void {
  memo = null;
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

const snapshot = () => changelogDue(readSeen(), Date.now());
const serverSnapshot = () => false;

/** The bulletin popup: `due` once per browser while fresh; `dismiss` marks it seen. */
export function useChangelogPopup(): { due: boolean; dismiss: () => void } {
  const due = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const dismiss = useCallback(() => markChangelogSeen(), []);
  return { due, dismiss };
}
