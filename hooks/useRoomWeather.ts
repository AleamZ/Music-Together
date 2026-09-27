import { useCallback, useEffect, useRef, useState } from "react";
import { effects, type RoomWeather, type WeatherEffects } from "@/lib/game/weather/model";
import { roomWeatherState } from "@/lib/game/weather/rpc";

export const WEATHER_POLL_MS = 5 * 60_000;

/** The room's weather (v18.8), for everyone: now and every 5 min while visible. null = no live weather (neutral). */
export function useRoomWeather(token: string | null, roomId: string): {
  weather: RoomWeather | null;
  effects: WeatherEffects | null;
  reload: () => Promise<void>;
  /** The owner's source pushes the row set_room_weather returned, so the chip updates without waiting for a poll. */
  apply: (w: RoomWeather | null) => void;
} {
  const [held, setHeld] = useState<{ key: string; w: RoomWeather | null } | null>(null);
  const key = `${token ?? ""}|${roomId}`;
  const seq = useRef(0);
  const reload = useCallback(async () => {
    if (!token) return;
    const mine = ++seq.current;
    try {
      const w = await roomWeatherState(roomId, token);
      if (mine === seq.current) setHeld({ key: `${token}|${roomId}`, w });
    } catch { /* next poll retries */ }
  }, [token, roomId]);
  const apply = useCallback((w: RoomWeather | null) => {
    seq.current++;
    setHeld({ key, w });
  }, [key]);
  useEffect(() => {
    if (!token) return;
    const counter = seq;
    const first = setTimeout(() => void reload(), 0);
    const id = setInterval(() => { if (document.visibilityState === "visible") void reload(); }, WEATHER_POLL_MS);
    return () => { clearTimeout(first); clearInterval(id); counter.current++; };
  }, [token, reload]);
  const weather = held && held.key === key ? held.w : null;
  return { weather, effects: weather ? effects(weather.kind, weather.isDay) : null, reload, apply };
}
