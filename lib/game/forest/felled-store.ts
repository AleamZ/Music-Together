// The felled trees (0096 forest_felled, as forest_state answers it): one shared list the HUD fills (every client polls
// the server, so everyone sees a tree fall within seconds) and the 2D (Rừng tràm's live trees) and 3D (the Forest's
// instances) renderers read. A tree is "cx:cy:k"; it stands again at its respawn time.

let felled = new Map<string, number>();                       // key → respawn (local ms)
const listeners = new Set<() => void>();

/** Replace the list: server rows and the server's clock (for the local respawn times). */
export function setFelled(rows: ReadonlyArray<{ tree: string; respawnMs: number }>, serverNowMs: number): void {
  const off = Date.now() - serverNowMs;
  const next = new Map(rows.map((r) => [r.tree, r.respawnMs + off] as const));
  if (next.size === felled.size && [...next.keys()].every((k) => felled.has(k))) { felled = next; return; }
  felled = next;
  for (const fn of listeners) fn();
}

/** A tree I just felled (before the next poll). */
export function addFelled(key: string, respawnLocalMs: number): void {
  felled.set(key, respawnLocalMs);
  for (const fn of listeners) fn();
}

export function isFelled(key: string, nowMs = Date.now()): boolean {
  const t = felled.get(key);
  return t !== undefined && t > nowMs;
}

export function felledKeys(nowMs = Date.now()): string[] {
  return [...felled.entries()].filter(([, t]) => t > nowMs).map(([k]) => k);
}

export function subscribeFelled(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function resetFelledForTests(): void {
  felled = new Map();
  listeners.clear();
}
