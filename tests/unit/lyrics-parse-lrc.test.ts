import { describe, it, expect } from "vitest";
import { parseLrc, findActiveLyricIndex } from "@/lib/lyrics/parse-lrc";

describe("parseLrc", () => {
  it("parses valid standard LRC format correctly", () => {
    const lrc = `
[ti:Song Title]
[ar:Artist Name]
[00:04.50]Dòng đầu tiên
[00:10.20]Dòng thứ hai
[01:05.80]Dòng điệp khúc
    `;
    const lines = parseLrc(lrc);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toEqual({ timeMs: 4500, text: "Dòng đầu tiên" });
    expect(lines[1]).toEqual({ timeMs: 10200, text: "Dòng thứ hai" });
    expect(lines[2]).toEqual({ timeMs: 65800, text: "Dòng điệp khúc" });
  });

  it("handles 3-digit millisecond timestamps", () => {
    const lrc = "[00:02.125]Ba chữ số thập phân";
    const lines = parseLrc(lrc);
    expect(lines[0].timeMs).toBe(2125);
    expect(lines[0].text).toBe("Ba chữ số thập phân");
  });

  it("handles multiple timestamps on a single line", () => {
    const lrc = "[00:10.00][00:20.00]Câu hát lặp lại";
    const lines = parseLrc(lrc);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual({ timeMs: 10000, text: "Câu hát lặp lại" });
    expect(lines[1]).toEqual({ timeMs: 20000, text: "Câu hát lặp lại" });
  });

  it("handles unsynchronized / plain lyrics", () => {
    const plain = "Dòng 1 không có time\nDòng 2 cũng vậy";
    const lines = parseLrc(plain);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual({ timeMs: -1, text: "Dòng 1 không có time" });
    expect(lines[1]).toEqual({ timeMs: -1, text: "Dòng 2 cũng vậy" });
  });

  it("returns empty array for empty input", () => {
    expect(parseLrc("")).toEqual([]);
    // @ts-expect-error test invalid type
    expect(parseLrc(null)).toEqual([]);
  });
});

describe("findActiveLyricIndex", () => {
  const lyrics = [
    { timeMs: 5000, text: "Intro" },
    { timeMs: 12000, text: "Verse 1" },
    { timeMs: 30000, text: "Chorus" },
  ];

  it("returns -1 before the first lyric starts", () => {
    expect(findActiveLyricIndex(lyrics, 0)).toBe(-1);
    expect(findActiveLyricIndex(lyrics, 4999)).toBe(-1);
  });

  it("finds the exact or intermediate active lyric line", () => {
    expect(findActiveLyricIndex(lyrics, 5000)).toBe(0);
    expect(findActiveLyricIndex(lyrics, 8000)).toBe(0);
    expect(findActiveLyricIndex(lyrics, 12000)).toBe(1);
    expect(findActiveLyricIndex(lyrics, 29999)).toBe(1);
    expect(findActiveLyricIndex(lyrics, 30000)).toBe(2);
    expect(findActiveLyricIndex(lyrics, 999999)).toBe(2);
  });

  it("returns -1 for unsynchronized lyrics", () => {
    const unsynced = [{ timeMs: -1, text: "Plain" }];
    expect(findActiveLyricIndex(unsynced, 5000)).toBe(-1);
  });
});
