// v20 Võ đài, an experiment: which painter draws the fighters. "rig" is the 48 × 64 pose rig (rig.ts, the default);
// "chibi" is the prototype in the world's chibi style (chibi.ts). A per-browser setting only (localStorage), so the
// owner can compare the two in a real fight; nothing is sent to the server and a fight plays the same either way.

export type FighterArt = "rig" | "chibi";

export const FIGHTER_ART_KEY = "music_together_fighter_art";

/** A stored value → the painter ("chibi" only when asked for exactly; anything else is the rig). */
export function parseFighterArt(raw: string | null | undefined): FighterArt {
  return typeof raw === "string" && raw.trim().toLowerCase() === "chibi" ? "chibi" : "rig";
}

/** The painter this browser picked (the rig on the server, in private mode or when unset). */
export function readFighterArt(): FighterArt {
  if (typeof window === "undefined") return "rig";
  try {
    return parseFighterArt(window.localStorage.getItem(FIGHTER_ART_KEY));
  } catch {
    return "rig";
  }
}

/** Saves the choice ("rig" clears the key). */
export function writeFighterArt(art: FighterArt): void {
  if (typeof window === "undefined") return;
  try {
    if (art === "chibi") window.localStorage.setItem(FIGHTER_ART_KEY, "chibi");
    else window.localStorage.removeItem(FIGHTER_ART_KEY);
  } catch { /* private mode: the rig stays */ }
}
