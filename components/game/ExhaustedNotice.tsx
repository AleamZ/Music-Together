"use client";

import { useEffect, useState } from "react";
import { clockText, EXHAUSTED_TEXT } from "@/lib/game/vitals";

/** The faint-ladder lock (0045): shown over the classic view when game mode is closed until VN midnight. */
export default function ExhaustedNotice({ untilMs, onClose }: { untilMs: number; onClose: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const left = untilMs - now;
  useEffect(() => {
    if (left <= 0) onClose();
  }, [left, onClose]);
  return (
    <div role="alertdialog" aria-label="Kiệt sức" className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-sm rounded-lg border-2 border-ink/40 bg-parchment p-5 text-center font-vt text-ink sm:max-w-md">
        <p className="text-4xl" aria-hidden="true">😵</p>
        <p className="mt-2 text-xl">{EXHAUSTED_TEXT}</p>
        <p className="mt-3 text-lg tabular-nums">Mở lại sau {clockText(left)}</p>
        <button type="button" className="pch-btn mt-4" onClick={onClose}>Đã hiểu</button>
      </div>
    </div>
  );
}
