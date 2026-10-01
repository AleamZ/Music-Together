import type { CharAct } from "./pose";

// Pure (a tiny client store, no DOM): wave 3's local "what am I doing" for the 3D chibi while a panel runs — the craft
// mini-games (Rèn → hammer, Nấu thuốc → stir, Phân loại → sort) and the photo mode (photo: holding the camera up).
// The panels set it while they are open; the engine reads it for my chibi's act. And the emoji reactions' emotes.

let current: CharAct | null = null;

/** Set (or clear with null) my chibi's busy act. */
export function setLocalEmote(a: CharAct | null): void {
  current = a;
}

export const localEmote = (): CharAct | null => current;

/** The act an emoji reaction plays on its sender (REACTION_EMOJIS): 🎉 / 🔥 dance, 👏 claps, the others wave. */
export function reactionAct(emoji: string): CharAct {
  return emoji === "🎉" || emoji === "🔥" ? "dance" : emoji === "👏" ? "clap" : "wave";
}

/** A card player's gesture at the table (seated): holding the fan, now and then playing a card (every ~6 s, per-player
 *  phase); a 🎉 at the table cheers. `t` in ms. */
export function cardAct(t: number, phase: number, cheering: boolean): CharAct {
  if (cheering) return "card_win";
  const k = (((t / 1000 + phase * 2.3) % 6) + 6) % 6;
  return k < 1.4 ? "card_play" : "card_hold";
}
