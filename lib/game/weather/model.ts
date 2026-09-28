// v18.8 weather: the pure model. The SQL (_room_weather) is authoritative for
// gameplay; this copy is display-only and a test pins it to the plan's table.

export type WeatherKind = "clear" | "cloudy" | "fog" | "rain" | "thunder" | "storm" | "snow";

export interface WeatherEffects {
  bite: number;
  bigRare: number;
  dockOpen: boolean;
  growth: number;
  drying: number;
  pests: number;
  ripeLossPct: number;
  thirst: number;
  rideSpeed: number;
}

export interface RoomWeather {
  kind: WeatherKind;
  code: number;
  isDay: boolean;
  sunriseMs: number | null;
  sunsetMs: number | null;
  rainMm: number;
  windKmh: number;
  /** v18.10: the reported temperature (°C); absent when the owner's browser did not send one. */
  tempC?: number;
  updatedAtMs: number;
}

export const STORM_WIND_KMH = 60;

function baseKind(code: number): WeatherKind | null {
  if (!Number.isInteger(code)) return null;
  if (code === 0 || code === 1) return "clear";
  if (code === 2 || code === 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  if (code === 95) return "thunder";
  if (code === 96 || code === 99) return "storm";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow"; // v21 (0075): was cloudy
  return null;
}

/** WMO code + wind → kind; null when the code is not in the accepted set. */
export function kindOf(code: number, windKmh: number): WeatherKind | null {
  const k = baseKind(code);
  if (k === null) return null;
  if ((k === "rain" || k === "thunder") && windKmh >= STORM_WIND_KMH) return "storm";
  return k;
}

const TABLE: Record<WeatherKind, WeatherEffects> = {
  clear: { bite: 1.0, bigRare: 1.0, dockOpen: true, growth: 1.0, drying: 1.5, pests: 1.0, ripeLossPct: 0, thirst: 1.3, rideSpeed: 1.0 },
  cloudy: { bite: 1.1, bigRare: 1.0, dockOpen: true, growth: 1.0, drying: 1.0, pests: 1.0, ripeLossPct: 0, thirst: 1.0, rideSpeed: 1.0 },
  fog: { bite: 1.0, bigRare: 1.2, dockOpen: true, growth: 1.0, drying: 0.5, pests: 1.2, ripeLossPct: 0, thirst: 1.0, rideSpeed: 0.8 },
  rain: { bite: 0.7, bigRare: 1.5, dockOpen: true, growth: 1.1, drying: 0, pests: 1.5, ripeLossPct: 0, thirst: 0.8, rideSpeed: 0.9 },
  thunder: { bite: 0.5, bigRare: 2.0, dockOpen: true, growth: 1.0, drying: 0, pests: 1.8, ripeLossPct: 10, thirst: 0.8, rideSpeed: 0.8 },
  // storm: casting is refused, so bigRare is moot ("—" in the plan); kept at 1.
  storm: { bite: 0, bigRare: 1.0, dockOpen: false, growth: 0.8, drying: 0, pests: 2.0, ripeLossPct: 25, thirst: 0.8, rideSpeed: 0.6 },
  // v21 (0075): real snow codes, or the room owner's "Tuyết" event
  snow: { bite: 0.8, bigRare: 1.3, dockOpen: true, growth: 0.5, drying: 0.3, pests: 0.5, ripeLossPct: 0, thirst: 0.7, rideSpeed: 0.7 },
};

/** The effects row for a kind; at night crops don't grow. */
export function effects(kind: WeatherKind, isDay: boolean): WeatherEffects {
  const row = { ...TABLE[kind] };
  if (!isDay) row.growth = 0;
  return row;
}

export const WEATHER_LABEL: Record<WeatherKind, string> = {
  clear: "Nắng",
  cloudy: "Nhiều mây",
  fog: "Sương mù",
  rain: "Mưa",
  thunder: "Giông",
  storm: "Bão",
  snow: "Tuyết",
};

export const WEATHER_ICON: Record<WeatherKind, string> = {
  clear: "☀️",
  cloudy: "☁️",
  fog: "\u{1F32B}️",
  rain: "\u{1F327}️",
  thunder: "⛈️",
  storm: "\u{1F300}",
  snow: "❄️",
};
