"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FarmCrab } from "@/hooks/useFarmController";
import { CRAB_SCENE, drawCrabScene } from "@/lib/game/art/gather-art";
import { CRAB, CRAB_MARK, crabClosed, createCrabRound, stepCrabRound, type CrabRound } from "@/lib/game/farm/minigames";
import { isTyping } from "@/lib/game/keys";

export const CRAB_HELP =
  "Cua giơ càng mở ra khép vào. Bấm Space (hoặc chạm, bấm chuột) lúc càng KHÉP để chộp — càng mở mà chộp là bị cua kẹp!";

/** The claws right now: closed while a grab would be a hit (§7.2). */
function clawsClosed(s: CrabRound): boolean {
  const i = s.tries.length;
  return s.stage === "claws" && crabClosed(CRAB.periodsMs[i], s.phases[i], s.stageMs);
}

/** The bank, the hole, the crab and the hand, drawn on a 96 × 64 canvas that CSS scales up in whole pixels (§15). The
 *  lines below it say the same in words. */
function Scene({ s }: { s: CrabRound }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const ctx = useRef<CanvasRenderingContext2D | null | undefined>(undefined);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    if (ctx.current === undefined) ctx.current = canvas.getContext("2d");
    const c = ctx.current;
    if (!c) return;
    drawCrabScene(c, {
      closed: clawsClosed(s), lurking: s.stage === "lead", mark: s.stage === "beat" ? s.tries[s.tries.length - 1] : null, t: s.elapsedMs,
      reduced: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    });
  }, [s]);
  return (
    <canvas ref={ref} width={CRAB_SCENE.w} height={CRAB_SCENE.h} aria-hidden="true"
      className="w-72 max-w-full [image-rendering:pixelated]" />
  );
}

/** The game (§7.2): a seeded CrabRound stepped every frame; a grab is Space, a click or a tap. Its end goes to `onEnd`
 *  once. Dừng or Esc (R8): before the first try ends it closes the game and nothing is sent; after a try it ends the
 *  game with the hits so far. */
function Playing({ crab, panelOpen, onEnd, onClose }: {
  crab: FarmCrab;
  panelOpen: boolean;
  onEnd: (hits: number) => void;
  onClose: () => void;
}) {
  const [s, setS] = useState(() => createCrabRound(crab.seed));
  /** A grab since the last frame. */
  const grabbed = useRef(false);
  /** The round as the last frame left it, and whether the game has been handed on (its end, or Dừng). */
  const latest = useRef(s);
  const over = useRef(false);
  const cb = useRef({ onEnd, onClose });
  useEffect(() => {
    cb.current = { onEnd, onClose };
  });
  const stop = useCallback(() => {
    if (over.current) return;
    over.current = true;
    if (latest.current.tries.length === 0) cb.current.onClose();
    else cb.current.onEnd(latest.current.hits);
  }, []);

  useEffect(() => {
    let cur = createCrabRound(crab.seed);
    let last = performance.now();
    let raf = requestAnimationFrame(function loop(t: number) {
      cur = stepCrabRound(cur, Math.max(0, t - last) / 1000, grabbed.current);
      grabbed.current = false;
      last = t;
      latest.current = cur;
      setS(cur);
      if (cur.outcome) {
        if (!over.current) {
          over.current = true;
          cb.current.onEnd(cur.hits);
        }
        return;
      }
      raf = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(raf);
  }, [crab.seed]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (e.code === "Space") {
        e.preventDefault();
        // a held key's repeats are not grabs
        if (!e.repeat) grabbed.current = true;
      } else if (e.key === "Escape" && !panelOpen) {
        stop();
      }
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [panelOpen, stop]);

  const grab = () => { grabbed.current = true; };
  const last = s.tries[s.tries.length - 1];
  const closed = clawsClosed(s);
  const line = s.stage === "lead" ? "Cua đang rình…" : s.stage === "claws" ? (closed ? "Càng khép — chộp!" : "Càng mở") : CRAB_MARK[last];
  return (
    <>
      {/* the whole block takes a click or a tap */}
      <div role="group" aria-label="Hang cua" onPointerDown={grab} className="flex w-full touch-none select-none flex-col items-center gap-2 py-1">
        <Scene s={s} />
        <p>
          Lần {Math.min(s.tries.length + (s.stage === "beat" ? 0 : 1), CRAB.tries)}/{CRAB.tries} · bắt được {s.hits}
          <b className={closed ? "text-[#2e7d32]" : undefined}> · {line}</b>
        </p>
        <p aria-live="polite" className="min-h-6">{last ? `Lần ${s.tries.length}: ${CRAB_MARK[last]}` : ""}</p>
        <p className="text-base opacity-80">{CRAB_HELP}</p>
      </div>
      <button type="button" className="pch-btn" onClick={stop}>Dừng (Esc)</button>
    </>
  );
}

/** CrabGame (v15.3 §13.2): the game at a hole; "Đang bỏ cua vào xô…" while a catch waits out its 4 s after crab_start's
 *  answer; then what the visit brought, or the server's refusal. Dừng (Esc) follows R8; an Esc typed into a text field,
 *  or one for another open overlay, is not its own. */
export default function CrabGame({ crab, panelOpen, onEnd, onClose }: {
  crab: FarmCrab;
  panelOpen: boolean;
  onEnd: (hits: number) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    // the game minds its own Esc (Dừng)
    if (panelOpen || crab.phase === "playing") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isTyping(e.target)) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelOpen, crab.phase, onClose]);

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center p-3" role="dialog" aria-modal="true"
      aria-label={`Bắt cua hang ${crab.hole}`}>
      <div className="pch flex w-80 max-w-full flex-col items-center gap-2 p-3 text-center font-vt text-lg leading-tight">
        <h2 className="font-vt text-2xl leading-none text-burgundy">🦀 Bắt cua · hang {crab.hole}</h2>
        {crab.phase === "playing" && <Playing crab={crab} panelOpen={panelOpen} onEnd={onEnd} onClose={onClose} />}
        {crab.phase === "waiting" && (
          <>
            {(crab.hits ?? 0) > 0 && <p role="status">Đang bỏ cua vào xô…</p>}
            <button type="button" className="pch-btn" onClick={onClose}>Dừng (Esc)</button>
          </>
        )}
        {(crab.phase === "done" || crab.phase === "refused") && (
          <>
            <p role="status" className={crab.phase === "refused" ? "text-burgundy" : undefined}>{crab.message}</p>
            <button type="button" className="pch-btn pch-btn-primary" onClick={onClose}>Đóng</button>
          </>
        )}
      </div>
    </div>
  );
}
