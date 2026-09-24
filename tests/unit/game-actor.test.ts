import { describe, it, expect } from "vitest";
import { applyPathMsg, applyStateMsg, createActor, setKeyboard, setPath, tickActor, walkFrame } from "@/lib/game/actor";
import { mapFromAscii } from "./helpers/ascii-map";

const open = mapFromAscii(Array(10).fill(".........."));
const wall = mapFromAscii(Array(10).fill(".....#...."));

describe("paths", () => {
  it("walks the waypoints and reports arrival once", () => {
    const a = createActor("a", { x: 40, y: 40 });
    setPath(a, [{ x: 60, y: 40 }, { x: 60, y: 60 }]);
    let arrived = false, now = 0;
    for (let i = 0; i < 100 && !arrived; i++) arrived = tickActor(open, a, 0.05, (now += 50), false);
    expect(arrived).toBe(true);
    expect(a.pos).toEqual({ x: 60, y: 60 });
    expect(a.moving).toBe(false);
    expect(a.facing).toBe("down");
    expect(tickActor(open, a, 0.05, now + 50, false)).toBe(false);
  });
  it("keyboard input cancels a path", () => {
    const a = createActor("a", { x: 40, y: 40 });
    setPath(a, [{ x: 70, y: 40 }]);
    setKeyboard(a, { x: -1, y: 0 });
    expect(a.path).toBeNull();
    expect(a.facing).toBe("left");
  });
});

describe("remote players", () => {
  it("extrapolate keyboard movement through the same collision", () => {
    const r = createActor("r", { x: 20, y: 40 });
    applyStateMsg(r, { x: 20, y: 40, facing: "right", moving: true, vx: 1, vy: 0 }, 0);
    tickActor(wall, r, 0.5, 100, true);
    expect(r.pos.x).toBeLessThan(37);
  });
  it("stop after 4 s without messages", () => {
    const r = createActor("r", { x: 20, y: 20 });
    applyStateMsg(r, { x: 20, y: 20, facing: "right", moving: true, vx: 1, vy: 0 }, 0);
    tickActor(open, r, 0.05, 4100, true);
    expect(r.moving).toBe(false);
  });
  it("snap when far, blend when near", () => {
    const far = createActor("f", { x: 20, y: 20 });
    applyStateMsg(far, { x: 75, y: 20, facing: "right", moving: false, vx: 0, vy: 0 }, 0);
    expect(far.display.x).toBe(75);
    const near = createActor("n", { x: 20, y: 20 });
    applyStateMsg(near, { x: 30, y: 20, facing: "right", moving: false, vx: 0, vy: 0 }, 0);
    expect(near.display.x).toBe(20);
    tickActor(open, near, 0.05, 50, true);
    expect(near.display.x).toBeGreaterThan(20);
    expect(near.display.x).toBeLessThan(30);
  });
  it("start walking on a path message", () => {
    const r = createActor("r", { x: 20, y: 20 });
    applyPathMsg(r, { x: 30, y: 20, pts: [{ x: 50, y: 20 }] }, 0);
    expect(r.moving).toBe(true);
    expect(r.path).toEqual([{ x: 50, y: 20 }]);
  });
});

describe("walkFrame", () => {
  it("is 0 when idle and cycles 0-3 at 8 fps while walking", () => {
    const a = createActor("a", { x: 40, y: 40 });
    expect(walkFrame(a)).toBe(0);
    setKeyboard(a, { x: 1, y: 0 });
    tickActor(open, a, 0.13, 130, false);
    expect(walkFrame(a)).toBe(1);
  });
});
