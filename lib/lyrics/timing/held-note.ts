/**
 * Karaoke Timing Engine — Held-Note & Residual Model.
 *
 * Computes how much of the gap after singing is:
 *   - actual held note (singer sustaining)
 *   - trailing gap (breathing, silence before next line)
 *
 * Replaces the fixed `lastWord × 2.5` multiplier with a
 * probability-weighted residual allocation.
 */

import type { TimingToken } from "./tokenizer";
import type { SongTimingProfile } from "./types";
import { PHRASE_BOUNDARIES, HELD_OPEN_VOWEL_FLOOR, MAX_TRAILING_GAP_FRACTION } from "./constants";

// ---------------------------------------------------------------------------
// Open-vowel detection (Vietnamese + English)
// ---------------------------------------------------------------------------

const OPEN_VOWEL_ENDING =
  /[aáàạảãâầấậẩẫăằắặẳẵoóòọỏõôồốộổỗơờớợởỡuúùụủũưừứựửữeéèẹẻẽêềếệểễiíìịỉĩyýỳỵỷỹ]$/i;

function hasOpenVowelEnding(token: TimingToken): boolean {
  // Strip trailing punctuation before testing
  const clean = token.text.replace(/[.,!?;:…—\-"'~]+$/, "");
  return OPEN_VOWEL_ENDING.test(clean);
}

// ---------------------------------------------------------------------------
// Held probability estimation
// ---------------------------------------------------------------------------

export interface HeldProbabilityContext {
  /** All non-space tokens in the line, in order */
  tokens: TimingToken[];
  /** Index of the token being evaluated */
  tokenIndex: number;
  /** Raw residual available after estimated speech duration */
  residualMs: number;
  songProfile: SongTimingProfile;
}

/**
 * Returns a probability [0, 1] that a token will carry a held note.
 *
 * Signals:
 *   + phrase-final position
 *   + open-vowel ending
 *   + large residual relative to song profile
 *   + slow timingDensity
 *   + trailing punctuation ("…", ".", etc.)
 *   - rap-like density
 *   - very dense line (little residual)
 *   - function word not at phrase boundary
 */
export function estimateHeldProbability(ctx: HeldProbabilityContext): number {
  const { tokens, tokenIndex, residualMs, songProfile } = ctx;
  const token = tokens[tokenIndex];

  if (!token || token.isSpace) return 0;

  let score = 0;

  // Phrase-final position carries the highest signal
  if (token.isPhraseFinal) {
    score += 0.40;
  }

  // Open-vowel endings → easier to sustain
  if (hasOpenVowelEnding(token)) {
    score += 0.20;
  }

  // Punctuation signals
  if (token.punctuation) {
    const boundary = PHRASE_BOUNDARIES[token.punctuation];
    if (boundary) {
      score += boundary.holdWeight;
    }
  }

  // Large residual relative to median syllable duration → more likely held
  const residualRatio = residualMs / Math.max(1, songProfile.medianSyllableMs);
  if (residualRatio > 3) {
    score += 0.20;
  } else if (residualRatio > 1.5) {
    score += 0.10;
  }

  // Slow songs → higher held tendency
  if (songProfile.timingDensity === "slow") {
    score += 0.10;
  } else if (songProfile.timingDensity === "fast") {
    score -= 0.15;
  }

  // Function word in non-phrase-final position almost never holds
  if (token.isFunctionWord && !token.isPhraseFinal) {
    score -= 0.30;
  }

  // Floor for open-vowel phrase-final tokens
  if (token.isPhraseFinal && hasOpenVowelEnding(token)) {
    score = Math.max(score, HELD_OPEN_VOWEL_FLOOR);
  }

  return Math.min(1, Math.max(0, score));
}

// ---------------------------------------------------------------------------
// Residual allocation
// ---------------------------------------------------------------------------

export interface ResidualAllocation {
  heldDurationMs: number;
  trailingGapMs: number;
}

/**
 * Splits the residual (time after estimated speech) into held-note and trailing gap.
 *
 * Does NOT automatically assign all residual to the last word.
 */
export function allocateResidual(
  residualMs: number,
  heldProbability: number,
  songProfile: SongTimingProfile,
  totalDurationMs?: number
): ResidualAllocation {
  if (residualMs <= 0) {
    return { heldDurationMs: 0, trailingGapMs: 0 };
  }

  // Cap natural breath gap for normal continuous singing
  const phraseGap = songProfile.phraseGapMs || 350;
  const maxBreathGap = Math.min(phraseGap, 450);

  // If line duration is normal (<= 5.5s), the phrase fills most of the line,
  // leaving only a natural breathing gap (typically 200 - 400ms) before the next line.
  const isInterlude = (totalDurationMs ?? residualMs) > 5500;

  if (!isInterlude) {
    // Normal continuous line: reserve only a natural breathing pause at the end
    const trailingGapMs = Math.min(
      maxBreathGap,
      Math.max(150, Math.round(residualMs * 0.12))
    );
    const heldDurationMs = Math.max(0, residualMs - trailingGapMs);
    return { heldDurationMs, trailingGapMs };
  }

  // Interlude / large gap (> 5.5s): singer holds note up to realistic physiological limit,
  // and the remaining time is true instrumental silence.
  const maxRealisticHeldMs = Math.round(
    Math.min(2400, Math.max(600, songProfile.slowSyllableMs * 3.5 * Math.max(0.3, heldProbability)))
  );
  const rawHeld = Math.round(residualMs * heldProbability * songProfile.heldNoteBias);
  const heldDurationMs = Math.max(0, Math.min(maxRealisticHeldMs, rawHeld));
  const trailingGapMs = Math.max(0, residualMs - heldDurationMs);

  return { heldDurationMs, trailingGapMs };
}
