"use client";

import type { Wear } from "@/lib/game/fishing/state";

/** v18.2: a small durability bar (green → amber → red) with the count. */
export default function WearBar({ wear }: { wear: Wear }) {
  const f = wear.max > 0 ? Math.max(0, Math.min(1, wear.left / wear.max)) : 0;
  const color = f > 0.5 ? "#4caf50" : f > 0.2 ? "#e0a431" : "#c0392b";
  return (
    <span className="mt-0.5 flex items-center gap-1 text-sm opacity-90">
      <span className="relative h-1.5 w-16 overflow-hidden rounded-sm border border-ink/60 bg-parchment-300" role="meter"
        aria-valuemin={0} aria-valuemax={wear.max} aria-valuenow={wear.left} aria-label="Độ bền">
        <span className="absolute inset-y-0 left-0" style={{ width: `${f * 100}%`, background: color }} />
      </span>
      {wear.left}/{wear.max}
    </span>
  );
}
