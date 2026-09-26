"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import type { FarmSling } from "@/hooks/useFarmController";
import { drawSlingScene } from "@/lib/game/art/sling-art";
import { SLING_CANCEL, SLING_HELP, slingStatus, slingTitle } from "@/lib/game/farm/messages";
import { createSling, SLING, SLING_MISS, slingAnswered, slingSent, stepSling, type SlingMark, type SlingState } from "@/lib/game/farm/sling";
import { isTyping } from "@/lib/game/keys";

/** The scene on a 320 × 180 canvas that CSS scales to the overlay's width; the lines below it say the same in words. */
function Scene({ s }: { s: SlingState }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const ctx = useRef<CanvasRenderingContext2D | null | undefined>(undefined);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    if (ctx.current === undefined) ctx.current = canvas.getContext("2d");
    const c = ctx.current;
    if (!c) return;
    drawSlingScene(c, s, performance.now(), window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  }, [s]);
  return (
    <canvas ref={ref} width={SLING.width} height={SLING.height} aria-hidden="true"
      className="w-full max-w-[640px] [image-rendering:pixelated]" />
  );
}

/** The game (§6.2): a seeded SlingState stepped every frame. A finished flight goes to `onShot` (sling_shoot), a shot
 *  ready too late to `onReaim` (sling_start); each new answer (`answers`) starts the 2.2 s reload. Holding is Space, a
 *  mouse button or a finger; the aim follows the pointer (a finger drags it while holding) or ←/→. */
function Playing({ sling, pellets, panelOpen, onShot, onReaim, onClose }: {
  sling: FarmSling;
  pellets: number;
  panelOpen: boolean;
  onShot: (hit: boolean) => void;
  onReaim: () => void;
  onClose: () => void;
}) {
  const [s, setS] = useState(() => createSling(sling.seed));
  /** The last shot's mark, for its line until the next shot. */
  const [mark, setMark] = useState<SlingMark | null>(null);
  const input = useRef({ key: false, pointer: false, aimTo: null as number | null, left: false, right: false });
  const cur = useRef(s);
  const answers = useRef(sling.answers);
  const cb = useRef({ onShot, onReaim });
  useEffect(() => {
    cb.current = { onShot, onReaim };
  });

  // a new answer (a miss, a new aim): the reload starts
  useEffect(() => {
    if (sling.answers === answers.current) return;
    answers.current = sling.answers;
    cur.current = slingAnswered(cur.current);
    setS(cur.current);
  }, [sling.answers]);

  useEffect(() => {
    let last = performance.now();
    let raf = requestAnimationFrame(function loop(t: number) {
      const i = input.current;
      let next = stepSling(cur.current, Math.max(0, t - last) / 1000, {
        holding: i.key || i.pointer, aimTo: i.aimTo, left: i.left, right: i.right,
      });
      last = t;
      if (next.stage === "send") {
        const m = next.mark;
        next = slingSent(next);
        setMark(m);
        cb.current.onShot(m === "hit");
      } else if (next.stage === "reaim") {
        next = slingSent(next);
        setMark(null);
        cb.current.onReaim();
      }
      cur.current = next;
      setS(next);
      raf = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (e.code === "Space") {
        e.preventDefault();
        input.current.key = true;
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        input.current.left = true;
        input.current.aimTo = null;
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        input.current.right = true;
        input.current.aimTo = null;
      } else if (e.key === "Escape" && !panelOpen) {
        onClose();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") input.current.key = false;
      else if (e.key === "ArrowLeft") input.current.left = false;
      else if (e.key === "ArrowRight") input.current.right = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [panelOpen, onClose]);

  /** A pointer's x in scene px. */
  const aimAt = useCallback((e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width > 0) input.current.aimTo = ((e.clientX - r.left) / r.width) * SLING.width;
  }, []);

  const reloading = s.stage === "reload" || s.stage === "wait";
  const line = mark === null || mark === "hit" ? null : SLING_MISS[mark];
  return (
    <>
      {/* the whole scene takes the pointer: move to aim, hold to draw */}
      <div role="group" aria-label="Ná" className="w-full touch-none select-none"
        onPointerMove={aimAt}
        onPointerDown={(e) => { aimAt(e); input.current.pointer = true; }}
        onPointerUp={() => { input.current.pointer = false; }}
        onPointerCancel={() => { input.current.pointer = false; }}
        onPointerLeave={() => { input.current.pointer = false; }}>
        <Scene s={s} />
      </div>
      <p>{slingStatus(pellets, reloading)}</p>
      <p aria-live="polite" className="min-h-6">{line ?? ""}</p>
      <p className="text-base opacity-80">{SLING_HELP}</p>
      <button type="button" className="pch-btn" onClick={onClose}>{SLING_CANCEL}</button>
    </>
  );
}

/** SlingGame (v17 §12.2): the game at a rat, then the hit or the refusal (`message`, the state's `recent` already read
 *  into it for `rat gone`). Thôi (Esc) sends nothing; an Esc typed into a text field, or one for another open overlay, is
 *  not its own. */
export default function SlingGame({ sling, pellets, message, panelOpen, onShot, onReaim, onClose }: {
  sling: FarmSling;
  pellets: number;
  message: string | null;
  panelOpen: boolean;
  onShot: (hit: boolean) => void;
  onReaim: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    // the game minds its own Esc (Thôi)
    if (panelOpen || sling.phase === "playing") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isTyping(e.target)) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelOpen, sling.phase, onClose]);

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center p-3" role="dialog" aria-modal="true"
      aria-label={slingTitle(sling.plot)}>
      <div className="pch flex w-[40rem] max-w-full flex-col items-center gap-2 p-3 text-center font-vt text-lg leading-tight">
        <h2 className="font-vt text-2xl leading-none text-burgundy">{slingTitle(sling.plot)}</h2>
        {sling.phase === "playing" && (
          <Playing sling={sling} pellets={pellets} panelOpen={panelOpen} onShot={onShot} onReaim={onReaim} onClose={onClose} />
        )}
        {sling.phase !== "playing" && (
          <>
            <p role="status" className={sling.phase === "refused" ? "text-burgundy" : undefined}>{message}</p>
            <button type="button" className="pch-btn pch-btn-primary" onClick={onClose}>Đóng</button>
          </>
        )}
      </div>
    </div>
  );
}
