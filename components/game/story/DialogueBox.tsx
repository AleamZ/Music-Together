"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SPEAKERS } from "@/lib/game/story/npcs";
import type { DialogueLine } from "@/lib/game/story/scripts";

// A Pokémon-style dialogue box at the bottom of the screen: the speaker's portrait and name, the line typed out letter by
// letter, "▶ Tiếp" to go on. Space / Enter / a click or tap anywhere on the box: the first press shows the whole line, the
// next goes to the next line. The last line may offer choices (Enter picks the first); Esc closes (no choice).

export interface DialogueChoice { id: string; label: string }

export const TYPE_MS = 28;

export default function DialogueBox({ lines, choices, onDone, typeMs = TYPE_MS }: {
  lines: readonly DialogueLine[];
  /** Shown on the last line (none: "▶ Tiếp" closes). */
  choices?: readonly DialogueChoice[];
  /** Closed: the choice picked, or null (closed without one / no choices). */
  onDone: (choice: string | null) => void;
  typeMs?: number;
}) {
  const [idx, setIdx] = useState(0);
  const [typed, setShown] = useState(0);
  const line = lines[Math.min(idx, lines.length - 1)];
  const full = line?.text ?? "";
  const shown = typeMs <= 0 ? full.length : typed;
  const typing = shown < full.length;
  const last = idx >= lines.length - 1;
  const hasChoices = last && !!choices && choices.length > 0;
  const doneRef = useRef(onDone);
  useEffect(() => { doneRef.current = onDone; }, [onDone]);

  // the typewriter
  useEffect(() => {
    if (!typing) return;
    const t = window.setTimeout(() => setShown((n) => Math.min(full.length, n + 1)), typeMs);
    return () => window.clearTimeout(t);
  }, [typing, shown, full, typeMs]);

  const advance = useCallback(() => {
    if (typing) { setShown(full.length); return; }
    if (!last) { setIdx((i) => i + 1); setShown(0); return; }
    if (hasChoices) return;                                                  // a choice is needed
    doneRef.current(null);
  }, [typing, full.length, last, hasChoices]);

  const pick = useCallback((id: string | null) => doneRef.current(id), []);

  // Space / Enter / Esc, ahead of the game's own keys
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" && e.code !== "Enter" && e.code !== "NumpadEnter" && e.code !== "Escape" && e.code !== "KeyE") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.repeat) return;
      if (e.code === "Escape") { pick(null); return; }
      if (hasChoices && !typing && e.code !== "KeyE") { pick(choices![0].id); return; }
      advance();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [advance, pick, hasChoices, typing, choices]);

  if (!line) return null;
  const sp = SPEAKERS[line.speaker];
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center p-2 sm:p-4" data-testid="dialogue">
      <div role="dialog" aria-label={`Hội thoại với ${sp.name}`} aria-live="polite"
        className="pch pointer-events-auto flex w-full max-w-2xl cursor-pointer select-none gap-3 border-4 p-3 font-vt leading-snug"
        onClick={advance}>
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md bg-parchment-300 text-4xl" aria-hidden="true">
          {sp.portrait}
        </div>
        <div className="flex min-h-[5.5rem] flex-1 flex-col gap-1">
          <p className="text-lg text-burgundy" data-testid="dialogue-speaker">{sp.name}</p>
          <p className="text-xl" data-testid="dialogue-text">
            {full.slice(0, shown)}<span className="invisible">{full.slice(shown)}</span>
          </p>
          <div className="mt-auto flex flex-wrap items-center justify-end gap-2">
            <span className="mr-auto text-sm opacity-60" aria-hidden="true">{idx + 1}/{lines.length}</span>
            {hasChoices && !typing ? choices!.map((c, i) => (
              <button key={c.id} type="button" className={`pch-btn min-h-11 px-4 text-lg ${i === 0 ? "font-bold" : ""}`}
                onClick={(e) => { e.stopPropagation(); pick(c.id); }}>{c.label}</button>
            )) : (
              <button type="button" className="pch-btn min-h-11 px-5 text-lg" data-testid="dialogue-next"
                onClick={(e) => { e.stopPropagation(); advance(); }}>{typing ? "▶▶" : last ? "▶ Xong" : "▶ Tiếp"}</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
