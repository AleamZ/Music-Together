"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ANVIL, anvilGlow, anvilNudge, createAnvilWaiting, replayAnvilP, stepAnvil, withGlow, type AnvilRound } from "@/lib/game/craftmg/games";
import { GATE_GUARD_MS, useLive, type LiveSync } from "@/lib/game/mglive";
import { prefersReduced, useKeys, useLiveRound } from "./shared";

export const ANVIL_HELP = "Nện búa khi thanh kim loại sáng rực nhất! Bấm Space, chạm hoặc bấm chuột — 5 nhát.";

/** The glow 0 … 1000 as the metal's colour: dull red → orange → white-hot. */
function heatColour(g: number): string {
  if (g >= ANVIL.great) return "#fff3c4";
  if (g >= ANVIL.good) return "#f7b84a";
  if (g >= 400) return "#e0673a";
  return "#8a3a2a";
}

interface Spark { x: number; y: number; vx: number; vy: number; born: number }

/** The anvil (original pixel art, SVG rects) with the glowing bar, the hammer and the sparks of each strike. */
function Anvil({ s, sparks, reduced }: { s: AnvilRound; sparks: Spark[]; reduced: boolean }) {
  const g = s.period > 0 ? anvilGlow(s.period, s.phase, s.tick) : 0;
  const col = heatColour(g);
  const since = s.strikes.length > 0 ? s.tick - s.strikes[s.strikes.length - 1] : 99;
  const down = since < 6;
  return (
    <svg viewBox="0 0 64 48" width="224" height="168" shapeRendering="crispEdges" aria-hidden="true" className={down && !reduced ? "craftmg-shake" : undefined}>
      {/* glow halo */}
      {g >= ANVIL.good && <rect x={18} y={16} width={28} height={10} fill={col} opacity={0.25} />}
      {/* the bar being forged */}
      <rect x={20} y={20} width={24} height={4} fill={col} />
      <rect x={20} y={20} width={24} height={1} fill="#ffffff" opacity={g / 2000} />
      {/* anvil */}
      <rect x={14} y={24} width={36} height={5} fill="#4a4a52" />
      <rect x={8} y={24} width={6} height={3} fill="#4a4a52" />
      <rect x={22} y={29} width={20} height={6} fill="#3a3a40" />
      <rect x={16} y={35} width={32} height={5} fill="#2e2e33" />
      <rect x={14} y={40} width={36} height={3} fill="#6b4226" />
      {/* hammer */}
      <g transform={down ? "translate(0 6)" : undefined}>
        <rect x={34} y={6} width={10} height={6} fill="#5b5b63" />
        <rect x={42} y={2} width={3} height={14} fill="#8b5a2b" transform="rotate(35 43 9)" />
      </g>
      {/* sparks */}
      {!reduced && sparks.map((p, i) => {
        const age = s.tick - p.born;
        if (age > 24) return null;
        return <rect key={i} x={p.x + p.vx * age} y={p.y + p.vy * age + 0.04 * age * age} width={1.5} height={1.5} fill={age < 10 ? "#fff3c4" : "#f2a33a"} />;
      })}
    </svg>
  );
}

const MARK = ["Trượt", "Khá", "Tuyệt!"] as const;

/** 0087: the glow (period, phase) shows through mg_sync('anvil') at a secret tick; a strike waits a moment after it; the
 *  strikes go up live. */
export default function AnvilGame({ live: sync, onEnd }: { live: LiveSync | null; onEnd: (strikes: readonly number[], ticks: number, score: number) => void }) {
  const struck = useRef(false);
  const [reduced] = useState(prefersReduced);
  const [sparks, setSparks] = useState<Spark[]>([]);
  const strikes = useRef<number[]>([]);
  const live = useLive(sync, () => [strikes.current, null]);
  const liveRef = useRef(live);
  useEffect(() => {
    liveRef.current = live;
  });
  const init = useCallback(() => createAnvilWaiting(), []);
  const step = useCallback((cur: AnvilRound) => {
    const l = liveRef.current;
    const g = l.ev.current?.[1];
    const seenAt = l.at.current?.[1];
    const ready = g !== undefined && seenAt !== undefined && performance.now() - seenAt >= GATE_GUARD_MS;
    const want = struck.current && ready;
    struck.current = false;
    const next = stepAnvil(ready ? withGlow(cur, g.period, g.phase) : cur, want);
    if (next.strikes !== cur.strikes) { strikes.current = next.strikes; l.flush(); }
    if (next.strikes.length > cur.strikes.length && (next.last ?? 0) > 0) {
      const n = 6 + (next.last ?? 0) * 4;
      const born = cur.tick;
      setSparks(Array.from({ length: n }, (_, i) => {
        const a = (Math.PI * (i + 0.5)) / n;
        const v = 0.35 + ((i * 37) % 10) / 25;
        return { x: 32, y: 20, vx: -Math.cos(a) * v, vy: -Math.sin(a) * v, born };
      }));
    }
    return next;
  }, []);
  const s = useLiveRound(live, init, step, (cur) => cur.done, (cur) => {
    liveRef.current.stop();
    const ticks = cur.strikes.length >= ANVIL.strikes ? cur.strikes[ANVIL.strikes - 1] + 1 : ANVIL.maxTicks;
    onEnd(cur.strikes.slice(), ticks, cur.period > 0 ? replayAnvilP([cur.period, cur.phase], cur.strikes).score : 0);
  });
  useKeys(["Space"], () => { struck.current = true; });
  const g = s.period > 0 ? anvilGlow(s.period, s.phase, s.tick) : 0;
  if (!live.ready) return <p role="status">Chuẩn bị…</p>;
  const nudge = anvilNudge(s.score) / 10;
  return (
    <div role="group" aria-label="Đe rèn" className="flex w-full touch-none select-none flex-col items-center gap-2"
      onPointerDown={() => { struck.current = true; }}>
      <Anvil s={s} sparks={sparks} reduced={reduced} />
      <div className="relative h-3 w-full overflow-hidden rounded border-2 border-[#3a2418] bg-[#3a2418]" aria-hidden="true">
        <div className="absolute inset-y-0 left-0" style={{ width: `${g / 10}%`, background: heatColour(g) }} />
        <div className="absolute inset-y-0 w-0.5 bg-white/70" style={{ left: `${ANVIL.great / 10}%` }} />
      </div>
      <p>Nhát {s.strikes.length}/{ANVIL.strikes} · điểm {s.score}/10 · tỉ lệ {nudge >= 0 ? "+" : "−"}{Math.abs(nudge)}%
        {s.last !== null && <b className={s.last > 0 ? "text-[#2e7d32]" : "text-burgundy"}> · {MARK[s.last]}</b>}
      </p>
      <p className="text-base opacity-80">{ANVIL_HELP} (chạm vào khung đe trên điện thoại)</p>    </div>
  );
}
