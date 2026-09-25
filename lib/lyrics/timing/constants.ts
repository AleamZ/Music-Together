/**
 * Karaoke Timing Engine — Constants.
 *
 * All magic numbers are centralised here so they can be tuned in one place.
 * Do NOT scatter raw numbers across other modules.
 */

// ---------------------------------------------------------------------------
// Syllable Duration Thresholds (ms / syllable)
// ---------------------------------------------------------------------------

/** Below this → fast/rap-like density */
export const FAST_SYLLABLE_THRESHOLD_MS = 200;

/** Above this → slow/ballad density */
export const SLOW_SYLLABLE_THRESHOLD_MS = 450;

/** Fallback when we cannot compute a song profile (neutral ballad-ish) */
export const DEFAULT_SYLLABLE_MS = 320;

// ---------------------------------------------------------------------------
// Line Duration Estimation
// ---------------------------------------------------------------------------

/**
 * Minimum realistic duration we ever assign to a lyric line's singing portion.
 * Prevents a zero-gap or malformed timestamp from producing zero-width tokens.
 */
export const MIN_LINE_SINGING_MS = 800;

/**
 * Fallback gap between lines when no next-line timestamp is available.
 */
export const FALLBACK_LINE_GAP_MS = 4500;

/**
 * Maximum fraction of total line duration that can be assigned to trailing gap.
 * Keeps held-note + speech from being eaten by silence.
 */
export const MAX_TRAILING_GAP_FRACTION = 0.35;

// ---------------------------------------------------------------------------
// Held-Note Model
// ---------------------------------------------------------------------------

/**
 * Hard floor for heldProbability when the last token has an open vowel ending.
 * Even on dense rap lines, final open-vowel tokens have some sustain.
 */
export const HELD_OPEN_VOWEL_FLOOR = 0.25;

/**
 * Minimum held-note bias applied to residual even on fast songs.
 */
export const MIN_HELD_NOTE_BIAS = 0.1;

/**
 * Maximum held-note bias for very slow songs.
 */
export const MAX_HELD_NOTE_BIAS = 0.85;

// ---------------------------------------------------------------------------
// Function Word Compression
// ---------------------------------------------------------------------------

/** Default compression for function words in normal-density songs */
export const DEFAULT_FUNCTION_WORD_COMPRESSION = 0.65;

/** Floor compression: even the fastest song compresses function words at most here */
export const MIN_FUNCTION_WORD_COMPRESSION = 0.45;

// ---------------------------------------------------------------------------
// Phonetic Fill Model (Onset / Nucleus / Coda)
// ---------------------------------------------------------------------------

/**
 * Default ratios for intra-word phonetic fill.
 *
 * Visual distance intentionally front-loads the onset (gets the
 * fill moving quickly) and then slows in the nucleus (sustained vowel).
 *
 *   Time:   onset=15%  nucleus=70%  coda=15%
 *   Visual: onset=25%  nucleus=55%  coda=20%
 */
export const DEFAULT_PHONETIC_FILL = {
  onset: {
    durationFraction: 0.15,
    visualFraction: 0.25,
  },
  nucleus: {
    durationFraction: 0.70,
    visualFraction: 0.55,
  },
  coda: {
    durationFraction: 0.15,
    visualFraction: 0.20,
  },
} as const;

// ---------------------------------------------------------------------------
// Phrase Boundary Weights (pause / hold)
// ---------------------------------------------------------------------------

export interface PhraseBoundaryProfile {
  /** Fraction of residual that becomes trailing gap */
  pauseWeight: number;
  /** Fraction of residual that becomes held duration */
  holdWeight: number;
}

export const PHRASE_BOUNDARIES: Readonly<Record<string, PhraseBoundaryProfile>> = {
  ",":  { pauseWeight: 0.20, holdWeight: 0.05 },
  ".":  { pauseWeight: 0.40, holdWeight: 0.10 },
  "…":  { pauseWeight: 0.20, holdWeight: 0.50 },
  "?":  { pauseWeight: 0.35, holdWeight: 0.15 },
  "!":  { pauseWeight: 0.30, holdWeight: 0.20 },
  ";":  { pauseWeight: 0.25, holdWeight: 0.08 },
  ":":  { pauseWeight: 0.15, holdWeight: 0.05 },
  "—":  { pauseWeight: 0.20, holdWeight: 0.25 },
  "-":  { pauseWeight: 0.10, holdWeight: 0.05 },
};

// ---------------------------------------------------------------------------
// Confidence Scores
// ---------------------------------------------------------------------------

export const CONFIDENCE = {
  enhancedLrc: 0.95,
  normalLrcStable: 0.75,
  normalLrcLargeGap: 0.50,
  normalLrcAbnormal: 0.35,
  fallback: 0.20,
} as const;

// ---------------------------------------------------------------------------
// Profile Estimation
// ---------------------------------------------------------------------------

/**
 * Minimum number of valid lines needed to compute a meaningful song profile.
 * Falls back to default profile below this.
 */
export const MIN_LINES_FOR_PROFILE = 4;

/**
 * Maximum syllable/ms ratio considered a valid data point for profile estimation.
 * Filters out silences masquerading as sung lines.
 */
export const MAX_VALID_SYLLABLE_MS = 1800;

/**
 * Minimum syllable duration considered valid (exclude zero-gap errors).
 */
export const MIN_VALID_SYLLABLE_MS = 60;
