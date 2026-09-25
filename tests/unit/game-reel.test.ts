import { describe, it, expect } from "vitest";
import {
  createReel, fishFloor, nextRandom, REEL, stepReel, zoneHeight, type ReelParams, type ReelState,
} from "@/lib/game/fishing/reel";

const P = (over: Partial<ReelParams> = {}): ReelParams => ({ zonePct: 25, difficulty: 15, minReelMs: 2600, seed: 7, ...over });
const play = (p: ReelParams, policy: (s: ReelState) => boolean): ReelState => {
  let s = createReel(p);
  for (let i = 0; i < 60 * 70 && !s.outcome; i++) s = stepReel(s, p, 1 / 60, policy(s));
  return s;
};
/** Holds while the zone's middle (plus a little look-ahead) is below the fish. */
const tracker = (p: ReelParams) => (s: ReelState) => s.zone + zoneHeight(p) / 2 + s.zoneV * 0.12 < s.fish;

describe("nextRandom", () => {
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
});

describe("createReel", () => {
  it("starts at 30 % with the zone at the bottom and the fish above it", () => {
    const p = P();
    const s = createReel(p);
    expect(s).toMatchObject({ progress: REEL.start, zone: 0, zoneV: 0, fish: REEL.fishStart, elapsedMs: 0, outcome: null });
    expect(s.target).toBeGreaterThanOrEqual(fishFloor(p));
    expect(createReel(p)).toEqual(s);
  });
  it("keeps the fish above a big zone", () => {
    expect(createReel(P({ zonePct: 60 })).fish).toBe(fishFloor(P({ zonePct: 60 })));
  });
});

describe("stepReel", () => {
  it("lifts the zone while holding and lets it fall back with a bounce", () => {
    const p = P();
    let s = createReel(p);
    for (let i = 0; i < 20; i++) s = stepReel(s, p, 1 / 60, true);
    expect(s.zone).toBeGreaterThan(0);
    expect(s.zoneV).toBeGreaterThan(0);
    for (let i = 0; i < 180; i++) s = stepReel(s, p, 1 / 60, false);
    expect(s.zone).toBe(0);
    expect(s.zoneV).toBeGreaterThanOrEqual(0);
  });
  it("keeps the zone inside the bar and the fish between its floor and the top", () => {
    const p = P({ difficulty: 90, seed: 3 });
    let s = createReel(p);
    for (let i = 0; i < 900 && !s.outcome; i++) {
      s = stepReel(s, p, 1 / 60, i % 50 < 30);
      expect(s.zone).toBeGreaterThanOrEqual(0);
      expect(s.zone).toBeLessThanOrEqual(1 - zoneHeight(p) + 1e-9);
      expect(s.fish).toBeGreaterThanOrEqual(fishFloor(p) - 1e-9);
      expect(s.fish).toBeLessThanOrEqual(1);
    }
  });
  it("fills progress while the fish is in the zone and drains it outside", () => {
    const p = P();
    const inside: ReelState = { ...createReel(p), zone: 0.3, fish: 0.4, target: 0.4 };
    expect(stepReel(inside, p, 0.05, false).progress).toBeCloseTo(0.3 + (0.7 / 2.6) * 0.05, 6);
    const outside: ReelState = { ...createReel(p), zone: 0, fish: 0.9, target: 0.9 };
    expect(stepReel(outside, p, 0.05, false).progress).toBeCloseTo(0.3 - (0.075 + 0.07 * 0.15) * 0.05, 6);
  });
  it("lets a tracking player land easy fish, never faster than minReelMs", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const p = P({ seed });
      const s = play(p, tracker(p));
      expect(s.outcome, `seed ${seed}`).toBe("caught");
      expect(s.elapsedMs).toBeGreaterThanOrEqual(p.minReelMs - 1);
    }
  });
  it("never lands a fish for a player who does nothing", () => {
    for (let seed = 1; seed <= 20; seed++) expect(play(P({ seed, zonePct: 36 }), () => false).outcome).toBe("escaped");
  });
  it("gives up after 60 s and then keeps its outcome", () => {
    const p = P();
    const late: ReelState = { ...createReel(p), elapsedMs: REEL.maxMs - 10, progress: 0.5, zone: 0, fish: 0.9, target: 0.9 };
    const s = stepReel(late, p, 0.05, false);
    expect(s.outcome).toBe("escaped");
    expect(stepReel(s, p, 0.05, true)).toBe(s);
  });
  it("clamps a long frame to 50 ms", () => {
    const p = P();
    expect(stepReel(createReel(p), p, 1, false).elapsedMs).toBeCloseTo(50);
  });
  it("is deterministic for a seed", () => {
    const p = P({ seed: 99, difficulty: 58 });
    expect(play(p, tracker(p))).toEqual(play(p, tracker(p)));
  });
});
