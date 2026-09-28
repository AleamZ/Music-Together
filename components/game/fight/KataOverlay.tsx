"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MartialStyle } from "@/lib/game/fight/dojo";
import { KATA_GOOD, KATA_LANES, LANE_LABELS, judge, type KataChart, type KataJudgement } from "@/lib/game/fight/kata";
import { specialPoseIds, stancePoseIds } from "@/lib/game/fight/render/poses";
import RigPreview from "./RigPreview";

/** The keys of the eight lanes: ← → ↑ ↓ (or A D W S) and U I J K. */
const LANE_KEYS: Readonly<Record<string, number>> = {
  ArrowLeft: 0, KeyA: 0, ArrowRight: 1, KeyD: 1, ArrowUp: 2, KeyW: 2, ArrowDown: 3, KeyS: 3,
  KeyU: 4, KeyI: 5, KeyJ: 6, KeyK: 7,
};
/** How far ahead notes show (ticks). */
const AHEAD = 120;
const JUDGE_TEXT: Record<KataJudgement, string> = { perfect: "Hoàn hảo!", good: "Tốt", miss: "Trượt" };

/** v20.2 Bài quyền (spec §v20.2 "Kata minigame"): eight lanes on the left, the master performing the form on the right,
 *  Hoàn hảo / Tốt / Trượt, a score meter with the pass line. The presses go to the server, which scores them; the
 *  judgements here are only feedback. */
