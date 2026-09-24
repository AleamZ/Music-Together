/**
 * Karaoke Timing Engine — Duration Model.
 *
 * Converts TimingToken[] + SongTimingProfile into KaraokeToken[]
 * with accurate per-token start/end timestamps.
 *
 * Responsibility:
 *   - speech duration estimation from syllables
 *   - held-note / trailing-gap residual allocation
 *   - token timeline construction
 *   - confidence scoring
 *
 * Does NOT:
 *   - parse LRC
 *   - render anything
 *   - run on every animation frame
 */

import type { LyricLine, LyricWord } from "../parse-lrc";
import type { KaraokeToken, KaraokeLineTiming, SongTimingProfile, TimingDebugInfo } from "./types";
import type { TimingToken } from "./tokenizer";
import { tokenizeLine } from "./tokenizer";
import { estimateHeldProbability, allocateResidual } from "./held-note";
import { buildPhoneticSegments } from "./visual-fill";
import {
  FALLBACK_LINE_GAP_MS,
  MIN_LINE_SINGING_MS,
  CONFIDENCE,
  PHRASE_BOUNDARIES,
} from "./constants";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getLineDurationMs(curLine: LyricLine, nextLine?: LyricLine): number {
  if (nextLine && nextLine.timeMs > curLine.timeMs) {
    return nextLine.timeMs - curLine.timeMs;
  }
  return FALLBACK_LINE_GAP_MS;
}

function weightedSyllableCount(tokens: TimingToken[], profile: SongTimingProfile): number {
  let total = 0;
  for (const tok of tokens) {
    if (tok.isSpace) continue;
    let weight = tok.syllableCount;
    if (tok.isFunctionWord && !tok.isPhraseFinal) {
      weight *= profile.functionWordCompression;
    }
    total += weight;
  }
  return Math.max(0.5, total);
}

function lineConfidence(
  _curLine: LyricLine,
  nextLine: LyricLine | undefined,
  totalDurationMs: number,
  profile: SongTimingProfile
): number {
  if (!nextLine) return CONFIDENCE.normalLrcLargeGap;
  const gap = totalDurationMs;
  if (gap > profile.slowSyllableMs * 20 || gap < 150) return CONFIDENCE.normalLrcAbnormal;
  if (gap > profile.slowSyllableMs * 8) return CONFIDENCE.normalLrcLargeGap;
  return CONFIDENCE.normalLrcStable;
}

// ---------------------------------------------------------------------------
// Enhanced LRC path
// ---------------------------------------------------------------------------

export function buildFromEnhancedLrc(
  curLine: LyricLine,
  words: LyricWord[],
  nextLine: LyricLine | undefined
): KaraokeLineTiming {
  const startMs = curLine.timeMs;
  const totalDurationMs = getLineDurationMs(curLine, nextLine);
  const endMs = startMs + totalDurationMs;

  const rawTokens = tokenizeLine(curLine.text || "");
  const karaokeTokens: KaraokeToken[] = [];
  let wordIdx = 0;

  for (const tok of rawTokens) {
    if (tok.isSpace) {
      const prevEnd =
        karaokeTokens.length > 0
          ? karaokeTokens[karaokeTokens.length - 1].endMs
          : startMs;
      karaokeTokens.push({
        text: tok.text,
        isSpace: true,
        startMs: prevEnd,
        endMs: prevEnd,
        durationMs: 0,
        timingSource: "enhanced-lrc",
        confidence: CONFIDENCE.enhancedLrc,
        syllableCount: 0,
      });
      continue;
    }

    const srcWord = words[wordIdx];
    const nextSrcWord = words[wordIdx + 1];

    const tokenStart = srcWord ? srcWord.timeMs : startMs;
    const tokenEnd = nextSrcWord
      ? nextSrcWord.timeMs
      : srcWord?.durationMs
      ? srcWord.timeMs + srcWord.durationMs
      : endMs;

    const durationMs = Math.max(50, tokenEnd - tokenStart);

    karaokeTokens.push({
      text: tok.text,
      isSpace: false,
      startMs: tokenStart,
      endMs: Math.max(tokenStart + 50, tokenEnd),
      durationMs,
      timingSource: "enhanced-lrc",
      confidence: CONFIDENCE.enhancedLrc,
      syllableCount: tok.syllableCount,
      segments: buildPhoneticSegments(tok),
    });

    wordIdx++;
  }

  const lastReal = [...karaokeTokens].reverse().find((t) => !t.isSpace);

  return {
    startMs,
    endMs,
    speechEndMs: lastReal ? lastReal.endMs : endMs,
    tokens: karaokeTokens,
    timingSource: "enhanced-lrc",
    confidence: CONFIDENCE.enhancedLrc,
  };
}

// ---------------------------------------------------------------------------
// Estimated path
// ---------------------------------------------------------------------------

