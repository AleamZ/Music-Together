// v20 Võ đài: which painter draws the fighters. "chibi" (chibi.ts, the world's chibi style) is the default since the
// owner's ruling 2026-09-29; "rig" is the older 48 × 64 pose rig (rig.ts), kept as a per-browser opt-out
// (localStorage). Nothing is sent to the server and a fight plays the same either way.

export type FighterArt = "rig" | "chibi";

export const FIGHTER_ART_KEY = "music_together_fighter_art";

/** A stored value → the painter ("rig" only when asked for exactly; anything else is the chibi). */
export function parseFighterArt(raw: string | null | undefined): FighterArt {
  return typeof raw === "string" && raw.trim().toLowerCase() === "rig" ? "rig" : "chibi";
}

/** The painter this browser picked (the chibi on the server, in private mode or when unset). */
export function readFighterArt(): FighterArt {
  if (typeof window === "undefined") return "chibi";
  try {
    return parseFighterArt(window.localStorage.getItem(FIGHTER_ART_KEY));
  } catch {
    return "chibi";
  }
}

/** Saves the choice ("chibi" clears the key). */
export function writeFighterArt(art: FighterArt): void {
  if (typeof window === "undefined") return;
  try {
    if (art === "rig") window.localStorage.setItem(FIGHTER_ART_KEY, "rig");
    else window.localStorage.removeItem(FIGHTER_ART_KEY);
  } catch { /* private mode: the chibi stays */ }
}
