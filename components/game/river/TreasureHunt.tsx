"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChestView, DetectorView, DigView } from "@/hooks/useExplore";
import { formatXu } from "@/lib/game/fishing/catalog";
import { TickClock } from "@/lib/game/fishing/net";
import { isTyping } from "@/lib/game/keys";
import { canStrike, createMineRound, MINE, minePos, stepMineRound, type MineRound } from "@/lib/game/mining/game";
import { coinClink, shovelThud } from "@/lib/game/river/beep";
import { BAND_TEXT, signalBars } from "@/lib/game/river/treasure";
import { CoinBurst } from "@/components/game/celebrate/Fx";

// v22 (0086) the treasure hunt: the detector's HUD (signal bars, a pulsing ring, "Đào!" on the spot), the shovel dig
// (0072's dig sim: the blade sweeps, strike inside the dark soil) and the chest's reveal (the lid opens, coins pop).

export const DIG_HELP = "Nện xẻng đúng nhịp: bấm Space (hoặc chạm) khi lưỡi xẻng nằm trong vệt đất tối.";

/** The detector while it is on: bars, the band's words, Đào! (E) on the spot, Tắt. */
export function DetectorHud({ view, busy, onDig, onStop }: { view: DetectorView; busy: boolean; onDig: () => void; onStop: () => void }) {
  const bars = signalBars(view.band);
  const onSpot = view.band === 0;
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.repeat) return;
      if (onSpot && !busy && (e.key === "e" || e.key === "E")) {
        e.preventDefault();
        e.stopImmediatePropagation();
        onDig();
      }
    };
    window.addEventListener("keydown", down, true);
    return () => window.removeEventListener("keydown", down, true);
  }, [onSpot, busy, onDig]);
  return (
    <div className="pch pointer-events-auto absolute bottom-36 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-1 px-3 py-2 font-vt text-lg leading-none"
      role="status" aria-label="Máy dò kho báu">
      <div className="flex items-center gap-2">
        <span className={`relative inline-flex h-8 w-8 items-center justify-center text-2xl ${onSpot ? "motion-safe:animate-bounce" : ""}`}>
          {bars > 0 && <span className="absolute inset-0 rounded-full border-2 border-[#e0b33c] motion-safe:animate-ping" style={{ animationDuration: `${Math.max(0.3, 1.8 - bars * 0.22)}s` }} />}
          📡
        </span>
        <span className="flex items-end gap-0.5" aria-hidden="true">
          {Array.from({ length: 7 }, (_, i) => (
            <span key={i} className={`w-2 border border-[#3a2418] ${i < bars ? (bars >= 6 ? "bg-[#c0392b]" : bars >= 4 ? "bg-[#e0b33c]" : "bg-[#5caa4a]") : "bg-[#d9c28f]"}`}
              style={{ height: 6 + i * 3 }} />
          ))}
        </span>
      </div>
      <span>{view.wrongMap ? "🧭 Bản đồ này không vẽ nơi đây." : view.band === null ? "Theo tiếng bíp, tìm chỗ kêu dồn dập!" : BAND_TEXT[view.band]}</span>
      <div className="flex gap-2">
        {onSpot && <button type="button" className="pch-btn pch-btn-primary motion-safe:animate-pulse" disabled={busy} onClick={onDig}>⛏️ Đào! (E)</button>}
        <button type="button" className="pch-btn" onClick={onStop}>Tắt máy dò</button>
      </div>
    </div>
  );
}

/** The dirt bar: the dark soil band (the current centre ± win) and the shovel blade sweeping. */
function DirtBar({ s }: { s: MineRound }) {
  const c = s.centres[Math.min(s.hits, s.centres.length - 1)];
  const lo = Math.max(0, c - s.win) / 10, hi = Math.min(1000, c + s.win) / 10;
  const pos = minePos(s.period, s.tick) / 10;
  return (
    <div className="relative h-12 w-full overflow-hidden rounded border-2 border-[#3a2418] bg-[#c89a5e]" aria-hidden="true">
      <div className="absolute inset-x-0 bottom-0 h-3 bg-[#b58a52]" />
      <div className="absolute inset-y-0 bg-[#6e5230]" style={{ left: `${lo}%`, width: `${hi - lo}%` }} />
      <div className="absolute inset-y-0 -translate-x-1/2 text-2xl leading-[2.75rem]" style={{ left: `${pos}%` }}>🪏</div>
    </div>
  );
}

