import { describe, it, expect } from "vitest";
import { throttled, REACTION_EMOJIS } from "@/lib/reactions";

describe("throttled", () => {
  it("allows the first call (lastAt null)", () => {
    expect(throttled(null, 1000)).toBe(false);
  });
  it("blocks a call within the gap", () => {
    expect(throttled(1000, 1100, 250)).toBe(true);
  });
  it("allows a call at/after the gap", () => {
    expect(throttled(1000, 1250, 250)).toBe(false);
    expect(throttled(1000, 1600, 250)).toBe(false);
  });
});

describe("REACTION_EMOJIS", () => {
  it("is the fixed 5-emoji palette", () => {
    expect(REACTION_EMOJIS).toEqual(["❤️", "😂", "🔥", "👏", "🎉"]);
  });
});
