// 0123: my placed traps (forest_state's `traps`, world px), shared between the forest HUD that polls them and the 2D
// Rừng tràm map that draws them (useWorld's extras). `ready` is the odds of a catch by now (0 … 1), as of the poll.
import { trapOdds } from "./catalog";

export interface TrapMark { id: number; item: string; x: number; y: number; durability: number; max: number; odds: number }

let traps: TrapMark[] = [];
const listeners = new Set<() => void>();

/** Replace the list (the server's rows and the server's clock). */
export function setTraps(rows: ReadonlyArray<{ id: number; item: string; x: number; y: number; durability: number; max: number; sinceMs: number }>,
  serverNowMs: number): void {
  traps = rows.map((r) => ({ id: r.id, item: r.item, x: r.x, y: r.y, durability: r.durability, max: r.max,
    odds: trapOdds(r.item, (serverNowMs - r.sinceMs) / 60_000) }));
  for (const fn of listeners) fn();
}

export function trapList(): readonly TrapMark[] {
  return traps;
}

export function subscribeTraps(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** The nearest of my traps within `reach` px of (x, y) (world px), or null. */
export function nearestTrap(x: number, y: number, reach: number): TrapMark | null {
  let best: TrapMark | null = null, bd = Infinity;
  for (const t of traps) {
    const d = Math.hypot(t.x - x, t.y - y);
    if (d <= reach && d < bd) { best = t; bd = d; }
  }
  return best;
}
