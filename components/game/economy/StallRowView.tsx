"use client";

import { useEffect, useRef } from "react";
import { ECON_H, ECON_W, paintStallRow } from "@/lib/game/art/economy";

/** The stall row art (lib/game/art/economy.ts), animated unless reduced motion is asked for. */
export default function StallRowView({ rented, notes }: { rented: readonly boolean[]; notes: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const key = rented.map((r) => (r ? 1 : 0)).join("");
  useEffect(() => {
    const c = ref.current?.getContext("2d");
    if (!c) return;
    const flags = key.split("").map((k) => k === "1");
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const draw = (now: number) => {
      c.clearRect(0, 0, ECON_W, ECON_H);
      paintStallRow(c, reduced ? 0 : now, flags, notes);
      if (!reduced) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [key, notes]);
  return (
    <canvas ref={ref} width={ECON_W} height={ECON_H} data-testid="econ-art" aria-hidden="true"
      className="mx-auto w-full max-w-[520px] rounded-sm border-2 border-gold-300 [image-rendering:pixelated]" />
  );
}
