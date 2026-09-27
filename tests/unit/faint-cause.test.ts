import { describe, expect, it } from "vitest";
import { FAINT_TEXT, faintCause } from "@/lib/game/vitals";

describe("faintCause", () => {
  const base = { struckAgoMs: Infinity, crampAgoMs: Infinity, cold: false, wet: false };
  it("says hunger/thirst when nothing else happened", () => {
    expect(faintCause(base)).toBe("starve");
  });
  it("a cramp in the last minute is a drowning", () => {
    expect(faintCause({ ...base, crampAgoMs: 12000 })).toBe("drown");
    expect(FAINT_TEXT.drown).toContain("đuối nước");
  });
  it("lightning wins over the rest", () => {
    expect(faintCause({ struckAgoMs: 800, crampAgoMs: 1000, cold: true, wet: true })).toBe("lightning");
  });
  it("cold and still wet is the rain's faint; an old cramp does not count", () => {
    expect(faintCause({ ...base, crampAgoMs: 120000, cold: true, wet: true })).toBe("cold");
    expect(faintCause({ ...base, cold: true, wet: false })).toBe("starve");
  });
});
