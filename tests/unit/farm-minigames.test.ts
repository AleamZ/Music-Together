import { describe, it, expect } from "vitest";
import {
  crabClosed, CRAB, CRAB_MARK, crabInputError, createCrabRound, createHarvestRound, createTransplantRound, HARVEST, HARVEST_MARK,
  harvestInputError, replayCrab, replayHarvest, scoreHill, scoreRelease, scoreText, stepCrabRound, stepHarvestRound,
  stepTransplantRound, ToggleRecorder, togglesError, TRANSPLANT, transplantMarkText, type CrabRound, type HarvestRound,
  type TransplantRound,
} from "@/lib/game/farm/minigames";

/** Plays a round tick by tick: holds until the bar reaches `aim(centre, bundle)` ‰, lets go, and presses again once the
 *  cut beat is over. Records the hold as the server takes it. */
function play(seed: number, aim: (c: number, i: number) => number): HarvestRound & { toggles: number[] } {
  let s = createHarvestRound(seed);
  const rec = new ToggleRecorder();
  while (!s.outcome) {
    const holding = s.beat > 0 ? false : !(s.charging && s.level >= aim(s.centres[s.bundle], s.bundle));
    rec.hold(s.tick, holding);
    s = stepHarvestRound(s, holding);
  }
  return { ...s, toggles: rec.toggles };
}
const hold = (s: HarvestRound, n: number, holding: boolean) => {
  for (let i = 0; i < n; i++) s = stepHarvestRound(s, holding);
  return s;
};

describe("createHarvestRound", () => {
  it("seeds 8 sweet bands centred in [620, 780] ‰", () => {
    const s = createHarvestRound(7);
    expect(s).toMatchObject({ bundle: 0, level: 0, charging: false, beat: 0, cuts: [], score2: 0, tick: 0, outcome: null });
    expect(s.centres).toHaveLength(HARVEST.bundles);
    for (const c of s.centres) {
      expect(Number.isInteger(c)).toBe(true);
      expect(c).toBeGreaterThanOrEqual(620);
      expect(c).toBeLessThanOrEqual(780);
    }
    expect(createHarvestRound(7)).toEqual(s);
    expect(createHarvestRound(8).centres).not.toEqual(s.centres);
    expect(createHarvestRound(2 ** 32 + 7)).toEqual(s);                        // the seed is a u32
  });
});

describe("scoreRelease", () => {
  it("scores chuẩn within 70 ‰ of the centre, được within 170, and says which way a miss went", () => {
    expect(scoreRelease(700, 700)).toEqual({ mark: "chuan", score2: 2 });
    expect(scoreRelease(770, 700)).toEqual({ mark: "chuan", score2: 2 });
    expect(scoreRelease(630, 700)).toEqual({ mark: "chuan", score2: 2 });
    expect(scoreRelease(771, 700)).toEqual({ mark: "duoc", score2: 1 });
    expect(scoreRelease(870, 700)).toEqual({ mark: "duoc", score2: 1 });
    expect(scoreRelease(530, 700)).toEqual({ mark: "duoc", score2: 1 });
    expect(scoreRelease(529, 700)).toEqual({ mark: "sot", score2: 0 });
    expect(scoreRelease(871, 700)).toEqual({ mark: "rung", score2: 0 });
    expect(scoreRelease(1000, 780)).toEqual({ mark: "rung", score2: 0 });
    expect(HARVEST_MARK).toEqual({ chuan: "Chuẩn!", duoc: "Được", sot: "Lệch — sót hạt", rung: "Lệch — rụng hạt" });
  });
});

