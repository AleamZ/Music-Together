"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

// v22 (0086) small celebration effects shared by the panels: pixel confetti, a coin burst, coins flying to the purse,
// a big countdown, a number that counts up and a flash when a value changes. CSS-only animations (the keyframes live in
// one <style> each component renders once); prefers-reduced-motion shows the end state at once. Original art.

const FX_CSS = `
.fxc-piece { position: absolute; top: -8px; width: 6px; height: 8px; opacity: 0; animation: fxc-fall var(--dur) linear var(--delay) forwards; }
@keyframes fxc-fall {
  0% { transform: translate(0, 0) rotate(0deg); opacity: 1; }
  100% { transform: translate(var(--dx), 110vh) rotate(var(--rot)); opacity: 1; }
}
.fxc-coin { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); opacity: 0; animation: fxc-burst 900ms cubic-bezier(.2,.7,.3,1) var(--delay) forwards; }
@keyframes fxc-burst {
  0% { transform: translate(-50%, -50%) scale(.4); opacity: 0; }
  15% { opacity: 1; }
  70% { transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(1); opacity: 1; }
  100% { transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy) + 30px)) scale(.9); opacity: 0; }
}
.fxc-fly { position: fixed; z-index: 60; pointer-events: none; opacity: 0; animation: fxc-fly 850ms cubic-bezier(.5,0,.7,.4) var(--delay) forwards; }
@keyframes fxc-fly {
  0% { transform: translate(0, 0) scale(1.2); opacity: 1; }
  60% { opacity: 1; }
  100% { transform: translate(var(--dx), var(--dy)) scale(.6); opacity: 0; }
}
.fxc-count { animation: fxc-pop 1s ease-out both; }
@keyframes fxc-pop { 0% { transform: scale(2.2); opacity: 0; } 25% { transform: scale(1); opacity: 1; } 80% { opacity: 1; } 100% { transform: scale(.8); opacity: 0; } }
.fxc-flash { animation: fxc-flash 900ms ease-out; }
@keyframes fxc-flash { 0% { background: rgba(255, 224, 138, .95); } 100% { background: transparent; } }
.fxc-rise { animation: fxc-rise 1100ms ease-out forwards; }
@keyframes fxc-rise { 0% { transform: translateY(0); opacity: 1; } 100% { transform: translateY(-22px); opacity: 0; } }
.fxc-fill { transition: width 1.2s cubic-bezier(.2,.8,.2,1); }
.fxc-shine { background-image: linear-gradient(110deg, transparent 30%, rgba(255,255,255,.55) 45%, transparent 60%); background-size: 250% 100%; animation: fxc-shine 1.4s ease-out 1; }
@keyframes fxc-shine { 0% { background-position: 120% 0; } 100% { background-position: -40% 0; } }
@media (prefers-reduced-motion: reduce) {
  .fxc-piece, .fxc-coin, .fxc-fly, .fxc-rise { animation: none; opacity: 0; }
  .fxc-count, .fxc-flash, .fxc-shine { animation: none; }
  .fxc-fill { transition: none; }
}`;

/** The effects' keyframes, once per mounted effect (identical <style> blocks are harmless). */
export function FxStyle() {
  return <style>{FX_CSS}</style>;
}

const CONFETTI = ["#c0392b", "#e0b33c", "#3d6fd1", "#5caa4a", "#b58ae0", "#f4efe0"];

/** Pixel confetti raining over the whole screen for about 2.5 s. */
export function Confetti({ count = 60 }: { count?: number }) {
  const [pieces] = useState(() => Array.from({ length: count }, (_, i) => ({
    left: (i * 37) % 100, delay: (i % 12) * 90, dur: 1800 + ((i * 53) % 900), dx: ((i * 29) % 80) - 40,
    rot: 180 + ((i * 71) % 540), color: CONFETTI[i % CONFETTI.length],
  })));
  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden" aria-hidden="true">
      <FxStyle />
      {pieces.map((p, i) => (
        <span key={i} className="fxc-piece" style={{
          left: `${p.left}%`, background: p.color, "--delay": `${p.delay}ms`, "--dur": `${p.dur}ms`, "--dx": `${p.dx}px`, "--rot": `${p.rot}deg`,
        } as CSSProperties} />
      ))}
    </div>
  );
}

/** Coins bursting out of the middle of the parent (position: relative). */
export function CoinBurst({ count = 14 }: { count?: number }) {
  return (
    <span className="pointer-events-none absolute inset-0" aria-hidden="true">
      <FxStyle />
      {Array.from({ length: count }, (_, i) => {
        const a = (i / count) * Math.PI * 2, d = 60 + (i % 3) * 22;
        return (
          <span key={i} className="fxc-coin text-xl"
            style={{ "--dx": `${Math.round(Math.cos(a) * d)}px`, "--dy": `${Math.round(Math.sin(a) * d - 40)}px`, "--delay": `${(i % 5) * 40}ms` } as CSSProperties}>
            🪙
          </span>
        );
      })}
    </span>
  );
}

