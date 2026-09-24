import { describe, it, expect } from "vitest";
import { assignSpots } from "@/lib/game/seating";
import { wrapBubble } from "@/lib/game/text";
import type { Spot } from "@/lib/game/maps/types";

const seats: Spot[] = [{ x: 1, y: 1, dir: "down" }, { x: 2, y: 2, dir: "down" }];
const stand: Spot[] = [{ x: 9, y: 9, dir: "left" }];

describe("assignSpots", () => {
  it("seats classic members by sorted id, then overflows to stand spots", () => {
    const spots = assignSpots(["c", "a", "b", "a"], seats, stand);
    expect(spots.get("a")).toEqual(seats[0]);
    expect(spots.get("b")).toEqual(seats[1]);
    expect(spots.get("c")).toEqual(stand[0]);
  });
  it("returns nothing when there are no spots", () => {
    expect(assignSpots(["a"], [], []).size).toBe(0);
  });
});

describe("wrapBubble", () => {
  it("keeps short text on one line and collapses whitespace", () => {
    expect(wrapBubble("xin chào")).toEqual(["xin chào"]);
    expect(wrapBubble("  hello   world  ")).toEqual(["hello world"]);
    expect(wrapBubble("")).toEqual([]);
  });
  it("wraps at 28 chars into at most 2 lines with an ellipsis", () => {
    const lines = wrapBubble("bài này hay quá trời luôn á mọi người ơi nghe đi nghe lại hoài không chán");
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith("…")).toBe(true);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(28);
  });
  it("hard-breaks a very long word", () => {
    const lines = wrapBubble("a".repeat(70));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toHaveLength(28);
    expect(lines[1]).toHaveLength(28);
    expect(lines[1].endsWith("…")).toBe(true);
  });
});
