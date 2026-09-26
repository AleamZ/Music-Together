import { describe, expect, it } from "vitest";
import { endsAtText, formatMult, nowPricePerKg, parseFishPrices, trend, type FishPrices } from "@/lib/game/fishing/prices";

const P: FishPrices = { mult: 2.24, wealth: 100000, endsAt: "2026-09-25T08:00:00+00:00", factors: { ca_ro: 1.12, ca_loc: 0.93 } };

describe("fish prices (economy spec §5)", () => {
  it("prices a species per kg now: base × the room's multiplier × its season factor", () => {
    expect(nowPricePerKg({ id: "ca_ro", pricePerKg: 45 }, P)).toBe(113); // 45 × 2.24 × 1.12 = 112.896
    expect(nowPricePerKg({ id: "ca_loc", pricePerKg: 60 }, P)).toBe(125); // 60 × 2.24 × 0.93 = 124.992
    expect(nowPricePerKg({ id: "ca_ho", pricePerKg: 200 }, P)).toBe(448); // no factor: 1
  });
  it("marks the trend and formats the multiplier and the end of the period", () => {
    expect([trend(1.12), trend(0.93), trend(1)]).toEqual(["▲", "▼", ""]);
    expect(formatMult(2.24)).toBe("×2,24");
    expect(formatMult(1)).toBe("×1,00");
    expect(endsAtText("2026-09-25T08:00:00+00:00")).toBe("15:00");
    expect(endsAtText("nope")).toBe("—");
  });
  it("reads the board's prices defensively", () => {
    expect(parseFishPrices({ mult: 2.24, wealth: 100000, ends_at: "2026-09-25T08:00:00+00:00", factors: { ca_ro: 1.12, bad: "x" } }))
      .toEqual({ mult: 2.24, wealth: 100000, endsAt: "2026-09-25T08:00:00+00:00", factors: { ca_ro: 1.12 } });
    expect(parseFishPrices(undefined)).toBeNull();
    expect(parseFishPrices({ mult: 0.5, ends_at: "2026-09-25T08:00:00+00:00" })).toBeNull();
    expect(parseFishPrices({ mult: 2, ends_at: 5 })).toBeNull();
    expect(parseFishPrices({ mult: 2, wealth: "?", ends_at: "2026-09-25T08:00:00+00:00" }))
      .toEqual({ mult: 2, wealth: 0, endsAt: "2026-09-25T08:00:00+00:00", factors: {} });
  });
});
