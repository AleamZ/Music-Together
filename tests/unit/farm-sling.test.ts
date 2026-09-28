import { describe, it, expect } from "vitest";
import { nextRandom } from "@/lib/game/fishing/reel";
import {
  bandMark, createSling, ratAt, SLING, SLING_MISS, slingAnswered, slingInputError, slingMark, slingPower, slingSent, stepSling,
  type SlingInput, type SlingState,
} from "@/lib/game/farm/sling";

const IDLE: SlingInput = { holding: false, aimTo: null, left: false, right: false };
const HOLD: SlingInput = { ...IDLE, holding: true };

/** Steps `n` ticks with one input. */
function run(s: SlingState, n: number, input: SlingInput = IDLE): SlingState {
  for (let t = 0; t < n; t++) s = stepSling(s, input);
  return s;
}

/** A game past its 132-tick (2.2 s) reload, ready to draw. */
const ready = (seed = 1) => run(createSling(seed), SLING.reloadTicks);

/** The rat at x px, standing still for a long while, or running right at 1 000 mpx a tick (60 px/s). */
const still = (s: SlingState, x: number): SlingState => ({ ...s, rat: { ...s.rat, xm: x * 1000, x, moving: false, seg: 100_000 } });
const running = (s: SlingState, x: number): SlingState =>
  ({ ...s, rat: { ...s.rat, xm: x * 1000, x, dir: 1, moving: true, speed: 1000, seg: 100_000 } });

/** A pellet let go after `held` ticks of draw towards `aimM` (mpx), just leaving the sling. */
const flying = (held: number, aimM: number): SlingState => {
  const s = ready();
  const shot = { press: s.tick - held, release: s.tick, aim: aimM };
  return { ...s, stage: "flight", stageTicks: 0, stageMs: 0, powerM: slingPower(held), power: slingPower(held) / 1000, shot, shotX: aimM / 1000 };
};

/** Draws for `held` ticks at the still rat's x, lets go, and waits out the flight. */
function release(held: number): SlingState {
  const at = { ...HOLD, aimTo: 160 };
  let s = stepSling(still(ready(), 160), at);
  s = run(s, held - 1, at);
  s = stepSling(s, { ...at, holding: false });
  return run(s, SLING.flightTicks, { ...at, holding: false });
}

