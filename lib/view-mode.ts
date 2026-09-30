export type ViewMode = "classic" | "game";

/** Per-browser preference for how a room is shown (v13). */
export const VIEW_MODE_KEY = "music-together:view-mode";

/** Stored value → mode; the game is the default — only an explicit "classic" choice shows the music room. */
export function parseViewMode(raw: string | null | undefined): ViewMode {
  return raw === "classic" ? "classic" : "game";
}
