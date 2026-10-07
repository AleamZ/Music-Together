"use client";

// 0096 Tiều phu: the chopping minigame's overlay — three beats slide in to the axe line; press Space (or tap) as each
// reaches it (±180 ms). The round stays on the server: mg_sync('chop') reveals a beat 1 s before it, a press before
// the first beat showed is not sent (the server refuses a hit claimed < 0.1 s after its beat's reveal), the presses go
// up as they are made, and chop_finish replays them. The tree shakes and chips fly on each press.
import { useCallback, useEffect, useRef, useState } from "react";
import { CHOP_TAIL, MAX_CHOP_PRESSES } from "@/lib/game/forest/games";
import { treeById } from "@/lib/game/forest/catalog";
import type { ChopRound } from "@/lib/game/forest/rpc";
import { GATE_GUARD_MS, liveTick, useLive, type LiveSync } from "@/lib/game/mglive";
import { isTyping } from "@/lib/game/keys";

export interface ChopView {
  round: ChopRound;
  phase: "playing" | "sending" | "done";
  message: string;
  live: LiveSync | null;
}

/** How far ahead (ticks) the track shows a beat. */
const AHEAD = 60;

export default function ChopGame({ view, onEnd, onClose, onAgain }: {
  view: ChopView;
  /** The round is over: the presses (ticks), or null when given up / lost. */
  onEnd: (presses: number[] | null) => void;
  onClose: () => void;
  /** 0121: the tree still stands — another round on it (Space / E). */
  onAgain?: (() => void) | null;
}) {
  const presses = useRef<number[]>([]);
  const inputs = useCallback((): [readonly number[] | null, readonly number[] | null] => [presses.current, null], []);
  const live = useLive(view.phase === "playing" ? view.live : null, inputs);
  const [tick, setTick] = useState(0);
  const [hitAt, setHitAt] = useState(-1000);
  const ended = useRef(false);
  const tree = treeById(view.round.kind);

  // the clock: the round's tick from the first sync
  useEffect(() => {
    if (view.phase !== "playing" || !live.ready) return;
    let raf = 0;
    const loop = () => {
      setTick(liveTick(live.t0, performance.now()));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [view.phase, live.ready, live.t0]);

  const beats = [1, 2, 3].map((i) => live.events[i]?.beat).filter((b): b is number => typeof b === "number");
  const end = beats.length === 3 ? beats[2] + CHOP_TAIL : null;

  const finish = useCallback((p: number[] | null) => {
    if (ended.current) return;
    ended.current = true;
    live.stop();
    onEnd(p);
  }, [live, onEnd]);

  useEffect(() => {
    if (view.phase === "playing" && end !== null && tick >= end) finish(presses.current.slice());
  }, [tick, end, view.phase, finish]);
  useEffect(() => {
    if (view.phase === "playing" && live.failed) finish(null);
  }, [live.failed, view.phase, finish]);

  const press = useCallback(() => {
    if (view.phase !== "playing" || !live.ready || presses.current.length >= MAX_CHOP_PRESSES) return;
    // nothing before the first beat showed (+ a human moment)
    const first = live.at.current?.[1];
    if (first === undefined || performance.now() - first < GATE_GUARD_MS) return;
    const t = liveTick(live.t0, performance.now());
    presses.current = [...presses.current, t];
    setHitAt(t);
    live.flush();
  }, [view.phase, live]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (e.code === "Space" || e.code === "KeyE") {
        e.preventDefault();
        if (e.repeat) return;
        if (view.phase === "done" && onAgain) onAgain();
        else press();
      }
      else if (e.code === "Escape") { e.preventDefault(); if (view.phase === "playing") finish(null); else onClose(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [press, finish, onClose, onAgain, view.phase]);

  const shake = tick - hitAt < 8;
  return (
    <div className="pointer-events-auto absolute inset-x-0 bottom-28 z-20 mx-auto w-[min(92vw,360px)] font-vt" role="dialog" aria-label="Đốn cây">
      <div className="pch p-2 text-base">
        <div className="flex items-center justify-between">
          <b>🪓 {tree?.name ?? "Cây"}</b>
          <span className="text-sm tabular-nums">{view.round.have}/{view.round.need} nhát · rìu {view.round.durability}</span>
        </div>
        <div className="relative mt-2 h-20 overflow-hidden rounded bg-[#2f4a2a]">
          {/* the tree */}
          <div className="absolute bottom-0 left-3 flex flex-col items-center" style={{ transform: shake ? `rotate(${(tick % 2 ? -1 : 1) * 3}deg)` : undefined, transformOrigin: "bottom center" }}>
            <div className="h-10 w-10 rounded-full bg-[#4f8a3a]" />
            <div className="h-9 w-3 bg-[#7a5230]" />
          </div>
          {shake && <span className="absolute bottom-6 left-10 text-sm" aria-hidden>✦ ✧</span>}
          {/* the axe line and the beats sliding in from the right */}
          <div className="absolute inset-y-0 left-[72px] w-1 bg-amber-300/90" />
          {beats.map((b, i) => {
            const dx = b - tick;
            if (dx < -20 || dx > AHEAD) return null;
            const left = 72 + (dx / AHEAD) * 260;
            return <div key={i} className="absolute top-7 h-6 w-6 -translate-x-1/2 rounded-full border-2 border-amber-200 bg-amber-600" style={{ left }} />;
          })}
          {!live.ready && <p className="absolute inset-0 grid place-items-center text-sm text-white">Đang chuẩn bị…</p>}
        </div>
        {view.phase === "playing" ? (
          <button type="button" className="pch-btn pch-btn-primary mt-2 w-full py-1 text-lg" onClick={press}>
            Chặt! <span className="pointer-coarse:hidden">(Space)</span>
          </button>
        ) : (
          <div className="mt-2">
            <p className="whitespace-pre-line text-sm">{view.phase === "sending" ? "Đang tính…" : view.message}</p>
            {view.phase === "done" && (
              <div className="mt-1 flex gap-1">
                {onAgain && (
                  <button type="button" className="pch-btn pch-btn-primary flex-1" onClick={onAgain}>
                    🪓 Chặt tiếp <span className="pointer-coarse:hidden">(Space)</span>
                  </button>
                )}
                <button type="button" className="pch-btn flex-1" onClick={onClose}>Đóng</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
