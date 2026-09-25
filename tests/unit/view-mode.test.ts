import { describe, it, expect } from "vitest";
import { parseViewMode, VIEW_MODE_KEY } from "@/lib/view-mode";

describe("parseViewMode", () => {
  it("returns game only for the exact stored value", () => {
    expect(parseViewMode("game")).toBe("game");
  });
  it("falls back to classic for anything else", () => {
    for (const v of [null, undefined, "", "GAME", "classic", "x"]) expect(parseViewMode(v)).toBe("classic");
  });
  it("uses a namespaced storage key", () => {
    expect(VIEW_MODE_KEY).toBe("music-together:view-mode");
  });
});
