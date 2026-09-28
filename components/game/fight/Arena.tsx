"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { G_PHASE, PH_OVER, type State } from "@/lib/game/fight/engine";
import { BUTTONS, KEY_BITS, maskFromKeys, padDirAt, padMask, type PadDir } from "@/lib/game/fight/input";
import type { ArenaKind } from "@/lib/game/fight/render/arena-art";
import { EffectTracker } from "@/lib/game/fight/render/fx";
import { ARENA_H, ARENA_W, TrailTracker, hudText, type HudText } from "@/lib/game/fight/render/hud";
import type { FighterLook } from "@/lib/game/fight/render/rig";
import { paintScene } from "@/lib/game/fight/render/scene";

/** What moves a fight forward: practice steps a local sim at 60 Hz; a refereed match follows the server's clock. */
export interface FightDriver {
  /** Advance to animation time `now` (ms) with the held input mask; returns the state to draw. */
  tick(now: number, mask: number, paused: boolean): State;
  /** Seconds before frame 0 (a refereed match's 3·2·1), else null. */
  countdown?(): number | null;
}

export function fitScale(): number {
  if (typeof window === "undefined") return 2;
  const w = Math.floor((window.innerWidth - 16) / ARENA_W);
  const h = Math.floor((window.innerHeight - 190) / ARENA_H);
  return Math.max(1, Math.min(4, w, h));
}

export function prefersReduced(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The arena canvas (384 × 216, integer-scaled), the HTML HUD copy over it, the keyboard (capture phase: the fight's
 *  keys never reach the world) and the touch pad. Shared by practice (v20.1) and refereed fights (v20.2). */
export default function Arena({ driver, arena, fighters, names, paused, boxes = false, onEsc, onOver }: {
  driver: FightDriver;
  arena: ArenaKind;
  fighters: readonly [FighterLook, FighterLook];
  names: readonly [string, string];
  paused: boolean;
  boxes?: boolean;
  onEsc: () => void;
  onOver: (s: State) => void;
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
  const [count, setCount] = useState<number | null>(null);
  const [padShown, setPadShown] = useState<PadDir | null>(null);
  const [me, foe] = names;

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

  // the render loop; the driver owns the sim
  useEffect(() => {
    const fx = new EffectTracker();
    const trail = new TrailTracker();
    const reduced = prefersReduced();
    const view = { arena, fighters, fx, trail, reduced, boxes };
    const raf: (cb: FrameRequestCallback) => number = typeof window.requestAnimationFrame === "function"
      ? (cb) => window.requestAnimationFrame(cb)
      : (cb) => window.setTimeout(() => cb(performance.now()), 16);
    const cancel = (id: number) => (typeof window.cancelAnimationFrame === "function" ? window.cancelAnimationFrame(id) : window.clearTimeout(id));
    let id = 0, hudKey = "", overSent = false, overAt = -1, lastFrame = -1, lastCount: number | null = null;
    const tick = (now: number) => {
      const mask = maskFromKeys(keys.current) | padMask(pad.current) | held.current;
      const s = driver.tick(now, mask, pausedRef.current);
      if (s[0] !== lastFrame) {
        lastFrame = s[0];
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
      const c = driver.countdown?.() ?? null;
      if (c !== lastCount) {
        lastCount = c;
        setCount(c);
      }
      if (s[G_PHASE] === PH_OVER && !overSent) {
        if (overAt < 0) overAt = now;
        if (now - overAt > 900) {
          overSent = true;
          onOverRef.current(s);
        }
      }
      id = raf(tick);
    };
    id = raf(tick);
    return () => cancel(id);
  }, [driver, arena, fighters, me, foe, boxes]);

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
        {count !== null && count > 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center font-vt text-[#fff4d8] [text-shadow:0_3px_0_#1a1216]" role="status" style={{ fontSize: 30 * scale }}>
            {count}
          </div>
        )}
        {(hud.banner || hud.sub) && (count === null || count <= 0) && (
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
