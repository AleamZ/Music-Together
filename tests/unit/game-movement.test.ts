import { describe, it, expect } from "vitest";
import { facingFor, facingForVector, inputDir, isBlockedAt, stepMove } from "@/lib/game/movement";
import { mapFromAscii } from "./helpers/ascii-map";

const open = mapFromAscii(Array(10).fill(".........."));   // 80 × 80 px
const wall = mapFromAscii(Array(10).fill(".....#...."));   // wall at x 40–48

describe("stepMove", () => {
  it("moves speed × dt in open space", () => {
    const p = stepMove(open, { x: 20, y: 20 }, { x: 1, y: 0 }, 0.1);
    expect(p.x).toBeCloseTo(27);
    expect(p.y).toBe(20);
  });
  it("normalizes diagonal input", () => {
    const p = stepMove(open, { x: 20, y: 20 }, { x: 1, y: 1 }, 0.1);
    expect(Math.hypot(p.x - 20, p.y - 20)).toBeCloseTo(7);
  });
  it("stops in front of a wall", () => {
    const p = stepMove(wall, { x: 30, y: 40 }, { x: 1, y: 0 }, 0.5);
    expect(p.x).toBeGreaterThan(32);
    expect(p.x).toBeLessThan(37);
    expect(isBlockedAt(wall, p.x, p.y)).toBe(false);
  });
  it("slides along a wall", () => {
    const p = stepMove(wall, { x: 30, y: 20 }, { x: 1, y: 1 }, 0.5);
    expect(p.x).toBeLessThan(37);
    expect(p.y).toBeGreaterThan(40);
  });
  it("does not move with zero input", () => {
    expect(stepMove(open, { x: 20, y: 20 }, { x: 0, y: 0 }, 0.1)).toEqual({ x: 20, y: 20 });
  });
});

describe("isBlockedAt", () => {
  it("treats the map edge as a wall (6×4 feet box)", () => {
    expect(isBlockedAt(open, 1, 40)).toBe(true);
    expect(isBlockedAt(open, 40, 80)).toBe(true);
    expect(isBlockedAt(open, 40, 79)).toBe(false);
  });
});

describe("input + facing", () => {
  it("maps keys to a direction", () => {
    expect(inputDir({ up: true, down: false, left: true, right: false })).toEqual({ x: -1, y: -1 });
  });
  it("keyboard facing prefers the horizontal component", () => {
    expect(facingFor({ x: -1, y: -1 }, "down")).toBe("left");
    expect(facingFor({ x: 0, y: 1 }, "left")).toBe("down");
    expect(facingFor({ x: 0, y: 0 }, "up")).toBe("up");
  });
  it("path facing follows the dominant axis", () => {
    expect(facingForVector({ x: 0.3, y: 40 }, "left")).toBe("down");
    expect(facingForVector({ x: -40, y: 5 }, "down")).toBe("left");
  });
});
