import { describe, expect, it } from "vitest";
import { drawWeather, lightingFor, NIGHT_ALPHA, swayAmp, swayAt } from "@/lib/game/art/weather";
import type { RoomWeather, WeatherKind } from "@/lib/game/weather/model";

const KINDS: WeatherKind[] = ["clear", "cloudy", "fog", "rain", "thunder", "storm", "snow"];

/** A 2D context that records every call and style change. */
function recorder() {
  const calls: string[] = [];
  const ctx = {
    set fillStyle(v: string) { calls.push(`fs:${v}`); },
    set globalAlpha(v: number) { calls.push(`ga:${v.toFixed(3)}`); },
    globalCompositeOperation: "source-over",
    fillRect: (x: number, y: number, w: number, h: number) => calls.push(`r:${x},${y},${w},${h}`),
    drawImage: () => calls.push("img"),
  };
  return { calls, c: ctx as unknown as CanvasRenderingContext2D };
}

function at(h: number, m = 0): number {
  return new Date(2026, 8, 27, h, m).getTime();
}

function weather(kind: WeatherKind, isDay = true): RoomWeather {
  return { kind, code: 0, isDay, sunriseMs: at(6), sunsetMs: at(18), rainMm: kind === "rain" ? 2 : 0, windKmh: 10, updatedAtMs: at(12) };
}

describe("drawWeather", () => {
  it("draws every kind by day and by night", () => {
    for (const k of KINDS) for (const night of [0, 1]) {
      const { calls, c } = recorder();
      drawWeather(c, 320, 180, { x: 40, y: 20 }, 1234, weather(k, night === 0), "pond", false, night);
      expect(calls.some((s) => s.startsWith("r:")), `${k} night=${night}`).toBe(true);
    }
  });

  it("draws nothing without a weather row", () => {
    const { calls, c } = recorder();
    drawWeather(c, 320, 180, { x: 0, y: 0 }, 0, null, "hall", false);
    expect(calls).toEqual([]);
  });

  it("holds still under reduced motion", () => {
    for (const k of KINDS) for (const map of ["hall", "pond", "field", "market"] as const) {
      const a = recorder(), b = recorder();
      drawWeather(a.c, 320, 180, { x: 10, y: 10 }, 0, weather(k), map, true);
      drawWeather(b.c, 320, 180, { x: 10, y: 10 }, 5000, weather(k), map, true);
      expect(b.calls, `${k} on ${map}`).toEqual(a.calls);
    }
  });

  it("moves with time otherwise", () => {
    const a = recorder(), b = recorder();
    drawWeather(a.c, 320, 180, { x: 0, y: 0 }, 0, weather("rain"), "pond", false);
    drawWeather(b.c, 320, 180, { x: 0, y: 0 }, 500, weather("rain"), "pond", false);
    expect(b.calls).not.toEqual(a.calls);
  });

  it("flashes white on a lightning strike, and only tints under reduced motion", () => {
    const flash = (reduced: boolean) => {
      for (let t = 0; t < 30_000; t += 20) {
        const { calls, c } = recorder();
        drawWeather(c, 320, 180, { x: 0, y: 0 }, t, weather("thunder"), "hall", reduced);
        if (calls.includes("r:0,0,320,180")) return calls;
      }
      return null;
    };
    expect(flash(false)).toContain("fs:#ffffff");
    const dim = flash(true);
    expect(dim).not.toBeNull();
    expect(dim).not.toContain("fs:#ffffff");
  });
});

describe("lightingFor", () => {
  it("is night blue at midnight and clear at noon under a clear sky", () => {
    const mid = lightingFor(at(0), weather("clear"));
    expect(mid.alpha).toBeCloseTo(NIGHT_ALPHA, 5);
    expect(mid.night).toBe(1);
    const noon = lightingFor(at(12), weather("clear"));
    expect(noon.alpha).toBe(0);
    expect(noon.night).toBe(0);
  });

  it("falls back to 06:00 and 18:00 local", () => {
    const w = { ...weather("clear"), sunriseMs: null, sunsetMs: null };
    expect(lightingFor(at(0), w).night).toBe(1);
    expect(lightingFor(at(12), w).alpha).toBe(0);
    expect(lightingFor(at(18), w).night).toBeCloseTo(0.5, 5);
  });

  it("uses the sun times of any day (only the time of day counts)", () => {
    const w = weather("clear");
    const nextMidnight = at(0) + 3 * 86_400_000;
    expect(lightingFor(nextMidnight, w).alpha).toBeCloseTo(NIGHT_ALPHA, 5);
  });

  it("glows warm at dusk", () => {
    const l = lightingFor(at(18), weather("clear"));
    const [r, , b] = l.tint.match(/\d+/g)!.map(Number);
    expect(l.alpha).toBeGreaterThan(0);
    expect(r).toBeGreaterThan(b);
    expect(l.night).toBeGreaterThan(0);
    expect(l.night).toBeLessThan(1);
  });

  it("greys an overcast or stormy day", () => {
    expect(lightingFor(at(12), weather("cloudy")).alpha).toBeCloseTo(0.15, 5);
    expect(lightingFor(at(12), weather("storm")).alpha).toBeCloseTo(0.3, 5);
    const rain = lightingFor(at(12), weather("rain")).alpha;
    expect(rain).toBeGreaterThanOrEqual(0.15);
    expect(rain).toBeLessThanOrEqual(0.3);
  });
});

describe("sway", () => {
  it("sways in a storm, never under reduced motion or in calm weather", () => {
    expect(swayAmp(weather("storm"), false)).toBeGreaterThan(0);
    expect(swayAmp(weather("storm"), true)).toBe(0);
    expect(swayAmp(weather("clear"), false)).toBe(0);
    expect(swayAt(0, 1234, 3)).toBe(0);
  });
});
