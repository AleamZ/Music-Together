/**
 * Karaoke Timing Engine — Visual Fill Model.
 *
 * Determines how the colour gradient progresses INSIDE a single token.
 * This layer is completely independent of duration estimation.
 *
 * Uses a piecewise onset/nucleus/coda model instead of a global smoothstep.
 */

import type { PhoneticFillSegment } from "./types";
import { DEFAULT_PHONETIC_FILL } from "./constants";
import type { TimingToken } from "./tokenizer";

// ---------------------------------------------------------------------------
// Segment builder
// ---------------------------------------------------------------------------

/**
 * Builds the phonetic fill segments for one word-token.
 * Currently uses the DEFAULT_PHONETIC_FILL config.
 * Future: could be tuned per language / per word.
 */
export function buildPhoneticSegments(_token: TimingToken): PhoneticFillSegment[] {
  const { onset, nucleus, coda } = DEFAULT_PHONETIC_FILL;

  return [
    {
      type: "onset",
      startRatio: 0,
      endRatio: onset.durationFraction,
      visualStart: 0,
      visualEnd: onset.visualFraction,
    },
    {
      type: "nucleus",
      startRatio: onset.durationFraction,
      endRatio: onset.durationFraction + nucleus.durationFraction,
      visualStart: onset.visualFraction,
      visualEnd: onset.visualFraction + nucleus.visualFraction,
    },
    {
      type: "coda",
      startRatio: onset.durationFraction + nucleus.durationFraction,
      endRatio: 1,
      visualStart: onset.visualFraction + nucleus.visualFraction,
      visualEnd: 1,
    },
  ];
}

// ---------------------------------------------------------------------------
// Fill progress calculation
// ---------------------------------------------------------------------------

/**
 * Returns visual fill progress [0, 1] for a given raw time ratio [0, 1].
 *
 * Maps through the piecewise phonetic model:
 *   - onset:   quick start (gradient front-loads)
 *   - nucleus: slow sustained fill
 *   - coda:    quick finish
 */
export function calculateVisualFill(
  rawRatio: number,
  segments: PhoneticFillSegment[]
): number {
  const clamped = Math.min(1, Math.max(0, rawRatio));
  if (clamped === 0) return 0;
  if (clamped === 1) return 1;

  for (const seg of segments) {
    if (clamped >= seg.startRatio && clamped <= seg.endRatio) {
      const segDuration = seg.endRatio - seg.startRatio;
      if (segDuration <= 0) return seg.visualEnd;

      // Linear interpolation within the segment
      // (could be replaced with per-segment easing in the future)
      const localRatio = (clamped - seg.startRatio) / segDuration;
      return seg.visualStart + localRatio * (seg.visualEnd - seg.visualStart);
    }
  }

  return 1;
}

/**
 * Legacy smoothstep — kept as fallback when segments are unavailable.
 * S(x) = 3x² − 2x³
 */
export function smoothstep(ratio: number): number {
  const x = Math.min(1, Math.max(0, ratio));
  return x * x * (3 - 2 * x);
}

/**
 * Computes the final CSS --fill percentage [0, 100] for a token at currentMs.
 */
export function computeTokenFill(
  token: { startMs: number; endMs: number; durationMs: number; segments?: PhoneticFillSegment[] },
  currentMs: number
): number {
  if (token.durationMs <= 0) {
    return currentMs >= token.startMs ? 100 : 0;
  }
  if (currentMs <= token.startMs) return 0;
  if (currentMs >= token.endMs) return 100;

  const rawRatio = (currentMs - token.startMs) / token.durationMs;

  const visualRatio = token.segments
    ? calculateVisualFill(rawRatio, token.segments)
    : smoothstep(rawRatio);

  return Math.min(100, Math.max(0, Math.round(visualRatio * 100)));
}
