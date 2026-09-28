import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { REEL_TIMING, reelTiming, reelTimingSuspect } from "@/lib/game/fishing/reel";

// Anti-cheat v2, part 2 (docs/superpowers/plans/2026-09-28-anticheat-v2-part2.md): the TS halves of 0058–0063 and their
// constants against the SQL. The SQL smokes (tests/sql/anticheat-v2-*-smoke.sql) check the same cases on the server.

const M = (n: string) => readFileSync(`supabase/migrations/${n}.sql`, "utf8").replace(/\r\n/g, "\n");

describe("0059: the reel's toggle timing", () => {
  it("the smoke's cases", () => {
    const metronome = Array.from({ length: 12 }, (_, g) => g * 10);
    expect(reelTiming(metronome)).toEqual({ n: 12, fast: 0, variance: 0 });
    expect(reelTimingSuspect(reelTiming(metronome))).toBe(true);
    const flicks = [0, 1, 30, 31, 60, 62, 90, 91, 120, 121];
    expect(reelTiming(flicks)).toMatchObject({ n: 10, fast: 5 });
    expect(reelTimingSuspect(reelTiming(flicks))).toBe(true);
    const hand = [0, 9, 21, 28, 43, 50, 66, 71, 90, 97, 113, 121];
    expect(reelTiming(hand)).toEqual({ n: 12, fast: 0, variance: 20.7273 });
    expect(reelTimingSuspect(reelTiming(hand))).toBe(false);
    expect(reelTiming([])).toEqual({ n: 0, fast: 0, variance: 0 });
    expect(reelTimingSuspect(reelTiming([5]))).toBe(false);
  });
  it("the thresholds are 0059's", () => {
    const m = M("0059_reel_hook");
    expect(m).toContain(`(p_t->>'n')::int >= ${REEL_TIMING.fastMin} and ${REEL_TIMING.fastShare} * (p_t->>'fast')::int >= (p_t->>'n')::int`);
    expect(m).toContain(`(p_t->>'n')::int >= ${REEL_TIMING.metronomeMin} and (p_t->>'var')::numeric < ${REEL_TIMING.metronomeVar}`);
    expect(m).toContain("count(*) filter (where g <= 2)");
  });
});
