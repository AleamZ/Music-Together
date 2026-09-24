"use client";

import { useEffect, useRef } from "react";
import { getCharacterFrames, getPortrait } from "@/lib/game/art/raster";
import type { Facing, Look } from "@/lib/game/types";

const TURN: Facing[] = ["down", "left", "up", "right"];

/** A look on a small pixel canvas: a static head portrait, or a walking preview that turns every 1.2 s. */
export default function SpritePreview({ look, mode = "portrait", scale = 2, className = "" }: {
  look: Look;
  mode?: "portrait" | "walk";
  scale?: number;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const w = 24 * scale;
  const h = (mode === "portrait" ? 24 : 48) * scale;

  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    ctx.imageSmoothingEnabled = false;
    if (mode === "portrait") {
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.drawImage(getPortrait(look), 0, 0, cv.width, cv.height);
      return;
    }
    const frames = getCharacterFrames(look);
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now();
    let raf = 0;
    const draw = (t: number) => {
      const sec = (t - start) / 1000;
      const facing = TURN[Math.floor(sec / 1.2) % TURN.length];
      const frame = still ? 0 : ((Math.floor(sec * 8) % 4) as 0 | 1 | 2 | 3);
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.drawImage(frames[facing][frame], 0, 0, cv.width, cv.height);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [look, mode]);

  return (
    <canvas
      ref={ref}
      width={w}
      height={h}
      className={className}
      style={{ width: w, height: h, imageRendering: "pixelated" }}
      aria-hidden="true"
    />
  );
}
