/**
 * Karaoke Timing Engine — Core Types.
 *
 * Architecture: Three independent layers
 *   1. TimingSource  — where timestamps come from
 *   2. Duration Model — how long each token is sung
 *   3. Visual Fill   — how gradient progresses inside a token
 */

// ---------------------------------------------------------------------------
// Timing Source
// ---------------------------------------------------------------------------

export type KaraokeTimingSource =
  | "enhanced-lrc"   // word-level timestamps from Enhanced LRC <mm:ss.xx>
  | "estimated"      // heuristic estimation from line-level timestamps
  | "forced-alignment"; // future: server-side phoneme alignment

// ---------------------------------------------------------------------------
// Phonetic Fill Segments (Onset / Nucleus / Coda)
// ---------------------------------------------------------------------------

export type PhoneticSegmentType = "onset" | "nucleus" | "coda";

export interface PhoneticFillSegment {
  type: PhoneticSegmentType;
  /** Fraction of word duration this segment spans (0–1) */
  startRatio: number;
  endRatio: number;
  /** Fraction of visual fill this segment covers (0–1) */
  visualStart: number;
  visualEnd: number;
}

// ---------------------------------------------------------------------------
// Karaoke Token — the unit KaraokeView renders
// ---------------------------------------------------------------------------

export interface KaraokeToken {
  /** Display text (no extra whitespace) */
  text: string;
  isSpace: boolean;

  startMs: number;
  endMs: number;
  durationMs: number;

  timingSource: KaraokeTimingSource;

  /**
   * 0 = very uncertain, 1 = highest confidence
   * Enhanced LRC: 0.9–1.0
   * Normal LRC stable: 0.65–0.85
   * Abnormal interval: 0.3–0.6
   */
  confidence: number;

  syllableCount: number;

  /** Phonetic fill segments for intra-word visual progression */
  segments?: PhoneticFillSegment[];
}

// ---------------------------------------------------------------------------
// Karaoke Line Timing — the unit KaraokeView receives per active line
// ---------------------------------------------------------------------------

export interface KaraokeLineTiming {
  startMs: number;
  endMs: number;

  /**
   * Estimated end of actual singing (before trailing gap).
   * speechEndMs = startMs + speechDurationMs + heldDurationMs
   */
  speechEndMs: number;

  tokens: KaraokeToken[];

  timingSource: KaraokeTimingSource;
  confidence: number;

  /** Debug/tuning information — never ship as production logs */
  debug?: TimingDebugInfo;
}

// ---------------------------------------------------------------------------
// Song Timing Profile — adaptive, estimated from all valid lines
// ---------------------------------------------------------------------------

export interface SongTimingProfile {
  /** Median ms per syllable for this specific song */
  medianSyllableMs: number;

  /** 25th percentile — fast lines */
  fastSyllableMs: number;

  /** 75th percentile — slow lines */
  slowSyllableMs: number;

  /** Estimated average gap between lines (breathing room) */
  phraseGapMs: number;

  /**
   * Multiplier applied to function words when not phrase-final.
   * Range: 0.4 (very fast) – 1.0 (no compression)
   */
  functionWordCompression: number;

  /**
   * Bias toward allocating residual time to held-notes.
   * Range: 0.0 (all gap) – 1.0 (all held)
   */
  heldNoteBias: number;

  /** Overall lyrical density */
  timingDensity: "fast" | "normal" | "slow";
}

// ---------------------------------------------------------------------------
// Debug Info
// ---------------------------------------------------------------------------

export interface TimingDebugInfo {
  weightedSyllableCount: number;
  expectedSpeechDurationMs: number;
  residualMs: number;
  heldDurationMs: number;
  trailingGapMs: number;
  heldProbability: number;
  songProfile: SongTimingProfile;
}
