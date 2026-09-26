"use client";

import { useEffect, useRef, useState } from "react";
import type { FarmRound } from "@/hooks/useFarmController";
import { HARVEST_PARTS } from "@/lib/game/farm/catalog";
import { partsDoneText, partText } from "@/lib/game/farm/messages";
import { createHarvestRound, HARVEST, HARVEST_MARK, scoreText, stepHarvestRound, type HarvestRound } from "@/lib/game/farm/minigames";
import { isTyping } from "@/lib/game/keys";

export const HARVEST_HELP = "Giữ Space (hoặc giữ chuột, giữ ngón tay) cho lực liềm lên — thả khi vạch nằm trong vùng xanh.";

/** The sickle's power bar: the được zone, the chuẩn band, the bar and the last cut. */
function PowerBar({ s }: { s: HarvestRound }) {
  const bundle = Math.min(s.bundle, HARVEST.bundles - 1);
  const c = s.centres[bundle];
  const last = s.beatMs > 0 ? s.cuts[s.cuts.length - 1] : undefined;
  const pct = (x: number) => `${Math.max(0, Math.min(1, x)) * 100}%`;
  return (
    <div className="relative h-7 w-64 max-w-full overflow-hidden rounded-sm border-2 border-ink bg-parchment-300" role="progressbar"
      aria-label="Lực liềm" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(s.level * 100)}>
      <div className="absolute inset-y-0 bg-[#9bd07f]/60" style={{ left: pct(c - HARVEST.near), width: pct(2 * HARVEST.near) }} />
      <div className="absolute inset-y-0 bg-[#4caf50]" style={{ left: pct(c - HARVEST.band / 2), width: pct(HARVEST.band) }} />
      <div className="absolute inset-y-1 left-0 bg-[#e0b33c]/90" style={{ width: pct(s.level) }} />
      {last && <div className="absolute inset-y-0 w-0.5 bg-burgundy" style={{ left: pct(last.level) }} />}
    </div>
  );
}

/** The round itself (v15.2 §6.2): a seeded HarvestRound stepped every frame; the sickle is Space, a mouse button or a
 *  finger held down. Its end goes to `onEnd` once. */
function Playing({ round, onEnd }: { round: FarmRound; onEnd: (pass: boolean, score: number) => void }) {
  const [s, setS] = useState(() => createHarvestRound(round.seed));
  const holding = useRef(false);
  const onEndRef = useRef(onEnd);
  useEffect(() => {
    onEndRef.current = onEnd;
  });

  useEffect(() => {
    let cur = createHarvestRound(round.seed);
    let last = performance.now();
    let raf = requestAnimationFrame(function loop(t: number) {
      cur = stepHarvestRound(cur, Math.max(0, t - last) / 1000, holding.current);
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
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || isTyping(e.target)) return;
      e.preventDefault();
      holding.current = true;
    };
    // A release always lets go: a hold never sticks when focus moved into a text field.
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") holding.current = false;
    };
    const blur = () => { holding.current = false; };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  const hold = (on: boolean) => () => { holding.current = on; };
  const last = s.beatMs > 0 ? s.cuts[s.cuts.length - 1] : undefined;
  return (
    // the whole block takes a held mouse button or finger
    <div className="flex w-full touch-none select-none flex-col items-center gap-2 py-1"
      onPointerDown={hold(true)} onPointerUp={hold(false)} onPointerCancel={hold(false)} onPointerLeave={hold(false)}>
      <PowerBar s={s} />
      <p aria-live="polite">
        Bó {Math.min(s.bundle + 1, HARVEST.bundles)}/{HARVEST.bundles} · {scoreText(s.score)} điểm
        {last && <b className={last.score === 0 ? "text-burgundy" : undefined}> · {HARVEST_MARK[last.mark]}</b>}
      </p>
      <p className="text-base opacity-80">{HARVEST_HELP}</p>
    </div>
  );
}

/** HarvestGame (v15.2 §13.2): the round, "Đang bó lúa…" while a pass waits out its 9 s, then the part won, a failed
 *  round's score or the server's refusal. Esc or "Huỷ" closes it and sends nothing; an Esc typed into a text field, or
 *  one for another open overlay, is not its own. */
export default function HarvestGame({ round, busy, panelOpen, varietyName, onEnd, onNext, onClose }: {
  round: FarmRound;
  busy: boolean;
  panelOpen: boolean;
  /** The plot's variety, for the harvest's last line. */
  varietyName: string;
  onEnd: (pass: boolean, score: number) => void;
  onNext: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    if (panelOpen || round.phase === "waiting") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isTyping(e.target)) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelOpen, round.phase, onClose]);

  const done = round.phase === "won" && round.result?.done === true;
  const button = (label: string, onClick: () => void, primary = false) => (
    <button type="button" className={`pch-btn${primary ? " pch-btn-primary" : ""}`} disabled={busy} onClick={onClick}>{label}</button>
  );
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center p-3" role="dialog" aria-modal="true"
      aria-label={`Gặt thửa ${round.plot}`}>
      <div className="pch flex w-80 max-w-full flex-col items-center gap-2 p-3 text-center font-vt text-lg leading-tight">
        <h2 className="font-vt text-2xl leading-none text-burgundy">🌾 Gặt thửa {round.plot} · phần {round.part}/{HARVEST_PARTS}</h2>
        {round.phase === "playing" && (
          <>
            <Playing round={round} onEnd={onEnd} />
            {button("Huỷ (Esc)", onClose)}
          </>
        )}
        {round.phase === "waiting" && <p role="status">Đang bó lúa…</p>}
        {round.phase === "won" && (
          <>
            <p role="status">
              {done
                ? partsDoneText(round.plot, round.result!.total, varietyName)
                : partText(round.part, round.result?.kg ?? 0)}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {done ? button("Đóng", onClose, true) : (
                <>
                  {button(`Gặt tiếp phần ${round.part + 1}`, onNext, true)}
                  {button("Nghỉ tay", onClose)}
                </>
              )}
            </div>
          </>
        )}
        {(round.phase === "lost" || round.phase === "refused") && (
          <>
            <p role="status" className="text-burgundy">
              {round.phase === "lost"
                ? `❌ Được ${scoreText(round.score ?? 0)}/${HARVEST.bundles} điểm — cần ${HARVEST.pass}. Thử lại ngay nhé!`
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
