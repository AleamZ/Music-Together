"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { readGfx, subscribeGfx, writeGfx, type GfxMode } from "@/lib/game/diorama/flag";
import type { WeatherFx } from "@/lib/game/art/weather";
import { FX_LEVELS } from "@/lib/game/weather/fx";
import { unifiedWorldOn } from "@/lib/game/world/flag";
import KeyBadge from "./KeyBadge";

/** The viewer's own display settings (v18.8): for now the weather-effects level. */
export default function PersonalSettings({ weatherFx, onWeatherFx }: { weatherFx: WeatherFx; onWeatherFx: (l: WeatherFx) => void }) {
  const [open, setOpen] = useState(false);
  const gfx = useSyncExternalStore<GfxMode>(subscribeGfx, readGfx, () => "2d");
  // 0090: the server offers the unified 3D world (flag unified_world); without it 3D is only the Ao cá diorama
  const [world, setWorld] = useState(false);
  useEffect(() => {
    let live = true;
    void unifiedWorldOn().then((on) => { if (live) setWorld(on); });
    return () => { live = false; };
  }, []);
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
            <div id="gfx-label" className="mt-1 text-xs font-bold opacity-75">Đồ họa 3D</div>
            <div role="radiogroup" aria-labelledby="gfx-label" className="flex gap-1">
              {(["2d", "3d"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={gfx === m}
                  className={`pch-btn px-1.5 text-xs ${gfx === m ? "pch-btn-primary" : ""}`}
                  onClick={() => writeGfx(m)}
                >
                  {m === "2d" ? "2D" : "3D"}
                </button>
              ))}
            </div>
            <div className="text-xs opacity-75">
              {world ? "3D: cả thế giới liền một mảnh, đi bộ giữa các khu. Máy yếu tải không nổi sẽ tự về 2D." : "3D (thử): chỉ ở Ao cá, các nơi khác vẫn 2D."}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
