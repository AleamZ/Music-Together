import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCurrentWeather, forecastUrl, geocodeUrl, parseCities, parseForecast, searchCity } from "@/lib/game/weather/openmeteo";

const SAMPLE = {
  utc_offset_seconds: 25200,
  current: { weather_code: 61, is_day: 1, precipitation: 2.4, wind_speed_10m: 12.5, temperature_2m: 24.3 },
  daily: { sunrise: ["2026-09-27T05:43"], sunset: ["2026-09-27T17:49"] },
};

afterEach(() => vi.unstubAllGlobals());

describe("open-meteo", () => {
  it("parses the forecast", () => {
    const w = parseForecast(SAMPLE)!;
    expect(w).toMatchObject({ code: 61, isDay: true, rainMm: 2.4, windKmh: 12.5, tempC: 24.3 });
    expect(new Date(w.sunriseMs!).toISOString()).toBe("2026-09-26T22:43:00.000Z");
    expect(new Date(w.sunsetMs!).toISOString()).toBe("2026-09-27T10:49:00.000Z");
  });

  it("invalid JSON gives null", () => {
    expect(parseForecast(null)).toBeNull();
    expect(parseForecast("nope")).toBeNull();
    expect(parseForecast({ current: { is_day: 1 } })).toBeNull();
  });

  it("rounds the coordinates to 2 decimals in the URL", () => {
    const u = forecastUrl(10.776543, 106.700987);
    expect(u).toContain("latitude=10.78&longitude=106.7&");
    expect(u).not.toContain("10.7765");
    expect(u).toContain("temperature_2m");
  });

  it("fetchCurrentWeather calls Open-Meteo with rounded coordinates; a bad body gives null", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => SAMPLE }));
    vi.stubGlobal("fetch", fetchMock);
    const w = await fetchCurrentWeather(21.028511, 105.804817);
    expect(w?.code).toBe(61);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toMatch(/^https:\/\/api\.open-meteo\.com\/.*latitude=21\.03&longitude=105\.8&/);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => { throw new SyntaxError("bad"); } })));
    expect(await fetchCurrentWeather(1, 2)).toBeNull();
  });

  it("parses city results", async () => {
    const body = { results: [{ name: "Hà Nội", admin1: "Hà Nội", country: "Việt Nam", latitude: 21.0245, longitude: 105.84117 }, { name: 3 }] };
    expect(parseCities(body)).toEqual([{ lat: 21.0245, lon: 105.84117, label: "Hà Nội, Việt Nam" }]);
    expect(parseCities({})).toEqual([]);
    expect(geocodeUrl("Đà Nẵng")).toContain("name=%C4%90%C3%A0%20N%E1%BA%B5ng&count=5&language=vi");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => body })));
    expect(await searchCity("Hà Nội")).toHaveLength(1);
  });
});
