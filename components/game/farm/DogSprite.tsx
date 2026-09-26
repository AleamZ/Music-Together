"use client";

import { useEffect, useRef } from "react";
import { DOG_H, DOG_W, dogMatrix } from "@/lib/game/art/dog";
import type { DogCoat } from "@/lib/game/dog";

/** A dog of `coat`, sitting and facing down, drawn in code at `scale` px a pixel (the adoption's coat buttons). */
export default function DogSprite({ coat, scale = 3 }: { coat: DogCoat; scale?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current?.getContext("2d");
    if (!c) return;
    c.clearRect(0, 0, DOG_W, DOG_H);
    dogMatrix(coat, "down", "sit").forEach((row, y) => row.forEach((col, x) => {
      if (!col) return;
      c.fillStyle = col;
      c.fillRect(x, y, 1, 1);
    }));
  }, [coat]);
  return (
    <canvas ref={ref} width={DOG_W} height={DOG_H} aria-hidden="true" style={{ width: DOG_W * scale, height: DOG_H * scale }}
      className="[image-rendering:pixelated]" />
  );
}
