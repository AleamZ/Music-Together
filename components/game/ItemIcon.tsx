"use client";

import { useEffect, useRef } from "react";
import { ICON_SIZE, itemIconMatrix } from "@/lib/game/art/icons";

/** A catalog item's 16×16 pixel icon, drawn crisp at `scale`. */
export default function ItemIcon({ id, scale = 3, className }: { id: string; scale?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, ICON_SIZE, ICON_SIZE);
    itemIconMatrix(id)?.forEach((row, y) => row.forEach((col, x) => {
      if (!col) return;
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }));
  }, [id]);
  return (
    <canvas
      ref={ref}
      width={ICON_SIZE}
      height={ICON_SIZE}
      aria-hidden="true"
      className={className}
      style={{ width: ICON_SIZE * scale, height: ICON_SIZE * scale, imageRendering: "pixelated" }}
    />
  );
}
