"use client";

import { useEffect, useRef } from "react";
import { hotkeyFor, type HotkeyContext } from "@/lib/game/hotkeys";
import { revealFor } from "@/components/game/hud/HudMenu";

/** Runs a resolved hotkey: "help" goes to `onHelp`; any other action clicks (or, for a text field, focuses) the
 *  visible element marked `data-hotkey="<id>"`, skipping a disabled one. One window listener for the whole HUD. */
export function runHotkey(id: string, onHelp: () => void, root: ParentNode = document): boolean {
  if (id === "help") {
    onHelp();
    return true;
  }
  const el = root.querySelector<HTMLElement>(`[data-hotkey="${id}"]`);
  if (!el || (el as HTMLButtonElement).disabled) return false;
  revealFor(el);                                   // a control inside a closed HUD group (the zoom) opens its group
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.focus();
  else el.click();
  return true;
}

export function useHotkeys(ctx: HotkeyContext, onHelp: () => void): void {
  const live = useRef({ ctx, onHelp });
  useEffect(() => {
    live.current = { ctx, onHelp };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const id = hotkeyFor(e, live.current.ctx);
      if (id && runHotkey(id, live.current.onHelp)) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
