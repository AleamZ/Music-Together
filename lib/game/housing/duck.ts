// v19.3 (a v19.2 fix): the apartment TV ducks the room's music by setting the (persisted) volume to 0. The volume it
// ducked from is kept in its own key while ducked, so a tab closed mid-TV gets the room's volume back on the next load.

export const DUCK_KEY = "music-together:ducked-from";

const valid = (raw: string | null): number | null => {
  const v = raw === null ? NaN : Number(raw);
  return Number.isFinite(v) && v >= 0 && v <= 100 ? v : null;
};

function store(): Storage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

/** The TV ducked the room from volume `v`. */
export function markDucked(v: number): void {
  try { store()?.setItem(DUCK_KEY, String(v)); } catch { /* storage full or blocked: the duck just is not remembered */ }
}

/** The duck ended (the volume was restored). */
export function clearDucked(): void {
  try { store()?.removeItem(DUCK_KEY); } catch { /* ignore */ }
}

/** Read and clear a leftover duck marker (a tab closed while the TV played): the volume to restore, or null. */
export function takeDucked(): number | null {
  const s = store();
  if (!s) return null;
  try {
    const v = valid(s.getItem(DUCK_KEY));
    s.removeItem(DUCK_KEY);
    return v;
  } catch {
    return null;
  }
}
