import { describe, it, expect } from "vitest";
import {
  createHarvestRound, HARVEST, HARVEST_MARK, scoreRelease, scoreText, stepHarvestRound, type HarvestRound,
} from "@/lib/game/farm/minigames";

/** Plays a round at `dt` seconds a frame: holds until the bar reaches `aim(centre, bundle)`, lets go, and presses again
 *  once the cut beat is over. */
function play(seed: number, aim: (c: number, i: number) => number, dt = 1 / 60): HarvestRound {
  let s = createHarvestRound(seed);
  for (let f = 0; f < 60 * 120 && !s.outcome; f++) {
    const holding = s.beatMs > 0 ? false : !(s.charging && s.level >= aim(s.centres[s.bundle], s.bundle));
    s = stepHarvestRound(s, dt, holding);
  }
  return s;
}

describe("createHarvestRound", () => {
  it("seeds 8 sweet bands centred in [0.62, 0.78]", () => {
    const s = createHarvestRound(7);
    expect(s).toMatchObject({ bundle: 0, level: 0, charging: false, beatMs: 0, cuts: [], score: 0, elapsedMs: 0, outcome: null });
    expect(s.centres).toHaveLength(HARVEST.bundles);
    for (const c of s.centres) {
      expect(c).toBeGreaterThanOrEqual(0.62);
      expect(c).toBeLessThanOrEqual(0.78);
    }
    expect(createHarvestRound(7)).toEqual(s);
    expect(createHarvestRound(8).centres).not.toEqual(s.centres);
  });
});

describe("scoreRelease", () => {
  it("scores chuẩn within 0.07 of the centre, được within 0.17, and says which way a miss went", () => {
    expect(scoreRelease(0.7, 0.7)).toEqual({ mark: "chuan", score: 1 });
    expect(scoreRelease(0.77, 0.7)).toEqual({ mark: "chuan", score: 1 });
    expect(scoreRelease(0.63, 0.7)).toEqual({ mark: "chuan", score: 1 });
    expect(scoreRelease(0.78, 0.7)).toEqual({ mark: "duoc", score: 0.5 });
    expect(scoreRelease(0.87, 0.7)).toEqual({ mark: "duoc", score: 0.5 });
    expect(scoreRelease(0.53, 0.7)).toEqual({ mark: "duoc", score: 0.5 });
    expect(scoreRelease(0.52, 0.7)).toEqual({ mark: "sot", score: 0 });
    expect(scoreRelease(0.88, 0.7)).toEqual({ mark: "rung", score: 0 });
    expect(scoreRelease(1, 0.78)).toEqual({ mark: "rung", score: 0 });
    expect(HARVEST_MARK).toEqual({ chuan: "Chuẩn!", duoc: "Được", sot: "Lệch — sót hạt", rung: "Lệch — rụng hạt" });
  });
});

