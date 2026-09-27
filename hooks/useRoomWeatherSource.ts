import { useCallback, useEffect, useRef, useState } from "react";
import type { RoomWeather } from "@/lib/game/weather/model";
import { fetchCurrentWeather, loadLoc, round2, saveLoc, type CityHit } from "@/lib/game/weather/openmeteo";
import { setRoomWeather } from "@/lib/game/weather/rpc";

export const WEATHER_FETCH_MS = 15 * 60_000;

export type LocStatus = "asking" | "ready" | "needed";

/** The owner's weather source (v18.8). Runs only when `enabled` (the room owner). The location comes from localStorage,
 *  else geolocation is asked once, else the owner picks a city. Coordinates never leave this browser: Open-Meteo is
 *  called directly and only the weather values go to set_room_weather ('too soon' from another tab is ignored). */
export function useRoomWeatherSource(opts: {
  enabled: boolean;
  token: string | null;
  roomId: string;
  onReported?: (w: RoomWeather | null) => void;
}): { loc: CityHit | null; status: LocStatus; tempC: number | null; setLoc: (l: CityHit) => void } {
  const { enabled, token, roomId, onReported } = opts;
  const [loc, setLocState] = useState<CityHit | null>(() => loadLoc());
  const [geoFailed, setGeoFailed] = useState(false);
  const [tempC, setTempC] = useState<number | null>(null);
  const asked = useRef(false);
  const reported = useRef(onReported);
  useEffect(() => { reported.current = onReported; }, [onReported]);

  const setLoc = useCallback((l: CityHit) => {
    const r = { lat: round2(l.lat), lon: round2(l.lon), label: l.label };
    saveLoc(r);
    setLocState(r);
  }, []);

  // geolocation, once, when there is no stored location
  useEffect(() => {
    if (!enabled || loc || asked.current) return;
    asked.current = true;
    const geo = typeof navigator !== "undefined" ? navigator.geolocation : undefined;
    if (!geo) {
      const t = setTimeout(() => setGeoFailed(true), 0);
      return () => clearTimeout(t);
    }
    geo.getCurrentPosition(
      (p) => setLoc({ lat: p.coords.latitude, lon: p.coords.longitude, label: "Vị trí hiện tại" }),
      () => setGeoFailed(true),
      { maximumAge: 60 * 60_000, timeout: 15_000 },
    );
  }, [enabled, loc, setLoc]);

  // fetch now and every 15 min, report to the server
  useEffect(() => {
    if (!enabled || !token || !loc) return;
    const ctrl = new AbortController();
    const run = async () => {
      const cur = await fetchCurrentWeather(loc.lat, loc.lon, ctrl.signal);
      if (!cur || ctrl.signal.aborted) return;
      setTempC(cur.tempC);
      try {
        const w = await setRoomWeather(roomId, token, cur);
        if (!ctrl.signal.aborted) reported.current?.(w);
      } catch { /* 'too soon' (another tab) or a transient error: the next round retries */ }
    };
    const first = setTimeout(() => void run(), 0);
    const id = setInterval(() => void run(), WEATHER_FETCH_MS);
    return () => { ctrl.abort(); clearTimeout(first); clearInterval(id); };
  }, [enabled, token, roomId, loc]);

  const status: LocStatus = loc ? "ready" : geoFailed ? "needed" : "asking";
  return { loc: enabled ? loc : null, status, tempC: enabled ? tempC : null, setLoc };
}