/** The chest being dug up: deeper with each good strike. */
function Pit({ hits, need }: { hits: number; need: number }) {
  const depth = hits / need;
  return (
    <svg viewBox="0 0 80 40" width={240} height={120} aria-hidden="true" style={{ imageRendering: "pixelated" }}>
      <rect x={0} y={0} width={80} height={40} fill="#6aa23c" />
      <rect x={0} y={14} width={80} height={26} fill="#c89a5e" />
      <ellipse cx={40} cy={22} rx={18 + depth * 6} ry={5 + depth * 4} fill="#6e5230" />
      {depth > 0.3 && <rect x={30} y={24 - depth * 6} width={20} height={Math.max(2, depth * 8)} fill="#8b5a33" stroke="#3a2418" strokeWidth={1} />}
      {depth > 0.6 && <rect x={38} y={25 - depth * 6} width={4} height={3} fill="#e0b33c" />}
      {[10, 64].map((x) => <rect key={x} x={x} y={18 - depth * 3} width={6} height={3 + depth * 3} fill="#b58a52" />)}
    </svg>
  );
}

function Digging({ view, onEnd }: { view: DigView; onEnd: (strikes: readonly number[], ticks: number, pass: boolean) => void }) {
  const [s, setS] = useState(() => createMineRound(view.seed, view.need, view.win));
  const struck = useRef(false);
  const latest = useRef(s);
  const over = useRef(false);
  const cb = useRef(onEnd);
  useEffect(() => {
    cb.current = onEnd;
  });
  const stop = useCallback(() => {
    if (over.current) return;
    over.current = true;
    cb.current(latest.current.strikes.slice(), Math.max(1, latest.current.tick), false);
  }, []);
  useEffect(() => {
    let cur = createMineRound(view.seed, view.need, view.win);
    const clock = new TickClock(performance.now());
    let raf = requestAnimationFrame(function loop(t: number) {
      const due = clock.advance(t);
      while (cur.tick < due && cur.outcome === "open") {
        const hit = struck.current && canStrike(cur);
        struck.current = false;
        const before = cur.hits;
        cur = stepMineRound(cur, hit);
        if (hit) shovelThud(cur.hits > before);
      }
      latest.current = cur;
      setS(cur);
      if (cur.outcome !== "open") {
        if (!over.current) {
          over.current = true;
          cb.current(cur.strikes.slice(), cur.tick, cur.outcome === "pass");
        }
        return;
      }
      raf = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(raf);
  }, [view.seed, view.need, view.win]);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (e.code === "Space") {
        e.preventDefault();
        if (!e.repeat) struck.current = true;
      } else if (e.key === "Escape") stop();
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [stop]);
  const left = view.need + MINE.spare - s.strikes.length;
  return (
    <>
      <div role="group" aria-label="Đào kho báu" onPointerDown={() => { struck.current = true; }}
        className={`flex w-full touch-none select-none flex-col items-center gap-2 py-1 ${s.last === "hit" ? "motion-safe:animate-[pulse_0.3s_ease-out_1]" : ""}`}>
        <Pit hits={s.hits} need={view.need} />
        <DirtBar s={s} />
        <p>Trúng {s.hits}/{view.need} · còn {left} nhát
          {s.last && <b className={s.last === "hit" ? "text-[#2e7d32]" : "text-burgundy"}> · {s.last === "hit" ? "Nhát xẻng gọn ghê!" : "Xẻng trượt nhịp rồi!"}</b>}
        </p>
        <p className="text-base opacity-80">{DIG_HELP}</p>
      </div>
      <button type="button" className="pch-btn" onClick={stop}>Dừng (Esc)</button>
    </>
  );
}

export function ShovelGame({ view, onEnd, onClose }: { view: DigView; onEnd: (strikes: readonly number[], ticks: number, pass: boolean) => void; onClose: () => void }) {
  useEffect(() => {
    if (view.phase !== "done") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isTyping(e.target)) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view.phase, onClose]);
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center p-3" role="dialog" aria-modal="true" aria-label="Đào kho báu">
      <div className="pch flex w-96 max-w-full flex-col items-center gap-2 p-3 text-center font-vt text-lg leading-tight">
        <h2 className="font-vt text-2xl leading-none text-burgundy">⛏️ Đào kho báu</h2>
        {view.phase === "starting" && <p role="status">Đang cắm xẻng…</p>}
        {view.phase === "playing" && <Digging view={view} onEnd={onEnd} />}
        {view.phase === "sending" && <p role="status">Đang bẩy nắp rương…</p>}
        {view.phase === "done" && (
          <>
            <p role="status">{view.message}</p>
            <button type="button" className="pch-btn pch-btn-primary" onClick={onClose}>Đóng</button>
          </>
        )}
      </div>
    </div>
  );
}

