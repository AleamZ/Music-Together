"use client";

// v22 world (0083): the combo strike on a boss or a dungeon monster — six arrows slide into the ring; press the arrow
// key as each one reaches it (±10 ticks, perfect ±3); the boss winds up a slam: press Space (Né) in time or be stunned.
// A 60 Hz sim (lib/game/realm/minigames.ts) on the chart mg_sync reveals 2 s ahead (0087); combo_finish replays the
// key ticks, which went up live. Esc gives the round up (only a round played to its end is taken).

import { useCallback, useEffect, useRef, useState } from "react";
import { drawBoss } from "@/lib/game/realm/art";
import { COMBO, DIR_ICON, DIR_KEYS, comboParamsFrom, replayComboP, type Dir, type Judge } from "@/lib/game/realm/minigames";
import { COMBO_HELP, JUDGE_TEXT } from "@/lib/game/realm/mg-copy";
import type { BossId } from "@/lib/game/realm/model";
import type { ComboRound } from "@/lib/game/realm/rpc";
import { liveTick, useLive, type LiveSync } from "@/lib/game/mglive";
import { isTyping } from "@/lib/game/keys";

export interface ComboView {
  round: ComboRound; name: string; boss: BossId | null; icon: string;
  phase: "playing" | "sending" | "done"; message: string; dmg: number | null;
  /** 0087: the round's live channel (mg_sync('world')); null in a test render. */
  live: LiveSync | null;
}

/** Pixels per tick of the arrows' slide. */
const SPEED = 2.2;
const RING_X = 48;
/** mg_sync reveals an arrow this many ticks before its beat (0087's _mg_events). */
const COMBO_AHEAD = 120;

function BossSprite({ boss, icon, hurtAt, tick, shake }: { boss: BossId | null; icon: string; hurtAt: number; tick: number; shake: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current?.getContext("2d");
    if (!c || !boss) return;
    c.clearRect(0, 0, 96, 64);
    c.imageSmoothingEnabled = false;
    drawBoss(c, boss, 40, 60, tick * 16, tick - hurtAt < 8, 1, false);
  }, [boss, tick, hurtAt]);
  return boss
    ? <canvas ref={ref} width={96} height={64} aria-hidden="true" className={`h-32 w-48 [image-rendering:pixelated] ${shake ? "translate-x-1" : ""}`} />
    : <div aria-hidden="true" className={`text-6xl ${tick - hurtAt < 8 ? "opacity-50" : ""} ${shake ? "translate-x-1" : ""}`}>{icon}</div>;
}

