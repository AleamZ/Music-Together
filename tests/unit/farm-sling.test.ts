import { describe, it, expect } from "vitest";
import { nextRandom } from "@/lib/game/fishing/reel";
import {
  bandMark, createSling, SLING, SLING_MISS, slingAnswered, slingSent, stepSling, type SlingInput, type SlingState,
} from "@/lib/game/farm/sling";

const IDLE: SlingInput = { holding: false, aimTo: null, left: false, right: false };
const HOLD: SlingInput = { ...IDLE, holding: true };

/** Steps `ms` in 10 ms frames with one input. */
function run(s: SlingState, ms: number, input: SlingInput = IDLE): SlingState {
  for (let t = 0; t < ms; t += 10) s = stepSling(s, 0.01, input);
  return s;
}

/** A game past its 2.2 s reload, ready to draw. */
const ready = (seed = 1) => run(createSling(seed), SLING.reloadMs);

/** The rat at x, standing still for a minute, or running right at 100 px/s. */
const still = (s: SlingState, x: number): SlingState => ({ ...s, rat: { ...s.rat, x, moving: false, segMs: 60_000 } });
const running = (s: SlingState, x: number): SlingState =>
  ({ ...s, rat: { ...s.rat, x, dir: 1, moving: true, speed: 100, segMs: 60_000 } });

/** A pellet let go at `power` towards `shotX`, just leaving the sling. */
const flying = (power: number, shotX: number): SlingState =>
  ({ ...ready(), stage: "flight", stageMs: 0, power, shotX, aimX: shotX });

/** Draws for `ms` at the still rat's x, lets go, and waits out the flight. */
function release(ms: number): SlingState {
  const at = { ...HOLD, aimTo: 160 };
  let s = stepSling(still(ready(), 160), 0.01, at);
  s = run(s, ms, at);
  s = stepSling(s, 0, { ...at, holding: false });
  return run(s, SLING.flightMs, { ...at, holding: false });
}

