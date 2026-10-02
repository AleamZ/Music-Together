// 3D wave 2: whether this browser shows the Võ đài previews (dojo stances and specials, the kata master, the ready
// screen) in 3D (fight-pose.ts on the chibi rig) instead of the 2D painters. Per browser (localStorage), off by
// default; the 2D renderer is untouched and fights play the same either way.

export const FIGHT_3D_KEY = "music_together_fight_3d";
const listeners = new Set<() => void>();

export function readFight3D(): boolean {
  if (typeof window === "undefined") return false;
  try { return window.localStorage.getItem(FIGHT_3D_KEY) === "1"; } catch { return false; }
}

export function writeFight3D(on: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (on) window.localStorage.setItem(FIGHT_3D_KEY, "1");
    else window.localStorage.removeItem(FIGHT_3D_KEY);
  } catch { /* private mode: stays 2D */ }
  for (const cb of listeners) cb();
}

export function subscribeFight3D(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
