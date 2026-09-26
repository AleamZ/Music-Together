import { describe, it, expect } from "vitest";
import {
  crabClosed, CRAB, CRAB_MARK, createCrabRound, createHarvestRound, createTransplantRound, HARVEST, HARVEST_MARK, scoreHill, scoreRelease,
  scoreText, stepCrabRound, stepHarvestRound, stepTransplantRound, TRANSPLANT, transplantMarkText, type CrabRound, type HarvestRound,
  type TransplantRound,
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

/** Plays a crab game at `dt` seconds a frame, grabbing when `grab(state)` says so (only a frame in the claws matters). */
function crab(seed: number, grab: (s: CrabRound) => boolean, dt = 0.05, start?: Partial<CrabRound>): CrabRound {
  let s: CrabRound = { ...createCrabRound(seed), ...start };
  for (let f = 0; f < 100_000 && !s.outcome; f++) s = stepCrabRound(s, dt, grab(s));
  return s;
}
/** The claws' state in the frame after this one, when a grab would be judged. */
const nextClosed = (s: CrabRound, dt = 0.05) => crabClosed(CRAB.periodsMs[s.tries.length], s.phases[s.tries.length], s.stageMs + dt * 1000);

describe("CrabRound (v15.3 §7.2, R17)", () => {
  it("seeds a phase in [0, P) for each of the 3 tries", () => {
    const s = createCrabRound(4);
    expect(s).toMatchObject({ tries: [], hits: 0, stage: "lead", stageMs: 0, elapsedMs: 0, outcome: null });
    expect(CRAB.periodsMs).toEqual([1200, 950, 750]);
    s.phases.forEach((p, i) => {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(CRAB.periodsMs[i]);
    });
    expect(createCrabRound(4)).toEqual(s);
    expect(createCrabRound(5).phases).not.toEqual(s.phases);
  });
  it("opens the claws for the first 60 % of each cycle and closes them for the last 40 %", () => {
    expect([0, 719, 720, 1199, 1200, 1920].map((t) => crabClosed(1200, 0, t))).toEqual([false, false, true, true, false, true]);
    expect([219, 220, 699, 700].map((t) => crabClosed(1200, 500, t))).toEqual([false, true, true, false]);
    expect([569, 570, 749].map((t) => crabClosed(950, 0, t))).toEqual([false, true, true]);
    expect([449, 450].map((t) => crabClosed(750, 0, t))).toEqual([false, true]);
  });
  it("ignores a grab in the 0.6 s lead-in and in the 0.5 s beat", () => {
    let s = createCrabRound(1);
    for (let i = 0; i < 11; i++) s = stepCrabRound(s, 0.05, true);
    expect(s).toMatchObject({ stage: "lead", tries: [] });
    s = stepCrabRound(s, 0.05, true);
    expect(s).toMatchObject({ stage: "claws", stageMs: 0, tries: [] });
    s = stepCrabRound(s, 0.05, true);
    expect(s.tries).toHaveLength(1);
    expect(s).toMatchObject({ stage: "beat" });
    for (let i = 0; i < 9; i++) s = stepCrabRound(s, 0.05, true);
    expect(s).toMatchObject({ stage: "beat", tries: [expect.anything()] });
    s = stepCrabRound(s, 0.05, true);
    expect(s).toMatchObject({ stage: "lead", tries: [expect.anything()] });
  });
  it("scores a grab: a hit while closed, a pinch while open; no grab in 4 cycles is a slip", () => {
    const hits = crab(2, (s) => s.stage === "claws" && nextClosed(s));
    expect(hits.tries).toEqual(["hit", "hit", "hit"]);
    expect([hits.hits, hits.outcome]).toEqual([3, "done"]);
    const pinches = crab(2, (s) => s.stage === "claws" && !nextClosed(s));
    expect([pinches.tries, pinches.hits]).toEqual([["pinch", "pinch", "pinch"], 0]);
    const none = crab(2, () => false);
    expect([none.tries, none.hits]).toEqual([["slip", "slip", "slip"], 0]);
    expect(CRAB_MARK).toEqual({ hit: "Bắt được!", pinch: "Á! Bị cua kẹp", slip: "Cua chui mất" });
  });
  it("judges a grab at the open/closed edge on the claws' clock", () => {
    const at = (ms: number) => crab(0, (s) => s.stage === "claws" && s.stageMs + 1 >= ms && s.tries.length === 0, 0.001,
      { phases: [0, 0, 0] }).tries[0];
    expect([at(719), at(720)]).toEqual(["pinch", "hit"]);
  });
  it("counts 0–3 hits whatever the input", () => {
    let rng = 7;
    for (let game = 0; game < 200; game++) {
      const s = crab(game, () => {
        rng = (rng * 1103515245 + 12345) % 2147483648;
        return rng % 7 === 0;
      }, 0.01 + (game % 5) * 0.01);
      expect(s.outcome).toBe("done");
      expect(s.hits).toBe(s.tries.filter((t) => t === "hit").length);
      expect(s.hits).toBeGreaterThanOrEqual(0);
      expect(s.hits).toBeLessThanOrEqual(3);
    }
  });
  it("takes 3.3 s at the least and 14.9 s at the most", () => {
    const fast = crab(3, (s) => s.stage === "claws", 0.001);
    expect(fast.elapsedMs).toBeGreaterThanOrEqual(3300);
    expect(fast.elapsedMs).toBeLessThan(3310);
    expect(crab(3, () => false).elapsedMs).toBeCloseTo(14_900, 6);
  });
  it("clamps a long frame to 50 ms, and stays put once done", () => {
    const s = stepCrabRound(createCrabRound(1), 3, false);
    expect(s.elapsedMs).toBeCloseTo(50, 6);
    const done = crab(1, () => false);
    expect(stepCrabRound(done, 0.05, true)).toBe(done);
  });
});

/** Plays a transplant round, pressing when the hand reaches `aim(centre, hill)` (null: never). */
function transplant(seed: number, aim: (c: number, i: number) => number | null, dt = 0.05): TransplantRound {
  let s = createTransplantRound(seed);
  for (let f = 0; f < 100_000 && !s.outcome; f++) {
    const a = s.stage === "sweep" ? aim(s.centres[s.hills.length], s.hills.length) : null;
    s = stepTransplantRound(s, dt, a !== null && s.x + (dt * 1000) / TRANSPLANT.sweepMs >= a);
  }
  return s;
}

describe("TransplantRound (v15.3 §8.2, R18)", () => {
  it("seeds 12 bands centred in [0.35, 0.65]", () => {
    const s = createTransplantRound(7);
    expect(s).toMatchObject({ hills: [], score: 0, stage: "lead", x: 0, elapsedMs: 0, outcome: null });
    expect(s.centres).toHaveLength(TRANSPLANT.hills);
    for (const c of s.centres) {
      expect(c).toBeGreaterThanOrEqual(0.35);
      expect(c).toBeLessThanOrEqual(0.65);
    }
    expect(createTransplantRound(7)).toEqual(s);
    expect(createTransplantRound(8).centres).not.toEqual(s.centres);
  });
  it("scores chuẩn within 0.08 of the centre, được within 0.18, else lệch", () => {
    expect(scoreHill(0.5, 0.5)).toEqual({ mark: "chuan", score: 1 });
    expect([scoreHill(0.58, 0.5), scoreHill(0.42, 0.5)].map((h) => h.mark)).toEqual(["chuan", "chuan"]);
    expect([scoreHill(0.59, 0.5), scoreHill(0.68, 0.5), scoreHill(0.32, 0.5)].map((h) => h.score)).toEqual([0.5, 0.5, 0.5]);
    expect([scoreHill(0.69, 0.5), scoreHill(0.31, 0.5)]).toEqual([{ mark: "lech", score: 0 }, { mark: "lech", score: 0 }]);
  });
  it("sweeps the hand from 0 to 1 in 1.4 s after a 1 s lead-in; a hill with no press is bỏ sót", () => {
    let s = createTransplantRound(2);
    for (let i = 0; i < 20; i++) s = stepTransplantRound(s, 0.05, true);
    expect(s).toMatchObject({ stage: "sweep", x: 0, hills: [] });
    for (let i = 0; i < 14; i++) s = stepTransplantRound(s, 0.05, false);
    expect(s.x).toBeCloseTo(0.5, 9);
    for (let i = 0; i < 14; i++) s = stepTransplantRound(s, 0.05, false);
    expect(s.hills).toEqual([{ x: null, centre: s.centres[0], mark: "sot", score: 0 }]);
    expect(s).toMatchObject({ stage: "beat" });
  });
  it("ignores a press in the lead-in and in the 0.25 s beat", () => {
    let s = createTransplantRound(3);
    for (let i = 0; i < 20; i++) s = stepTransplantRound(s, 0.05, true);
    s = stepTransplantRound(s, 0.05, true);
    expect(s.hills).toHaveLength(1);
    for (let i = 0; i < 4; i++) s = stepTransplantRound(s, 0.05, true);
    expect(s).toMatchObject({ stage: "beat" });
    expect(s.hills).toHaveLength(1);
    s = stepTransplantRound(s, 0.05, true);
    expect(s).toMatchObject({ stage: "sweep", x: 0 });
    expect(s.hills).toHaveLength(1);
  });
  it("needs 6 points of 12: 5,5 fails, 6 passes", () => {
    const six = transplant(5, (c, i) => (i < 6 ? c : null));
    expect([six.score, six.outcome]).toEqual([6, "pass"]);
    const half = transplant(5, (c, i) => (i < 5 ? c : i === 5 ? c + 0.12 : null));
    expect(half.hills.map((h) => h.mark)).toEqual([...Array(5).fill("chuan"), "duoc", ...Array(6).fill("sot")]);
    expect([half.score, scoreText(half.score), half.outcome]).toEqual([5.5, "5,5", "fail"]);
  });
  it("takes about 12 s when played well, 4 s at the least and under 21 s at the most", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const s = transplant(seed, (c) => c);
      expect(s.score).toBe(12);
      expect(s.elapsedMs).toBeGreaterThan(9_000);
      expect(s.elapsedMs).toBeLessThan(15_000);
    }
    const fast = transplant(1, () => 0, 0.001);
    expect(fast.elapsedMs).toBeGreaterThanOrEqual(4_000);
    expect(fast.elapsedMs).toBeLessThan(4_020);
    const idle = transplant(1, () => null);
    expect([idle.score, idle.outcome]).toEqual([0, "fail"]);
    expect(idle.elapsedMs).toBeCloseTo(20_800, 6);
  });
  it("names the marks, the ớt round with cây", () => {
    expect(["chuan", "duoc", "lech", "sot"].map((m) => transplantMarkText(m as "chuan", false)))
      .toEqual(["Thẳng hàng!", "Được", "Lệch hàng", "Bỏ sót khóm"]);
    expect(transplantMarkText("sot", true)).toBe("Bỏ sót cây");
  });
});