/** The chest: shut, it shakes; then the lid flips up with a burst of light and coins, and the loot counts up. */
export function ChestReveal({ view, onClose }: { view: ChestView; onClose: () => void }) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setOpen(true), 700);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!open) return;
    const start = performance.now();
    let raf = requestAnimationFrame(function loop(now: number) {
      const k = Math.min(1, (now - start) / 900);
      setShown(Math.round(view.loot * k));
      if (Math.floor(k * 10) !== Math.floor(Math.max(0, k - 0.02) * 10)) coinClink();
      if (k < 1) raf = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(raf);
  }, [open, view.loot]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "Escape" || e.key === "Enter") && !isTyping(e.target)) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-3" role="dialog" aria-modal="true" aria-label="Rương kho báu">
      <div className="pch relative flex w-80 max-w-full flex-col items-center gap-2 overflow-hidden p-4 text-center font-vt text-lg leading-tight">
        <div className="relative flex h-40 w-full items-center justify-center">
          {open && <span className="absolute h-32 w-32 rounded-full bg-[#ffe08a]/60 motion-safe:animate-ping" aria-hidden="true" />}
          <svg viewBox="0 0 32 28" width={128} height={112} aria-hidden="true" style={{ imageRendering: "pixelated" }}
            className={open ? "" : "motion-safe:animate-[bounce_0.35s_ease-in-out_2]"}>
            <rect x={3} y={13} width={26} height={13} fill="#8b5a33" stroke="#3a2418" />
            <rect x={3} y={17} width={26} height={2} fill="#e0b33c" />
            <rect x={14} y={15} width={4} height={5} fill="#ffe08a" stroke="#3a2418" strokeWidth={0.5} />
            {open ? (
              <>
                <rect x={5} y={11} width={22} height={3} fill="#ffe08a" />
                <path d="M 3 13 L 3 3 L 29 3 L 29 13" fill="#6e4424" stroke="#3a2418" transform="translate(0 -2) skewX(-10)" />
              </>
            ) : <path d="M 3 13 Q 16 3 29 13 Z" fill="#a8743f" stroke="#3a2418" />}
          </svg>
          {open && <CoinBurst count={view.jackpot ? 24 : 14} />}
        </div>
        <h2 className="font-vt text-3xl leading-none text-burgundy">{view.jackpot ? "💰 HŨ VÀNG!" : "Kho báu lộ ra rồi!"}</h2>
        <p className="text-2xl text-[#8e6a12]">+{formatXu(shown)}</p>
        {view.clean && !view.jackpot && <p className="text-base">Nhát xẻng gọn ghê — thưởng thêm 10%!</p>}
        <button type="button" className="pch-btn pch-btn-primary" onClick={onClose}>Nhận</button>
      </div>
    </div>
  );
}
