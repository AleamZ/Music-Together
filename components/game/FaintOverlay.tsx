"use client";

import { useEffect, useRef, useState } from "react";
import { clockText, FAINT_TEXT, faintLadderMs, ladderText, type FaintCause } from "@/lib/game/vitals";

/** The faint screen (v18.3): dark, why I fainted, a countdown to revival, input blocked by GameShell's overlay lock. */
export default function FaintOverlay({ untilMs, serverNowMs, clientAtPerfMs, onDone, cause = "starve", count = 0 }:
  { untilMs: number; serverNowMs: number; clientAtPerfMs: number; onDone: () => void; cause?: FaintCause; count?: number }) {
  const [left, setLeft] = useState(() => Math.max(0, untilMs - (serverNowMs + (performance.now() - clientAtPerfMs))));
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  }, [onDone]);
  useEffect(() => {
    const id = setInterval(() => {
      const r = Math.max(0, untilMs - (serverNowMs + (performance.now() - clientAtPerfMs)));
      setLeft(r);
      if (r <= 0) {
        clearInterval(id);
        doneRef.current();
      }
    }, 250);
    return () => clearInterval(id);
  }, [untilMs, serverNowMs, clientAtPerfMs]);
  return (
    <div
      role="alertdialog"
      aria-label="Ngất"
      className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-2 bg-black/85 font-vt text-parchment"
    >
      <p className="text-3xl">{FAINT_TEXT[cause]}</p>
      <p className="text-xl tabular-nums">Hồi sinh sau {clockText(left)}…</p>
      {count > 0 && (
        <p className="text-lg opacity-80">
          Lần ngất thứ {count} hôm nay · Lần sau: {ladderText(faintLadderMs(count + 1))}
        </p>
      )}
    </div>
  );
}