describe("SlingGame (0063: 60 Hz integer ticks, milli-px)", () => {
  it("reloads 132 ticks after the start answer, then is ready", () => {
    let s = createSling(5);
    expect(s).toMatchObject({ seed: 5, shots: 0, tick: 0, stage: "reload", powerM: 0, mark: null, shotX: null, shot: null, aimX: 160, sinceAnswer: 0 });
    expect(s.rat).toMatchObject({ xm: 160_000, x: 160, moving: true });
    s = run(s, SLING.reloadTicks - 1, HOLD);
    expect(s.stage).toBe("reload");
    s = stepSling(s, IDLE);
    expect(s).toMatchObject({ stage: "ready", stageTicks: 0, sinceAnswer: SLING.reloadTicks });
  });

  it("draws 0 → 1000 ‰ in 60 ticks while held; a full draw lets go by itself and flies over", () => {
    let s = stepSling(ready(), HOLD);
    expect(s).toMatchObject({ stage: "draw", powerM: 0, pressTick: s.tick });
    const press = s.tick;
    s = run(s, 30, HOLD);
    expect([s.powerM, s.power]).toEqual([500, 0.5]);
    s = run(s, 29, HOLD);
    expect(s.stage).toBe("draw");
    s = stepSling(s, HOLD);
    expect(s).toMatchObject({ stage: "flight", powerM: 1000, power: 1, armed: false, shot: { press, release: press + 60 } });
    s = run(s, SLING.flightTicks - 1, HOLD);
    expect(s).toMatchObject({ stage: "flight", mark: null });
    s = stepSling(s, HOLD);
    expect(s).toMatchObject({ stage: "send", mark: "over", lastLand: press + 60 + SLING.flightTicks });
    // still held since the auto-release: no new draw until the band is let go
    s = run(slingAnswered(slingSent(s)), SLING.reloadTicks + 6, HOLD);
    expect(s.stage).toBe("ready");
    s = stepSling(stepSling(s, IDLE), HOLD);
    expect(s.stage).toBe("draw");
  });

  it("has the band edges 600 and 850 ‰", () => {
    expect([599, 600, 850, 851, 1000].map(bandMark)).toEqual(["short", "in", "in", "over", "over"]);
    expect([slingPower(35), slingPower(36), slingPower(51), slingPower(52), slingPower(90)]).toEqual([583, 600, 850, 866, 1000]);
    expect(release(35)).toMatchObject({ stage: "send", powerM: 583, mark: "short" });
    expect(release(36)).toMatchObject({ stage: "send", powerM: 600, mark: "hit" });
    expect(release(51)).toMatchObject({ stage: "send", powerM: 850, mark: "hit" });
    expect(release(52)).toMatchObject({ stage: "send", powerM: 866, mark: "over" });
    expect(SLING_MISS).toEqual({ short: "Hụt — đạn rơi trước.", over: "Hụt — căng quá, đạn bay qua.", wide: "Hụt — lệch rồi." });
  });

  it("hits when the rat is within ±9 000 mpx of the aim when the pellet lands, 18 ticks after the release", () => {
    const land = (s: SlingState, input: SlingInput = IDLE) => run(s, SLING.flightTicks, input).mark;
    expect(land(still(flying(42, 109_000), 100))).toBe("hit");
    expect(land(still(flying(42, 91_000), 100))).toBe("hit");
    expect(land(still(flying(42, 109_001), 100))).toBe("wide");
    expect(land(still(flying(42, 90_999), 100))).toBe("wide");
    // a running rat is judged where it is at the landing, 18 000 mpx on; moving the aim in flight changes nothing
    expect(land(running(flying(42, 100_000), 100))).toBe("wide");
    expect(land(running(flying(42, 118_000), 100))).toBe("hit");
    expect(land(running(flying(42, 118_000), 100), { ...IDLE, aimTo: 20 })).toBe("hit");
    expect(land(still(flying(35, 100_000), 100))).toBe("short");
    expect(land(still(flying(52, 100_000), 100))).toBe("over");
  });

  it("moves the aim with the pointer, or ←/→ at 3 px a tick (180 px/s), inside the lane", () => {
    let s = stepSling(createSling(3), { ...IDLE, aimTo: 40 });
    expect(s.aimX).toBe(40);
    s = run(s, 6, { ...IDLE, right: true });
    expect(s.aimX).toBe(58);
    s = run(s, 6, { ...IDLE, left: true, right: true });
    expect(s.aimX).toBe(58);
    s = run(s, 60, { ...IDLE, left: true });
    expect(s.aimX).toBe(SLING.laneMin);
    expect(stepSling(s, { ...IDLE, aimTo: 999 }).aimX).toBe(SLING.laneMax);
  });

  it("runs the rat 30–72 ticks at 1 000–1 833 mpx a tick with stops of 12–36, in the lane, on one path for a seed", () => {
    const bad: string[] = [];
    for (const seed of [1, 2, 3, 99, 12345]) {
      let s = createSling(seed), since = 0, turns = 0;
      for (let f = 0; f < 3600; f++) {
        const prev = s.rat;
        s = stepSling(s, IDLE);
        since++;
        const r = s.rat;
        if (!Number.isInteger(r.xm) || r.xm < SLING.laneMinM || r.xm > SLING.laneMaxM) bad.push(`${seed}/${f}: xm ${r.xm}`);
        if (r.moving && (r.speed < SLING.speedMin || r.speed >= SLING.speedMin + SLING.speedSpan)) bad.push(`${seed}/${f}: speed ${r.speed}`);
        if (r.dir !== prev.dir) turns++;
        if (r.moving !== prev.moving) {
          const [lo, hi] = prev.moving ? [SLING.runMin, SLING.runMin + SLING.runSpan - 1] : [SLING.stopMin, SLING.stopMin + SLING.stopSpan - 1];
          if (f > 0 && (since < lo || since > hi)) bad.push(`${seed}/${f}: ${prev.moving ? "run" : "stop"} of ${since} ticks`);
          since = 0;
        }
      }
      if (turns === 0) bad.push(`${seed}: never turned`);
      expect(s.rat).toEqual(ratAt(seed, 3600));                                  // the path the server replays
    }
    expect(bad).toEqual([]);
    const play = (seed: number) => run(createSling(seed), 480, { ...IDLE, aimTo: 50 });
    expect(play(11)).toEqual(play(11));
    expect(play(11).rat).not.toEqual(play(12).rat);
  });

  it("counts only the shots sent; the rat runs on through the answer", () => {
    const sent = release(42);
    expect(sent.stage).toBe("send");
    expect(slingSent(sent).stage).toBe("wait");
    expect(slingSent(ready()).stage).toBe("ready");
    const next = slingAnswered(slingSent(sent));
    expect(next).toMatchObject({ shots: 1, stage: "reload", stageTicks: 0, powerM: 0, mark: null, shotX: null, shot: null, sinceAnswer: 0 });
    expect([next.rat, next.tick, next.lastLand]).toEqual([sent.rat, sent.tick, sent.lastLand]);
  });

  it("drops a shot ready 3 300 ticks (55 s) or more after the last answer for a new aim", () => {
    const shootAt = (idle: number) => {
      let s = run(ready(4), idle);
      s = run(stepSling(s, HOLD), 41, HOLD);
      s = stepSling(s, IDLE);
      return run(s, SLING.flightTicks);
    };
    expect(shootAt(3106)).toMatchObject({ stage: "send", sinceAnswer: 3299 });
    const late = shootAt(3107);
    expect(late).toMatchObject({ stage: "reaim", mark: null, shot: null, sinceAnswer: 3300 });
    const again = slingAnswered(slingSent(late));
    expect(again).toMatchObject({ shots: 0, stage: "reload", sinceAnswer: 0 });
  });

  it("refuses a shot no sling makes", () => {
    expect(slingInputError({ press: 10, release: 70, aim: 16_000 }, 0)).toBeNull();
    expect(slingInputError({ press: 10, release: 71, aim: 16_000 }, 0)).toBe("draw");
    expect(slingInputError({ press: 10, release: 10, aim: 16_000 }, 0)).toBe("draw");
    expect(slingInputError({ press: 10, release: 20, aim: 15_999 }, 0)).toBe("aim");
    expect(slingInputError({ press: 10, release: 20, aim: 304_001 }, 0)).toBe("aim");
    expect(slingInputError({ press: 100, release: 120, aim: 16_000 }, 100)).toBe("order");
    expect(slingInputError({ press: 0, release: 20, aim: 16_000 }, 0)).toBe("order");
    expect(slingInputError({ press: 1.5, release: 20, aim: 16_000 }, 0)).toBe("shape");
  });

  it("sends no result before 152 ticks and no hit before 187 after an answer, and every shot replays, over 300 random games", () => {
    let hits = 0, misses = 0;
    for (let seed = 1; seed <= 300; seed++) {
      let rng = seed * 7 + 3;
      const u = () => {
        const [v, n] = nextRandom(rng);
        rng = n;
        return v;
      };
      let s = createSling(seed), target = u() * 1100, last = 0;
      for (let f = 0; f < 1500; f++) {
        s = stepSling(s, {
          holding: s.stage === "draw" ? s.powerM < target : u() < 0.5,
          aimTo: u() < 0.8 ? s.rat.x + (u() - 0.5) * 24 : null,
          left: u() < 0.1,
          right: u() < 0.1,
        });
        if (s.stage === "send") {
          expect(s.sinceAnswer).toBeGreaterThanOrEqual(152);
          if (s.mark === "hit") {
            expect(s.sinceAnswer).toBeGreaterThanOrEqual(187);
            hits++;
          } else misses++;
          expect(slingInputError(s.shot!, last)).toBeNull();
          expect(slingMark(seed, s.shot!)).toBe(s.mark);
          last = s.lastLand;
          s = slingAnswered(slingSent(s));
          target = u() * 1100;
        }
      }
    }
    expect(hits).toBeGreaterThan(30);
    expect(misses).toBeGreaterThan(30);
  }, 60_000);
});
