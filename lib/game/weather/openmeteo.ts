// v18.8: the owner's browser calls Open-Meteo directly. Coordinates and the city name never leave the browser for
// our server: only the parsed weather values are reported (see rpc.ts).
import type { WeatherReport } from "./rpc";

export interface CurrentWeather extends WeatherReport {
  /** Display only; never sent to our server. */
  tempC: number | null;
}

export interface CityHit {
  lat: number;
  lon: number;
  label: string;
}

export const round2 = (x: number) => Math.round(x * 100) / 100;

export function forecastUrl(lat: number, lon: number): string {
  return "https://api.open-meteo.com/v1/forecast"
    + `?latitude=${round2(lat)}&longitude=${round2(lon)}`
    + "&current=weather_code,is_day,precipitation,wind_speed_10m,temperature_2m"
    + "&daily=sunrise,sunset&timezone=auto&forecast_days=1";
}

export function geocodeUrl(name: string): string {
  return `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=5&language=vi`;
}

const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);

/** "2026-09-27T05:43" in the location's local time + its UTC offset → epoch ms. */
function localToMs(s: unknown, offsetSec: number): number | null {
  if (typeof s !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - offsetSec * 1000;
}

export function parseForecast(raw: unknown): CurrentWeather | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const cur = r.current as Record<string, unknown> | undefined;
  if (!cur || typeof cur !== "object") return null;
  const code = num(cur.weather_code);
  const isDay = num(cur.is_day);
  if (code === null || isDay === null) return null;
  const offset = num(r.utc_offset_seconds) ?? 0;
  const daily = (r.daily && typeof r.daily === "object" ? r.daily : {}) as Record<string, unknown>;
  const first = (x: unknown) => (Array.isArray(x) ? x[0] : undefined);
  return {
    code,
    isDay: isDay === 1,
    sunriseMs: localToMs(first(daily.sunrise), offset),
    sunsetMs: localToMs(first(daily.sunset), offset),
    rainMm: Math.max(0, num(cur.precipitation) ?? 0),
    windKmh: Math.max(0, num(cur.wind_speed_10m) ?? 0),
    tempC: num(cur.temperature_2m),
  };
}

export function parseCities(raw: unknown): CityHit[] {
  if (!raw || typeof raw !== "object") return [];
  const list = (raw as { results?: unknown }).results;
  if (!Array.isArray(list)) return [];
  const out: CityHit[] = [];
  for (const it of list) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const lat = num(o.latitude), lon = num(o.longitude);
    if (lat === null || lon === null || typeof o.name !== "string") continue;
    const parts = [o.name, o.admin1, o.country].filter((p): p is string => typeof p === "string" && p !== "");
    out.push({ lat, lon, label: [...new Set(parts)].join(", ") });
  }
  return out;
}

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function fetchCurrentWeather(lat: number, lon: number, signal?: AbortSignal): Promise<CurrentWeather | null> {
  return parseForecast(await getJson(forecastUrl(lat, lon), signal));
}

export async function searchCity(name: string, signal?: AbortSignal): Promise<CityHit[]> {
  const q = name.trim();
  if (q.length < 2) return [];
  return parseCities(await getJson(geocodeUrl(q), signal));
}

// --- the stored location (localStorage only)
export const LOC_KEY = "mt.weather.loc";

export function loadLoc(): CityHit | null {
  try {
    const raw = localStorage.getItem(LOC_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as Record<string, unknown>;
    const lat = num(o.lat), lon = num(o.lon);
    if (lat === null || lon === null) return null;
    return { lat, lon, label: typeof o.label === "string" ? o.label : "" };
  } catch {
    return null;
  }
}

export function saveLoc(loc: CityHit): void {
  try {
    localStorage.setItem(LOC_KEY, JSON.stringify({ lat: round2(loc.lat), lon: round2(loc.lon), label: loc.label }));
  } catch { /* private mode: the location is asked again next time */ }
}
