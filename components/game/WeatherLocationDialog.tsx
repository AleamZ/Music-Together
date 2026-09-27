"use client";

import { useState, type FormEvent } from "react";
import { searchCity, type CityHit } from "@/lib/game/weather/openmeteo";
import { ParchmentModal } from "./Parchment";

/** The owner's weather location (v18.8): the current position or a city. Stored only in this browser. */
export default function WeatherLocationDialog({ current, onPick, onClose }: {
  current: CityHit | null;
  onPick: (loc: CityHit) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<CityHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const useHere = () => {
    const geo = typeof navigator !== "undefined" ? navigator.geolocation : undefined;
    if (!geo) { setErr("Trình duyệt không hỗ trợ định vị."); return; }
    setBusy(true);
    setErr(null);
    geo.getCurrentPosition(
      (p) => { setBusy(false); onPick({ lat: p.coords.latitude, lon: p.coords.longitude, label: "Vị trí hiện tại" }); onClose(); },
      () => { setBusy(false); setErr("Không lấy được vị trí — hãy tìm theo tên thành phố."); },
      { maximumAge: 60 * 60_000, timeout: 15_000 },
    );
  };

  const search = async (e: FormEvent) => {
    e.preventDefault();
    if (q.trim().length < 2) return;
    setBusy(true);
    setErr(null);
    const r = await searchCity(q);
    setBusy(false);
    setHits(r);
  };

  return (
    <ParchmentModal title="📍 Vị trí thời tiết" onClose={onClose} className="sm:max-w-[420px]">
      <div className="flex flex-col gap-3 font-vt text-lg">
        <p className="text-base">
          Thời tiết trong phòng lấy theo nơi bạn chọn. Vị trí chỉ lưu trên trình duyệt này, không gửi cho ai.
          {current && <><br />Hiện tại: <b>{current.label || "Vị trí đã lưu"}</b></>}
        </p>
        <button type="button" className="pch-btn" onClick={useHere} disabled={busy}>Dùng vị trí hiện tại</button>
        <form onSubmit={(e) => void search(e)} className="flex gap-2">
          <input
            aria-label="Tên thành phố"
            className="min-w-0 flex-1 rounded-sm border border-ink/40 bg-parchment px-2"
            placeholder="Tên thành phố…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button type="submit" className="pch-btn" disabled={busy || q.trim().length < 2}>Tìm</button>
        </form>
        {err && <p role="alert" className="text-base text-red-700">{err}</p>}
        {hits && hits.length === 0 && <p className="text-base">Không tìm thấy thành phố nào.</p>}
        {hits && hits.length > 0 && (
          <ul className="flex flex-col gap-1">
            {hits.map((h, i) => (
              <li key={`${h.lat},${h.lon},${i}`}>
                <button type="button" className="w-full text-left hover:underline" onClick={() => { onPick(h); onClose(); }}>
                  {h.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </ParchmentModal>
  );
}