describe("stepHarvestRound (0061: 60 Hz integer ticks)", () => {
  it("raises the bar from 0 to 1000 ‰ in 72 ticks while held, and auto-releases it at 1000 as rụng hạt", () => {
    let s = stepHarvestRound(createHarvestRound(1), true);
    expect(s).toMatchObject({ charging: true, level: 0, tick: 1 });
    s = hold(s, 36, true);
    expect(s.level).toBe(500);
    s = hold(s, 36, true);
    expect(s).toMatchObject({ bundle: 1, level: 0, charging: false, beat: HARVEST.beatTicks, score2: 0 });
    expect(s.cuts).toEqual([{ level: 1000, centre: s.centres[0], mark: "rung", score2: 0 }]);
    // still held after the beat: nothing happens until the sickle is let go and pressed again
    s = hold(s, 40, true);
    expect(s).toMatchObject({ bundle: 1, charging: false, level: 0, beat: 0 });
    s = stepHarvestRound(stepHarvestRound(s, false), true);
    expect(s.charging).toBe(true);
  });

  it("ignores input for the 21-tick beat after a cut, and starts the next charge once it is over", () => {
    let s = stepHarvestRound(createHarvestRound(2), true);
    s = hold(s, 10, true);
    s = stepHarvestRound(s, false);
    expect(s.cuts).toHaveLength(1);
    expect(s.cuts[0].level).toBe(Math.trunc(10_000 / 72));
    s = hold(s, 20, true);
    expect(s).toMatchObject({ charging: false, level: 0, beat: 1 });
    s = stepHarvestRound(s, true);
    expect(s.beat).toBe(0);
    s = stepHarvestRound(s, true);
    expect(s.charging).toBe(true);
  });

  it("passes a clean round with 16 half points in about 10 s", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = play(seed, (c) => c);
      expect(s.outcome).toBe("pass");
      expect(s.score2).toBe(16);
      expect(s.cuts.map((x) => x.mark)).toEqual(Array(8).fill("chuan"));
      expect(s.tick).toBeGreaterThan(480);
      expect(s.tick).toBeLessThan(720);
    }
  });

  it("needs 8 half points: 7 fails, 8 passes", () => {
    const four = play(5, (c, i) => (i < 4 ? c : 200));
    expect([four.score2, four.outcome]).toEqual([8, "pass"]);
    const seven = play(5, (c, i) => (i < 3 ? c : i === 3 ? c + 120 : 200));
    expect(seven.cuts.map((x) => x.mark)).toEqual(["chuan", "chuan", "chuan", "duoc", "sot", "sot", "sot", "sot"]);
    expect([seven.score2, seven.outcome]).toEqual([7, "fail"]);
    const late = play(6, () => 1000);
    expect(late.cuts.every((x) => x.mark === "rung")).toBe(true);
    expect(late.outcome).toBe("fail");
  });

  it("ends after the last cut's beat, and then stays put; a round still going at 7 200 ticks fails", () => {
    let s = createHarvestRound(9);
    let beforeEnd: HarvestRound | null = null;
    while (!s.outcome) {
      const holding = s.beat > 0 ? false : !(s.charging && s.level >= s.centres[s.bundle]);
      const next = stepHarvestRound(s, holding);
      if (next.outcome && !beforeEnd) beforeEnd = s;
      s = next;
    }
    expect(beforeEnd).toMatchObject({ bundle: 8, outcome: null, beat: 1 });
    expect(stepHarvestRound(s, true)).toBe(s);
    const idle = hold(createHarvestRound(9), 7200, false);
    expect([idle.outcome, idle.tick]).toEqual(["fail", HARVEST.maxTicks]);
  });
});

describe("the harvest's replay (0061)", () => {
  it("replays a played round from its recorded toggles to the same outcome, end tick and half points", () => {
    for (let seed = 1; seed <= 10; seed++) {
      for (const aim of [(c: number) => c, (c: number, i: number) => (i % 2 ? c + 120 : 300)]) {
        const s = play(seed, aim);
        expect(replayHarvest(seed, s.toggles)).toEqual({ outcome: s.outcome, ticks: s.tick, score2: s.score2 });
        expect(harvestInputError(s.toggles, s.tick)).toBeNull();
      }
    }
    expect(replayHarvest(3, [])).toEqual({ outcome: "fail", ticks: 7200, score2: 0 });
  });

  it("records only the hold's flips, each before the tick it is stepped in", () => {
    const rec = new ToggleRecorder();
    [false, true, true, false, false, true].forEach((h, t) => rec.hold(t, h));
    expect(rec.toggles).toEqual([1, 3, 5]);
  });

  it("refuses a list no round makes: its end, its size, its range, its order, its rate", () => {
    expect(togglesError([], 0, 7200, 400, 45)).toBe("ticks");
    expect(togglesError([], 7201, 7200, 400, 45)).toBe("ticks");
    expect(togglesError([], 1.5, 7200, 400, 45)).toBe("ticks");
    expect(harvestInputError(Array.from({ length: 401 }, (_, i) => i * 10), 7200)).toBe("too_many");
    expect(harvestInputError([100], 100)).toBe("range");
    expect(harvestInputError([-1], 100)).toBe("range");
    expect(harvestInputError([5, 5], 100)).toBe("order");
    expect(harvestInputError(Array.from({ length: 46 }, (_, i) => i), 300)).toBe("rate");
    expect(harvestInputError(Array.from({ length: 45 }, (_, i) => i), 300)).toBeNull();
    expect(crabInputError(Array.from({ length: 21 }, (_, i) => i * 2), 300)).toBe("rate");
    expect(crabInputError(Array.from({ length: 61 }, (_, i) => i * 60), 7200)).toBe("too_many");
  });
});

describe("scoreText", () => {
  it("writes a half point with a comma", () => {
    expect([scoreText(3.5), scoreText(4), scoreText(0), scoreText(0.5)]).toEqual(["3,5", "4", "0", "0,5"]);
  });
});