describe("stepHarvestRound", () => {
  it("raises the bar from 0 to 1 in 1.2 s while held, and auto-releases it at 1 as rụng hạt", () => {
    let s = createHarvestRound(1);
    s = stepHarvestRound(s, 0.05, true);
    expect(s).toMatchObject({ charging: true, level: 0 });
    for (let i = 0; i < 12; i++) s = stepHarvestRound(s, 0.05, true);
    expect(s.level).toBeCloseTo(0.5, 9);
    for (let i = 0; i < 12; i++) s = stepHarvestRound(s, 0.05, true);
    expect(s).toMatchObject({ bundle: 1, level: 0, charging: false, beatMs: HARVEST.beatMs, score: 0 });
    expect(s.cuts).toEqual([{ level: 1, centre: s.centres[0], mark: "rung", score: 0 }]);
    // still held after the beat: nothing happens until the sickle is let go and pressed again
    for (let i = 0; i < 40; i++) s = stepHarvestRound(s, 0.05, true);
    expect(s).toMatchObject({ bundle: 1, charging: false, level: 0, beatMs: 0 });
    s = stepHarvestRound(stepHarvestRound(s, 0.05, false), 0.05, true);
    expect(s.charging).toBe(true);
  });

  it("ignores input for 0.35 s after a cut, and starts the next charge once the beat is over", () => {
    let s = createHarvestRound(2);
    s = stepHarvestRound(s, 0.05, true);
    for (let i = 0; i < 10; i++) s = stepHarvestRound(s, 0.05, true);
    s = stepHarvestRound(s, 0.05, false);
    expect(s.cuts).toHaveLength(1);
    expect(s.cuts[0].level).toBeCloseTo(10 * 0.05 / 1.2, 9);
    for (let i = 0; i < 6; i++) s = stepHarvestRound(s, 0.05, true);
    expect(s).toMatchObject({ charging: false, level: 0 });
    expect(s.beatMs).toBeCloseTo(50, 6);
    s = stepHarvestRound(s, 0.05, true);
    expect(s.beatMs).toBe(0);
    s = stepHarvestRound(s, 0.05, true);
    expect(s.charging).toBe(true);
  });

  it("clamps a long frame to 50 ms and ignores a negative one", () => {
    let s = stepHarvestRound(createHarvestRound(3), 0.05, true);
    s = stepHarvestRound(s, 2, true);
    expect(s.level).toBeCloseTo(0.05 / 1.2, 9);
    expect(s.elapsedMs).toBeCloseTo(100, 6);
    expect(stepHarvestRound(s, -1, true).level).toBeCloseTo(s.level, 9);
  });

  it("passes a clean round with 8 points in about 10 s, at 60 and at 20 frames a second", () => {
    for (const dt of [1 / 60, 0.05]) {
      for (let seed = 1; seed <= 20; seed++) {
        const s = play(seed, (c) => c, dt);
        expect(s.outcome).toBe("pass");
        expect(s.score).toBe(8);
        expect(s.cuts.map((x) => x.mark)).toEqual(Array(8).fill("chuan"));
        expect(s.elapsedMs).toBeGreaterThan(8_000);
        expect(s.elapsedMs).toBeLessThan(12_000);
      }
    }
  });

  it("needs 4 points of 8: 3.5 fails, 4 passes", () => {
    const four = play(5, (c, i) => (i < 4 ? c : 0.2));
    expect([four.score, four.outcome]).toEqual([4, "pass"]);
    const threeAndHalf = play(5, (c, i) => (i < 3 ? c : i === 3 ? c + 0.12 : 0.2));
    expect(threeAndHalf.cuts.map((x) => x.mark)).toEqual(["chuan", "chuan", "chuan", "duoc", "sot", "sot", "sot", "sot"]);
    expect([threeAndHalf.score, threeAndHalf.outcome]).toEqual([3.5, "fail"]);
    const late = play(6, () => 1);
    expect(late.cuts.every((x) => x.mark === "rung")).toBe(true);
    expect(late.outcome).toBe("fail");
  });

  it("ends after the last cut's beat, and then stays put", () => {
    let s = createHarvestRound(9);
    let beforeEnd: HarvestRound | null = null;
    for (let f = 0; f < 10_000 && !s.outcome; f++) {
      const holding = s.beatMs > 0 ? false : !(s.charging && s.level >= s.centres[s.bundle]);
      const next = stepHarvestRound(s, 1 / 60, holding);
      if (next.outcome && !beforeEnd) beforeEnd = s;
      s = next;
    }
    expect(beforeEnd).toMatchObject({ bundle: 8, outcome: null });
    expect(beforeEnd!.beatMs).toBeGreaterThan(0);
    expect(stepHarvestRound(s, 1 / 60, true)).toBe(s);
  });
});

describe("scoreText", () => {
  it("writes a half point with a comma", () => {
    expect([scoreText(3.5), scoreText(4), scoreText(0), scoreText(0.5)]).toEqual(["3,5", "4", "0", "0,5"]);
  });
});
