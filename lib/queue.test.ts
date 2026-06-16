import { describe, it, expect } from "vitest";
import { positionBetween } from "@/lib/queue";

describe("positionBetween", () => {
  it("averages two neighbors", () => {
    expect(positionBetween(2, 4)).toBe(3);
  });
  it("drops below the first when no upper neighbor", () => {
    expect(positionBetween(null, 4)).toBe(3); // 4 - 1
  });
  it("rises above the last when no lower neighbor", () => {
    expect(positionBetween(2, null)).toBe(3); // 2 + 1
  });
  it("returns 0 for an empty list", () => {
    expect(positionBetween(null, null)).toBe(0);
  });
});
