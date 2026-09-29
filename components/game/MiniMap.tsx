"use client";

import { useEffect, useRef, useState } from "react";
import { getMap, paintMap } from "@/lib/game/maps/registry";
import type { MapId } from "@/lib/game/maps/types";
import type { Vec } from "@/lib/game/types";
import { partyDotsOn } from "@/lib/game/realm/party-dots";

const MAP_NAMES: Record<MapId, string> = {
  hall: "Hội trường",
  pond: "Ao câu cá",
  field: "Đồng lúa",
  market: "Chợ Lớn",
  khu_nha: "Khu nhà",
  bai_dat: "Bãi đất trống",
  ham_ngam: "Hầm đấu ngầm",
  mo_da: "Mỏ đá",
  rung_tram: "Rừng tràm",
  song_cai: "Sông Cái",
};

type MiniMapSize = "sm" | "md" | "lg";

const SIZES: Record<MiniMapSize, { width: number; label: string; dotR: number }> = {
  sm: { width: 200, label: "Nhỏ", dotR: 3.5 },
  md: { width: 280, label: "Chuẩn", dotR: 4.5 },
  lg: { width: 380, label: "Lớn", dotR: 6 },
};

function getInitialSize(): MiniMapSize {
  if (typeof window === "undefined") return "md";
  try {
    const saved = localStorage.getItem("music_together_minimap_size");
    if (saved === "sm" || saved === "md" || saved === "lg") return saved;
  } catch {
    // ignore
  }
  return "md";
}

