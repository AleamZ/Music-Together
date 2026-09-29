"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { TickClock } from "@/lib/game/fishing/net";
import { isTyping } from "@/lib/game/keys";

// v22 crafting minigames (0084): the 60 Hz loop every round runs on, the reduced-motion switch and the dialog frame.

export function prefersReduced(): boolean {
  return typeof window !== "undefined" && (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
}

/** Steps a seeded round at 60 Hz (catching up on slow frames) until `done`; `onDone` gets the final round once. */
export function useRound<S>(init: () => S, step: (s: S) => S, done: (s: S) => boolean, onDone: (s: S) => void): S {
  const [s, setS] = useState(init);
  const fns = useRef({ init, step, done, onDone });
  useEffect(() => {
    fns.current = { init, step, done, onDone };
  });
  useEffect(() => {
    let cur = fns.current.init();
    let tick = 0;
    let over = false;
    const clock = new TickClock(performance.now());
    let raf = requestAnimationFrame(function loop(t: number) {
      const due = clock.advance(t);
      while (tick < due && !fns.current.done(cur)) {
        cur = fns.current.step(cur);
        tick++;
      }
      setS(cur);
      if (fns.current.done(cur)) {
        if (!over) {
          over = true;
          fns.current.onDone(cur);
        }
        return;
      }
      raf = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(raf);
  }, []);
  return s;
}

/** Keyboard helper: calls `down(code)` / `up(code)` for the listed codes (no repeats, not while typing). */
export function useKeys(codes: readonly string[], down: (code: string) => void, up?: (code: string) => void): void {
  const cb = useRef({ down, up });
  useEffect(() => {
    cb.current = { down, up };
  });
  const key = codes.join(",");
  useEffect(() => {
    const list = key.split(",");
    const d = (e: KeyboardEvent) => {
      if (isTyping(e.target) || !list.includes(e.code)) return;
      e.preventDefault();
      if (!e.repeat) cb.current.down(e.code);
    };
    const u = (e: KeyboardEvent) => {
      if (isTyping(e.target) || !list.includes(e.code)) return;
      cb.current.up?.(e.code);
    };
    window.addEventListener("keydown", d);
    window.addEventListener("keyup", u);
    return () => {
      window.removeEventListener("keydown", d);
      window.removeEventListener("keyup", u);
    };
  }, [key]);
}

/** The minigame dialog: title, the round while playing, then the result with a puff (good) or a crack (bad). */
export function CraftFrame({ title, phase, message, good, onClose, children, label }: {
  title: string;
  label: string;
  phase: "playing" | "sending" | "done";
  message: string | null;
  good: boolean | null;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (phase !== "done") return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "Escape" || e.key === "Enter") && !isTyping(e.target)) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, onClose]);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-3" role="dialog" aria-modal="true" aria-label={label}>
      <div className="pch flex w-[26rem] max-w-full flex-col items-center gap-2 p-3 text-center font-vt text-lg leading-tight">
        <h2 className="font-vt text-2xl leading-none text-burgundy">{title}</h2>
        {phase === "playing" && children}
        {phase === "sending" && <p role="status">Đang gửi kết quả…</p>}
        {phase === "done" && (
          <>
            <div className={`craftmg-result ${good ? "craftmg-good" : "craftmg-bad"}`} aria-hidden="true">
              {good ? <Puff /> : <Crack />}
            </div>
            <p role="status">{message}</p>
            <button type="button" className="pch-btn pch-btn-primary" onClick={onClose}>Đóng</button>
          </>
        )}
      </div>
      <style>{CRAFT_CSS}</style>
    </div>
  );
}

function Puff() {
  return (
    <svg viewBox="0 0 64 40" width="128" height="80" shapeRendering="crispEdges">
      {[[20, 22, 9], [32, 16, 11], [45, 22, 9], [26, 30, 7], [39, 30, 7]].map(([x, y, r], i) => (
        <rect key={i} className="craftmg-puff" style={{ animationDelay: `${i * 60}ms` }} x={x - r} y={y - r} width={r * 2} height={r * 2} rx={3} fill="#fff7d8" stroke="#e9c46a" />
      ))}
      {[[8, 8], [56, 10], [12, 34], [54, 34], [32, 4]].map(([x, y], i) => (
        <rect key={`s${i}`} className="craftmg-star" style={{ animationDelay: `${120 + i * 70}ms` }} x={x - 2} y={y - 2} width={4} height={4} fill="#f2c93a" />
      ))}
    </svg>
  );
}

function Crack() {
  return (
    <svg viewBox="0 0 64 40" width="128" height="80" shapeRendering="crispEdges">
      {[[22, 22, 10], [36, 18, 12], [46, 26, 8]].map(([x, y, r], i) => (
        <rect key={i} className="craftmg-puff" style={{ animationDelay: `${i * 80}ms` }} x={x - r} y={y - r} width={r * 2} height={r * 2} rx={3} fill="#8a8178" />
      ))}
      <polyline className="craftmg-crack" points="18,6 26,16 22,22 32,28 28,36" fill="none" stroke="#3a2418" strokeWidth={3} />
    </svg>
  );
}

const CRAFT_CSS = `
.craftmg-puff { transform-box: fill-box; transform-origin: center; animation: craftmg-puff 700ms ease-out both; }
.craftmg-star { animation: craftmg-star 900ms ease-out both; }
.craftmg-crack { stroke-dasharray: 60; animation: craftmg-crack 450ms steps(6) both; }
.craftmg-shake { animation: craftmg-shake 180ms steps(3) 1; }
.craftmg-bob { animation: craftmg-bob 900ms steps(3) infinite; }
@keyframes craftmg-puff { from { transform: scale(.2); opacity: 0 } 40% { opacity: 1 } to { transform: scale(1.15); opacity: .85 } }
@keyframes craftmg-star { from { opacity: 0 } 50% { opacity: 1 } to { opacity: 0 } }
@keyframes craftmg-crack { from { stroke-dashoffset: 60 } to { stroke-dashoffset: 0 } }
@keyframes craftmg-shake { 0% { transform: translate(0,0) } 33% { transform: translate(-3px,1px) } 66% { transform: translate(3px,-1px) } 100% { transform: translate(0,0) } }
@keyframes craftmg-bob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-2px) } }
@media (prefers-reduced-motion: reduce) {
  .craftmg-puff, .craftmg-star, .craftmg-crack, .craftmg-shake, .craftmg-bob { animation: none !important; }
}
`;