export default function KataOverlay({ style, chart, passPct, onDone }: {
  style: MartialStyle;
  chart: KataChart;
  passPct: number;
  onDone: (presses: number[]) => void;
}) {
  const [tick, setTick] = useState(0);
  const [flash, setFlash] = useState<{ text: KataJudgement; at: number } | null>(null);
  const [points, setPoints] = useState(0);
  /** What the render shows (the refs below are the loop's and the handlers' own copy). */
  const [marks, setMarks] = useState<{ judged: ReadonlySet<number>; missed: ReadonlySet<number> }>({ judged: new Set(), missed: new Set() });
  const presses = useRef<number[]>([]);
  const judged = useRef(new Set<number>());
  const missed = useRef(new Set<number>());
  const t0 = useRef<number | null>(null);
  const tickRef = useRef(0);
  const done = useRef(false);
  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);

  // the master's moves: the stance, then every special's keyframes, one per note hit
  const moves = useMemo(() => [...stancePoseIds(style.id), ...[1, 2, 3, 4, 5].flatMap((s) => specialPoseIds(style.id, s))], [style.id]);

  useEffect(() => {
    const raf: (cb: FrameRequestCallback) => number = typeof window.requestAnimationFrame === "function"
      ? (cb) => window.requestAnimationFrame(cb)
      : (cb) => window.setTimeout(() => cb(performance.now()), 16);
    let id = 0;
    const loop = (now: number) => {
      if (t0.current === null) t0.current = now;
      const t = Math.floor(((now - t0.current) * 60) / 1000);
      tickRef.current = t;
      setTick(t);
      // notes gone past their window unjudged are misses
      chart.notes.forEach(([nt], i) => {
        if (!judged.current.has(i) && !missed.current.has(i) && t > nt + KATA_GOOD) {
          missed.current.add(i);
          setMarks({ judged: new Set(judged.current), missed: new Set(missed.current) });
          setFlash({ text: "miss", at: t });
        }
      });
      if (t > chart.length) {
        if (!done.current) {
          done.current = true;
          onDoneRef.current(presses.current.slice());
        }
        return;
      }
      id = raf(loop);
    };
    id = raf(loop);
    return () => (typeof window.cancelAnimationFrame === "function" ? window.cancelAnimationFrame(id) : window.clearTimeout(id));
  }, [chart]);

  const press = (lane: number) => {
    const t = tickRef.current;
    const p = presses.current;
    const n = p.length / 2;
    if (done.current || t > chart.length || n >= 3 * chart.notes.length) return;
    if (n >= 2 && p[p.length - 2] === t && p[p.length - 4] === t) return;
    p.push(t, lane);
    // live feedback (kata.ts's rule: the nearest unjudged note of the lane within 9 ticks)
    let best = -1, bestD = KATA_GOOD + 1;
    chart.notes.forEach(([nt, nl], i) => {
      if (nl !== lane || judged.current.has(i)) return;
      const d = Math.abs(nt - t);
      if (d < bestD) { best = i; bestD = d; }
    });
    if (best < 0) {
      setPoints((x) => x - 1);
      setFlash({ text: "miss", at: t });
      return;
    }
    judged.current.add(best);
    setMarks({ judged: new Set(judged.current), missed: new Set(missed.current) });
    const j = judge(bestD);
    setPoints((x) => x + (j === "perfect" ? 2 : 1));
    setFlash({ text: j, at: t });
  };
  const pressRef = useRef(press);
  useEffect(() => { pressRef.current = press; });

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const lane = LANE_KEYS[e.code];
      if (lane === undefined) return;
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) pressRef.current(lane);
    };
    window.addEventListener("keydown", down, true);
    return () => window.removeEventListener("keydown", down, true);
  }, []);

  const max = 2 * chart.notes.length;
  const shown = Math.max(0, points);
  const hits = marks.judged.size;
  const lead = chart.notes.length > 0 ? chart.notes[0][0] - tick : 0;
  return (
    <div className="game-ui fixed inset-0 z-50 flex items-center justify-center bg-[#1a120c]/95 p-2 text-ink" role="dialog" aria-modal="true" aria-label={`Bài quyền ${style.kata}`}>
      <div className="pch flex w-full max-w-2xl flex-col gap-2 p-3 font-vt text-lg sm:flex-row">
        <div className="flex flex-1 flex-col gap-1">
          <h2 className="text-2xl leading-none text-burgundy">🥋 {style.kata}</h2>
          <div className="relative h-72 overflow-hidden rounded-sm border-2 border-ink/40 bg-[#2a1d14]" data-testid="kata-lanes">
            {Array.from({ length: KATA_LANES }, (_, lane) => (
              <div key={lane} className="absolute inset-y-0 border-r border-white/10" style={{ left: `${(lane * 100) / KATA_LANES}%`, width: `${100 / KATA_LANES}%` }} />
            ))}
            <div className="absolute inset-x-0 bottom-8 h-1 bg-gold" aria-hidden />
            {chart.notes.map(([nt, lane], i) => {
              const dt = nt - tick;
              if (dt > AHEAD || marks.judged.has(i) || dt < -KATA_GOOD - 6) return null;
              return (
                <span
                  key={i}
                  className={`absolute flex h-6 items-center justify-center rounded-sm border border-ink text-sm ${marks.missed.has(i) ? "bg-ink/40" : "bg-burgundy text-white"}`}
                  style={{ left: `calc(${(lane * 100) / KATA_LANES}% + 2px)`, width: `calc(${100 / KATA_LANES}% - 4px)`, bottom: `calc(2rem + ${(dt / AHEAD) * 85}%)` }}
                >
                  {LANE_LABELS[lane]}
                </span>
              );
            })}
            {lead > 0 && (
              <div className="absolute inset-0 flex items-center justify-center text-5xl text-white" role="status">{Math.ceil(lead / 60)}</div>
            )}
            {flash && tick - flash.at < 30 && (
              <div className={`absolute inset-x-0 top-6 text-center text-3xl ${flash.text === "miss" ? "text-red-300" : "text-[#ffd24a]"}`} role="status">
                {JUDGE_TEXT[flash.text]}
              </div>
            )}
          </div>
          <div className="grid grid-cols-8 gap-1" aria-label="Phím bài quyền">
            {LANE_LABELS.map((l, lane) => (
              <button key={l} type="button" className="pch-btn touch-none select-none px-0 py-2 text-xl" onPointerDown={(e) => { e.preventDefault(); press(lane); }}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col items-center gap-2 sm:w-48">
          <RigPreview look={style.masterLook} style={style.id} rank={4} poses={moves} scale={3} step={hits} label={`${style.master} biểu diễn`} />
          <p className="text-center text-base">{style.master} biểu diễn — đánh theo nhịp!</p>
          <div className="relative h-4 w-full rounded-sm border border-ink bg-parchment-200" aria-label="Điểm bài quyền" role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={shown}>
            <div className="h-full bg-burgundy" style={{ width: `${Math.min(100, (shown * 100) / Math.max(1, max))}%` }} />
            <div className="absolute inset-y-[-3px] w-0.5 bg-ink" style={{ left: `${passPct}%` }} title={`Đạt: ${passPct}%`} />
          </div>
          <p className="text-base">{Math.trunc((shown * 100) / Math.max(1, max))}% · cần {passPct}%</p>
          <p className="text-sm opacity-70">← → ↑ ↓ · U I J K</p>
        </div>
      </div>
    </div>
  );
}
