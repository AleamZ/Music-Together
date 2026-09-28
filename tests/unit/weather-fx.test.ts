import { afterEach, describe, expect, it, vi } from "vitest";
import { drawLighting, drawWeather, lightingFor, swayAmp, type WeatherFx } from "@/lib/game/art/weather";
import { FX_DEFAULT, FX_KEY, loadWeatherFx, parseFx, saveWeatherFx } from "@/lib/game/weather/fx";
import type { RoomWeather, WeatherKind } from "@/lib/game/weather/model";

const KINDS: WeatherKind[] = ["clear", "cloudy", "fog", "rain", "thunder", "storm", "snow"];

function recorder() {
  const calls: string[] = [];
  const ctx = {
    set fillStyle(v: string) { calls.push(`fs:${v}`); },
    set globalAlpha(v: number) { calls.push(`ga:${v.toFixed(3)}`); },
    set globalCompositeOperation(v: string) { calls.push(`op:${v}`); },
    get globalCompositeOperation() { return "source-over"; },
    fillRect: (x: number, y: number, w: number, h: number) => calls.push(`r:${x},${y},${w},${h}`),
    drawImage: () => calls.push("img"),
  };
  return { calls, c: ctx as unknown as CanvasRenderingContext2D };
}
const at = (h: number) => new Date(2026, 8, 27, h).getTime();
const W = (kind: WeatherKind): RoomWeather => ({ kind, code: 0, isDay: true, sunriseMs: at(6), sunsetMs: at(18), rainMm: 4, windKmh: 30, updatedAtMs: 0 });
const rects = (calls: string[]) => calls.filter((s) => s.startsWith("r:")).length;

/** Every frame over 30 s of thunder: whether a full-screen fill or a white bolt pixel ever appears. */
function scan(fx: WeatherFx, reduced = false) {
  let full = false, bolt = false;
  for (let t = 0; t < 30_000; t += 20) {
    const { calls, c } = recorder();
    drawWeather(c, 320, 180, { x: 0, y: 0 }, t, W("thunder"), "hall", reduced, 0, fx);
    if (calls.includes("r:0,0,320,180")) full = true;
    if (calls.includes("fs:#ffffff")) bolt = true;
  }
  return { full, bolt };
}

describe("weather effects level", () => {
  it("level 0 draws no particles and no flash", () => {
    for (const k of KINDS) {
      const { calls, c } = recorder();
      drawWeather(c, 320, 180, { x: 0, y: 0 }, 1234, W(k), "pond", false, 1, 0);
      expect(calls, k).toEqual([]);
    }
    expect(scan(0)).toEqual({ full: false, bolt: false });
  });

  it("density falls with the level", () => {
    const n = (fx: WeatherFx) => { const { calls, c } = recorder(); drawWeather(c, 320, 180, { x: 0, y: 0 }, 900, W("storm"), "pond", false, 0, fx); return rects(calls); };
    expect(n(1)).toBeLessThan(n(2));
    expect(n(2)).toBeLessThan(n(3));
    expect(n(3)).toBeLessThan(n(4));
  });

  it("levels 1-2: only the bolt, no full-screen flash; 3-4 flash", () => {
    expect(scan(1)).toEqual({ full: false, bolt: true });
    expect(scan(2)).toEqual({ full: false, bolt: true });
    expect(scan(3).full).toBe(true);
    expect(scan(4).full).toBe(true);
    expect(scan(2, true).full).toBe(false); // reduced motion: no tint below level 3 either
  }, 30_000); // five full scans of a storm frame: slow when the whole suite shares the machine

  it("no sway below level 2; the overcast grey scales, night stays", () => {
    expect(swayAmp(W("storm"), false, 1)).toBe(0);
    expect(swayAmp(W("storm"), false, 2)).toBeGreaterThan(0);
    expect(lightingFor(at(12), W("storm"), 0).alpha).toBe(0);
    expect(lightingFor(at(12), W("storm"), 2).alpha).toBeCloseTo(0.15, 5);
    expect(lightingFor(at(0), W("clear"), 0).night).toBe(1);
    const { calls, c } = recorder();
    drawLighting(c, 10, 10, lightingFor(at(0), W("rain"), 0));
    expect(calls).toContain("op:multiply");
    expect(calls).toContain("r:0,0,10,10");
  });
});

describe("the stored level", () => {
  afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

  it("defaults to 3, persists, and rejects junk", () => {
    expect(loadWeatherFx()).toBe(FX_DEFAULT);
    saveWeatherFx(1);
    expect(localStorage.getItem(FX_KEY)).toBe("1");
    expect(loadWeatherFx()).toBe(1);
    localStorage.setItem(FX_KEY, "7");
    expect(loadWeatherFx()).toBe(3);
    expect(parseFx("2.5")).toBeNull();
    expect(parseFx("")).toBeNull();
  });

  it("survives blocked storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(loadWeatherFx()).toBe(3);
    expect(() => saveWeatherFx(4)).not.toThrow();
  });
});
