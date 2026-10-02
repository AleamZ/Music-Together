"use client";

import { useEffect, type ReactNode } from "react";
import { IS_PROD } from "@/lib/app-mode";

/** Keys that open DevTools or the page source (Windows/Linux and macOS). */
export function isDevtoolsShortcut(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">): boolean {
  const k = e.key.toLowerCase();
  if (k === "f12") return true;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.shiftKey && ["i", "j", "c", "k"].includes(k)) return true;   // Chrome/Edge/Firefox DevTools panels
  if (e.metaKey && e.altKey && ["i", "j", "c", "u"].includes(k)) return true; // macOS
  if (mod && k === "u") return true;                                        // view source
  return false;
}

export interface Gaps { w: number; h: number }
/** A docked DevTools panel is at least this big; browser chrome growing by less (a bar, a zoom step) is not one. */
const PANEL = 160;
/** Bigger than any browser chrome (tabs, address, bookmarks ≈ 80–140 px tall; a vertical tab strip ≈ 50–300 px wide):
 *  a strip this big is DevTools even if it was already open when the page loaded. */
const ABS_W = 420, ABS_H = 320;

/** The smallest strip seen so far is the browser's own chrome; DevTools is the strip growing a panel past it. */
export function nextFloor(floor: Gaps | null, now: Gaps): Gaps {
  return floor ? { w: Math.min(floor.w, now.w), h: Math.min(floor.h, now.h) } : now;
}

/** Docked DevTools open: the strip grew a panel past the smallest seen, or is bigger than any browser chrome. */
export function devtoolsDocked(floor: Gaps, now: Gaps): boolean {
  if (now.w > ABS_W || now.h > ABS_H) return true;
  return now.w - floor.w > PANEL || now.h - floor.h > PANEL;
}

/**
 * APP_MODE=prod only: blocks the DevTools shortcuts and the right-click menu (text fields keep theirs). An open DevTools
 * no longer covers the app. Still a deterrent, not security — the server stays the judge of anything that pays.
 */
export default function DevtoolsGuard({ children }: { children?: ReactNode }) {
  useEffect(() => {
    if (!IS_PROD) return;
    const onKey = (e: KeyboardEvent) => {
      if (isDevtoolsShortcut(e)) { e.preventDefault(); e.stopPropagation(); }
    };
    const onMenu = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, [contenteditable='true']")) return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("contextmenu", onMenu, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("contextmenu", onMenu, true);
    };
  }, []);
  return <>{children}</>;
}

/** Inline, before React loads (prod only): React DevTools finds a disabled hook and does not attach. */
export const DISABLE_REACT_DEVTOOLS_SCRIPT =
  "try{var h=window.__REACT_DEVTOOLS_GLOBAL_HOOK__;if(h&&typeof h==='object'){for(var k in h){h[k]=typeof h[k]==='function'?function(){}:null}}else{Object.defineProperty(window,'__REACT_DEVTOOLS_GLOBAL_HOOK__',{value:{isDisabled:true,supportsFiber:true,inject:function(){},onCommitFiberRoot:function(){},onCommitFiberUnmount:function(){}},writable:false,configurable:false})}}catch(e){}";
