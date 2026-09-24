import { describe, it, expect } from "vitest";
import { findActiveLyricIndex, parseLrc } from "@/lib/lyrics/parse-lrc";

describe("lyrics offset adjustment", () => {
  const sampleLrc = `
[00:05.00]Câu một bắt đầu hát
[00:10.00]Câu hai tiếp theo
[00:15.00]Điệp khúc bùng nổ
[00:20.00]Kết thúc bài hát
`;
  const lines = parseLrc(sampleLrc);

  it("finds normal active index without offset", () => {
    expect(findActiveLyricIndex(lines, 4000)).toBe(-1);
    expect(findActiveLyricIndex(lines, 5000)).toBe(0);
    expect(findActiveLyricIndex(lines, 8000)).toBe(0);
    expect(findActiveLyricIndex(lines, 12000)).toBe(1);
    expect(findActiveLyricIndex(lines, 16000)).toBe(2);
  });

  it("corrects intro delay using negative offset (retarding lyrics)", () => {
    // MV has a 10-second intro dialog, so singer sings Câu một at 15s instead of 5s.
    // By applying offsetMs = -10000, at elapsed 15s: 15000 + (-10000) = 5000 -> line 0 is active!
    const offsetMs = -10000;
    const effectiveElapsed = Math.max(0, 15000 + offsetMs);
    expect(findActiveLyricIndex(lines, effectiveElapsed)).toBe(0);
  });

  it("advances lyrics using positive offset (speeding up lyrics)", () => {
    // Singer starts singing earlier than studio version by 2 seconds.
    // At elapsed 3s, applying offsetMs = +2000 -> 5000ms -> line 0 becomes active!
    const offsetMs = 2000;
    const effectiveElapsed = Math.max(0, 3000 + offsetMs);
    expect(findActiveLyricIndex(lines, effectiveElapsed)).toBe(0);
  });

  it("handles edge cases where effectiveElapsed is negative", () => {
    const offsetMs = -5000;
    const effectiveElapsed = Math.max(0, 2000 + offsetMs);
    expect(effectiveElapsed).toBe(0);
    expect(findActiveLyricIndex(lines, effectiveElapsed)).toBe(-1);
  });
});
