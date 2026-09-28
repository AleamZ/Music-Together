import { describe, it, expect } from "vitest";
import {
  createReel, fishFloor, floorUnits, FX, nextRandom, PFX, rand32, REEL, ReelRecorder, replayReel, stepReel, zoneHeight,
  zoneUnits, type ReelParams, type ReelState,
} from "@/lib/game/fishing/reel";
import cases from "../fixtures/reel-cases.json";

const P = (over: Partial<ReelParams> = {}): ReelParams => ({ zonePct: 25, difficulty: 15, minReelMs: 2600, seed: 7, ...over });
const play = (p: ReelParams, policy: (s: ReelState) => boolean): ReelState => {
  let s = createReel(p);
  while (!s.outcome) s = stepReel(s, p, policy(s));
  return s;
};
/** Holds while the zone's middle (plus a little look-ahead) is below the fish. */
const tracker = (p: ReelParams) => (s: ReelState) => s.zone + zoneUnits(p) / 2 + s.zoneV * 7 < s.fish;

describe("nextRandom / rand32", () => {
  it("is deterministic and stays in [0, 1)", () => {
    let a = 42, b = 42;
    for (let i = 0; i < 100; i++) {
      const [x, na] = nextRandom(a);
      const [y, nb] = nextRandom(b);
      expect(x).toBe(y);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      a = na;
      b = nb;
    }
  });
  it("rand32 is mulberry32 on u32s: the same stream as nextRandom", () => {
    let a = 42, b = 42;
    for (let i = 0; i < 100; i++) {
      const [x, na] = rand32(a);
      const [y, nb] = nextRandom(b);
      expect(x / 4294967296).toBe(y);
      expect(na).toBe(nb >>> 0);
      a = na;
      b = nb;
    }
  });
});

describe("createReel", () => {
  it("starts at 30 % with the zone at the bottom and the fish above it", () => {
    const p = P();
    const s = createReel(p);
    expect(s).toMatchObject({ progress: REEL.start, zone: 0, zoneV: 0, fish: REEL.fishStart, tick: 0, outcome: null });
    expect(s.target).toBeGreaterThanOrEqual(floorUnits(p));
    expect(createReel(p)).toEqual(s);
  });
  it("keeps the fish above a big zone", () => {
    expect(createReel(P({ zonePct: 60 })).fish).toBe(floorUnits(P({ zonePct: 60 })));
    expect(fishFloor(P({ zonePct: 60 }))).toBe(0.5);
    expect(zoneHeight(P())).toBe(0.25);
  });
});

describe("stepReel", () => {
  it("lifts the zone while holding and lets it fall back with a bounce", () => {
    const p = P();
    let s = createReel(p);
    for (let i = 0; i < 20; i++) s = stepReel(s, p, true);
    expect(s.zone).toBeGreaterThan(0);
    expect(s.zoneV).toBeGreaterThan(0);
    for (let i = 0; i < 180; i++) s = stepReel(s, p, false);
    expect(s.zone).toBe(0);
    expect(s.zoneV).toBeGreaterThanOrEqual(0);
  });
  it("keeps every value an integer, the zone inside the bar and the fish between its floor and the top", () => {
    const p = P({ difficulty: 90, seed: 3 });
    let s = createReel(p);
    for (let i = 0; i < 900 && !s.outcome; i++) {
      s = stepReel(s, p, i % 50 < 30);
      for (const v of [s.zone, s.zoneV, s.fish, s.target, s.progress, s.rng]) expect(Number.isInteger(v)).toBe(true);
      expect(s.zone).toBeGreaterThanOrEqual(0);
      expect(s.zone).toBeLessThanOrEqual(FX - zoneUnits(p));
      expect(s.fish).toBeGreaterThanOrEqual(floorUnits(p));
      expect(s.fish).toBeLessThanOrEqual(FX);
    }
  });
  it("fills progress while the fish is in the zone and drains it outside", () => {
    const p = P();
    const inside: ReelState = { ...createReel(p), zone: 300_000, fish: 400_000, target: 400_000 };
    expect(stepReel(inside, p, false).progress / PFX).toBeCloseTo(0.3 + 0.7 / 2.6 / 60, 6);
    const outside: ReelState = { ...createReel(p), zone: 0, fish: 900_000, target: 900_000 };
    expect(stepReel(outside, p, false).progress / PFX).toBeCloseTo(0.3 - (0.075 + 0.07 * 0.15) / 60, 6);
  });
  it("lets a tracking player land easy fish, never faster than minReelMs", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const p = P({ seed });
      const s = play(p, tracker(p));
      expect(s.outcome, `seed ${seed}`).toBe("caught");
      expect((s.tick * 1000) / REEL.hz).toBeGreaterThanOrEqual(p.minReelMs);
    }
  });
  it("never lands a fish for a player who does nothing", () => {
    for (let seed = 1; seed <= 20; seed++) expect(play(P({ seed, zonePct: 36 }), () => false).outcome).toBe("escaped");
  });
  it("gives up after 60 s and then keeps its outcome", () => {
    const p = P();
    const late: ReelState = { ...createReel(p), tick: REEL.maxTicks - 1, progress: PFX / 2, zone: 0, fish: 900_000, target: 900_000 };
    const s = stepReel(late, p, false);
    expect(s.outcome).toBe("escaped");
    expect(stepReel(s, p, true)).toBe(s);
  });
  it("is deterministic for a seed", () => {
    const p = P({ seed: 99, difficulty: 58 });
    expect(play(p, tracker(p))).toEqual(play(p, tracker(p)));
  });
});

describe("replayReel", () => {
  it("replays a recorded reel to the same outcome and tick", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const p = P({ seed, difficulty: 40 });
      let s = createReel(p);
      const rec = new ReelRecorder();
      while (!s.outcome) {
        const h = tracker(p)(s);
        rec.hold(s.tick, h);
        s = stepReel(s, p, h);
      }
      expect(replayReel(p, rec.toggles)).toEqual({ outcome: s.outcome, ticks: s.tick, progress: s.progress });
    }
  });
  it("records only the flips", () => {
    const rec = new ReelRecorder();
    [false, true, true, false, false, true].forEach((h, i) => rec.hold(i, h));
    expect(rec.toggles).toEqual([1, 3, 5]);
  });
  // the same file is replayed by public._reel_replay in tests/sql/reel-verify-smoke.sql
  it.each(cases.map((c) => [c.name, c] as const))("matches the shared fixture %s", (_n, c) => {
    expect(replayReel(c.params, c.toggles)).toEqual(c.expected);
  });
});