function Playing({ view, onEnd }: { view: ComboView; onEnd: (keys: number[], dodges: number[], ticks: number) => void }) {
  const [tick, setTick] = useState(0);
  const [keys, setKeys] = useState<number[]>([]);
  const [dodges, setDodges] = useState<number[]>([]);
  const want = useRef<{ dir: Dir | null; dodge: boolean }>({ dir: null, dodge: false });
  const st = useRef({ tick: 0, keys: [] as number[], dodges: [] as number[] });
  const over = useRef(false);
  const cb = useRef(onEnd);
  useEffect(() => {
    cb.current = onEnd;
  });
  // 0087: the chart comes from the server a little ahead (mg_sync); the keys go up as they are pressed
  const live = useLive(view.live, () => [st.current.keys, st.current.dodges]);
  const liveRef = useRef(live);
  useEffect(() => {
    liveRef.current = live;
  });
  const end = useCallback((ticks: number) => {
    if (over.current) return;
    over.current = true;
    liveRef.current.stop();
    cb.current(st.current.keys.slice(), st.current.dodges.slice(), ticks);
  }, []);
  // Esc gives the round up (a finish before the last beat is refused, so nothing is sent)
  const stop = useCallback(() => end(-1), [end]);
  useEffect(() => {
    if (live.failed) end(-1);
  }, [live.failed, end]);

  useEffect(() => {
    if (!live.ready) return;
    const t0 = live.t0;
    let raf = requestAnimationFrame(function loop(now: number) {
      const due = liveTick(t0, now);
      const s = st.current;
      const p = comboParamsFrom(liveRef.current.ev.current ?? {});
      while (s.tick < due && !over.current) {
        const t = s.tick;
        const d = want.current.dir;
        const n = s.keys.length;
        if (d !== null && n < COMBO.maxKeys && (n === 0 || Math.floor(s.keys[n - 1] / 4) < t) && (n < 2 || t - Math.floor(s.keys[n - 2] / 4) >= 60)) {
          s.keys = [...s.keys, t * 4 + d];
        }
        want.current.dir = null;
        const m = s.dodges.length;
        if (want.current.dodge && m < 3 && (m === 0 || t - s.dodges[m - 1] >= 60)) s.dodges = [...s.dodges, t];
        want.current.dodge = false;
        s.tick = t + 1;
        if (p.known === COMBO.arrows && s.tick >= p.end) {
          end(p.end);
          break;
        }
      }
      setTick(s.tick);
      setKeys(s.keys);
      setDodges(s.dodges);
      if (!over.current) raf = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(raf);
  }, [live.ready, live.t0, end]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.repeat) return;
      const i = DIR_KEYS.indexOf(e.key as (typeof DIR_KEYS)[number]);
      const wasd = ["KeyW", "KeyD", "KeyS", "KeyA"].indexOf(e.code);
      if (i >= 0 || wasd >= 0) { e.preventDefault(); want.current.dir = (i >= 0 ? i : wasd) as Dir; }
      else if (e.code === "Space" || e.code === "KeyE") { e.preventDefault(); want.current.dodge = true; }
      else if (e.key === "Escape") { e.preventDefault(); stop(); }
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [stop]);

  const p = comboParamsFrom(live.events);
  const rep = replayComboP(p, keys, dodges, tick + 1);
  const judged = (i: number): Judge | null => {
    if (rep.judges[i] !== "miss") return rep.judges[i];
    return tick > p.beats[i] + COMBO.win ? "miss" : null;
  };
  const lastHit = p.beats.reduce((acc, b, i) => (rep.judges[i] !== "miss" && b <= tick ? Math.max(acc, b) : acc), -99);
  const warn = tick >= p.slam - COMBO.warn && tick <= p.slam;
  const dodgedNow = dodges.some((d) => d >= p.slam - COMBO.dodgeWin && d <= p.slam);
  const hitByslam = tick > p.slam && tick < p.slam + 30 && !dodgedNow;
  const streak = rep.streaks.reduce((a, s, i) => (p.beats[i] <= tick && s > 0 ? s : a), 0);

  if (!live.ready) return <p role="status">Chuẩn bị…</p>;
  return (
    <>
      <div className={`relative flex h-36 w-full items-end justify-center overflow-hidden rounded border-2 border-[#3a2418] ${warn ? "bg-[#6a2a24]" : "bg-[#3a3a4a]"} ${hitByslam ? "animate-pulse" : ""}`}>
        <BossSprite boss={view.boss} icon={view.icon} hurtAt={lastHit} tick={tick} shake={tick - lastHit < 6} />
        {tick - lastHit < 20 && (
          <b className="absolute top-2 text-2xl text-[#ffe066] drop-shadow" style={{ transform: `translateY(${-(tick - lastHit)}px)` }}>
            {JUDGE_TEXT[rep.judges[p.beats.indexOf(lastHit)]]}{streak > 1 ? ` ×${streak}` : ""}
          </b>
        )}
        {warn && <b className="absolute left-2 top-2 text-lg text-[#ffd040]">💥 {dodgedNow ? "Né được!" : "Né! (Space)"}</b>}
        {hitByslam && <b className="absolute right-2 top-2 text-lg text-[#ff8080]">😵 Choáng!</b>}
      </div>
      {/* the lane: arrows slide right → left into the ring (each one shows up 2 s before its beat) */}
      <div className="relative h-14 w-full overflow-hidden rounded border-2 border-[#3a2418] bg-[#f4e6c8]" aria-hidden="true">
        <div className="absolute top-1 h-11 w-11 -translate-x-1/2 rounded-full border-4 border-[#b8322a]" style={{ left: RING_X }} />
        {p.beats.map((b, i) => {
          if (i >= p.known) return null;
          const j = judged(i);
          const x = RING_X + (b - tick) * SPEED;
          if (x < -30 || x > 700) return null;
          const fade = Math.max(0.15, Math.min(1, (COMBO_AHEAD - (b - tick)) / 20));
          return (
            <span key={i} className={`absolute top-2 -translate-x-1/2 text-3xl ${j === "miss" ? "opacity-30 grayscale" : j ? "scale-125 opacity-60" : ""}`}
              style={{ left: x, opacity: j ? undefined : fade }}>
              {DIR_ICON[p.dirs[i]]}
            </span>
          );
        })}
      </div>
      <p className="text-base opacity-80">{COMBO_HELP}</p>
      <div className="grid grid-cols-5 gap-1">
        {([3, 0, 2, 1] as const).map((d) => (
          <button key={d} type="button" className="pch-btn px-3 text-2xl" onPointerDown={() => { want.current.dir = d; }}>{DIR_ICON[d]}</button>
        ))}
        <button type="button" className="pch-btn pch-btn-primary px-3" onPointerDown={() => { want.current.dodge = true; }}>🤸 Né</button>
      </div>
      <button type="button" className="pch-btn" onClick={stop}>Bỏ (Esc)</button>
    </>
  );
}

export default function ComboGame({ view, onEnd, onClose }: {
  view: ComboView;
  onEnd: (keys: number[], dodges: number[], ticks: number) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    if (view.phase !== "done") return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "Escape" || e.code === "KeyK") && !isTyping(e.target)) { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view.phase, onClose]);
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center p-3" role="dialog" aria-modal="true" aria-label={`Đánh ${view.name}`}>
      <div className="pch flex w-[40rem] max-w-full flex-col items-center gap-2 p-3 text-center font-vt text-lg leading-tight">
        <h2 className="font-vt text-2xl leading-none text-burgundy">⚔️ {view.name}</h2>
        {view.phase === "playing" && <Playing view={view} onEnd={onEnd} />}
        {view.phase === "sending" && <p role="status">Đang tung đòn…</p>}
        {view.phase === "done" && (
          <>
            {view.dmg !== null && view.dmg > 0 && <b className="animate-bounce text-4xl text-[#d83a3a]">−{view.dmg}</b>}
            <p role="status" className="whitespace-pre-line">{view.message}</p>
            <button type="button" className="pch-btn pch-btn-primary" onClick={onClose}>Đóng</button>
          </>
        )}
      </div>
    </div>
  );
}