describe("SlingGame", () => {
  it("reloads 2.2 s after the start answer, then is ready", () => {
    let s = createSling(5);
    expect(s).toMatchObject({ seed: 5, shots: 0, stage: "reload", power: 0, mark: null, shotX: null, aimX: 160, sinceAnswerMs: 0 });
    expect(s.rat).toMatchObject({ x: 160, moving: true });
    s = run(s, SLING.reloadMs - 10, HOLD);
    expect(s.stage).toBe("reload");
    s = stepSling(s, 0.01, IDLE);
    expect(s).toMatchObject({ stage: "ready", stageMs: 0 });
    expect(stepSling(s, 1, IDLE).sinceAnswerMs).toBe(SLING.reloadMs + 50);
    expect(stepSling(s, -1, IDLE).sinceAnswerMs).toBe(SLING.reloadMs);
  });

  it("draws 0 → 1 in 1 s while held; a full draw lets go by itself and flies over", () => {
    let s = stepSling(ready(), 0.01, HOLD);
    expect(s).toMatchObject({ stage: "draw", power: 0 });
    s = run(s, 500, HOLD);
    expect(s.power).toBe(0.5);
    s = run(s, 490, HOLD);
    expect(s.stage).toBe("draw");
    s = stepSling(s, 0.01, HOLD);
    expect(s).toMatchObject({ stage: "flight", power: 1, armed: false });
    s = run(s, SLING.flightMs - 10, HOLD);
    expect(s).toMatchObject({ stage: "flight", mark: null });
    s = stepSling(s, 0.01, HOLD);
    expect(s).toMatchObject({ stage: "send", mark: "over" });
    // still held since the auto-release: no new draw until the band is let go
    s = run(slingAnswered(slingSent(s)), SLING.reloadMs + 100, HOLD);
    expect(s.stage).toBe("ready");
    s = stepSling(stepSling(s, 0.01, IDLE), 0.01, HOLD);
    expect(s.stage).toBe("draw");
  });

  it("has the band edges 0.60 and 0.85", () => {
    expect(bandMark(0.5999)).toBe("short");
    expect(bandMark(0.6)).toBe("in");
    expect(bandMark(0.85)).toBe("in");
    expect(bandMark(0.8501)).toBe("over");
    expect(bandMark(1)).toBe("over");
    expect(release(590)).toMatchObject({ stage: "send", power: 0.59, mark: "short" });
    expect(release(600)).toMatchObject({ stage: "send", power: 0.6, mark: "hit" });
    expect(release(850)).toMatchObject({ stage: "send", power: 0.85, mark: "hit" });
    expect(release(860)).toMatchObject({ stage: "send", power: 0.86, mark: "over" });
    expect(SLING_MISS).toEqual({ short: "Hụt — đạn rơi trước.", over: "Hụt — căng quá, đạn bay qua.", wide: "Hụt — lệch rồi." });
  });

  it("hits when the rat is within ±9 px of the shot when the pellet lands, 0.3 s after the release", () => {
    const land = (s: SlingState, input: SlingInput = IDLE) => run(s, SLING.flightMs, input).mark;
    expect(land(still(flying(0.7, 109), 100))).toBe("hit");
    expect(land(still(flying(0.7, 91), 100))).toBe("hit");
    expect(land(still(flying(0.7, 109.5), 100))).toBe("wide");
    expect(land(still(flying(0.7, 90.5), 100))).toBe("wide");
    // a running rat is judged where it is at the landing, 30 px on; moving the aim in flight changes nothing
    expect(land(running(flying(0.7, 100), 100))).toBe("wide");
    expect(land(running(flying(0.7, 130), 100))).toBe("hit");
    expect(land(running(flying(0.7, 130), 100), { ...IDLE, aimTo: 20 })).toBe("hit");
    expect(land(still(flying(0.59, 100), 100))).toBe("short");
    expect(land(still(flying(0.86, 100), 100))).toBe("over");
  });

  it("moves the aim with the pointer, or ←/→ at 180 px/s, inside the lane", () => {
    let s = stepSling(createSling(3), 0.01, { ...IDLE, aimTo: 40 });
    expect(s.aimX).toBe(40);
    s = run(s, 100, { ...IDLE, right: true });
    expect(s.aimX).toBeCloseTo(58, 9);
    s = run(s, 100, { ...IDLE, left: true, right: true });
    expect(s.aimX).toBeCloseTo(58, 9);
    s = run(s, 1000, { ...IDLE, left: true });
    expect(s.aimX).toBe(SLING.laneMin);
    expect(stepSling(s, 0.01, { ...IDLE, aimTo: 999 }).aimX).toBe(SLING.laneMax);
  });

  it("runs the rat 0.5–1.2 s at 60–110 px/s with stops of 0.2–0.6 s, in the lane, the same for a seed", () => {
    const bad: string[] = [];
    for (const seed of [1, 2, 3, 99, 12345]) {
      let s = createSling(seed), since = 0, turns = 0;
      for (let f = 0; f < 6000; f++) {
        const prev = s.rat;
        s = stepSling(s, 0.01, IDLE);
        since += 10;
        const r = s.rat;
        if (r.x < SLING.laneMin || r.x > SLING.laneMax) bad.push(`${seed}/${f}: x ${r.x}`);
        if (r.moving && (r.speed < SLING.speedMin || r.speed > SLING.speedMax)) bad.push(`${seed}/${f}: speed ${r.speed}`);
        if (r.dir !== prev.dir) turns++;
        if (r.moving !== prev.moving) {
          // a segment is seen to end within the 10 ms frame it ends in
          const [lo, hi] = prev.moving ? [SLING.runMinMs, SLING.runMaxMs] : [SLING.stopMinMs, SLING.stopMaxMs];
          if (since < lo - 10 || since > hi + 10) bad.push(`${seed}/${f}: ${prev.moving ? "run" : "stop"} of ${since} ms`);
          since = 0;
        }
      }
      if (turns === 0) bad.push(`${seed}: never turned`);
    }
    expect(bad).toEqual([]);
    const play = (seed: number) => run(createSling(seed), 8000, { ...IDLE, aimTo: 50 });
    expect(play(11)).toEqual(play(11));
    expect(play(11).rat).not.toEqual(play(12).rat);
  }, 30_000);

  it("reseeds each shot's rat with seed + 7919 · shot, and counts only the shots sent", () => {
    const sent = release(700);
    expect(sent.stage).toBe("send");
    expect(slingSent(sent).stage).toBe("wait");
    expect(slingSent(ready()).stage).toBe("ready");
    const next = slingAnswered(slingSent(sent));
    expect(next).toMatchObject({ shots: 1, stage: "reload", stageMs: 0, power: 0, mark: null, shotX: null, sinceAnswerMs: 0 });
    expect(next.rat.rng).toBe((1 + 7919) | 0);
    expect(slingAnswered(slingSent({ ...next, stage: "send", mark: "wide" })).rat.rng).toBe((1 + 2 * 7919) | 0);
  });

  it("drops a shot ready 55 s or more after the last answer for a new aim", () => {
    const shootAt = (idleMs: number) => {
      let s = run(ready(4), idleMs);
      s = run(stepSling(s, 0.01, HOLD), 700, HOLD);
      s = stepSling(s, 0, IDLE);
      return run(s, SLING.flightMs);
    };
    expect(shootAt(51_780)).toMatchObject({ stage: "send", sinceAnswerMs: 54_990 });
    const late = shootAt(51_790);
    expect(late).toMatchObject({ stage: "reaim", mark: null, sinceAnswerMs: 55_000 });
    const again = slingAnswered(slingSent(late));
    expect(again).toMatchObject({ shots: 0, stage: "reload", sinceAnswerMs: 0 });
  });

  it("sends no result before T + 2.5 s and no hit before T + 3.1 s, over 1 000 random inputs", () => {
    let hits = 0, misses = 0;
    for (let seed = 1; seed <= 1000; seed++) {
      let rng = seed * 7 + 3;
      const u = () => {
        const [v, n] = nextRandom(rng);
        rng = n;
        return v;
      };
      let s = createSling(seed), since = 0, target = u() * 1.1;
      for (let f = 0; f < 800; f++) {
        const dt = u() * 0.06;
        s = stepSling(s, dt, {
          holding: s.stage === "draw" ? s.power < target : u() < 0.5,
          aimTo: u() < 0.8 ? s.rat.x + (u() - 0.5) * 24 : null,
          left: u() < 0.1,
          right: u() < 0.1,
        });
        since += Math.min(0.05, dt) * 1000;
        if (s.stage === "send") {
          expect(since).toBeGreaterThanOrEqual(2500);
          if (s.mark === "hit") {
            expect(since).toBeGreaterThanOrEqual(3100);
            hits++;
          } else misses++;
          s = slingAnswered(slingSent(s));
          since = 0;
          target = u() * 1.1;
        }
      }
    }
    expect(hits).toBeGreaterThan(100);
    expect(misses).toBeGreaterThan(100);
  }, 60_000);
});
