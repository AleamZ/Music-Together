import { describe, it, expect } from "vitest";
import { canHook, castPhase, msToNextPhase, reelParamsFor, type CastInfo } from "@/lib/game/fishing/cast";
import { BOBBER_REACH, bobberPoint, handPoint, rodTip } from "@/lib/game/fishing/geometry";

const INFO: CastInfo = { castId: "c", biteMs: 4000, windowMs: 1500, difficulty: 38, minReelMs: 3520, zonePct: 30, rarity: null };

describe("cast timeline", () => {
  it("waits, bites, then misses", () => {
    expect(castPhase(INFO, 0)).toBe("waiting");
    expect(castPhase(INFO, 3999)).toBe("waiting");
    expect(castPhase(INFO, 4000)).toBe("bite");
    expect(castPhase(INFO, 5499)).toBe("bite");
    expect(castPhase(INFO, 5500)).toBe("missed");
  });
  it("only hooks during the bite", () => {
    expect(canHook(INFO, 3000)).toBe(false);
    expect(canHook(INFO, 4500)).toBe(true);
    expect(canHook(INFO, 6000)).toBe(false);
  });
  it("tells how long until the next phase", () => {
    expect(msToNextPhase(INFO, 1000)).toBe(3000);
    expect(msToNextPhase(INFO, 4200)).toBe(1300);
    expect(msToNextPhase(INFO, 9000)).toBeNull();
  });
  it("builds the reel parameters from the cast", () => {
    expect(reelParamsFor(INFO, 5)).toEqual({ zonePct: 30, difficulty: 38, minReelMs: 3520, seed: 5 });
  });
});

describe("rod geometry", () => {
  const feet = { x: 300, y: 204 };
  it("puts the bobber in front of the feet, clear of the head when facing up", () => {
    expect(bobberPoint(feet, "up")).toEqual({ x: 300, y: 204 - BOBBER_REACH.up });
    expect(bobberPoint(feet, "up").y).toBeLessThan(feet.y - 46);
    expect(bobberPoint(feet, "left")).toEqual({ x: 264, y: 204 });
    expect(bobberPoint(feet, "right")).toEqual({ x: 336, y: 204 });
    expect(bobberPoint(feet, "down")).toEqual({ x: 300, y: 234 });
  });
  it("swings the rod tip from over the shoulder to out front", () => {
    const h = handPoint(feet, "left");
    expect(rodTip(feet, "left", 1, 0)).toEqual({ x: h.x - 12, y: h.y - 10 });
    expect(rodTip(feet, "left", 1, 4)).toEqual({ x: h.x - 12, y: h.y - 6 });
    expect(rodTip(feet, "left", 0, 0)).toEqual({ x: h.x + 6, y: h.y - 13 });
    expect(rodTip(feet, "left", 5, 0)).toEqual(rodTip(feet, "left", 1, 0));
  });
});
