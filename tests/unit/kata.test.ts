import { describe, expect, it } from "vitest";
import { EXAMS } from "@/lib/game/fight/dojo";
import {
  KATA_START, KATA_TAIL, judge, kataChart, kataChartOf, kataInputError, kataPassed, kataPct, kataScore, kataSuspect,
  type KataChart,
} from "@/lib/game/fight/kata";

const flat = (c: KataChart, dt = 0): number[] => c.notes.flatMap(([t, l]) => [t + dt, l]);

describe("kata charts", () => {
  it("are fixed by the seed and the target rank", () => {
    expect(kataChart(12345, 2)).toEqual(kataChart(12345, 2));
    expect(kataChart(12345, 2)).not.toEqual(kataChart(12346, 2));
  });

  it("have the belt's notes on beats from tick 180, half beats only from rank 3", () => {
    for (const e of EXAMS) {
      for (const seed of [1, 99, 4_000_000_000]) {
        const c = kataChart(seed, e.rank);
        expect(c.notes).toHaveLength(e.notes);
        expect(c.tpb).toBe(e.tpb);
        expect(c.notes[0][0]).toBe(KATA_START);
        const gaps = c.notes.slice(1).map(([t], i) => t - c.notes[i][0]);
        for (const g of gaps) expect(e.rank >= 3 ? [e.tpb, Math.trunc(e.tpb / 2)] : [e.tpb]).toContain(g);
        expect(c.length).toBe(c.notes[c.notes.length - 1][0] + KATA_TAIL);
      }
    }
    // over many seeds about a fifth of rank-4 gaps are half beats
    let half = 0, all = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const c = kataChart(seed, 4);
      for (let i = 1; i < c.notes.length; i++) { all++; if (c.notes[i][0] - c.notes[i - 1][0] === 14) half++; }
    }
    expect(half / all).toBeGreaterThan(0.14);
    expect(half / all).toBeLessThan(0.26);
  });

  it("never puts a lane three times in a row, and uses all eight", () => {
    const seen = new Set<number>();
    for (let seed = 1; seed <= 300; seed++) {
      const c = kataChartOf(seed, 36, 28, true);
      for (let i = 2; i < c.notes.length; i++) {
        expect(c.notes[i][1] === c.notes[i - 1][1] && c.notes[i][1] === c.notes[i - 2][1]).toBe(false);
      }
      for (const [, l] of c.notes) seen.add(l);
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});

describe("kata scoring", () => {
  const c = kataChart(777, 1);
  it("scores a perfect run 100 %", () => {
    const s = kataScore(c, flat(c));
    expect(s).toMatchObject({ points: 36, max: 36, perfect: 18, good: 0, miss: 0, extra: 0, worst: 0 });
    expect(kataPct(s)).toBe(100);
    expect(kataPassed(s, 60)).toBe(true);
  });

  it("windows: ±4 Hoàn hảo, ±9 Tốt, beyond a miss plus an extra press", () => {
    expect(kataScore(c, flat(c, 4))).toMatchObject({ perfect: 18, points: 36 });
    expect(kataScore(c, flat(c, -5))).toMatchObject({ perfect: 0, good: 18, points: 18 });
    expect(kataScore(c, flat(c, 9))).toMatchObject({ good: 18 });
    const late = kataScore(c, flat(c, 10));
    expect(late).toMatchObject({ perfect: 0, good: 0, miss: 18, extra: 18, points: 0 });
    expect(judge(4)).toBe("perfect");
    expect(judge(-9)).toBe("good");
    expect(judge(10)).toBe("miss");
  });

  it("an extra press costs a point, floored at 0 at the end", () => {
    const [t, l] = c.notes[0];
    const wrong = (l + 1) % 8;
    // the right note plus a press on another lane nowhere near a note of that lane
    const s = kataScore(c, [t, l, t, wrong].concat());
    const nearWrong = c.notes.some(([tt, ll]) => ll === wrong && Math.abs(tt - t) <= 9);
    expect(s.points).toBe(nearWrong ? 3 : 1);
    expect(kataScore(c, [0, 0, 1, 1, 2, 2]).points).toBe(0);
  });

  it("the pass line is points × 100 ≥ pct × max", () => {
    // 60 % of 36 = 21.6 → 22 points pass, 21 fail
    const presses = flat(c);
    const s11 = kataScore(c, presses.slice(0, 22));        // 11 perfect notes = 22 points
    expect(s11.points).toBe(22);
    expect(kataPassed(s11, 60)).toBe(true);
    const s = kataScore(c, presses.slice(0, 20).concat(presses[20] + 6, presses[21]));   // 10 perfect + 1 good
    expect(s.points).toBe(21);
    expect(kataPassed(s, 60)).toBe(false);
  });

  it("kata_perfect: every note within ±1 with 24 notes or more", () => {
    const big = kataChart(5, 2);
    expect(kataSuspect(big, kataScore(big, flat(big, 1)))).toBe(true);
    expect(kataSuspect(big, kataScore(big, flat(big, 2)))).toBe(false);
    expect(kataSuspect(c, kataScore(c, flat(c)))).toBe(false);
  });
});

describe("kata input", () => {
  const c = kataChart(3, 1);
  it("accepts honest presses and rejects malformed ones", () => {
    expect(kataInputError(c, flat(c))).toBeNull();
    expect(kataInputError(c, [])).toBeNull();
    expect(kataInputError(c, [1])).toBe("shape");
    expect(kataInputError(c, [5, 8])).toBe("lane");
    expect(kataInputError(c, [5, -1])).toBe("lane");
    expect(kataInputError(c, [-1, 0])).toBe("tick");
    expect(kataInputError(c, [1.5, 0])).toBe("tick");
    expect(kataInputError(c, [9, 0, 8, 1])).toBe("order");
    expect(kataInputError(c, [9, 0, 9, 1])).toBeNull();
    expect(kataInputError(c, [9, 0, 9, 1, 9, 2])).toBe("crowd");
    expect(kataInputError(c, [c.length, 0])).toBeNull();
    expect(kataInputError(c, [c.length + 1, 0])).toBe("late");
    expect(kataInputError(c, Array.from({ length: 3 * 18 * 2 + 2 }, (_, i) => (i % 2 ? 0 : 200 + i)))).toBe("count");
  });
});
