"use client";

import { useEffect, useRef, useState } from "react";
import type { FarmRound } from "@/hooks/useFarmController";
import { drawTransplantScene, TRANSPLANT_SCENE } from "@/lib/game/art/gather-art";
import { transplantDoneText } from "@/lib/game/farm/messages";
import {
  createTransplantRound, scoreText, stepTransplantRound, TRANSPLANT, transplantMarkText, type TransplantRound,
} from "@/lib/game/farm/minigames";
import { isTyping } from "@/lib/game/keys";

/** The round's help line (v15.3 §13.3). */
export function transplantHelp(ot: boolean): string {
  return `Bấm Space (hoặc chạm, bấm chuột) khi bàn tay vào vùng xanh để cắm ${ot ? "cây ớt" : "khóm mạ"} cho thẳng hàng.`;
}

/** The mud, the row and the sweeping hand, drawn on a 160 × 48 canvas that CSS scales up in whole pixels (§15). The
 *  lines below it say the same in words. */
function Scene({ s, ot }: { s: TransplantRound; ot: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const ctx = useRef<CanvasRenderingContext2D | null | undefined>(undefined);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    if (ctx.current === undefined) ctx.current = canvas.getContext("2d");
    const c = ctx.current;
    if (!c) return;
    const sweep = s.stage === "sweep";
    drawTransplantScene(c, {
      hills: s.hills, centre: sweep ? s.centres[s.hills.length] : null, x: sweep ? s.x : null, ot, t: s.elapsedMs,
      reduced: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    });
  }, [s, ot]);
  return (
    <canvas ref={ref} width={TRANSPLANT_SCENE.w} height={TRANSPLANT_SCENE.h} aria-hidden="true"
      className="w-80 max-w-full [image-rendering:pixelated]" />
  );
}

/** The round itself (§8.2): a seeded TransplantRound stepped every frame; a press is Space, a click or a tap. Its end
 *  goes to `onEnd` once. */
function Playing({ round, onEnd }: { round: FarmRound; onEnd: (pass: boolean, score: number) => void }) {
  const [s, setS] = useState(() => createTransplantRound(round.seed));
  /** A press since the last frame. */
  const pressed = useRef(false);
  const onEndRef = useRef(onEnd);
  useEffect(() => {
    onEndRef.current = onEnd;
  });

  useEffect(() => {
    let cur = createTransplantRound(round.seed);
    let last = performance.now();
    let raf = requestAnimationFrame(function loop(t: number) {
      cur = stepTransplantRound(cur, Math.max(0, t - last) / 1000, pressed.current);
      pressed.current = false;
      last = t;
      setS(cur);
      if (cur.outcome) {
        onEndRef.current(cur.outcome === "pass", cur.score);
        return;
      }
      raf = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(raf);
  }, [round.seed]);

  useEffect(() => {
    // a held key's repeats are not presses
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || isTyping(e.target)) return;
      e.preventDefault();
      pressed.current = true;
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, []);

  const press = () => { pressed.current = true; };
  const last = s.stage === "beat" ? s.hills[s.hills.length - 1] : undefined;
  return (
    // the whole block takes a click or a tap
    <div role="group" aria-label={round.ot ? "Hàng cây" : "Hàng mạ"} onPointerDown={press}
      className="flex w-full touch-none select-none flex-col items-center gap-2 py-1">
      <Scene s={s} ot={round.ot} />
      <p aria-live="polite">
        {round.ot ? "Cây" : "Khóm"} {Math.min(s.hills.length + 1, TRANSPLANT.hills)}/{TRANSPLANT.hills} · {scoreText(s.score)} điểm
        {s.stage === "lead" && <b> · Sẵn sàng…</b>}
        {last && <b className={last.score === 0 ? "text-burgundy" : undefined}> · {transplantMarkText(last.mark, round.ot)}</b>}
      </p>
      <p className="text-base opacity-80">{transplantHelp(round.ot)}</p>
    </div>
  );
}

/** TransplantGame (v15.3 §13.3): the round, "Đang cắm nốt hàng mạ…" while a pass waits out its 9 s, then the rice
 *  transplanted or the ớt set out, a failed round's score or the server's refusal. Esc or "Huỷ" closes it and sends
 *  nothing; an Esc typed into a text field, or one for another open overlay, is not its own. While the claim is on its
 *  way Esc waits, until the claim is slow: then "Nghỉ tay" or Esc closes it too. */
export default function TransplantGame({ round, busy, panelOpen, onEnd, onNext, onClose }: {
  round: FarmRound;
  busy: boolean;
  panelOpen: boolean;
  onEnd: (pass: boolean, score: number) => void;
  onNext: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    if (panelOpen || (round.phase === "waiting" && !round.slow)) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isTyping(e.target)) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelOpen, round.phase, round.slow, onClose]);

  const title = round.ot ? `Trồng cây ớt con thửa ${round.plot}` : `Cấy lúa thửa ${round.plot}`;
  const button = (label: string, onClick: () => void, primary = false) => (
    <button type="button" className={`pch-btn${primary ? " pch-btn-primary" : ""}`} disabled={busy} onClick={onClick}>{label}</button>
  );
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center p-3" role="dialog" aria-modal="true" aria-label={title}>
      <div className="pch flex w-96 max-w-full flex-col items-center gap-2 p-3 text-center font-vt text-lg leading-tight">
        <h2 className="font-vt text-2xl leading-none text-burgundy">{round.ot ? "🌶\uFE0F" : "🌱"} {title}</h2>
        {round.phase === "playing" && (
          <>
            <Playing round={round} onEnd={onEnd} />
            {button("Huỷ (Esc)", onClose)}
          </>
        )}
        {round.phase === "waiting" && (
          <>
            <p role="status">{round.ot ? "Đang cắm nốt hàng cây…" : "Đang cắm nốt hàng mạ…"}</p>
            {round.slow && button("Nghỉ tay", onClose)}
          </>
        )}
        {round.phase === "won" && (
          <>
            <p role="status">{transplantDoneText(round.plot, round.ot)}</p>
            {button("Đóng", onClose, true)}
          </>
        )}
        {(round.phase === "lost" || round.phase === "refused") && (
          <>
            <p role="status" className="text-burgundy">
              {round.phase === "lost"
                ? `❌ Được ${scoreText(round.score ?? 0)}/${TRANSPLANT.hills} điểm — cần ${TRANSPLANT.pass}. Thử lại ngay nhé!`
                : round.message}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {button("Thử lại", onNext, true)}
              {button("Nghỉ tay", onClose)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
