export type ViewMode = "classic" | "game";

/** Per-browser preference for how a room is shown (v13). */
export const VIEW_MODE_KEY = "music-together:view-mode";

/** Stored value → mode; anything unknown (or missing) falls back to the classic UI. */
export function parseViewMode(raw: string | null | undefined): ViewMode {
  return raw === "game" ? "game" : "classic";
}
