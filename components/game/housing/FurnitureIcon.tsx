"use client";

import { useEffect, useRef } from "react";
import { drawItemIcon } from "@/lib/game/art/furniture";
import { APT_TILE } from "@/lib/game/housing/apartment";

/** A catalogue item drawn by the game's art on a small pixel canvas (`tiles` × 16 px, shown at `scale`). */
export default function FurnitureIcon({ item, tiles = 3, scale = 1.5, className = "" }: { item: string; tiles?: number; scale?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const size = tiles * APT_TILE;
  useEffect(() => {
    const c = ref.current?.getContext("2d");
    if (!c) return;
    c.clearRect(0, 0, size, size);
    c.imageSmoothingEnabled = false;
    drawItemIcon(c, item, tiles);
  }, [item, tiles, size]);
  return (
    <canvas ref={ref} width={size} height={size} aria-hidden="true" className={`shrink-0 rounded-sm bg-[#e8dcc0] ${className}`}
      style={{ width: size * scale, height: size * scale, imageRendering: "pixelated" }} />
  );
}
