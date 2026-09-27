"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getCharacterFrames } from "@/lib/game/art/raster";
import { ROAD_GROUND_Y, ROAD_H, ROAD_SPEED, ROAD_W, drawTraveller, paintRoad, riderFrame, type Pillion } from "@/lib/game/art/road";
import { SKIP_COST, type Vehicle } from "@/lib/game/travel/vehicles";
import type { Look } from "@/lib/game/types";

/** v18.5 Đường ra chợ: the hall <-> Chợ Lớn road cutscene. Input is blocked while it plays; skipping costs SKIP_COST xu. */
export default function RoadTripOverlay({ look, toMarket, vehicle, durationMs, onArrive, onSkip, coins, pillion = null, canSkip = true, destName }: {
  /** The driver's look (mine, unless I ride along). */
  look: Look;
  /** v18.13: the passenger on the vehicle (null: none). */
  pillion?: Look | null;
  /** v18.13: a passenger rides the driver's trip and cannot skip it. */
  canSkip?: boolean;
  toMarket: boolean;
  /** v19.2: where the road leads (the Chợ Lớn ↔ Khu nhà road); without it the text is the hall ↔ Chợ Lớn one. */
  destName?: string;
  vehicle: Vehicle | null;
  durationMs: number;
  onArrive: () => void;
  onSkip: () => Promise<boolean>;
  coins: number | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const arrivedRef = useRef(false);
  const onArriveRef = useRef(onArrive);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const frames = useMemo(() => getCharacterFrames(look), [look]);
  const pillionFrames = useMemo((): Pillion | null => {
    if (!pillion) return null;
    const f = getCharacterFrames(pillion);
    return { right: f.right[0], down: f.down[0], up: f.up[0] };
  }, [pillion]);
  const vehicleId = vehicle?.id ?? null;

  useEffect(() => {
    onArriveRef.current = onArrive;
  }, [onArrive]);

  useEffect(() => {
    const reduced = typeof window !== "undefined" && typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ctx = canvasRef.current?.getContext("2d") ?? null;
    const start = performance.now();
    let painted = false;
    let raf = 0;
    const arrive = () => {
      if (arrivedRef.current) return;
      arrivedRef.current = true;
      onArriveRef.current();
    };
    const tick = () => {
      const el = Math.min(durationMs, performance.now() - start);
      if (ctx && (!reduced || !painted)) {
        ctx.imageSmoothingEnabled = false;
        paintRoad(ctx, ROAD_W, ROAD_H, el, ROAD_SPEED[vehicleId ?? "walk"], reduced, toMarket ? 1 : -1);
        const rider = frames.right[riderFrame(vehicleId, el, reduced)] ?? null;
        drawTraveller(ctx, toMarket ? 120 : ROAD_W - 120, ROAD_GROUND_Y, el, vehicleId, rider, reduced, !toMarket, vehicleId ? pillionFrames : null);
        painted = true;
      }
      setElapsed(el);
      if (el >= durationMs) { arrive(); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // a backstop for background tabs, where requestAnimationFrame is paused
    const backstop = setTimeout(arrive, durationMs + 250);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(backstop);
    };
  }, [durationMs, vehicleId, toMarket, frames, pillionFrames]);

  const skip = async () => {
    if (busy || arrivedRef.current) return;
    setBusy(true);
    setMsg(null);
    let ok = false;
    try {
      ok = await onSkip();
    } catch {
      ok = false;
    }
    if (ok) {
      if (!arrivedRef.current) {
        arrivedRef.current = true;
        onArriveRef.current();
      }
    } else {
      setMsg("Không đủ xu");
    }
    setBusy(false);
  };

  const secs = Math.round(durationMs / 1000);
  const left = Math.max(0, Math.ceil((durationMs - elapsed) / 1000));
  const pct = durationMs > 0 ? Math.min(100, (elapsed / durationMs) * 100) : 100;
  const label = vehicle ? `${vehicle.icon} ${vehicle.name} · ${secs} giây` : `🚶 Đi bộ · ${secs} giây`;
  const cannotPay = coins !== null && coins < SKIP_COST;

  return (
    <div role="dialog" aria-label="Đường ra chợ" className="absolute inset-0 z-50 overflow-hidden bg-[#1c1636] font-vt text-parchment">
      <canvas
        ref={canvasRef}
        width={ROAD_W}
        height={ROAD_H}
        className="absolute inset-0 h-full w-full object-cover"
        style={{ imageRendering: "pixelated" }}
      />
      <div className="absolute left-3 top-3 rounded border-2 border-[#3a2438] bg-black/55 px-3 py-1">
        <p className="text-2xl leading-tight">{destName ? `Đang tới ${destName}…` : toMarket ? "Đang ra Chợ Lớn…" : "Đang về Sảnh…"}</p>
        <p className="text-lg leading-tight opacity-90">{label}</p>
      </div>
      <div className="absolute inset-x-3 bottom-3 flex items-center gap-3 rounded border-2 border-[#3a2438] bg-black/55 px-3 py-2">
        <div
          className="relative h-4 flex-1 overflow-hidden rounded-sm border border-[#3a2438] bg-[#2a1f2e]"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct)}
        >
          <div className="h-full bg-[#f0b45a]" style={{ width: `${pct}%` }} />
        </div>
        <span className="w-16 text-right text-lg tabular-nums">{left} giây</span>
        {msg && <span className="text-lg text-[#ff8a7a]">{msg}</span>}
        {canSkip && <button
          type="button"
          onClick={skip}
          disabled={busy || cannotPay}
          className="rounded border-2 border-[#3a2438] bg-[#e8b640] px-3 py-0.5 text-lg text-[#2a1a14] hover:bg-[#f4c85a] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Bỏ qua ({SKIP_COST} xu)
        </button>}
      </div>
    </div>
  );
}
