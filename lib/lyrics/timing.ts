/**
 * Smart Phonetic & Rhythm-Aware Lyrics Timing Engine.
 * 
 * Provides natural syllable weighting, held-note duration scaling for line endings,
 * smooth vocal attack-sustain easing, and Enhanced LRC (<mm:ss.xx>) timestamp support.
 */

import type { LyricLine } from "./parse-lrc";

export interface TimedWord {
  text: string;
  isSpace: boolean;
  startMs: number;
  endMs: number;
  durationMs: number;
}

export interface LineTiming {
  startTimeMs: number;
  singingDurationMs: number;
  words: TimedWord[];
}

/**
 * Common Vietnamese & English function words that are sung rapidly
 * (pronouns, prepositions, conjunctions, filler words).
 */
const FAST_FUNCTION_WORDS = new Set([
  // Vietnamese
  "và", "thì", "là", "mà", "ở", "với", "cho", "để", "nhưng", "đã", "sẽ", "đang",
  "của", "từ", "này", "khi", "trong", "vào", "cùng", "như", "em", "anh", "ta",
  "tôi", "mình", "ai", "được", "ra", "lên", "về", "có", "không", "chỉ", "cũng",
  // English
  "the", "a", "an", "and", "or", "in", "on", "at", "to", "for", "with", "of",
  "is", "it", "so", "be", "by", "as", "if", "my", "you", "we", "he", "she",
]);

/**
 * Open vowels & diphthongs in Vietnamese that allow long vocal sustain.
 */
const SUSTAINABLE_VOWEL_ENDINGS = /[aáoàạảãeéèẹẻẽêếềệểễiíìịỉĩoóòọỏõôốồộổỗơớờợởỡuúùụủũưứừựửữyýỳỵỷỹ]$/i;

/**
 * Smooth vocal progress easing curve (Smoothstep S-curve).
 * Simulates human vocal articulation: quick consonant onset -> sustained vowel.
 */
export function easeVocalProgress(ratio: number): number {
  const clamped = Math.min(1, Math.max(0, ratio));
  // Smoothstep: 3x^2 - 2x^3 (zero derivative at endpoints, smooth continuous flow)
  return clamped * clamped * (3 - 2 * clamped);
}

/**
 * Computes natural, rhythm-aware word timing for a synchronized lyric line.
 */
export function computeLineTiming(
  curLine: LyricLine,
  nextLine?: LyricLine,
  fallbackDurationMs = 4500
): LineTiming {
  const startTimeMs = Math.max(0, curLine.timeMs);
  const rawGapMs =
    nextLine && nextLine.timeMs > startTimeMs
      ? nextLine.timeMs - startTimeMs
      : fallbackDurationMs;

  const rawText = (curLine.text || "").trim();
  if (!rawText) {
    return {
      startTimeMs,
      singingDurationMs: Math.max(1000, rawGapMs),
      words: [],
    };
  }

  // Tokenize preserving spaces
  const rawTokens = rawText.split(/(\s+)/).filter(Boolean);
  const wordsOnly = rawTokens.filter((tok) => !/^\s+$/.test(tok));
  const totalWordCount = wordsOnly.length;

  // Estimate realistic singing duration (cap excessive gaps between lines/solos)
  const totalChars = wordsOnly.reduce((acc, w) => acc + w.length, 0);
  const estimatedSingingMs = Math.max(1600, totalChars * 240 + 700);
  const singingDurationMs = Math.min(rawGapMs, estimatedSingingMs);

  // If curLine already has exact word-level timestamps (from Enhanced LRC)
  if (curLine.words && curLine.words.length > 0) {
    const timedWords: TimedWord[] = [];
    let wordIdx = 0;

    for (const token of rawTokens) {
      const isSpace = /^\s+$/.test(token);
      if (isSpace) {
        const prevEnd = timedWords.length > 0 ? timedWords[timedWords.length - 1].endMs : startTimeMs;
        timedWords.push({
          text: token,
          isSpace: true,
          startMs: prevEnd,
          endMs: prevEnd,
          durationMs: 0,
        });
      } else {
        const exact = curLine.words[wordIdx];
        const nextExact = curLine.words[wordIdx + 1];
        const start = exact ? exact.timeMs : startTimeMs;
        const end = nextExact
          ? nextExact.timeMs
          : exact?.durationMs
          ? start + exact.durationMs
          : start + Math.round(singingDurationMs / totalWordCount);

        timedWords.push({
          text: token,
          isSpace: false,
          startMs: start,
          endMs: Math.max(start + 50, end),
          durationMs: Math.max(50, end - start),
        });
        wordIdx++;
      }
    }

    return {
      startTimeMs,
      singingDurationMs,
      words: timedWords,
    };
  }

  // Smart Phonetic & Rhythm Weighting calculation
  const wordWeights: number[] = [];
  for (let i = 0; i < totalWordCount; i++) {
    const word = wordsOnly[i];
    const isLastWord = i === totalWordCount - 1;
    const cleanWord = word.toLowerCase().replace(/[.,!?:;"'~…\-]/g, "");

    // 1. Base weight based on syllable length
    let weight = Math.max(1.0, cleanWord.length);

    // 2. Short / Function words get discounted (sung quickly)
    if (FAST_FUNCTION_WORDS.has(cleanWord) && !isLastWord) {
      weight *= 0.65;
    }

    // 3. Open vowel endings allow longer resonance
    if (SUSTAINABLE_VOWEL_ENDINGS.test(cleanWord) && !isLastWord) {
      weight *= 1.15;
    }

    // 4. Held Note (Ngân cuối câu): In singing, the final word is held 2x to 3x longer
    if (isLastWord) {
      weight *= totalWordCount > 3 ? 2.5 : 1.8;
    }

    wordWeights.push(weight);
  }

  const sumWeights = wordWeights.reduce((a, b) => a + b, 0) || 1;

  // Build final TimedWord list with calculated startMs & endMs
  const timedWords: TimedWord[] = [];
  let currentCursorMs = startTimeMs;
  let wordIdx = 0;

  for (const token of rawTokens) {
    const isSpace = /^\s+$/.test(token);
    if (isSpace) {
      timedWords.push({
        text: token,
        isSpace: true,
        startMs: currentCursorMs,
        endMs: currentCursorMs,
        durationMs: 0,
      });
    } else {
      const weight = wordWeights[wordIdx];
      const duration = Math.max(100, Math.round((weight / sumWeights) * singingDurationMs));
      const end = currentCursorMs + duration;

      timedWords.push({
        text: token,
        isSpace: false,
        startMs: currentCursorMs,
        endMs: end,
        durationMs: duration,
      });

      currentCursorMs = end;
      wordIdx++;
    }
  }

  return {
    startTimeMs,
    singingDurationMs,
    words: timedWords,
  };
}

/**
 * Calculates current fill percentage (0 to 100) for a timed word.
 */
export function calculateWordFill(word: TimedWord, currentMs: number): number {
  if (word.isSpace || word.durationMs <= 0) {
    return currentMs >= word.startMs ? 100 : 0;
  }
  if (currentMs <= word.startMs) {
    return 0;
  }
  if (currentMs >= word.endMs) {
    return 100;
  }

  const elapsed = currentMs - word.startMs;
  const rawRatio = elapsed / word.durationMs;
  const eased = easeVocalProgress(rawRatio);
  return Math.min(100, Math.max(0, Math.round(eased * 100)));
}
