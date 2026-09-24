/**
 * Karaoke Timing Engine — Tokenizer.
 *
 * Converts a raw lyric string into TimingToken objects carrying
 * linguistic metadata (syllable count, function-word flag,
 * phrase-final flag, trailing punctuation).
 */

// ---------------------------------------------------------------------------
// Token model
// ---------------------------------------------------------------------------

export interface TimingToken {
  text: string;
  normalizedText: string;
  isSpace: boolean;

  /** Estimated number of syllables */
  syllableCount: number;

  /**
   * True if the token is a grammatical function word that is typically
   * sung quickly when NOT phrase-final.
   */
  isFunctionWord: boolean;

  /**
   * True if this token is the last non-space token in the line,
   * OR if it is immediately followed by a hard punctuation boundary.
   */
  isPhraseFinal: boolean;

  /** Trailing punctuation character, if any */
  punctuation?: string;
}

// ---------------------------------------------------------------------------
// Function-word vocabulary
// ---------------------------------------------------------------------------

const FUNCTION_WORDS_VI = new Set([
  "và", "thì", "là", "mà", "ở", "với", "cho", "để", "nhưng", "đã", "sẽ",
  "đang", "của", "từ", "này", "khi", "trong", "vào", "cùng", "như", "em",
  "anh", "ta", "tôi", "mình", "ai", "được", "ra", "lên", "về", "có",
  "không", "chỉ", "cũng", "những", "các", "một", "hai", "ba", "đây", "đó",
  "đến", "đi", "lại", "cũng", "bao", "mọi", "nơi", "nào",
]);

const FUNCTION_WORDS_EN = new Set([
  "the", "a", "an", "and", "or", "in", "on", "at", "to", "for", "with",
  "of", "is", "it", "so", "be", "by", "as", "if", "my", "you", "we",
  "he", "she", "they", "do", "did", "am", "are", "was", "were", "I",
  "me", "him", "her", "us", "them", "that", "this", "but", "nor", "yet",
  "both", "not",
]);

function isFunctionWordToken(normalized: string): boolean {
  return FUNCTION_WORDS_VI.has(normalized) || FUNCTION_WORDS_EN.has(normalized);
}

// ---------------------------------------------------------------------------
// Syllable estimation
// ---------------------------------------------------------------------------

/**
 * Vietnamese: each whitespace-separated token is one syllable (monosyllabic language).
 * English: heuristic vowel-cluster count.
 * Unknown: falls back to English estimator.
 */
export function estimateSyllableCount(word: string): number {
  if (!word) return 0;

  // Vietnamese detection: contains Vietnamese diacritics → 1 syllable per token
  const hasVietnameseDiacritics =
    /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(word);
  if (hasVietnameseDiacritics) {
    return 1;
  }

  // English syllable estimator (vowel-cluster heuristic)
  const lower = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!lower) return 1;

  // Count vowel clusters
  const vowelClusters = lower.match(/[aeiou]+/g) || [];
  let count = vowelClusters.length;

  // Silent 'e' at end of word (e.g. "love", "fire")
  if (lower.endsWith("e") && count > 1) {
    count -= 1;
  }

  // "le" suffix forms its own syllable (e.g. "table", "purple")
  if (lower.length > 2 && lower.endsWith("le") && !/[aeiou]l$/.test(lower)) {
    count += 1;
  }

  return Math.max(1, count);
}

// ---------------------------------------------------------------------------
// Punctuation extraction
// ---------------------------------------------------------------------------

const PHRASE_PUNCTUATION = new Set([",", ".", "…", "!", "?", ";", ":", "—", "-"]);

function extractPunctuation(text: string): { clean: string; punctuation?: string } {
  const last = text.slice(-1);
  if (PHRASE_PUNCTUATION.has(last)) {
    return { clean: text.slice(0, -1), punctuation: last };
  }
  // Handle "..." as single token
  if (text.endsWith("...")) {
    return { clean: text.slice(0, -3), punctuation: "…" };
  }
  return { clean: text };
}

// ---------------------------------------------------------------------------
// Main tokenizer
// ---------------------------------------------------------------------------

export function tokenizeLine(text: string): TimingToken[] {
  const raw = (text || "").normalize("NFC").trim();
  if (!raw) return [];

  // Split preserving whitespace runs
  const rawTokens = raw.split(/(\s+)/).filter(Boolean);
  const tokens: TimingToken[] = [];

  // Pre-pass: find the last non-space raw token index
  let lastWordIdx = -1;
  for (let i = rawTokens.length - 1; i >= 0; i--) {
    if (!/^\s+$/.test(rawTokens[i])) {
      lastWordIdx = i;
      break;
    }
  }

  for (let i = 0; i < rawTokens.length; i++) {
    const part = rawTokens[i];
    const isSpace = /^\s+$/.test(part);

    if (isSpace) {
      tokens.push({
        text: part,
        normalizedText: " ",
        isSpace: true,
        syllableCount: 0,
        isFunctionWord: false,
        isPhraseFinal: false,
      });
      continue;
    }

    const { clean, punctuation } = extractPunctuation(part);
    const normalized = (clean || part).toLowerCase().replace(/[^a-zàáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/gi, "");

    const isLastWordToken = i === lastWordIdx;
    const hasPhraseBreakPunctuation = punctuation !== undefined;
    const isPhraseFinal = isLastWordToken || hasPhraseBreakPunctuation;

    tokens.push({
      text: part,
      normalizedText: normalized,
      isSpace: false,
      syllableCount: estimateSyllableCount(clean || part),
      isFunctionWord: isFunctionWordToken(normalized),
      isPhraseFinal,
      punctuation,
    });
  }

  return tokens;
}
