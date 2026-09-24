import { describe, it, expect } from "vitest";
import { findPath, lineClear, MAX_PATH_POINTS, smoothPath } from "@/lib/game/pathfinding";
import { isBlockedAt } from "@/lib/game/movement";
import { mapFromAscii } from "./helpers/ascii-map";

const wallMap = mapFromAscii([
  "....................",
  "....................",
  "........#...........",
  "........#...........",
  "........#...........",
  "........#...........",
  "........#...........",
  "....................",
  "....................",
  "....................",
]);

describe("findPath", () => {
  it("routes around a wall and ends exactly on a free target", () => {
    const path = findPath(wallMap, { x: 28, y: 36 }, { x: 108, y: 36 })!;
    expect(path).not.toBeNull();
    expect(path[path.length - 1]).toEqual({ x: 108, y: 36 });
    for (const p of path) expect(isBlockedAt(wallMap, p.x, p.y)).toBe(false);
  });
  it("returns null when the target is enclosed", () => {
    const boxed = mapFromAscii(["..........", "..#####...", "..#...#...", "..#...#...", "..#####...", ".........."]);
    expect(findPath(boxed, { x: 4, y: 4 }, { x: 36, y: 28 })).toBeNull();
  });
  it("never cuts a corner between two blocked cells", () => {
    const diag = mapFromAscii(["....", ".#..", "..#.", "...."]);
    const path = findPath(diag, { x: 20, y: 12 }, { x: 12, y: 20 });
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(1);
  });
  it("snaps a blocked target to the nearest walkable cell", () => {
    const path = findPath(wallMap, { x: 28, y: 36 }, { x: 68, y: 36 })!;
    const last = path[path.length - 1];
    expect(isBlockedAt(wallMap, last.x, last.y)).toBe(false);
  });
});

describe("smoothPath", () => {
  it("keeps line of sight, shortens the route and keeps the end point", () => {
    const from = { x: 28, y: 36 };
    const cells = findPath(wallMap, from, { x: 108, y: 36 })!;
    const pts = smoothPath(wallMap, from, cells);
    expect(pts.length).toBeLessThan(cells.length);
    expect(pts.length).toBeLessThanOrEqual(MAX_PATH_POINTS);
    let prev = from;
    for (const p of pts) { expect(lineClear(wallMap, prev, p)).toBe(true); prev = p; }
    expect(pts[pts.length - 1]).toEqual({ x: 108, y: 36 });
  });
});
