"use client";

import { useState } from "react";
import type { WeatherFx } from "@/lib/game/art/weather";
import { FX_LEVELS } from "@/lib/game/weather/fx";
import KeyBadge from "./KeyBadge";

/** The viewer's own display settings (v18.8): for now the weather-effects level. */
export default function PersonalSettings({ weatherFx, onWeatherFx }: { weatherFx: WeatherFx; onWeatherFx: (l: WeatherFx) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative font-vt text-base leading-none">
      <button
        type="button"
        className={`pch-btn relative flex items-center gap-1 px-2 py-1 text-sm shadow-xs ${open ? "pch-btn-primary" : ""}`}
        data-hotkey="settings"
        onClick={() => setOpen(!open)}
        aria-label="Cài đặt cá nhân"
        aria-expanded={open}
        title="Cài đặt cá nhân (O)"
      >
        ⚙️<KeyBadge id="settings" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="pch absolute top-full left-0 z-50 mt-1 flex flex-col gap-1 p-2 text-sm shadow-lg whitespace-nowrap">
            <div id="fx-weather-label" className="text-xs font-bold opacity-75">Hiệu ứng thời tiết</div>
            <div role="radiogroup" aria-labelledby="fx-weather-label" className="flex gap-1">
              {FX_LEVELS.map(({ level, label }) => (
                <button
                  key={level}
                  type="button"
                  role="radio"
                  aria-checked={weatherFx === level}
                  title={`${level} ${label}`}
                  className={`pch-btn px-1.5 text-xs ${weatherFx === level ? "pch-btn-primary" : ""}`}
                  onClick={() => onWeatherFx(level)}
                >
                  {level} {label}
                </button>
              ))}
            </div>
            <div className="text-xs opacity-75">Chỉ đổi hình ảnh trên máy bạn; ngày/đêm và đèn vẫn giữ.</div>
          </div>
        </>
      )}
    </div>
  );
}