/** Coins flying from a point on screen towards the top-left purse (the player HUD), with the amount rising. */
export function CoinFly({ from, amount, onDone }: { from: { x: number; y: number }; amount: number; onDone?: () => void }) {
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });
  useEffect(() => {
    const t = setTimeout(() => done.current?.(), 1300);
    return () => clearTimeout(t);
  }, []);
  const n = Math.min(10, 3 + Math.floor(Math.log10(Math.max(1, amount)) * 2));
  return (
    <div className="pointer-events-none" aria-hidden="true">
      <FxStyle />
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className="fxc-fly text-lg" style={{
          left: from.x + ((i * 13) % 24) - 12, top: from.y + ((i * 7) % 16) - 8,
          "--dx": `${80 - from.x}px`, "--dy": `${40 - from.y}px`, "--delay": `${i * 60}ms`,
        } as CSSProperties}>🪙</span>
      ))}
      <span className="fxc-rise fixed z-60 font-vt text-2xl text-[#8e6a12] drop-shadow-[0_1px_0_#f4efe0]" style={{ left: from.x - 20, top: from.y - 30 }}>
        +{amount.toLocaleString("vi-VN")}
      </span>
    </div>
  );
}

/** Where an element sits on screen (for CoinFly's start): its centre, or the screen's middle. */
export function centreOf(el: Element | null | undefined): { x: number; y: number } {
  if (!el) return { x: typeof window === "undefined" ? 200 : window.innerWidth / 2, y: typeof window === "undefined" ? 200 : window.innerHeight / 2 };
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** A huge number (3, 2, 1) or word popping in the middle of the screen; `k` restarts the pop. */
export function BigPop({ k, children }: { k: string | number; children: ReactNode }) {
  return (
    <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center" aria-live="assertive">
      <FxStyle />
      <span key={k} className="fxc-count font-vt text-8xl text-parchment drop-shadow-[0_4px_0_#3a2418]">{children}</span>
    </div>
  );
}

/** A number counting up to `value` over `ms`. */
export function CountUp({ value, ms = 900 }: { value: number; ms?: number }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const start = performance.now();
    let raf = requestAnimationFrame(function loop(now: number) {
      const k = Math.min(1, (now - start) / ms);
      setShown(Math.round(value * (1 - (1 - k) ** 3)));
      if (k < 1) raf = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return <>{shown.toLocaleString("vi-VN")}</>;
}

/** The change of `value` since the last render that changed it (null when unchanged or first seen): drives a flash. */
export function useBump(value: number): { delta: number; at: number } | null {
  const [seen, setSeen] = useState(value);
  const [bump, setBump] = useState<{ delta: number; at: number } | null>(null);
  if (seen !== value) {
    setSeen(value);
    setBump({ delta: value - seen, at: value });
  }
  return bump && bump.at === value ? bump : null;
}

/** A progress bar that fills from empty to `pct` % when shown (and glides when it changes), with one shine sweep. */
export function FillBar({ pct, className = "h-2.5 w-32", color = "bg-emerald-600" }: { pct: number; className?: string; color?: string }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(Math.max(0, Math.min(100, pct))));
    return () => cancelAnimationFrame(raf);
  }, [pct]);
  return (
    <span className={`relative inline-block overflow-hidden rounded-sm border border-gold-300 bg-parchment ${className}`}>
      <FxStyle />
      <span className={`fxc-fill fxc-shine block h-full ${color}`} style={{ width: `${shown}%` }} />
    </span>
  );
}

/** A reward popping out of a little chest: the lid flips, coins burst, the coins (and XP) count up. Closes itself. */
export function RewardPop({ coins, xp = 0, title = "Phần thưởng!", onDone }: { coins: number; xp?: number; title?: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });
  useEffect(() => {
    const a = setTimeout(() => setOpen(true), 350);
    const b = setTimeout(() => done.current(), 2600);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, []);
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center" role="status">
      <FxStyle />
      <div className="pch relative flex flex-col items-center gap-1 px-6 py-3 font-vt leading-none shadow-lg">
        <span className="relative flex h-16 w-20 items-center justify-center">
          <svg viewBox="0 0 32 24" width={64} height={48} aria-hidden="true" style={{ imageRendering: "pixelated" }}
            className={open ? "" : "motion-safe:animate-[bounce_0.3s_ease-in-out_1]"}>
            <rect x={4} y={11} width={24} height={11} fill="#8b5a33" stroke="#3a2418" />
            <rect x={4} y={14} width={24} height={2} fill="#e0b33c" />
            {open ? <rect x={6} y={9} width={20} height={3} fill="#ffe08a" /> : <path d="M 4 11 Q 16 2 28 11 Z" fill="#a8743f" stroke="#3a2418" />}
            {open && <path d="M 4 11 L 2 2 L 26 1 L 28 11" fill="#6e4424" stroke="#3a2418" />}
          </svg>
          {open && <CoinBurst count={10} />}
        </span>
        <span className="text-2xl text-burgundy">{title}</span>
        <span className="text-2xl text-[#8e6a12]">🪙 +{open ? <CountUp value={coins} /> : 0}{xp > 0 ? <> · ✨ +{open ? <CountUp value={xp} /> : 0} XP</> : null}</span>
      </div>
    </div>
  );
}

/** A finished trade: a handshake pops up, confetti, and the coins it brought fly to the purse. Clears itself. */
export function TradeDoneFx({ coins, onDone }: { coins: number; onDone: () => void }) {
  const [from] = useState(() => centreOf(null));
  return (
    <>
      <Confetti count={30} />
      <BigPop k="trade">🤝</BigPop>
      {coins > 0 ? <CoinFly from={from} amount={coins} onDone={onDone} /> : <AutoDone ms={1500} onDone={onDone} />}
    </>
  );
}

function AutoDone({ ms, onDone }: { ms: number; onDone: () => void }) {
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });
  useEffect(() => {
    const t = setTimeout(() => done.current(), ms);
    return () => clearTimeout(t);
  }, [ms]);
  return null;
}
