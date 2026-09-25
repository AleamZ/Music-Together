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
  it("cuts a route that needs more than MAX_PATH_POINTS waypoints to its first MAX_PATH_POINTS points", () => {
    // 20 one-cell corridors; the walls between them open alternately at the bottom and the top,
    // so the route zig-zags and needs about two waypoints per corridor (more than MAX_PATH_POINTS).
    const zigzag = mapFromAscii([
      ".#..".repeat(9) + ".#.",
      ".#".repeat(19) + ".",
      ".#".repeat(19) + ".",
      "...#".repeat(9) + "...",
    ]);
    const from = { x: 4, y: 4 };
    const to = { x: 308, y: 4 };
    const cells = findPath(zigzag, from, to)!;
    expect(cells[cells.length - 1]).toEqual(to);
    const pts = smoothPath(zigzag, from, cells);
    expect(pts).toHaveLength(MAX_PATH_POINTS);
    let prev = from;
    for (const p of pts) { expect(lineClear(zigzag, prev, p)).toBe(true); prev = p; }
    expect(pts[pts.length - 1]).not.toEqual(to);
  });
});
