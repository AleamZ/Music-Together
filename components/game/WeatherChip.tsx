"use client";

import { effects, WEATHER_ICON, WEATHER_LABEL, type RoomWeather, type WeatherEffects } from "@/lib/game/weather/model";

/** The active effects, in Vietnamese, for the tooltip (display only; the server applies them). */
export function effectsText(fx: WeatherEffects): string {
  const out: string[] = [];
  if (!fx.dockOpen) out.push("Cầu câu đóng cửa");
  else if (fx.bite < 1 && fx.bigRare > 1) out.push("Cá cắn ít hơn, cá lớn nhiều hơn");
  else if (fx.bite < 1) out.push("Cá cắn ít hơn");
  else if (fx.bite > 1) out.push("Cá cắn nhiều hơn");
  else if (fx.bigRare > 1) out.push("Cá lớn nhiều hơn");
  if (fx.growth === 0) out.push("Lúa ngừng lớn ban đêm");
  else if (fx.growth > 1) out.push("Lúa lớn nhanh hơn");
  else if (fx.growth < 1) out.push("Lúa lớn chậm hơn");
  if (fx.drying === 0) out.push("Không phơi lúa được");
  else if (fx.drying > 1) out.push("Phơi lúa nhanh hơn");
  else if (fx.drying < 1) out.push("Phơi lúa chậm hơn");
  if (fx.pests > 1) out.push("Dễ sâu bệnh hơn");
  if (fx.ripeLossPct > 0) out.push(`Lúa chín có thể mất ${fx.ripeLossPct}%`);
  if (fx.thirst > 1) out.push("Mau khát hơn");
  else if (fx.thirst < 1) out.push("Đỡ khát hơn");
  if (fx.rideSpeed < 1) out.push("Xe chạy chậm hơn");
  return out.length ? out.join(" · ") : "Thời tiết bình thường";
}

export function chipLabel(w: RoomWeather, tempC: number | null): string {
  const t = tempC === null ? "" : ` · ${Math.round(tempC)}°C`;
  return `${WEATHER_ICON[w.kind]} ${WEATHER_LABEL[w.kind]}${w.isDay ? "" : " đêm"}${t}`;
}

/** The HUD weather chip (v18.8). The owner can open the location dialog from it; without weather it shows only for the
 *  owner, as the prompt to set a location. */
export default function WeatherChip({ weather, tempC, isOwner, needsLocation, onOpenLocation }: {
  weather: RoomWeather | null;
  tempC: number | null;
  isOwner: boolean;
  needsLocation: boolean;
  onOpenLocation: () => void;
}) {
  if (!weather) {
    if (!isOwner) return null;
    return (
      <button type="button" className="pch-btn pointer-events-auto font-vt text-sm whitespace-nowrap" title={needsLocation ? "Chọn vị trí thời tiết cho phòng" : "Đang lấy thời tiết…"} onClick={onOpenLocation}>
        {needsLocation ? "📍 Chọn vị trí" : "⏳ Thời tiết…"}
      </button>
    );
  }
  const label = chipLabel(weather, tempC);
  const tip = effectsText(effects(weather.kind, weather.isDay));
  const body = (
    <>
      <span>{label}</span>
      <span className="sr-only"> — {tip}</span>
    </>
  );
  if (!isOwner) {
    return <div className="font-vt text-sm whitespace-nowrap" title={tip} data-testid="weather-chip">{body}</div>;
  }
  return (
    <button type="button" className="pointer-events-auto font-vt text-sm whitespace-nowrap hover:underline" title={`${tip}\n📍 Đổi vị trí`}
      data-testid="weather-chip" onClick={onOpenLocation}>
      {body}
    </button>
  );
}
