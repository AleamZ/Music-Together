"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import type { Vec } from "@/lib/game/types";
import { centreOn, drawWorldMap, fitWorld, zoneName, type MapView } from "@/lib/game/world/minimap";
import { waypointAt, type WaypointMark } from "@/lib/game/world/waypoints";
import type { ZoneId } from "@/lib/game/world/zones";

// P2 world mode: the minimap is a window over the whole world, centred on me (the per-map MiniMap stays for interiors
// and the per-map game). Redrawn every animation frame from the world data. P3: the fast-travel waypoints on it; a click
// on one travels there (the shell's waypoint trip: paid, from the waypoint I stand at).

const W = 240, H = 150, SCALE = 0.075;

/** The canvas px of a click (the canvas may be scaled by CSS). */
function clickAt(e: MouseEvent<HTMLCanvasElement>): Vec {
  const r = e.currentTarget.getBoundingClientRect();
  return { x: ((e.clientX - r.left) * e.currentTarget.width) / (r.width || 1), y: ((e.clientY - r.top) * e.currentTarget.height) / (r.height || 1) };
}

export default function WorldMiniMap({ getWorldPos, zone, waypoints = [], onWaypoint }: {
  getWorldPos: () => Vec | null;
  zone: ZoneId | null;
  waypoints?: readonly WaypointMark[];
  onWaypoint?: (m: WaypointMark) => void;
}) {
  const [minimized, setMinimized] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<MapView | null>(null);
  const marks = useRef(waypoints);
  useEffect(() => {
    marks.current = waypoints;
  }, [waypoints]);
  useEffect(() => {
    if (minimized) return;
    let raf = 0;
    const draw = () => {
      const c = canvasRef.current, ctx = c?.getContext("2d");
      if (c && ctx) {
        const me = getWorldPos();
        const v = me ? centreOn(me, W, H, SCALE) : fitWorld(W, H);
        viewRef.current = v;
        drawWorldMap(ctx, W, H, v, me, { waypoints: marks.current });
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [minimized, getWorldPos]);
  const onClick = (e: MouseEvent<HTMLCanvasElement>) => {
    const v = viewRef.current;
    const m = v ? waypointAt(marks.current, v, clickAt(e)) : null;
    if (m) onWaypoint?.(m);
  };
  return (
    <div className="pch pointer-events-auto flex flex-col gap-1 p-1 font-vt text-base leading-none" data-testid="world-minimap">
      <button type="button" className="flex items-center justify-between gap-2 px-1" onClick={() => setMinimized((m) => !m)} aria-expanded={!minimized}>
        <span>🧭 {zone ? zoneName(zone) : "Thế giới"}</span>
        <span aria-hidden="true">{minimized ? "▸" : "▾"}</span>
      </button>
      {!minimized && <canvas ref={canvasRef} width={W} height={H} className="rounded-sm border border-ink/50" aria-label="Bản đồ nhỏ thế giới" onClick={onClick} />}
    </div>
  );
}

/** The whole world for the city map (P2 world mode): the zones labelled, the roads, the river, the mine mouth and me;
 *  P3: the waypoints, a click on one travels there. */
export function WorldMapCanvas({ getWorldPos, waypoints = [], onWaypoint }: {
  getWorldPos: () => Vec | null;
  waypoints?: readonly WaypointMark[];
  onWaypoint?: (m: WaypointMark) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const marks = useRef(waypoints);
  useEffect(() => {
    marks.current = waypoints;
  }, [waypoints]);
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const c = ref.current, ctx = c?.getContext("2d");
      if (c && ctx) drawWorldMap(ctx, c.width, c.height, fitWorld(c.width, c.height), getWorldPos(), { labels: true, waypoints: marks.current });
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [getWorldPos]);
  const onClick = (e: MouseEvent<HTMLCanvasElement>) => {
    const c = e.currentTarget;
    const m = waypointAt(marks.current, fitWorld(c.width, c.height), clickAt(e), 20);
    if (m) onWaypoint?.(m);
  };
  return <canvas ref={ref} width={832} height={448} className="h-auto w-full rounded-sm border-2 border-ink/60" aria-label="Bản đồ thế giới" data-testid="world-map" onClick={onClick} />;
}
