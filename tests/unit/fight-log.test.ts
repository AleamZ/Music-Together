import { describe, expect, it } from "vitest";
import { RunRecorder, decodeRuns, encodeRuns, runsError, runsLength } from "@/lib/game/fight/log";

describe("fight logs (RLE runs)", () => {
  it("round-trips masks through runs and the recorder", () => {
    const masks = [0, 0, 0, 16, 16, 2, 2, 2, 2, 0, 1023, 1023];
    const runs = encodeRuns(masks);
    expect(runs).toEqual([0, 3, 16, 2, 2, 4, 0, 1, 1023, 2]);
    expect(decodeRuns(runs, 100)).toEqual(masks);
    expect(runsLength(runs)).toBe(12);
    const rec = new RunRecorder();
    for (const m of masks) rec.push(m);
    expect(rec.runs()).toEqual(runs);
    expect(rec.frames).toBe(12);
    expect(rec.runsFrom(4)).toEqual([16, 1, 2, 4, 0, 1, 1023, 2]);
    expect(rec.runsFrom(12)).toEqual([]);
    expect(encodeRuns([])).toEqual([]);
  });

  it("decodes only within the limit", () => {
    expect(decodeRuns([0, 300], 300)).toHaveLength(300);
    expect(decodeRuns([0, 300, 1, 1], 300)).toBeNull();
    expect(decodeRuns([0], 10)).toBeNull();
    expect(decodeRuns([2048, 1], 10)).toBeNull();
    expect(decodeRuns([1, 0], 10)).toBeNull();
  });

  it("names what is wrong: odd, mask, count, too_long, rate", () => {
    expect(runsError([0, 10, 16, 1, 0, 5], 300)).toBeNull();
    expect(runsError([0, 10, 16], 300)).toBe("odd");
    expect(runsError([1024, 1], 300)).toBe("mask");
    expect(runsError([-1, 1], 300)).toBe("mask");
    expect(runsError([1, 0], 300)).toBe("count");
    expect(runsError([1, 301], 300)).toBe("too_long");
    // 21 changes inside 60 frames is a script; 20 is a fast human
    const fast = Array.from({ length: 21 }, (_, i) => [i % 2 ? 16 : 0, 2]).flat();         // 20 changes in 42 frames
    expect(runsError(fast, 300)).toBeNull();
    const burst = Array.from({ length: 22 }, (_, i) => [i % 2 ? 16 : 0, 2]).flat();        // 21 changes in 44 frames
    expect(runsError(burst, 300)).toBe("rate");
    const steady = Array.from({ length: 60 }, (_, i) => [i % 2 ? 16 : 0, 3]).flat();       // one change per 3 frames
    expect(runsError(steady, 300)).toBeNull();
    // equal adjacent runs are not a change
    expect(runsError(Array.from({ length: 40 }, () => [16, 1]).flat(), 300)).toBeNull();
  });
});
