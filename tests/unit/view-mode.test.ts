import { describe, it, expect } from "vitest";
import { parseViewMode, VIEW_MODE_KEY } from "@/lib/view-mode";

describe("parseViewMode", () => {
  it("returns classic only for the exact stored choice", () => {
    expect(parseViewMode("classic")).toBe("classic");
  });
  it("defaults to the game for anything else", () => {
    for (const v of [null, undefined, "", "CLASSIC", "game", "x"]) expect(parseViewMode(v)).toBe("game");
  });
  it("uses a namespaced storage key", () => {
    expect(VIEW_MODE_KEY).toBe("music-together:view-mode");
  });
});
