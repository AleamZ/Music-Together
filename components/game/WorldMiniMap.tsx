"use client";

import { useEffect, useRef, useState } from "react";
import type { Vec } from "@/lib/game/types";
import { centreOn, drawWorldMap, fitWorld, zoneName } from "@/lib/game/world/minimap";
import type { ZoneId } from "@/lib/game/world/zones";

// P2 world mode: the minimap is a window over the whole world, centred on me (the per-map MiniMap stays for interiors
// and the per-map game). Redrawn every animation frame from the world data.

const W = 240, H = 150, SCALE = 0.075;

export default function WorldMiniMap({ getWorldPos, zone }: { getWorldPos: () => Vec | null; zone: ZoneId | null }) {
  const [minimized, setMinimized] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (minimized) return;
    let raf = 0;
    const draw = () => {
      const c = canvasRef.current, ctx = c?.getContext("2d");
      if (c && ctx) {
        const me = getWorldPos();
        drawWorldMap(ctx, W, H, me ? centreOn(me, W, H, SCALE) : fitWorld(W, H), me);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [minimized, getWorldPos]);
  return (
    <div className="pch pointer-events-auto flex flex-col gap-1 p-1 font-vt text-base leading-none" data-testid="world-minimap">
      <button type="button" className="flex items-center justify-between gap-2 px-1" onClick={() => setMinimized((m) => !m)} aria-expanded={!minimized}>
        <span>🧭 {zone ? zoneName(zone) : "Thế giới"}</span>
        <span aria-hidden="true">{minimized ? "▸" : "▾"}</span>
      </button>
      {!minimized && <canvas ref={canvasRef} width={W} height={H} className="rounded-sm border border-ink/50" aria-label="Bản đồ nhỏ thế giới" />}
    </div>
  );
}

/** The whole world for the city map (P2 world mode): the zones labelled, the roads, the river, the mine mouth and me. */
export function WorldMapCanvas({ getWorldPos }: { getWorldPos: () => Vec | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const c = ref.current, ctx = c?.getContext("2d");
      if (c && ctx) drawWorldMap(ctx, c.width, c.height, fitWorld(c.width, c.height), getWorldPos(), { labels: true });
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [getWorldPos]);
  return <canvas ref={ref} width={832} height={448} className="h-auto w-full rounded-sm border-2 border-ink/60" aria-label="Bản đồ thế giới" data-testid="world-map" />;
}
