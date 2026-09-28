"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { stepWithBots } from "@/lib/game/fight/bot";
import {
  BOT_DUMMY, G_PHASE, G_RESULT, PH_OVER, RESULT_DRAW, createMatch, fighterParams, makeParams, roundResults, type State,
} from "@/lib/game/fight/engine";
import { BUTTONS, KEY_BITS, maskFromKeys, padDirAt, padMask, type PadDir } from "@/lib/game/fight/input";
import { EffectTracker } from "@/lib/game/fight/render/fx";
import { ARENA_H, ARENA_W, TrailTracker, hudText, type HudText } from "@/lib/game/fight/render/hud";
import { paintScene } from "@/lib/game/fight/render/scene";
import { DEFAULT_LOOK } from "@/lib/game/look";
import type { Look } from "@/lib/game/types";
import PracticeSetup, { DEFAULT_PRACTICE, KeyLegend, type PracticeOptions } from "./PracticeSetup";

/** The practice bot's look (a sparring partner from the street). */
const SPARRING_LOOK: Look = { ...DEFAULT_LOOK, skin: "tan", hair: "buzz", hairColor: "darkbrown" };
const STEP_MS = 1000 / 60;

function fitScale(): number {
  if (typeof window === "undefined") return 2;
  const w = Math.floor((window.innerWidth - 16) / ARENA_W);
  const h = Math.floor((window.innerHeight - 190) / ARENA_H);
  return Math.max(1, Math.min(4, w, h));
}

