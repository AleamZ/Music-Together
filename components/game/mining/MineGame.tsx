"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { craftItem } from "@/lib/game/mining/catalog";
import { canStrike, createMineRound, MINE, minePos, stepMineRound, type MineRound } from "@/lib/game/mining/game";
import type { MineDigView } from "@/hooks/useMining";
import { TickClock } from "@/lib/game/fishing/net";
import { isTyping } from "@/lib/game/keys";
import { rarityInfo } from "@/lib/game/rarity";

export const MINE_HELP = "Vạch chạy qua lại trên thanh đá. Bấm Space (hoặc chạm, bấm chuột) khi vạch nằm trong vân quặng sáng để đập trúng.";

const reducedMotion = (): boolean =>
  typeof window !== "undefined" && (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);

/** The bar: the vein (the current centre ± win) and the sweeping marker. */
function Bar({ s }: { s: MineRound }) {
  const c = s.centres[Math.min(s.hits, s.centres.length - 1)];
  const lo = Math.max(0, c - s.win) / 10, hi = Math.min(1000, c + s.win) / 10;
  const pos = minePos(s.period, s.tick) / 10;
  // v22: rock chips burst from the last strike for 14 ticks (ore-coloured on a hit, grey on a miss)
  const lastAt = s.strikes.length > 0 ? s.strikes[s.strikes.length - 1] : -99;
  const age = s.tick - lastAt;
  const chipX = minePos(s.period, lastAt) / 10;
  const shake = age < 6 && s.last === "hit";
  return (
    <div className="relative h-10 w-full overflow-hidden rounded border-2 border-[#3a2418] bg-[#6d655c]" aria-hidden="true"
      style={shake ? { transform: `translateX(${age % 2 === 0 ? -2 : 2}px)` } : undefined}>
      <div className="absolute inset-y-0 bg-[#f2c93a]/80" style={{ left: `${lo}%`, width: `${hi - lo}%` }} />
      <div className="absolute inset-y-0 w-1 -translate-x-1/2 bg-[#fff7d8] shadow-[0_0_0_1px_#3a2418]" style={{ left: `${pos}%` }} />
      {age >= 0 && age < 14 && !reducedMotion() && [0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="absolute h-1.5 w-1.5" style={{
          left: `calc(${chipX}% + ${(i - 2.5) * age * 0.9}px)`, top: `${14 - age * (1.6 - (i % 3) * 0.4) + 0.12 * age * age}px`,
          background: s.last === "hit" ? (i % 2 ? "#f2c93a" : "#fff7d8") : "#8a8178",
        }} />
      ))}
    </div>
  );
}

/** The dig: a seeded MineRound on a 60 Hz tick clock (0072 replays its strikes). Its end goes to `onEnd` once; Dừng
 *  (Esc) gives the dig up. */
function Playing({ view, onEnd }: { view: MineDigView; onEnd: (strikes: readonly number[], ticks: number, pass: boolean) => void }) {
  const { dig } = view;
  const [s, setS] = useState(() => createMineRound(dig.seed, dig.need, dig.win));
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
    let cur = createMineRound(dig.seed, dig.need, dig.win);
    const clock = new TickClock(performance.now());
    let raf = requestAnimationFrame(function loop(t: number) {
      const due = clock.advance(t);
      while (cur.tick < due && cur.outcome === "open") {
        const hit = struck.current && canStrike(cur);
        struck.current = false;
        cur = stepMineRound(cur, hit);
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
  }, [dig.seed, dig.need, dig.win]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (e.code === "Space") {
        e.preventDefault();
        if (!e.repeat) struck.current = true;
      } else if (e.key === "Escape") {
        stop();
      }
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [stop]);

  const left = dig.need + MINE.spare - s.strikes.length;
  return (
    <>
      <div role="group" aria-label="Mỏ quặng" onPointerDown={() => { struck.current = true; }}
        className="flex w-full touch-none select-none flex-col items-center gap-2 py-1">
        <Bar s={s} />
        <p>Trúng {s.hits}/{dig.need} · còn {left} nhát
          {s.last && <b className={s.last === "hit" ? "text-[#2e7d32]" : "text-burgundy"}> · {s.last === "hit" ? "Keng! Trúng vân" : "Trượt"}</b>}
        </p>
        <p className="text-base opacity-80">{MINE_HELP}</p>
      </div>
      <button type="button" className="pch-btn" onClick={stop}>Dừng (Esc)</button>
    </>
  );
}

export default function MineGame({ view, onEnd, onClose }: {
  view: MineDigView;
  onEnd: (strikes: readonly number[], ticks: number, pass: boolean) => void;
  onClose: () => void;
}) {
  const it = craftItem(view.dig.item);
  const r = rarityInfo(it?.rarity);
  useEffect(() => {
    if (view.phase !== "done") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isTyping(e.target)) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view.phase, onClose]);
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center p-3" role="dialog" aria-modal="true" aria-label="Đào quặng">
      <div className="pch flex w-96 max-w-full flex-col items-center gap-2 p-3 text-center font-vt text-lg leading-tight">
        <h2 className="font-vt text-2xl leading-none text-burgundy">
          ⛏️ {it?.name ?? view.dig.item} <span style={{ color: r.color }}>· {r.label}</span>
        </h2>
        {view.phase === "playing" && <Playing view={view} onEnd={onEnd} />}
        {view.phase === "sending" && <p role="status">Đang gom quặng…</p>}
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
