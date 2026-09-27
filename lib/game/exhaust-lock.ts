// The faint-ladder lock (0045): after the 5th faint of a Vietnam day, game mode is closed until VN midnight. The server
// is authoritative (vitals_tick's locked_until_ms, the 'exhausted' refusals); this remembers the end on this device so
// the "enter game" button can refuse up front. Storage may be missing (private mode): then only the server stops it.

const key = (account: string) => `mt.exhaustedUntil.${account}`;

export function saveExhaustLock(account: string, untilMs: number): void {
  try { localStorage.setItem(key(account), String(untilMs)); } catch { /* storage unavailable */ }
}

/** The lock's end if it is still running at `now`, else null (a stale value is cleared). */
export function readExhaustLock(account: string, now: number = Date.now()): number | null {
  try {
    const v = Number(localStorage.getItem(key(account)));
    if (Number.isFinite(v) && v > now) return v;
    localStorage.removeItem(key(account));
  } catch { /* storage unavailable */ }
  return null;
}