/** Plays a crab game tick by tick, grabbing when `grab(state)` says so; records the grabs in the claws. */
function crab(seed: number, grab: (s: CrabRound) => boolean, start?: Partial<CrabRound>): CrabRound & { grabs: number[] } {
  let s: CrabRound = { ...createCrabRound(seed), ...start };
  const grabs: number[] = [];
  while (!s.outcome) {
    const g = grab(s);
    if (g && s.stage === "claws") grabs.push(s.tick);
    s = stepCrabRound(s, g);
  }
  return { ...s, grabs };
}
/** The claws' state in the tick after this one, when a grab would be judged. */
const nextClosed = (s: CrabRound) => crabClosed(CRAB.periods[s.tries.length], s.phases[s.tries.length], s.t + 1);

describe("CrabRound (v15.3 §7.2, R17; 0062: 60 Hz integer ticks)", () => {
  it("seeds a phase in [0, P) for each of the 3 tries", () => {
    const s = createCrabRound(4);
    expect(s).toMatchObject({ tries: [], hits: 0, stage: "lead", t: 0, tick: 0, outcome: null });
    expect(CRAB.periods).toEqual([72, 57, 45]);
    s.phases.forEach((p, i) => {
      expect(Number.isInteger(p)).toBe(true);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(CRAB.periods[i]);
    });
    expect(createCrabRound(4)).toEqual(s);
    expect(createCrabRound(5).phases).not.toEqual(s.phases);
  });
  it("opens the claws for the first 60 % of each cycle and closes them for the last 40 %", () => {
    expect([0, 43, 44, 71, 72, 116].map((t) => crabClosed(72, 0, t))).toEqual([false, false, true, true, false, true]);
    expect([13, 14, 41, 42].map((t) => crabClosed(72, 30, t))).toEqual([false, true, true, false]);
    expect([34, 35, 56].map((t) => crabClosed(57, 0, t))).toEqual([false, true, true]);
    expect([26, 27].map((t) => crabClosed(45, 0, t))).toEqual([false, true]);
  });
  it("ignores a grab in the 36-tick lead-in and in the 30-tick beat", () => {
    let s = createCrabRound(1);
    for (let i = 0; i < 35; i++) s = stepCrabRound(s, true);
    expect(s).toMatchObject({ stage: "lead", tries: [] });
    s = stepCrabRound(s, true);
    expect(s).toMatchObject({ stage: "claws", t: 0, tries: [] });
    s = stepCrabRound(s, true);
    expect(s.tries).toHaveLength(1);
    expect(s).toMatchObject({ stage: "beat" });
    for (let i = 0; i < 29; i++) s = stepCrabRound(s, true);
    expect(s).toMatchObject({ stage: "beat", tries: [expect.anything()] });
    s = stepCrabRound(s, true);
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
    const at = (t: number) => crab(0, (s) => s.stage === "claws" && s.t + 1 >= t && s.tries.length === 0, { phases: [0, 0, 0] }).tries[0];
    expect([at(43), at(44)]).toEqual(["pinch", "hit"]);
  });
  it("counts 0–3 hits whatever the input, and the replay of its grabs agrees", () => {
    let rng = 7;
    for (let game = 0; game < 200; game++) {
      const s = crab(game, () => {
        rng = (rng * 1103515245 + 12345) % 2147483648;
        return rng % (7 + (game % 5) * 5) === 0;
      });
      expect(s.outcome).toBe("done");
      expect(s.hits).toBe(s.tries.filter((t) => t === "hit").length);
      expect(s.hits).toBeGreaterThanOrEqual(0);
      expect(s.hits).toBeLessThanOrEqual(3);
      expect(replayCrab(game, s.grabs, s.tick)).toEqual({ hits: s.hits, tries: 3, ticks: s.tick });
      expect(crabInputError(s.grabs, s.tick)).toBeNull();
    }
  });
  it("replays a game stopped after a try up to its end tick", () => {
    const s = crab(3, (x) => x.stage === "claws" && nextClosed(x));
    const first = s.grabs[0] + 1;
    expect(replayCrab(3, s.grabs, first)).toEqual({ hits: 1, tries: 1, ticks: first });
  });
  it("takes 201 ticks (3.35 s) at the least and 894 (14.9 s) at the most", () => {
    expect(crab(3, (s) => s.stage === "claws").tick).toBe(3 * (CRAB.leadTicks + 1 + CRAB.beatTicks));
    expect(crab(3, () => false).tick).toBe(894);
  });
  it("stays put once done", () => {
    const done = crab(1, () => false);
    expect(stepCrabRound(done, true)).toBe(done);
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
