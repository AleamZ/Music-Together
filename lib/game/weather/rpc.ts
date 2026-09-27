import { supabase } from "@/lib/supabase";
import { kindOf, type RoomWeather, type WeatherKind } from "./model";

/** A storm closes the dock (start_cast raises 'storm'). */
export const STORM_TEXT = "Bão lớn — cầu câu tạm đóng, đợi trời yên nhé!";

/** The weather values the owner's browser reports. Never coordinates or a city: those stay in the browser. */
export interface WeatherReport {
  code: number;
  isDay: boolean;
  sunriseMs: number | null;
  sunsetMs: number | null;
  rainMm: number;
  windKmh: number;
  /** v18.10: the temperature (°C), for the heat; null/absent when unknown. */
  tempC?: number | null;
}

const KINDS: readonly WeatherKind[] = ["clear", "cloudy", "fog", "rain", "thunder", "storm"];

/** The server's _weather_json → RoomWeather (null when malformed or stale: stale means no live weather). */
export function parseRoomWeather(raw: unknown): RoomWeather | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : typeof x === "string" && x !== "" && Number.isFinite(Number(x)) ? Number(x) : null);
  if (r.stale === true) return null;
  const kind = typeof r.kind === "string" && (KINDS as readonly string[]).includes(r.kind) ? (r.kind as WeatherKind) : null;
  const code = n(r.code), updated = n(r.updated_at_ms);
  if (kind === null || code === null || updated === null || typeof r.is_day !== "boolean") return null;
  return {
    kind, code, isDay: r.is_day,
    sunriseMs: n(r.sunrise_ms), sunsetMs: n(r.sunset_ms),
    rainMm: n(r.rain_mm) ?? 0, windKmh: n(r.wind_kmh) ?? 0,
    ...(typeof n(r.temp_c) === "number" ? { tempC: n(r.temp_c) as number } : {}),
    updatedAtMs: updated,
  };
}

export async function roomWeatherState(roomId: string, token: string): Promise<RoomWeather | null> {
  const { data, error } = await supabase.rpc("room_weather_state", { p_room_id: roomId, p_session_token: token });
  if (error) throw error;
  return parseRoomWeather(data);
}

/** Owner only. Throws the RPC error ('too soon' is expected when another tab reported recently). */
export async function setRoomWeather(roomId: string, token: string, w: WeatherReport): Promise<RoomWeather | null> {
  if (kindOf(w.code, w.windKmh) === null) return null;
  const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
  const { data, error } = await supabase.rpc("set_room_weather", {
    p_room_id: roomId, p_session_token: token, p_code: w.code, p_is_day: w.isDay,
    p_sunrise: iso(w.sunriseMs), p_sunset: iso(w.sunsetMs),
    p_rain_mm: Math.max(0, Math.min(200, w.rainMm)), p_wind_kmh: Math.max(0, Math.min(300, w.windKmh)),
    p_temp_c: typeof w.tempC === "number" && Number.isFinite(w.tempC) ? Math.max(-50, Math.min(60, w.tempC)) : null,
  });
  if (error) throw error;
  return parseRoomWeather(data);
}

export function weatherErrorMessage(err: unknown): string | null {
  const msg = err && typeof err === "object" && typeof (err as { message?: unknown }).message === "string" ? (err as { message: string }).message : "";
  if (msg.includes("too soon")) return null;
  if (msg.includes("not owner")) return "Chỉ chủ phòng mới cập nhật thời tiết.";
  if (msg.includes("invalid weather")) return "Dữ liệu thời tiết không hợp lệ.";
  if (msg === "storm") return STORM_TEXT;
  return "Không cập nhật được thời tiết.";
}
