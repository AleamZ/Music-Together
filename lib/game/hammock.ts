import type { Interactable } from "@/lib/game/maps/types";

// The hall's hammock (võng): one person lies in it at a time. Client-only — the others learn it from `hm` on movement
// messages; two who lie down at once settle it by account id (the lower one keeps it).

export const HAMMOCK_TAKEN_TEXT = "Có người đang nằm";
export const HAMMOCK_UP_TEXT = "Dậy";

/** Is lying down refused now (on a vehicle, swimming, riding along, fishing, or locked by a stretch/cramp/strike)? */
export function hammockBlocked(s: { riding: boolean; swimming: boolean; passenger: boolean; rodOut: boolean; locked: boolean }): boolean {
  return s.riding || s.swimming || s.passenger || s.rodOut || s.locked;
}

/** The prompt for the hammock: "Dậy" while I lie in it, "Có người đang nằm" while someone else does, else its own. The
 *  same objects come back each time (the engine compares prompts by identity). */
const variants = new WeakMap<Interactable, { up: Interactable; taken: Interactable }>();
export function hammockPrompt(base: Interactable, lying: boolean, taken: boolean): Interactable {
  if (!lying && !taken) return base;
  let v = variants.get(base);
  if (!v) {
    v = { up: { ...base, prompt: HAMMOCK_UP_TEXT }, taken: { ...base, prompt: HAMMOCK_TAKEN_TEXT } };
    variants.set(base, v);
  }
  return lying ? v.up : v.taken;
}

/** Who keeps the hammock among everyone lying in it (me included): the lowest account id. */
export function hammockKeeper(ids: readonly string[]): string | null {
  let best: string | null = null;
  for (const id of ids) if (best === null || id < best) best = id;
  return best;
}