function prefersReduced(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

interface Match {
  seed: number;
  opts: PracticeOptions;
}

interface Outcome {
  result: number;
  rounds: { reason: number; winner: number }[];
}

/** v20.1 practice: the fight overlay over the game canvas (spec §v20.1). World input is suspended while it is open
 *  (GameShell counts it as a panel) and the room's music plays on. Practice is client-only and pays nothing. */
export default function FightOverlay({ look, name, onClose }: { look: Look; name: string; onClose: () => void }) {
  const [opts, setOpts] = useState<PracticeOptions>(DEFAULT_PRACTICE);
  const [match, setMatch] = useState<Match | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [confirmExit, setConfirmExit] = useState(false);

  const start = useCallback(() => {
    setOutcome(null);
    setConfirmExit(false);
    setMatch({ seed: (Date.now() & 0x7fffffff) | 1, opts });
  }, [opts]);

  const askExit = useCallback(() => {
    if (outcome) onClose();
    else setConfirmExit(true);
  }, [outcome, onClose]);

  if (!match) {
    return <PracticeSetup value={opts} onChange={setOpts} onStart={start} onClose={onClose} />;
  }
  const foe = match.opts.dummy ? "Bao cát" : `Bạn tập cấp ${match.opts.level}`;
  return (
    <div className="game-ui fixed inset-0 z-50 flex flex-col items-center justify-center gap-2 bg-[#120c14]/95 p-2 text-ink" role="dialog" aria-modal="true" aria-label="Sàn luyện tập">
      <Arena
        key={match.seed}
        match={match}
        look={look}
        me={name}
        foe={foe}
        paused={confirmExit || outcome !== null}
        onEsc={askExit}
        onOver={setOutcome}
      />
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button type="button" className="pch-btn" onClick={askExit}>✕ Thoát (Esc)</button>
        <details className="pch hidden px-2 py-1 pointer-fine:block">
          <summary className="cursor-pointer font-vt text-lg">⌨️ Phím</summary>
          <KeyLegend className="mt-1" />
        </details>
      </div>
      {confirmExit && !outcome && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50" role="alertdialog" aria-label="Thoát luyện tập?">
          <div className="pch flex flex-col gap-2 p-3 font-vt text-xl">
            <p>Thoát luyện tập?</p>
            <div className="flex justify-end gap-2">
              <button type="button" className="pch-btn" onClick={() => setConfirmExit(false)}>Tập tiếp</button>
              <button type="button" className="pch-btn pch-btn-primary" onClick={onClose}>Thoát</button>
            </div>
          </div>
        </div>
      )}
      {outcome && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40" role="alertdialog" aria-label="Kết quả">
          <div className="pch flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-2 p-3 font-vt text-xl" data-testid="fight-result">
            <p className="text-3xl text-burgundy">
              {outcome.result === 1 ? "🏆 Bạn thắng!" : outcome.result === RESULT_DRAW ? "🤝 Hòa!" : "😵 Bạn thua"}
            </p>
            <p className="text-lg">
              Các hiệp: {outcome.rounds.map((r) => (r.winner === 1 ? "thắng" : r.winner === 2 ? "thua" : "hòa")).join(" · ") || "—"}
            </p>
            <p className="text-base opacity-80">Luyện tập: không tốn xu, không mất đói khát, không có thưởng.</p>
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className="pch-btn" onClick={() => { setOutcome(null); setMatch(null); }}>Đổi tùy chọn</button>
              <button type="button" className="pch-btn" onClick={onClose}>Rời bao cát</button>
              <button type="button" className="pch-btn pch-btn-primary" onClick={start}>Đấu lại</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Arena({ match, look, me, foe, paused, onEsc, onOver }: {
  match: Match;
  look: Look;
  me: string;
  foe: string;
  paused: boolean;
  onEsc: () => void;
  onOver: (o: Outcome) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const keys = useRef(new Set<string>());
  const pad = useRef<PadDir | null>(null);
  const held = useRef(0);
  const pausedRef = useRef(paused);
  const onEscRef = useRef(onEsc);
  const onOverRef = useRef(onOver);
  const [scale, setScale] = useState(fitScale);
  const [hud, setHud] = useState<HudText>({ banner: null, sub: null, combo: [null, null] });
  const [padShown, setPadShown] = useState<PadDir | null>(null);

  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { onEscRef.current = onEsc; }, [onEsc]);
  useEffect(() => { onOverRef.current = onOver; }, [onOver]);

  useEffect(() => {
    const onResize = () => setScale(fitScale());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // the keyboard: the fight's keys never reach the world or the HUD hotkeys
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onEscRef.current();
        return;
      }
      if (KEY_BITS[e.code] === undefined) return;
      e.preventDefault();
      e.stopPropagation();
      keys.current.add(e.code);
    };
    const up = (e: KeyboardEvent) => {
      if (KEY_BITS[e.code] === undefined) return;
      e.preventDefault();
      e.stopPropagation();
      keys.current.delete(e.code);
    };
    const blur = () => keys.current.clear();
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("blur", blur);
    };
  }, []);

  // the fixed 60 Hz sim and the render loop
  useEffect(() => {
    const { opts, seed } = match;
    const p2 = fighterParams(0, 0, { bot: opts.dummy ? BOT_DUMMY : opts.level });
    let s: State = createMatch(makeParams(fighterParams(0, 0), p2, { seed, rounds: opts.rounds }));
    const fx = new EffectTracker();
    const trail = new TrailTracker();
    const reduced = prefersReduced();
    const view = {
      arena: "practice" as const,
      fighters: [{ look, style: 0, rank: 0 }, { look: SPARRING_LOOK, style: 0, rank: 0 }] as const,
      fx, trail, reduced, boxes: opts.boxes,
    };
    const raf: (cb: FrameRequestCallback) => number = typeof window.requestAnimationFrame === "function"
      ? (cb) => window.requestAnimationFrame(cb)
      : (cb) => window.setTimeout(() => cb(performance.now()), 16);
    const cancel = (id: number) => (typeof window.cancelAnimationFrame === "function" ? window.cancelAnimationFrame(id) : window.clearTimeout(id));
    let acc = 0, last = performance.now(), id = 0, hudKey = "", overSent = false, overAt = -1;
    const tick = (now: number) => {
      acc = Math.min(acc + (now - last), STEP_MS * 5);
      last = now;
      const mask = maskFromKeys(keys.current) | padMask(pad.current) | held.current;
      while (acc >= STEP_MS) {
        acc -= STEP_MS;
        if (pausedRef.current || s[G_PHASE] === PH_OVER) continue;
        s = stepWithBots(s, mask, 0);
        fx.observe(s);
      }
      const cv = canvasRef.current;
      const ctx = cv?.getContext("2d") ?? null;
      if (ctx && cv) {
        ctx.imageSmoothingEnabled = false;
        paintScene(ctx, s, view);
        const shake = fx.shake(s[0], reduced);
        cv.style.transform = shake ? `translateX(${shake}px)` : "";
      }
      const t = hudText(s, [me, foe]);
      const k = JSON.stringify(t);
      if (k !== hudKey) {
        hudKey = k;
        setHud(t);
      }
      if (s[G_PHASE] === PH_OVER && !overSent) {
        if (overAt < 0) overAt = now;
        if (now - overAt > 900) {
          overSent = true;
          onOverRef.current({ result: s[G_RESULT], rounds: roundResults(s) });
        }
      }
      id = raf(tick);
    };
    id = raf(tick);
    return () => cancel(id);
  }, [match, look, me, foe]);

  const padRef = useRef<HTMLDivElement | null>(null);
  const onPad = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = padRef.current?.getBoundingClientRect();
    if (!r || (e.buttons === 0 && e.type !== "pointerdown")) return;
    const d = padDirAt(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2), r.width / 6);
    pad.current = d;
    setPadShown(d);
  };
  const padOff = () => {
    pad.current = null;
    setPadShown(null);
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: ARENA_W * scale, height: ARENA_H * scale }}>
        <canvas
          ref={canvasRef}
          width={ARENA_W}
          height={ARENA_H}
          className="block"
          style={{ width: ARENA_W * scale, height: ARENA_H * scale, imageRendering: "pixelated" }}
          aria-label={`${me} đấu với ${foe}`}
        />
        <div className="pointer-events-none absolute inset-x-0 top-[12%] flex justify-between px-[3%] font-vt text-white [text-shadow:0_2px_0_#000]" style={{ fontSize: 8 * scale }}>
          <span className="truncate">{me}</span>
          <span className="truncate">{foe}</span>
        </div>
        {(hud.banner || hud.sub) && (
          <div className="pointer-events-none absolute inset-x-0 top-[30%] flex flex-col items-center font-vt text-[#fff4d8] [text-shadow:0_3px_0_#1a1216]" role="status">
            {hud.banner && <span style={{ fontSize: 22 * scale }}>{hud.banner}</span>}
            {hud.sub && <span style={{ fontSize: 11 * scale, marginTop: hud.banner ? 0 : 40 * scale }}>{hud.sub}</span>}
          </div>
        )}
        {hud.combo.map((c, side) => c && (
          <span
            key={side}
            className={`pointer-events-none absolute top-[28%] font-vt text-[#ffd24a] [text-shadow:0_2px_0_#1a1216] ${side === 0 ? "left-[3%]" : "right-[3%]"}`}
            style={{ fontSize: 10 * scale }}
          >
            {c}
          </span>
        ))}
      </div>
      {/* touch: an 8-way pad on the left, six buttons on the right */}
      <div className="hidden w-full max-w-xl items-end justify-between gap-4 pointer-coarse:flex" data-testid="fight-touch">
        <div
          ref={padRef}
          className="pch relative h-32 w-32 touch-none select-none rounded-full"
          onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); onPad(e); }}
          onPointerMove={onPad}
          onPointerUp={padOff}
          onPointerCancel={padOff}
          aria-label="Phím hướng"
        >
          <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 font-vt text-2xl opacity-70">{padShown ? "●" : "✥"}</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {BUTTONS.map((b) => (
            <button
              key={b.key}
              type="button"
              className="pch-btn h-14 w-14 touch-none select-none px-0 font-vt text-sm leading-tight"
              onPointerDown={(e) => { e.preventDefault(); held.current |= b.bit; }}
              onPointerUp={() => { held.current &= ~b.bit; }}
              onPointerCancel={() => { held.current &= ~b.bit; }}
              onPointerLeave={() => { held.current &= ~b.bit; }}
            >
              <b className="block text-lg">{b.key}</b>{b.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
