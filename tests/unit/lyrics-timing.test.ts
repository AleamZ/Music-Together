import { describe, it, expect } from "vitest";
import {
  estimateSongProfile,
  buildEstimatedLineTiming,
  computeTokenFill,
  smoothstep,
  DEFAULT_SONG_PROFILE,
} from "@/lib/lyrics/timing/index";
import { tokenizeLine, estimateSyllableCount } from "@/lib/lyrics/timing/index";
import type { LyricLine } from "@/lib/lyrics/parse-lrc";

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

describe("tokenizeLine", () => {
  it("splits words and spaces", () => {
    const tokens = tokenizeLine("Và người ra đi");
    const nonSpace = tokens.filter((t) => !t.isSpace);
    const spaces = tokens.filter((t) => t.isSpace);
    expect(nonSpace).toHaveLength(4);
    expect(spaces).toHaveLength(3);
  });

  it("marks last token as phrase-final", () => {
    const tokens = tokenizeLine("em yêu anh");
    const nonSpace = tokens.filter((t) => !t.isSpace);
    expect(nonSpace[nonSpace.length - 1].isPhraseFinal).toBe(true);
    expect(nonSpace[0].isPhraseFinal).toBe(false);
  });

  it("marks function words correctly", () => {
    const tokens = tokenizeLine("và người");
    const nonSpace = tokens.filter((t) => !t.isSpace);
    expect(nonSpace[0].isFunctionWord).toBe(true); // "và"
    expect(nonSpace[1].isFunctionWord).toBe(false); // "người"
  });

  it("extracts trailing punctuation", () => {
    const tokens = tokenizeLine("em yêu anh,");
    const nonSpace = tokens.filter((t) => !t.isSpace);
    const last = nonSpace[nonSpace.length - 1];
    expect(last.punctuation).toBe(",");
    expect(last.isPhraseFinal).toBe(true);
  });

  it("handles empty string", () => {
    expect(tokenizeLine("")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Syllable estimator
// ---------------------------------------------------------------------------

describe("estimateSyllableCount", () => {
  it("returns 1 for Vietnamese monosyllabic tokens", () => {
    expect(estimateSyllableCount("yêu")).toBe(1);
    expect(estimateSyllableCount("anh")).toBe(1);
    expect(estimateSyllableCount("đi")).toBe(1);
  });

  it("estimates English multi-syllable words", () => {
    expect(estimateSyllableCount("beautiful")).toBeGreaterThanOrEqual(3);
    expect(estimateSyllableCount("love")).toBe(1);
    expect(estimateSyllableCount("table")).toBeGreaterThanOrEqual(2);
  });

  it("returns at least 1 for any non-empty string", () => {
    expect(estimateSyllableCount("xyz")).toBeGreaterThanOrEqual(1);
    expect(estimateSyllableCount("a")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Song Profile
// ---------------------------------------------------------------------------

describe("estimateSongProfile", () => {
  it("returns DEFAULT_SONG_PROFILE for too few lines", () => {
    const lines: LyricLine[] = [
      { timeMs: 1000, text: "Dòng một" },
      { timeMs: 3000, text: "Dòng hai" },
    ];
    const profile = estimateSongProfile(lines);
    expect(profile.medianSyllableMs).toBe(DEFAULT_SONG_PROFILE.medianSyllableMs);
  });

  it("detects fast song density for short syllable gaps", () => {
    // Create many lines with ~150ms per syllable (fast/rap)
    const lines: LyricLine[] = [];
    for (let i = 0; i < 15; i++) {
      // "một hai ba" = 3 syllables in ~450ms = 150ms/syl
      lines.push({ timeMs: i * 450, text: "một hai ba" });
    }
    const profile = estimateSongProfile(lines);
    expect(profile.timingDensity).toBe("fast");
  });

  it("detects slow song density for large syllable gaps", () => {
    const lines: LyricLine[] = [];
    for (let i = 0; i < 10; i++) {
      // "em" = 1 syllable in 600ms = 600ms/syl > SLOW_SYLLABLE_THRESHOLD_MS(450)
      // Use multi-syllable to pass MIN_LINES filter
      lines.push({ timeMs: i * 1800, text: "em ơi đừng đi" }); // 4 syl in 1800ms = 450ms/syl → borderline; use 2000ms
    }
    // Rebuild with clearer gap
    const slowLines: LyricLine[] = [];
    for (let i = 0; i < 10; i++) {
      slowLines.push({ timeMs: i * 2400, text: "em ơi đừng đi" }); // 4 syl in 2400ms = 600ms/syl
    }
    const profile = estimateSongProfile(slowLines);
    expect(profile.timingDensity).toBe("slow");
  });

  it("heldNoteBias is higher for slow songs", () => {
    const slowLines: LyricLine[] = [];
    const fastLines: LyricLine[] = [];
    for (let i = 0; i < 10; i++) {
      slowLines.push({ timeMs: i * 2000, text: "em yêu anh nhiều" });
      fastLines.push({ timeMs: i * 500, text: "em yêu anh nhiều" });
    }
    const slowProfile = estimateSongProfile(slowLines);
    const fastProfile = estimateSongProfile(fastLines);
    expect(slowProfile.heldNoteBias).toBeGreaterThan(fastProfile.heldNoteBias);
  });
});

// ---------------------------------------------------------------------------
// buildEstimatedLineTiming
// ---------------------------------------------------------------------------

describe("buildEstimatedLineTiming", () => {
  const profile = { ...DEFAULT_SONG_PROFILE };

  it("returns empty tokens for empty line", () => {
    const line: LyricLine = { timeMs: 5000, text: "" };
    const timing = buildEstimatedLineTiming(line, undefined, profile);
    expect(timing.tokens).toHaveLength(0);
    expect(timing.confidence).toBeGreaterThan(0);
  });

  it("last token has longer duration than function words", () => {
    const cur: LyricLine = { timeMs: 10000, text: "Một khi đã yêu" };
    const next: LyricLine = { timeMs: 14500, text: "Trái tim bằng lòng" };

    const timing = buildEstimatedLineTiming(cur, next, profile);
    const nonSpace = timing.tokens.filter((t) => !t.isSpace);
    expect(nonSpace.length).toBe(4);

    const lastTok = nonSpace[nonSpace.length - 1]; // "yêu"
    const firstTok = nonSpace[0]; // "Một"
    expect(lastTok.durationMs).toBeGreaterThan(firstTok.durationMs);
  });

  it("speechEndMs <= endMs", () => {
    const cur: LyricLine = { timeMs: 0, text: "Hello world" };
    const next: LyricLine = { timeMs: 5000, text: "How are you" };
    const timing = buildEstimatedLineTiming(cur, next, profile);
    expect(timing.speechEndMs).toBeLessThanOrEqual(timing.endMs);
    expect(timing.speechEndMs).toBeGreaterThanOrEqual(timing.startMs);
  });

  it("uses Enhanced LRC when words are present", () => {
    const cur: LyricLine = {
      timeMs: 1000,
      text: "Hello world",
      words: [
        { word: "Hello", timeMs: 1000, durationMs: 400 },
        { word: "world", timeMs: 1500, durationMs: 600 },
      ],
    };
    const timing = buildEstimatedLineTiming(cur, undefined, profile);
    expect(timing.timingSource).toBe("enhanced-lrc");
    expect(timing.confidence).toBeGreaterThanOrEqual(0.9);

    const nonSpace = timing.tokens.filter((t) => !t.isSpace);
    expect(nonSpace[0].startMs).toBe(1000);
    expect(nonSpace[1].startMs).toBe(1500);
  });

  it("all token end-times are sequential", () => {
    const cur: LyricLine = { timeMs: 2000, text: "và người ra đi không lời từ biệt" };
    const next: LyricLine = { timeMs: 7000, text: "để lại" };
    const timing = buildEstimatedLineTiming(cur, next, profile);
    const nonSpace = timing.tokens.filter((t) => !t.isSpace);

    for (let i = 1; i < nonSpace.length; i++) {
      expect(nonSpace[i].startMs).toBeGreaterThanOrEqual(nonSpace[i - 1].startMs);
    }
  });

  it("tokens have phonetic segments", () => {
    const cur: LyricLine = { timeMs: 0, text: "em yêu anh" };
    const next: LyricLine = { timeMs: 4000, text: "mãi mãi" };
    const timing = buildEstimatedLineTiming(cur, next, profile);
    const nonSpace = timing.tokens.filter((t) => !t.isSpace);
    // Each non-space token should have segments
    for (const tok of nonSpace) {
      expect(tok.segments).toBeDefined();
      expect(tok.segments!.length).toBe(3); // onset, nucleus, coda
    }
  });
});

// ---------------------------------------------------------------------------
// computeTokenFill
// ---------------------------------------------------------------------------

describe("computeTokenFill", () => {
  const token = {
    startMs: 2000,
    endMs: 3000,
    durationMs: 1000,
    segments: undefined,
  };

  it("returns 0 before token starts", () => {
    expect(computeTokenFill(token, 1000)).toBe(0);
    expect(computeTokenFill(token, 2000)).toBe(0);
  });

  it("returns 100 after token ends", () => {
    expect(computeTokenFill(token, 3000)).toBe(100);
    expect(computeTokenFill(token, 4000)).toBe(100);
  });

  it("returns intermediate values mid-fill", () => {
    const fill = computeTokenFill(token, 2500);
    expect(fill).toBeGreaterThan(0);
    expect(fill).toBeLessThan(100);
  });

  it("returns 100 for zero-duration token past its start", () => {
    const instant = { startMs: 1000, endMs: 1000, durationMs: 0 };
    expect(computeTokenFill(instant, 1500)).toBe(100);
    expect(computeTokenFill(instant, 500)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// smoothstep
// ---------------------------------------------------------------------------

describe("smoothstep", () => {
  it("clamps to [0, 1]", () => {
    expect(smoothstep(-0.5)).toBe(0);
    expect(smoothstep(1.5)).toBe(1);
  });

  it("produces S-curve at midpoint", () => {
    expect(smoothstep(0.5)).toBe(0.5);
    expect(smoothstep(0.2)).toBeCloseTo(0.104, 3);
  });
});