function calculateTokenWeight(tok: TimingToken, profile: SongTimingProfile): number {
  if (tok.isSpace) return 0;

  let weight = tok.syllableCount * profile.medianSyllableMs;

  if (tok.isFunctionWord && !tok.isPhraseFinal) {
    weight *= profile.functionWordCompression;
  }

  if (tok.punctuation) {
    const boundary = PHRASE_BOUNDARIES[tok.punctuation];
    if (boundary) {
      weight *= 1 + boundary.holdWeight;
    }
  }

  return Math.max(80, weight);
}

export function buildEstimatedLineTiming(
  curLine: LyricLine,
  nextLine: LyricLine | undefined,
  profile: SongTimingProfile,
  debugEnabled = false
): KaraokeLineTiming {
  // Enhanced LRC: use exact word timestamps
  if (curLine.words && curLine.words.length > 0) {
    return buildFromEnhancedLrc(curLine, curLine.words, nextLine);
  }

  const startMs = curLine.timeMs;
  const totalDurationMs = getLineDurationMs(curLine, nextLine);
  const endMs = startMs + totalDurationMs;

  const rawTokens = tokenizeLine(curLine.text || "");
  const nonSpaceTokens = rawTokens.filter((t) => !t.isSpace);

  if (nonSpaceTokens.length === 0) {
    return {
      startMs,
      endMs,
      speechEndMs: endMs,
      tokens: [],
      timingSource: "estimated",
      confidence: CONFIDENCE.fallback,
    };
  }

  // Step 1: expected speech duration from syllables
  const wSyllables = weightedSyllableCount(rawTokens, profile);
  const expectedSpeechDurationMs = Math.min(
    totalDurationMs,
    Math.max(MIN_LINE_SINGING_MS, wSyllables * profile.medianSyllableMs)
  );

  // Step 2: residual after speech
  const residualMs = Math.max(0, totalDurationMs - expectedSpeechDurationMs);

  // Step 3: held probability for last real token
  const lastTokenIndex = nonSpaceTokens.length - 1;
  const heldProbability = estimateHeldProbability({
    tokens: nonSpaceTokens,
    tokenIndex: lastTokenIndex,
    residualMs,
    songProfile: profile,
  });

  // Step 4: held + gap split
  const { heldDurationMs, trailingGapMs } = allocateResidual(
    residualMs,
    heldProbability,
    profile,
    totalDurationMs
  );

  // Step 5: total singing duration (speech + held note)
  const speechAndHeldMs = Math.max(MIN_LINE_SINGING_MS, totalDurationMs - trailingGapMs);

  // Step 6: token weights & duration distribution
  const baseWeights = nonSpaceTokens.map((tok) => calculateTokenWeight(tok, profile));
  const sumBaseWeights = baseWeights.reduce((a, b) => a + b, 0) || 1;

  // Split heldDurationMs:
  // - finalHoldSustainMs: assigned to the final token for note sustain
  // - phraseSingingMs: distributed across all tokens to match the song's musical tempo
  const heldSustainRatio = Math.min(0.65, Math.max(0.25, heldProbability * 0.7));
  const finalHoldSustainMs = Math.round(heldDurationMs * heldSustainRatio);
  const phraseSingingMs = Math.max(
    MIN_LINE_SINGING_MS,
    speechAndHeldMs - finalHoldSustainMs
  );

  // Step 7: build timeline
  const karaokeTokens: KaraokeToken[] = [];
  let cursorMs = startMs;
  let nonSpaceIdx = 0;

  for (const tok of rawTokens) {
    if (tok.isSpace) {
      karaokeTokens.push({
        text: tok.text,
        isSpace: true,
        startMs: cursorMs,
        endMs: cursorMs,
        durationMs: 0,
        timingSource: "estimated",
        confidence: lineConfidence(curLine, nextLine, totalDurationMs, profile),
        syllableCount: 0,
      });
      continue;
    }

    const baseWeight = baseWeights[nonSpaceIdx];
    const isLast = nonSpaceIdx === lastTokenIndex;
    const baseDuration = Math.round((baseWeight / sumBaseWeights) * phraseSingingMs);
    const duration = Math.max(
      60,
      isLast ? baseDuration + finalHoldSustainMs : baseDuration
    );
    const tokenEnd = cursorMs + duration;

    karaokeTokens.push({
      text: tok.text,
      isSpace: false,
      startMs: cursorMs,
      endMs: tokenEnd,
      durationMs: duration,
      timingSource: "estimated",
      confidence: lineConfidence(curLine, nextLine, totalDurationMs, profile),
      syllableCount: tok.syllableCount,
      segments: buildPhoneticSegments(tok),
    });

    cursorMs = tokenEnd;
    nonSpaceIdx++;
  }

  const singingEndMs = Math.min(endMs, cursorMs);

  const debug: TimingDebugInfo | undefined = debugEnabled
    ? {
        weightedSyllableCount: wSyllables,
        expectedSpeechDurationMs,
        residualMs,
        heldDurationMs,
        trailingGapMs,
        heldProbability,
        songProfile: profile,
      }
    : undefined;

  return {
    startMs,
    endMs,
    speechEndMs: singingEndMs,
    tokens: karaokeTokens,
    timingSource: "estimated",
    confidence: lineConfidence(curLine, nextLine, totalDurationMs, profile),
    debug,
  };
}
