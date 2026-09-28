import { describe, it, expect } from "vitest";
import {
  HUNGER_PER_S, THIRST_PER_S, TICK_CAP_S, STARVE_FAINT_S, STARVING_SPEED,
  drainVitals, speedFactor, isStarving, lowWarn, type Vitals,
} from "@/lib/game/vitals";

const full: Vitals = { hunger: 100, thirst: 100, starveS: 0, faintedUntil: null };

describe("vitals drain", () => {
  it("drains both at their own rates", () => {
    const v = drainVitals(full, 100);
    expect(v.hunger).toBeCloseTo(100 - 100 * HUNGER_PER_S);
    expect(v.thirst).toBeCloseTo(100 - 100 * THIRST_PER_S);
    expect(v.starveS).toBe(0);
  });
  it("credits at most TICK_CAP_S per call (0057: 30 min; a longer gap is a logout)", () => {
    expect(TICK_CAP_S).toBe(1800);
    expect(drainVitals(full, 99999)).toEqual(drainVitals(full, TICK_CAP_S));
    expect(drainVitals(full, -5)).toEqual(full);
  });
  it("clamps at 0 and counts only the seconds spent at 0", () => {
    const nearlyDry: Vitals = { hunger: 50, thirst: 30 * THIRST_PER_S, starveS: 0, faintedUntil: null };
    const v = drainVitals(nearlyDry, 100);
    expect(v.thirst).toBe(0);
    expect(v.starveS).toBeCloseTo(70);
  });
  it("keeps adding starve seconds while at 0, resets once both are above 0", () => {
    const dry: Vitals = { hunger: 0, thirst: 40, starveS: 500, faintedUntil: null };
    expect(drainVitals(dry, 60).starveS).toBeCloseTo(560);
    expect(drainVitals({ ...dry, hunger: 10 }, 60).starveS).toBe(0);
  });
  it("does not drain while fainted", () => {
    const f: Vitals = { hunger: 0, thirst: 0, starveS: 0, faintedUntil: 123 };
    expect(drainVitals(f, 60)).toEqual(f);
  });
  it("STARVE_FAINT_S is 10 minutes", () => expect(STARVE_FAINT_S).toBe(600));
});

describe("vitals effects", () => {
  it("slows only at 0", () => {
    expect(speedFactor({ hunger: 1, thirst: 1 })).toBe(1);
    expect(speedFactor({ hunger: 0, thirst: 50 })).toBe(STARVING_SPEED);
    expect(speedFactor({ hunger: 50, thirst: 0 })).toBe(STARVING_SPEED);
    expect(isStarving({ hunger: 0, thirst: 50 })).toBe(true);
    expect(isStarving({ hunger: 0.1, thirst: 0.1 })).toBe(false);
  });
  it("warns below 25", () => {
    expect(lowWarn({ hunger: 24.9, thirst: 25 })).toEqual({ hunger: true, thirst: false });
  });
});
