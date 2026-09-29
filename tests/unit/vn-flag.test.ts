import { describe, expect, it } from "vitest";
import { flagPixels, STAR_INNER_K, VN_RATIO, VN_RED, VN_YELLOW, vnStar } from "@/lib/game/diorama/world/vnflag";

describe("the national flag (official spec)", () => {
  it("is 2 : 3, red with a yellow star", () => {
    expect(VN_RATIO).toBeCloseTo(2 / 3, 12);
    expect(VN_RED).toBe(0xda251d);
    expect(VN_YELLOW).toBe(0xffff00);
    const p = flagPixels(300);
    expect(p.h / p.w).toBeCloseTo(2 / 3, 2);
    const at = (x: number, y: number) => { const i = (y * p.w + x) * 4; return (p.rgba[i] << 16) | (p.rgba[i + 1] << 8) | p.rgba[i + 2]; };
    expect(at(5, 5)).toBe(VN_RED);                                          // the field
    expect(at(150, 100)).toBe(VN_YELLOW);                                   // the star's centre = the flag's centre
    expect(at(150, 100 - 55)).toBe(VN_YELLOW);                              // the top point, straight up
    expect(at(150, 100 + 55)).toBe(VN_RED);                                 // between the two bottom points
  });

  it("the star: 10 vertices, centred, one point up, R = length / 5, r = R × 0.381966", () => {
    const L = 3, s = vnStar(L, 1.5, 1);
    expect(s).toHaveLength(10);
    const R = L / 5;
    s.forEach((v, i) => expect(Math.hypot(v.x - 1.5, v.y - 1)).toBeCloseTo(i % 2 ? R * STAR_INNER_K : R, 12));
    expect(s[0].x).toBeCloseTo(1.5, 12);
    expect(s[0].y).toBeCloseTo(1 + R, 12);
    const cx = s.reduce((a, v) => a + v.x, 0) / 10, cy = s.reduce((a, v) => a + v.y, 0) / 10;
    expect(cx).toBeCloseTo(1.5, 12);
    expect(cy).toBeCloseTo(1, 12);
    expect(STAR_INNER_K).toBeCloseTo((3 - Math.sqrt(5)) / 2, 5);
  });
});
