"use client";

import { useEffect, useState } from "react";
import { spotHudText, tintOf, type GroundbaitSpotView } from "@/lib/game/fishing/groundbait-spots";

/** What the HUD needs of the canvas (GameCanvasHandle's 0117 part). */
export interface GroundbaitCanvas {
  setGroundbait?: (spots: readonly GroundbaitSpotView[]) => void;
  groundbaitHere?: () => GroundbaitSpotView | null;
}

/** 0117: hands the room's ổ thính to the canvas (2D, 3D, the minimap) and, while my feet are in one, the line
 *  "🌾 Đang câu trong ổ thính … · còn m:ss (cá ưa thính này ×3 tỉ lệ)". Ticks once a second; gone at expiry. */
export default function GroundbaitHud({ spots, canvas, hidden = false }: {
  spots: readonly GroundbaitSpotView[];
  canvas: () => GroundbaitCanvas | null;
  hidden?: boolean;
}) {
  const [here, setHere] = useState<{ spot: GroundbaitSpotView; now: number } | null>(null);
  useEffect(() => {
    const tick = () => {
      const c = canvas();
      c?.setGroundbait?.(spots);                     // again each second: a canvas mounted later gets them too
      const s = c?.groundbaitHere?.() ?? null;
      const now = Date.now();
      setHere(s && s.untilMs > now ? { spot: s, now } : null);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [spots, canvas]);
  if (!here || hidden) return null;
  return (
    <div className="pointer-events-none absolute left-1/2 top-[max(3.25rem,calc(env(safe-area-inset-top)+3rem))] z-10 -translate-x-1/2"
      data-testid="groundbait-hud">
      <span className="pch inline-flex max-w-[calc(100vw-2rem)] items-center gap-1 truncate px-2 py-0.5 font-vt text-base leading-tight"
        style={{ borderLeft: `6px solid ${tintOf(here.spot.item)}` }} title={here.spot.by ? `Ổ của ${here.spot.mine ? "bạn" : here.spot.by}` : undefined}>
        {spotHudText(here.spot, here.now)}
      </span>
    </div>
  );
}
