// v18.8: the viewer's own weather-effects level (display only; gameplay effects are server-side).
import type { WeatherFx } from "../art/weather";

export const FX_KEY = "mt.fx.weather";
export const FX_DEFAULT: WeatherFx = 3;

export const FX_LEVELS: ReadonlyArray<{ level: WeatherFx; label: string }> = [
  { level: 0, label: "Tắt" },
  { level: 1, label: "Nhẹ" },
  { level: 2, label: "Vừa" },
  { level: 3, label: "Nhiều" },
  { level: 4, label: "Đầy đủ" },
];

export function parseFx(raw: unknown): WeatherFx | null {
  const n = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : typeof raw === "number" ? raw : NaN;
  return Number.isInteger(n) && n >= 0 && n <= 4 ? (n as WeatherFx) : null;
}

export function loadWeatherFx(): WeatherFx {
  try {
    return parseFx(localStorage.getItem(FX_KEY)) ?? FX_DEFAULT;
  } catch {
    return FX_DEFAULT;
  }
}

export function saveWeatherFx(level: WeatherFx): void {
  try {
    localStorage.setItem(FX_KEY, String(level));
  } catch { /* storage blocked: the level lasts this session only */ }
}