export default function MiniMap({
  mapId,
  getLocalPos,
  onOpenMap,
}: {
  mapId: MapId;
  getLocalPos: () => Vec | null;
  /** P4: open the world map (the button carries the M hotkey). */
  onOpenMap?: () => void;
}) {
  const [minimized, setMinimized] = useState(false);
  const [sizeKey, setSizeKey] = useState<MiniMapSize>(getInitialSize);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  const map = getMap(mapId);
  const mapW = map.width;
  const mapH = map.height;

  const currentSize = SIZES[sizeKey];
  const miniW = currentSize.width;
  const miniH = Math.round((miniW * mapH) / mapW);

  const cycleSize = () => {
    const next: MiniMapSize = sizeKey === "sm" ? "md" : sizeKey === "md" ? "lg" : "sm";
    setSizeKey(next);
    try {
      localStorage.setItem("music_together_minimap_size", next);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (minimized) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let art: HTMLCanvasElement | null = null;
    try {
      art = paintMap(map).background;
    } catch {
      // ignore
    }

    const dotR = currentSize.dotR;

    const render = () => {
      ctx.clearRect(0, 0, miniW, miniH);

      // Draw scaled down map background
      if (art) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(art, 0, 0, miniW, miniH);
      } else {
        ctx.fillStyle = "#2d5a27";
        ctx.fillRect(0, 0, miniW, miniH);
      }

      // Draw subtle contrast overlay
      ctx.fillStyle = "rgba(0, 0, 0, 0.12)";
      ctx.fillRect(0, 0, miniW, miniH);

      // Draw points of interest with subtle border
      for (const it of map.interactables) {
        const ix = (it.rect.x + it.rect.w / 2) * (miniW / mapW);
        const iy = (it.rect.y + it.rect.h / 2) * (miniH / mapH);

        let color = "#fbbf24";
        if (it.kind === "portal") color = "#38bdf8"; // cyan portal
        else if (it.kind === "card_table") color = "#4ade80"; // green card table
        else if (it.kind === "shop" || it.kind === "farm_shop" || it.kind === "restaurant" || it.kind === "clothes_shop" || it.kind === "vehicle_shop" || it.kind === "salon") color = "#fbbf24"; // amber shop
        else if (it.kind === "fish_spot" || it.kind === "crab_hole" || it.kind === "snail_bed") color = "#60a5fa"; // blue water activity spot

        ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(ix, iy, dotR, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(ix, iy, dotR, 0, Math.PI * 2);
        ctx.fill();
      }

      // v21 world (0075): my party members on this map (their server positions), green with an outline
      for (const d of partyDotsOn(mapId)) {
        const dx = d.x * (miniW / mapW), dy = (d.y - 12) * (miniH / mapH);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(dx, dy, dotR, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = "#22c55e";
        ctx.beginPath();
        ctx.arc(dx, dy, dotR - 0.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // Draw player position
      const pos = getLocalPos();
      if (pos) {
        const px = pos.x * (miniW / mapW);
        const py = (pos.y - 12) * (miniH / mapH);

        // Radar pulsing ring
        const t = performance.now() / 1000;
        const pulse = dotR + 3 + Math.sin(t * 4) * 2.5;

        ctx.strokeStyle = "rgba(239, 68, 68, 0.85)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py, pulse, 0, Math.PI * 2);
        ctx.stroke();

        // Player dot with outline
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py, dotR + 1, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = "#ef4444"; // bright red dot
        ctx.beginPath();
        ctx.arc(px, py, dotR + 0.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(px, py, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }

      rafRef.current = requestAnimationFrame(render);
    };

    rafRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafRef.current);
  }, [map, mapId, mapW, mapH, miniW, miniH, minimized, getLocalPos, currentSize]);

  return (
    <div className="pointer-events-auto font-vt select-none">
      {onOpenMap && (
        <button type="button" className="pch-btn mb-1 ml-auto block px-2 py-0.5 text-sm" data-hotkey="cityMap" onClick={onOpenMap}
          title="Bản đồ thế giới (M)" aria-label="Mở bản đồ thế giới">🌏 Bản đồ (M)</button>
      )}
      {minimized ? (
        <button
          type="button"
          className="pch-btn flex items-center gap-1.5 px-3 py-1.5 shadow-lg text-sm font-bold bg-[#fbf6ea] border-2 border-ink"
          onClick={() => setMinimized(false)}
          title="Mở Mini Map"
          aria-label="Mở bản đồ thu nhỏ"
        >
          <span className="text-base">🗺️</span>
          <span>{MAP_NAMES[mapId] ?? "Bản đồ"}</span>
        </button>
      ) : (
        <div className="pch flex flex-col gap-1.5 p-2 shadow-2xl bg-[#fbf6ea]/95 backdrop-blur-xs border-2 border-ink rounded-md">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-ink/20 pb-1 text-sm font-bold">
            <span className="flex items-center gap-1.5 text-ink">
              <span className="text-base">🗺️</span>
              <span>{MAP_NAMES[mapId] ?? "Bản đồ"}</span>
              <span className="text-xs font-normal opacity-70">({miniW}px)</span>
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="rounded px-1.5 py-0.5 text-xs font-bold text-ink/80 hover:bg-black/10 hover:text-ink transition-colors"
                onClick={cycleSize}
                title={`Kích thước: ${currentSize.label}. Bấm để đổi (Nhỏ 200px / Chuẩn 280px / Lớn 380px)`}
                aria-label="Đổi kích thước bản đồ"
              >
                ⤢ {sizeKey.toUpperCase()}
              </button>
              <button
                type="button"
                className="rounded px-1.5 py-0.5 text-xs font-bold text-ink/80 hover:bg-black/10 hover:text-ink transition-colors"
                onClick={() => setMinimized(true)}
                title="Thu nhỏ"
                aria-label="Thu nhỏ bản đồ"
              >
                —
              </button>
            </div>
          </div>

          {/* Canvas container */}
          <div
            className="relative overflow-hidden rounded border-2 border-ink/60 bg-black/40 shadow-inner"
            style={{ width: miniW, height: miniH }}
          >
            <canvas
              ref={canvasRef}
              width={miniW}
              height={miniH}
              className="block"
              style={{ width: miniW, height: miniH }}
            />
          </div>

          {/* Legend */}
          <div className="flex items-center justify-between px-1 text-xs opacity-85 leading-none pt-0.5 font-bold">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full border border-black/50 bg-red-500" />
              <span>Bạn</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full border border-black/50 bg-sky-400" />
              <span>Cổng</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full border border-black/50 bg-green-400" />
              <span>Bàn bài</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full border border-black/50 bg-amber-400" />
              <span>Tiệm</span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
