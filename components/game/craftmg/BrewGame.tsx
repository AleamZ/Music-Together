"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BREW, brewQuality, createBrewFrom, QUALITY_NAME, replayBrewP, stepBrew, withDrift, type BrewRound } from "@/lib/game/craftmg/games";
import { useLive, waitEvents, type LiveSync } from "@/lib/game/mglive";
import { prefersReduced, useKeys, useLiveRound } from "./shared";

export const BREW_HELP = "Giữ Space (hoặc giữ nút Quạt lửa) để thổi lửa, thả ra cho nguội — giữ vạch nhiệt trong dải xanh.";

/** The liquid's colour by how far the heat is from the band: cold blue → green in the band → orange → red. */
function liquid(heat: number, centre: number): string {
  const d = heat - centre;
  if (Math.abs(d) <= BREW.half) return Math.abs(d) <= BREW.half / 2 ? "#3fbf6a" : "#7fcf4a";
  if (d < 0) return d < -BREW.half * 2 ? "#3a6fd6" : "#4aa3c8";
  return d > BREW.half * 2 ? "#d64a3a" : "#e0913a";
}

/** The cauldron (original pixel art, SVG rects): the fire grows with the fan, bubbles rise faster when hot. */
function Cauldron({ s, reduced }: { s: BrewRound; reduced: boolean }) {
  const col = liquid(s.heat, s.centre);
  const flames = s.fan ? 5 : 3;
  const hot = Math.max(0, Math.min(1, s.heat / 1000));
  const bubbles = reduced ? [] : [0, 1, 2, 3, 4].map((i) => {
    const speed = 1 + Math.floor(hot * 3);
    const y = 34 - ((s.tick * speed + i * 13) % 22);
    return { x: 22 + ((i * 11) % 22), y, r: 1 + (i % 2) };
  });
  // the three ingredients go in at 0, 200 and 400 ticks: a splash for 20 ticks
  const splash = !reduced && s.tick % 200 < 20;
  return (
    <svg viewBox="0 0 64 64" width="192" height="192" shapeRendering="crispEdges" aria-hidden="true">
      {/* steam */}
      {!reduced && [0, 1, 2].map((i) => (
        <rect key={`st${i}`} x={24 + i * 7} y={6 + ((s.tick / 3 + i * 5) % 12)} width={3} height={3} fill="#e8e2d6" opacity={0.25 + hot * 0.5} />
      ))}
      {/* pot rim + body */}
      <rect x={12} y={20} width={40} height={4} fill="#2b2622" />
      <rect x={14} y={24} width={36} height={22} fill="#3b342e" />
      <rect x={16} y={46} width={32} height={4} fill="#2b2622" />
      <rect x={10} y={22} width={4} height={6} fill="#2b2622" />
      <rect x={50} y={22} width={4} height={6} fill="#2b2622" />
      {/* the brew */}
      <rect x={15} y={24} width={34} height={8} fill={col} />
      <rect x={15} y={24} width={34} height={2} fill="#ffffff" opacity={0.25} />
      {bubbles.filter((b) => b.y < 32 && b.y > 18).map((b, i) => (
        <rect key={i} x={b.x} y={b.y} width={b.r * 2} height={b.r * 2} fill={col} stroke="#ffffff" strokeOpacity={0.5} strokeWidth={0.5} />
      ))}
      {splash && <rect x={29} y={16} width={6} height={4} fill="#fff7d8" />}
      {/* legs + logs */}
      <rect x={16} y={50} width={4} height={4} fill="#2b2622" />
      <rect x={44} y={50} width={4} height={4} fill="#2b2622" />
      <rect x={14} y={58} width={36} height={4} fill="#6b4226" />
      {/* fire */}
      {Array.from({ length: flames }, (_, i) => {
        const h = 4 + ((s.tick + i * 7) % (s.fan ? 6 : 3));
        return (
          <g key={`f${i}`}>
            <rect x={19 + i * (26 / flames)} y={58 - h} width={4} height={h} fill="#e0513a" />
            <rect x={20 + i * (26 / flames)} y={59 - h / 2} width={2} height={h / 2} fill="#f2c93a" />
          </g>
        );
      })}
    </svg>
  );
}

/** The heat meter: the green band and the needle. */
function Meter({ s }: { s: BrewRound }) {
  const lo = Math.max(0, s.centre - BREW.half) / 10, hi = Math.min(1000, s.centre + BREW.half) / 10;
  return (
    <div className="relative h-5 w-full overflow-hidden rounded border-2 border-[#3a2418] bg-gradient-to-r from-[#3a6fd6] via-[#e8e2d6] to-[#d64a3a]" aria-hidden="true">
      <div className="absolute inset-y-0 bg-[#3fbf6a]/85" style={{ left: `${lo}%`, width: `${hi - lo}%` }} />
      <div className="absolute inset-y-0 w-1 -translate-x-1/2 bg-[#2b2622]" style={{ left: `${s.heat / 10}%` }} />
    </div>
  );
}

/** 0087: the band's centre comes with the start; the drift through mg_sync('brew') 1 s ahead; the fan's toggles go up
 *  live. The score sent is the replay on the whole revealed round. */
export default function BrewGame({ centre, live: sync, onEnd }: {
  centre: number; live: LiveSync | null; onEnd: (toggles: readonly number[], score: number) => void;
}) {
  const holding = useRef(false);
  const [reduced] = useState(prefersReduced);
  const toggles = useRef<number[]>([]);
  const live = useLive(sync, () => [toggles.current, null]);
  const liveRef = useRef(live);
  useEffect(() => {
    liveRef.current = live;
  });
  const init = useCallback(() => createBrewFrom(centre), [centre]);
  const step = useCallback((cur: BrewRound) => {
    const next = stepBrew(withDrift(cur, liveRef.current.ev.current ?? {}), holding.current);
    if (next.toggles !== cur.toggles) toggles.current = next.toggles;
    return next;
  }, []);
  const s = useLiveRound(live, init, step, (cur) => cur.done, (cur) => {
    void (async () => {
      const l = liveRef.current;
      await waitEvents(l, BREW.ticks / BREW.seg);
      l.stop();
      const drift = withDrift(cur, l.ev.current ?? {}).drift;
      onEnd(cur.toggles.slice(), replayBrewP([cur.centre, ...drift], cur.toggles));
    })();
  });
  useKeys(["Space"], () => { holding.current = true; }, () => { holding.current = false; });
  if (!live.ready) return <p role="status">Chuẩn bị…</p>;
  const q = brewQuality(s.score);
  const left = Math.ceil((BREW.ticks - s.tick) / 60);
  return (
    <div className="flex w-full select-none flex-col items-center gap-2">
      <Cauldron s={s} reduced={reduced} />
      <Meter s={s} />
      <p>Trong dải: {Math.round((s.score / BREW.ticks) * 100)}% · đang ra: <b>{QUALITY_NAME[q]}</b> · còn {left}s</p>
      <button type="button" className={`pch-btn w-full touch-none ${s.fan ? "pch-btn-primary" : ""}`}
        onPointerDown={(e) => { e.preventDefault(); holding.current = true; }}
        onPointerUp={() => { holding.current = false; }} onPointerLeave={() => { holding.current = false; }}
        onPointerCancel={() => { holding.current = false; }}>
        🔥 Quạt lửa (giữ Space)
      </button>
      <p className="text-base opacity-80">{BREW_HELP}</p>
    </div>
  );
}
