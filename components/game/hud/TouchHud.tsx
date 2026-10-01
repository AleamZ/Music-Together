"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import { clampStick, joystickKeys, keyDiff, type StickCode } from "@/lib/game/touch";

// The phone HUD: a rotate-to-landscape wall in portrait, and in landscape a virtual joystick plus big action buttons.
// Both feed the game the keys the desktop uses (window key events), so every system that listens for WASD / E / Space
// works unchanged.

function media(query: string) {
  const subscribe = (cb: () => void) => {
    try {
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    } catch {
      return () => {};
    }
  };
  const get = () => {
    try { return window.matchMedia(query).matches; } catch { return false; }
  };
  return { subscribe, get };
}

const TOUCH = media("(pointer: coarse)");
const PORTRAIT = media("(orientation: portrait)");

/** A touch screen (coarse pointer): the touch HUD shows. False on the server. */
export function useTouchDevice(): boolean {
  return useSyncExternalStore(TOUCH.subscribe, TOUCH.get, () => false);
}

/** A touch screen held upright: the game asks to be turned. */
export function usePortraitTouch(): boolean {
  const touch = useTouchDevice();
  const portrait = useSyncExternalStore(PORTRAIT.subscribe, PORTRAIT.get, () => false);
  return touch && portrait;
}

/** Sends a key to the game as the keyboard would (on window: not a text field, so no game listener skips it). */
export function sendKey(type: "keydown" | "keyup", code: string): void {
  const key = code === "Space" ? " " : code.startsWith("Key") ? code.slice(3).toLowerCase() : code;
  window.dispatchEvent(new KeyboardEvent(type, { code, key, bubbles: true, cancelable: true }));
}

export function RotateOverlay() {
  const portrait = usePortraitTouch();
  if (!portrait) return null;
  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="rotate-title" data-testid="rotate-overlay"
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-4 bg-[#1d140e]/95 p-6 text-center font-vt text-cream">
      <svg viewBox="0 0 64 64" className="h-24 w-24 motion-safe:animate-[spin_2.4s_ease-in-out_infinite]" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="3">
        <rect x="20" y="6" width="24" height="44" rx="4" />
        <circle cx="32" cy="43" r="2" fill="currentColor" />
        <path d="M50 44a18 18 0 0 1-12 12" strokeLinecap="round" />
        <path d="M36 52l2 4 4-2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <h2 id="rotate-title" className="text-3xl leading-tight">Xoay ngang màn hình để chơi</h2>
      <p className="max-w-xs text-lg opacity-80">Trò chơi cần màn hình nằm ngang. Hãy tắt khóa xoay nếu điện thoại không tự xoay.</p>
    </div>
  );
}

const RADIUS = 40;

/** The stick: drag anywhere in its pad; the held WASD keys follow the push. */
export function Joystick() {
  const held = useRef<Set<StickCode>>(new Set());
  const origin = useRef<{ x: number; y: number; id: number } | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });

  const apply = (next: Set<StickCode>) => {
    const { up, down } = keyDiff(held.current, next);
    up.forEach((c) => sendKey("keyup", c));
    down.forEach((c) => sendKey("keydown", c));
    held.current = next;
  };
  const release = () => {
    origin.current = null;
    setKnob({ x: 0, y: 0 });
    apply(new Set());
  };
  // let go of every key when the stick goes away (a panel opened, the game blocked)
  useEffect(() => () => { held.current.forEach((c) => sendKey("keyup", c)); }, []);

  const center = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not supported */ }
    const c = center(e);
    origin.current = { ...c, id: e.pointerId };
    onMove(e);
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const o = origin.current;
    if (!o || o.id !== e.pointerId) return;
    const dx = e.clientX - o.x, dy = e.clientY - o.y;
    setKnob(clampStick(dx, dy, RADIUS));
    apply(joystickKeys(dx, dy, RADIUS));
  };

  return (
    <div data-testid="joystick" role="application" aria-label="Cần điều khiển: kéo để đi"
      className="pointer-events-auto relative flex h-28 w-28 touch-none opacity-80 select-none items-center justify-center rounded-full border-4 border-parchment-300/80 bg-black/25"
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}>
      <div className="h-12 w-12 rounded-full border-4 border-ink/40 bg-parchment/90 shadow-md"
        style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} aria-hidden="true" />
    </div>
  );
}

/** A button that holds a key while pressed (Space reels while held; E taps once). */
function KeyButton({ code, label, sr, primary, testId }: { code: string; label: string; sr: string; primary?: boolean; testId: string }) {
  const down = useRef(false);
  const up = () => { if (down.current) { down.current = false; sendKey("keyup", code); } };
  return (
    <button type="button" data-testid={testId} aria-label={sr}
      className={`pch-btn pointer-events-auto flex touch-none select-none items-center justify-center rounded-full font-vt leading-none ${primary ? "pch-btn-primary h-16 w-16 text-3xl" : "h-14 w-14 text-xl"} opacity-85`}
      onPointerDown={(e) => { e.preventDefault(); down.current = true; sendKey("keydown", code); }}
      onPointerUp={up} onPointerCancel={up} onPointerLeave={up}
      onContextMenu={(e) => e.preventDefault()}>
      {label}
    </button>
  );
}

/** The landscape touch HUD: the stick bottom-left, the action buttons bottom-right (inside the safe area). */
export function TouchControls({ disabled = false }: { disabled?: boolean }) {
  const touch = useTouchDevice();
  if (!touch || disabled) return null;
  return (
    <div data-testid="touch-controls"
      className={`pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-end justify-between pb-[max(0.75rem,calc(env(safe-area-inset-bottom)+0.5rem))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]`}>
      <Joystick />
      <div className="flex items-end gap-3 pr-2">
        <KeyButton code="Space" label="␣" sr="Hành động: quăng cần, giật, kéo (giữ)" testId="touch-space" />
        <KeyButton code="KeyE" label="E" sr="Tương tác" primary testId="touch-interact" />
      </div>
    </div>
  );
}
