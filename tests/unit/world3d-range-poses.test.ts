import { describe, expect, it } from "vitest";
import { CAST_S, JOINT_LIMITS, pedalAngle, poseAt, previewTime } from "@/lib/game/diorama/character/pose";
import { inRange, nextScale, rectDist, RENDER_SCALE, rimDist, THIRD_PERSON_RANGE, viewRange } from "@/lib/game/diorama/world/view-range";

describe("world3d view range", () => {
  it("bounds third person only", () => {
    expect(viewRange(true, "high")).toBe(THIRD_PERSON_RANGE.high);
    expect(viewRange(true, "low")).toBeLessThan(THIRD_PERSON_RANGE.high);
    expect(viewRange(false, "high")).toBe(Infinity);
  });
  it("measures distances to rectangles", () => {
    const r = { x0: 0, z0: 0, x1: 10, z1: 10 };
    expect(rectDist(5, 5, r)).toBe(0);
    expect(rectDist(13, 14, r)).toBe(5);
    expect(rimDist(2, 5, r)).toBe(2);
    expect(rimDist(-1, 5, r)).toBe(0);
    expect(inRange(150, 20, 140)).toBe(true);
    expect(inRange(170, 20, 140)).toBe(false);
  });
  it("steps the render scale with the frame rate, within its limits", () => {
    expect(nextScale(1, 30)).toBe(0.9);
    expect(nextScale(RENDER_SCALE.min, 20)).toBe(RENDER_SCALE.min);
    expect(nextScale(0.9, 60)).toBe(0.95);
    expect(nextScale(1, 60)).toBe(1);
    expect(nextScale(0.8, 50)).toBe(0.8);
    expect(nextScale(0.8, 0)).toBe(0.8);
  });
});

describe("chibi poses: fishing, pedalling, the warm-up", () => {
  it("the cast throws once, then holds the rod still-ish", () => {
    const wound = poseAt("cast", 0.4), held = poseAt("cast", CAST_S + 2), later = poseAt("cast", CAST_S + 2.3);
    expect(wound.armR.x).toBeLessThan(-1.5);                          // the rod back over the shoulder
    expect(held.armR.x).toBeGreaterThan(0.3);                         // then held out in front
    expect(Math.abs(held.armR.x - later.armR.x)).toBeLessThan(0.1);   // no more throwing
    expect(held.rod).toBe(1);
    expect(poseAt("bite", 1).rod).toBe(1);
    expect(poseAt("bite", 1).lean).toBeLessThan(0);                   // leaning back on the fish
  });
  it("pedals round: the legs are half a turn apart and follow the crank", () => {
    const a = poseAt("pedal", 0), b = poseAt("pedal", 0.5 / 1.1);    // half a crank turn later
    expect(a.legL.x).toBeCloseTo(b.legR.x, 5);
    expect(a.legL.x).toBeGreaterThan(a.legR.x);                       // the left foot at the top at angle 0
    expect(pedalAngle(1)).toBeCloseTo(Math.PI * 2 * 1.1, 5);
  });
  it("the warm-up bends sideways, then squats", () => {
    const bend = poseAt("stretch", 0.5), squat = poseAt("stretch", 2.5);
    expect(bend.armL.z).toBeGreaterThan(2);
    expect(Math.abs(bend.roll)).toBeGreaterThan(0.2);
    expect(squat.drop).toBeGreaterThan(0.2);
    expect(squat.kneeL).toBeGreaterThan(1.2);
  });
  it("keeps the joints within their limits and loops one-shots in previews", () => {
    for (const act of ["cast", "bite", "pedal", "stretch"] as const) for (let t = 0; t < 5; t += 0.13) {
      const p = poseAt(act, t);
      for (const k of [p.kneeL, p.kneeR]) { expect(k).toBeGreaterThanOrEqual(JOINT_LIMITS.knee[0]); expect(k).toBeLessThanOrEqual(JOINT_LIMITS.knee[1]); }
      for (const k of [p.ankleL, p.ankleR]) { expect(k).toBeGreaterThanOrEqual(JOINT_LIMITS.ankle[0]); expect(k).toBeLessThanOrEqual(JOINT_LIMITS.ankle[1]); }
    }
    expect(previewTime("cast", 4)).toBe(1);
    expect(previewTime("walk", 4)).toBe(4);
  });
});
