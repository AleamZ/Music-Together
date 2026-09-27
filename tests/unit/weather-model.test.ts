import { describe, expect, it } from "vitest";
import { effects, kindOf, WEATHER_ICON, WEATHER_LABEL, type WeatherKind } from "@/lib/game/weather/model";

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

describe("kindOf", () => {
  const cases: [number[], WeatherKind][] = [
    [[0, 1], "clear"],
    [[2, 3], "cloudy"],
    [[45, 48], "fog"],
    [[...range(51, 67), ...range(80, 82)], "rain"],
    [[95], "thunder"],
    [[96, 99], "storm"],
    [[...range(71, 77), 85, 86], "cloudy"],
  ];
  it.each(cases)("maps %j to %s", (codes, kind) => {
    for (const c of codes) expect(kindOf(c, 0)).toBe(kind);
  });
  it("rejects unknown codes", () => {
    expect(kindOf(5, 0)).toBeNull();
    expect(kindOf(100, 0)).toBeNull();
  });
  it("upgrades rain/thunder to storm at wind >= 60", () => {
    expect(kindOf(61, 60)).toBe("storm");
    expect(kindOf(95, 70)).toBe("storm");
    expect(kindOf(61, 59.9)).toBe("rain");
  });
  it("keeps clear clear in high wind", () => {
    expect(kindOf(0, 80)).toBe("clear");
  });
});

describe("effects", () => {
  it("returns the table rows exactly (day)", () => {
    expect(effects("clear", true)).toEqual({ bite: 1.0, bigRare: 1.0, dockOpen: true, growth: 1.0, drying: 1.5, pests: 1.0, ripeLossPct: 0, thirst: 1.3, rideSpeed: 1.0 });
    expect(effects("cloudy", true)).toEqual({ bite: 1.1, bigRare: 1.0, dockOpen: true, growth: 1.0, drying: 1.0, pests: 1.0, ripeLossPct: 0, thirst: 1.0, rideSpeed: 1.0 });
    expect(effects("fog", true)).toEqual({ bite: 1.0, bigRare: 1.2, dockOpen: true, growth: 1.0, drying: 0.5, pests: 1.2, ripeLossPct: 0, thirst: 1.0, rideSpeed: 0.8 });
    expect(effects("rain", true)).toEqual({ bite: 0.7, bigRare: 1.5, dockOpen: true, growth: 1.1, drying: 0, pests: 1.5, ripeLossPct: 0, thirst: 0.8, rideSpeed: 0.9 });
    expect(effects("thunder", true)).toEqual({ bite: 0.5, bigRare: 2.0, dockOpen: true, growth: 1.0, drying: 0, pests: 1.8, ripeLossPct: 10, thirst: 0.8, rideSpeed: 0.8 });
    expect(effects("storm", true)).toEqual({ bite: 0, bigRare: 1.0, dockOpen: false, growth: 0.8, drying: 0, pests: 2.0, ripeLossPct: 25, thirst: 0.8, rideSpeed: 0.6 });
  });
  it("night sets growth to 0 and leaves the rest", () => {
    const kinds: WeatherKind[] = ["clear", "cloudy", "fog", "rain", "thunder", "storm"];
    for (const k of kinds) {
      expect(effects(k, false)).toEqual({ ...effects(k, true), growth: 0 });
    }
  });
  it("does not leak mutations into the table", () => {
    effects("rain", false);
    expect(effects("rain", true).growth).toBe(1.1);
  });
});

describe("labels", () => {
  it("has Vietnamese labels and icons", () => {
    expect(WEATHER_LABEL).toEqual({ clear: "Nắng", cloudy: "Nhiều mây", fog: "Sương mù", rain: "Mưa", thunder: "Giông", storm: "Bão" });
    expect(Object.values(WEATHER_ICON)).toEqual(["☀️", "☁️", "🌫️", "🌧️", "⛈️", "🌀"]);
  });
});
