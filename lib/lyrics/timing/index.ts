/**
 * Karaoke Timing Engine — Public Index.
 *
 * Architecture: Three separate layers, called in sequence:
 *
 *   1. estimateSongProfile(lines)         — once per lyrics load
 *   2. buildEstimatedLineTiming(...)       — on active line change
 *   3. computeTokenFill(token, currentMs) — every animation frame
 */

// --- Types ------------------------------------------------------------------
export type {
  KaraokeToken,
  KaraokeLineTiming,
  SongTimingProfile,
  KaraokeTimingSource,
  PhoneticFillSegment,
  TimingDebugInfo,
} from "./types";

export type { TimingToken } from "./tokenizer";

// --- Profile (call once per lyrics load) ------------------------------------
export { estimateSongProfile, DEFAULT_SONG_PROFILE } from "./song-profile";

// --- Per-line timing (call in useMemo) --------------------------------------
export { buildEstimatedLineTiming } from "./duration-model";

// --- Visual fill (call in rAF loop) -----------------------------------------
export { computeTokenFill, smoothstep } from "./visual-fill";

// --- Utilities ---------------------------------------------------------------
export { tokenizeLine, estimateSyllableCount } from "./tokenizer";
