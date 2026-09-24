/**
 * Karaoke Timing Engine — Adaptive Song Timing Profile.
 *
 * Analyses all valid lines in a song to produce a SongTimingProfile that
 * reflects the actual lyrical timing density of THIS song, rather than
 * relying on universal magic numbers.
 *
 * Profile is computed once when lyrics load, not on every animation frame.
 */

import type { LyricLine } from "../parse-lrc";
import type { SongTimingProfile } from "./types";
import { tokenizeLine } from "./tokenizer";
import {
  FAST_SYLLABLE_THRESHOLD_MS,
  SLOW_SYLLABLE_THRESHOLD_MS,
  DEFAULT_SYLLABLE_MS,
  MIN_LINES_FOR_PROFILE,
  MAX_VALID_SYLLABLE_MS,
  MIN_VALID_SYLLABLE_MS,
  DEFAULT_FUNCTION_WORD_COMPRESSION,
  MIN_FUNCTION_WORD_COMPRESSION,
  MIN_HELD_NOTE_BIAS,
  MAX_HELD_NOTE_BIAS,
  FALLBACK_LINE_GAP_MS,
} from "./constants";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function median(sorted: number[]): number {
  if (sorted.length === 0) return DEFAULT_SYLLABLE_MS;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return DEFAULT_SYLLABLE_MS;
  const idx = Math.max(0, Math.floor((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

function countWeightedSyllables(text: string): number {
  const tokens = tokenizeLine(text);
  return tokens.reduce((sum, tok) => sum + tok.syllableCount, 0);
}

// ---------------------------------------------------------------------------
// Default profile used when not enough lines are available
// ---------------------------------------------------------------------------

export const DEFAULT_SONG_PROFILE: Readonly<SongTimingProfile> = {
  medianSyllableMs: DEFAULT_SYLLABLE_MS,
  fastSyllableMs: FAST_SYLLABLE_THRESHOLD_MS,
  slowSyllableMs: SLOW_SYLLABLE_THRESHOLD_MS,
  phraseGapMs: 400,
  functionWordCompression: DEFAULT_FUNCTION_WORD_COMPRESSION,
  heldNoteBias: 0.55,
  timingDensity: "normal",
};

// ---------------------------------------------------------------------------
// Main estimation
// ---------------------------------------------------------------------------

/**
 * Estimates an adaptive SongTimingProfile from all available lyric lines.
 *
 * Excludes data points that are clearly not sung content:
 *   - Lines with no timestamp
 *   - Lines with zero or negative gap to next line
 *   - Lines with zero syllables
 *   - Lines where syllable duration is suspiciously large (long silence)
 *   - Lines with only one word (poor estimators)
 */
export function estimateSongProfile(lines: LyricLine[]): SongTimingProfile {
  const synced = lines.filter((l) => l.timeMs >= 0);
  if (synced.length < MIN_LINES_FOR_PROFILE) {
    return { ...DEFAULT_SONG_PROFILE };
  }

  const syllableRates: number[] = [];
  const gapSamples: number[] = [];

  for (let i = 0; i < synced.length; i++) {
    const cur = synced[i];
    const next = synced[i + 1];

    if (!next) continue;

    const gapMs = next.timeMs - cur.timeMs;
    if (gapMs <= 0) continue;

    const syllables = countWeightedSyllables(cur.text || "");
    if (syllables < 2) continue; // single-word lines are poor estimators

    const syllableMs = gapMs / syllables;
    if (syllableMs < MIN_VALID_SYLLABLE_MS || syllableMs > MAX_VALID_SYLLABLE_MS) {
      // Likely a long silence between sections, or malformed timestamp
      gapSamples.push(gapMs); // still useful for phraseGapMs
      continue;
    }

    syllableRates.push(syllableMs);
    gapSamples.push(gapMs);
  }

  if (syllableRates.length < MIN_LINES_FOR_PROFILE) {
    return { ...DEFAULT_SONG_PROFILE };
  }

  syllableRates.sort((a, b) => a - b);

  const medianSyllableMs = median(syllableRates);
  const fastSyllableMs = percentile(syllableRates, 25);
  const slowSyllableMs = percentile(syllableRates, 75);

  // Phrase gap = median of all inter-line gaps
  gapSamples.sort((a, b) => a - b);
  const phraseGapMs = Math.min(800, Math.max(150, median(gapSamples) * 0.15));

  // Density classification
  let timingDensity: SongTimingProfile["timingDensity"];
  if (medianSyllableMs < FAST_SYLLABLE_THRESHOLD_MS) {
    timingDensity = "fast";
  } else if (medianSyllableMs > SLOW_SYLLABLE_THRESHOLD_MS) {
    timingDensity = "slow";
  } else {
    timingDensity = "normal";
  }

  // Function-word compression: fast songs compress less (words are already flying by),
  // slow songs can compress more because there's time.
  const densityRatio =
    (medianSyllableMs - FAST_SYLLABLE_THRESHOLD_MS) /
    Math.max(1, SLOW_SYLLABLE_THRESHOLD_MS - FAST_SYLLABLE_THRESHOLD_MS);
  const functionWordCompression = Math.max(
    MIN_FUNCTION_WORD_COMPRESSION,
    DEFAULT_FUNCTION_WORD_COMPRESSION - densityRatio * 0.1
  );

  // Held-note bias: slow songs spend more time in sustain
  const heldNoteBias = Math.min(
    MAX_HELD_NOTE_BIAS,
    Math.max(MIN_HELD_NOTE_BIAS, 0.3 + densityRatio * 0.5)
  );

  return {
    medianSyllableMs,
    fastSyllableMs,
    slowSyllableMs,
    phraseGapMs,
    functionWordCompression,
    heldNoteBias,
    timingDensity,
  };
}
