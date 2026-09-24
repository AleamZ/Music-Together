/**
 * Parses LRC format synchronized lyrics into structured timeline objects.
 */

export interface LyricWord {
  word: string;
  timeMs: number;
  durationMs?: number;
}

export interface LyricLine {
  timeMs: number; // Milliseconds from start. -1 if plain unsynchronized lyric.
  text: string;
  words?: LyricWord[];
}

const TIMESTAMP_REGEX = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;
const WORD_TIMESTAMP_REGEX = /<(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?>([^<]+)/g;
const METADATA_TAG_REGEX = /^\[[a-zA-Z]+:[^\]]*\]$/;

/**
 * Parses raw LRC string into an array of LyricLine objects sorted chronologically.
 */
export function parseLrc(rawLrc: string): LyricLine[] {
  if (!rawLrc || typeof rawLrc !== "string") {
    return [];
  }

  const lines = rawLrc.split(/\r?\n/);
  const result: LyricLine[] = [];

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    // Skip metadata headers like [ar: Singer], [ti: Song], [al: Album]
    if (METADATA_TAG_REGEX.test(trimmed)) {
      continue;
    }

    // Match all line-level timestamps on this line
    const timestamps: number[] = [];
    let match: RegExpExecArray | null;

    // Reset regex index before matching
    TIMESTAMP_REGEX.lastIndex = 0;
    while ((match = TIMESTAMP_REGEX.exec(trimmed)) !== null) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      let ms = 0;
      if (match[3]) {
        // e.g. "45" -> 450ms, "5" -> 500ms, "123" -> 123ms
        ms = parseInt(match[3].padEnd(3, "0").slice(0, 3), 10);
      }
      const totalMs = (minutes * 60 + seconds) * 1000 + ms;
      timestamps.push(totalMs);
    }

    if (timestamps.length > 0) {
      const textWithoutBrackets = trimmed.replace(TIMESTAMP_REGEX, "").trim();

      // Check if line contains Enhanced LRC word-level timestamps: <mm:ss.xx>word
      let words: LyricWord[] | undefined = undefined;
      WORD_TIMESTAMP_REGEX.lastIndex = 0;
      if (WORD_TIMESTAMP_REGEX.test(textWithoutBrackets)) {
        WORD_TIMESTAMP_REGEX.lastIndex = 0;
        const parsedWords: LyricWord[] = [];
        let wordMatch: RegExpExecArray | null;
        while ((wordMatch = WORD_TIMESTAMP_REGEX.exec(textWithoutBrackets)) !== null) {
          const wMin = parseInt(wordMatch[1], 10);
          const wSec = parseInt(wordMatch[2], 10);
          let wMs = 0;
          if (wordMatch[3]) {
            wMs = parseInt(wordMatch[3].padEnd(3, "0").slice(0, 3), 10);
          }
          const wTimeMs = (wMin * 60 + wSec) * 1000 + wMs;
          const wordText = wordMatch[4].trim();
          if (wordText) {
            parsedWords.push({ word: wordText, timeMs: wTimeMs });
          }
        }
        if (parsedWords.length > 0) {
          words = parsedWords;
        }
      }

      // Clean all tags to produce final plain text
      const cleanText = textWithoutBrackets.replace(/<\d{1,2}:\d{2}(?:\.\d{1,3})?>/g, "").trim();
      for (const timeMs of timestamps) {
        if (words && words.length > 0) {
          result.push({ timeMs, text: cleanText, words });
        } else {
          result.push({ timeMs, text: cleanText });
        }
      }
    } else {
      // Line without timestamps (e.g. plain text lyric)
      result.push({ timeMs: -1, text: trimmed });
    }
  }

  // Sort synchronized lines chronologically
  const synced = result.filter((l) => l.timeMs >= 0).sort((a, b) => a.timeMs - b.timeMs);
  if (synced.length > 0) {
    return synced;
  }

  // If no lines had timestamps, return plain lines
  return result;
}

/**
 * Finds the index of the currently active lyric line given the elapsed playback time.
 */
export function findActiveLyricIndex(lyrics: LyricLine[], elapsedMs: number): number {
  if (!lyrics || lyrics.length === 0) return -1;
  // If unsynchronized, no active line
  if (lyrics[0].timeMs < 0) return -1;

  // Before the first lyric starts
  if (elapsedMs < lyrics[0].timeMs) {
    return -1;
  }

  // Binary search or linear scan for the active line
  let low = 0;
  let high = lyrics.length - 1;
  let activeIndex = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (lyrics[mid].timeMs <= elapsedMs) {
      activeIndex = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return activeIndex;
}
