"use client";

import { useCallback, useRef, useState } from "react";
import { createSort, SORT, SORT_TICKS, sortArrive, sortBonus, sortItemAt, stepSort, type SortRound } from "@/lib/game/craftmg/games";
import { prefersReduced, useKeys, useRound } from "./shared";

export const SORT_HELP = "Chọn đúng ngăn cho từng hạt! ← hạt tốt, → sạn/hạt lép (hoặc chạm nút).";

/** One grain: a golden rice grain (good) or a grey pebble (bad), original pixel art. */
function Grain({ bad, x, y }: { bad: boolean; x: number; y: number }) {
  return bad ? (
    <g>
      <rect x={x - 3} y={y - 2} width={6} height={4} fill="#7d766e" />
      <rect x={x - 2} y={y - 3} width={4} height={1} fill="#a39b90" />
      <rect x={x - 1} y={y} width={2} height={1} fill="#4f4a44" />
    </g>
  ) : (
    <g>
      <rect x={x - 2} y={y - 3} width={4} height={6} fill="#e9c46a" />
      <rect x={x - 1} y={y - 3} width={1} height={5} fill="#fff1b8" />
    </g>
  );
}

/** The processor's chute and the two baskets; decided grains fly to their basket. */
function Chute({ s, reduced }: { s: SortRound; reduced: boolean }) {
  const cur = sortItemAt(s.tick);
  return (
    <svg viewBox="0 0 64 48" width="224" height="168" shapeRendering="crispEdges" aria-hidden="true">
      {/* the machine's hopper */}
      <rect x={24} y={0} width={16} height={6} fill="#6b6f78" />
      <rect x={28} y={6} width={8} height={4} fill="#4d5058" />
      {/* baskets */}
      <rect x={2} y={36} width={18} height={10} fill="#a8703a" />
      <rect x={2} y={36} width={18} height={2} fill="#c98f4f" />
      <rect x={44} y={36} width={18} height={10} fill="#6f5a48" />
      <rect x={44} y={36} width={18} height={2} fill="#8b7560" />
      {/* the grains in flight to a basket after a decision */}
      {!reduced && s.decided.map((d, i) => {
        if (d === null) return null;
        const k = s.ticks.findIndex((t) => sortItemAt(t) === i);
        const age = k < 0 ? -1 : s.tick - s.ticks[k];
        if (age < 0 || age >= 16) return null;
        const dir = s.dirs[k];
        const x = 32 + (dir === 0 ? -1 : 1) * age * 1.4;
        return <Grain key={i} bad={s.kinds[i] === 1} x={x} y={12 + age * 1.5} />;
      })}
      {/* the grain in reach, falling */}
      {cur >= 0 && s.decided[cur] === null && (
        <Grain bad={s.kinds[cur] === 1} x={32} y={10 + ((s.tick - sortArrive(cur)) * 22) / SORT.window} />
      )}
      {/* the next one waiting in the hopper */}
      {cur < SORT.items - 1 && <rect x={31} y={2} width={2} height={2} fill="#e9c46a" opacity={0.6} />}
    </svg>
  );
}

export default function SortGame({ seed, onEnd }: { seed: number; onEnd: (ticks: readonly number[], dirs: readonly number[], score: number) => void }) {
  const pressed = useRef<0 | 1 | null>(null);
  const [reduced] = useState(prefersReduced);
  const init = useCallback(() => createSort(seed), [seed]);
  const step = useCallback((cur: SortRound) => {
    const d = pressed.current;
    pressed.current = null;
    return stepSort(cur, d);
  }, []);
  const s = useRound(init, step, (cur) => cur.done, (cur) => onEnd(cur.ticks.slice(), cur.dirs.slice(), cur.score));
  useKeys(["ArrowLeft", "ArrowRight", "KeyA", "KeyD"], (code) => { pressed.current = code === "ArrowLeft" || code === "KeyA" ? 0 : 1; });
  const done = s.decided.filter((d) => d !== null).length;
  const left = Math.ceil((SORT_TICKS - s.tick) / 60);
  return (
    <div className="flex w-full select-none flex-col items-center gap-2">
      <Chute s={s} reduced={reduced} />
      <div className="flex gap-1" aria-hidden="true">
        {s.decided.map((d, i) => (
          <span key={i} className={`inline-block h-3 w-3 border border-[#3a2418] ${d === null ? "bg-transparent" : d ? "bg-[#3fbf6a]" : "bg-[#b23a3a]"}`} />
        ))}
      </div>
      <p>Đúng {s.score}/{SORT.items} (đã chọn {done}) · thưởng +{sortBonus(s.score)}% · còn {left}s</p>
      <div className="flex w-full gap-2">
        <button type="button" className="pch-btn flex-1 touch-none" onPointerDown={(e) => { e.preventDefault(); pressed.current = 0; }}>← Hạt tốt</button>
        <button type="button" className="pch-btn flex-1 touch-none" onPointerDown={(e) => { e.preventDefault(); pressed.current = 1; }}>Sạn / lép →</button>
      </div>
      <p className="text-base opacity-80">{SORT_HELP}</p>
    </div>
  );
}
