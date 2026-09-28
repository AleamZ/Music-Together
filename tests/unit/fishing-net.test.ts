import { describe, expect, it } from "vitest";
import { arrowForKey, MAX_MISTAKES, NET, NETX, roundGrade, SCENE, TickClock } from "@/lib/game/fishing/net";

// The overlay's helpers around the replayed sim (fishing-net-replay.test.ts pins the sim itself).
describe("the net overlay's helpers", () => {
  it("keys map arrows and WASD", () => {
    expect(["ArrowUp", "KeyS", "KeyA", "ArrowRight", "Space"].map(arrowForKey)).toEqual(["up", "down", "left", "right", null]);
    expect(MAX_MISTAKES).toBe(3);
  });

  it("grades a round: clean in the first half of the timer is Perfect, clean is Good, else Miss", () => {
    expect(roundGrade(true, 100, 240)).toBe("perfect");
    expect(roundGrade(true, 120, 240)).toBe("perfect");
    expect(roundGrade(true, 121, 240)).toBe("good");
    expect(roundGrade(false, 10, 240)).toBe("miss");
  });

  it("the tick clock runs at 60 Hz and never ahead of real time (at most 3 ticks per frame)", () => {
    const c = new TickClock(1000);
    expect(c.advance(1000)).toBe(0);
    expect(c.advance(1000 + 1000 / 60)).toBe(1);
    expect(c.advance(1000 + 1000)).toBe(4);                 // a long frame: 3 more, the rest dropped
    let t = 2000;
    for (let i = 0; i < 60; i++) c.advance((t += 1000 / 60));
    expect(c.now).toBe(64);
    expect(c.advance(t - 50)).toBe(64);                      // time never runs back
  });

  it("the scene and the replay agree on the geometry", () => {
    expect(NETX.handsX).toBe(SCENE.hands.x * 1000);
    expect(NETX.handsY).toBe(SCENE.hands.y * 1000);
    expect(NETX.range).toBe(SCENE.range * 1000);
    expect(NETX.fishMinY).toBe(SCENE.top * 1000);
    expect(NETX.fishMaxY).toBe(SCENE.bottom * 1000);
    expect(NETX.aimMaxY).toBe((SCENE.shore - 6) * 1000);
    expect(NETX.landMaxY).toBe((SCENE.shore - 4) * 1000);
    expect(NETX.flightTicks).toBe((NET.flightMs * NETX.hz) / 1000);
    expect(NETX.sinkTicks).toBe((NET.sinkMs * NETX.hz) / 1000);
  });
});
