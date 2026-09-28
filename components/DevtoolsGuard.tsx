"use client";

import { useEffect, useState } from "react";
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

interface Gaps { w: number; h: number }
/** How much of the window is not the page (browser chrome, a docked DevTools). */
function gaps(): Gaps {
  return { w: window.outerWidth - window.innerWidth, h: window.outerHeight - window.innerHeight };
}
/** Docked DevTools open: the non-page strip grew by more than a DevTools panel's minimum since the baseline. */
export function devtoolsDocked(base: Gaps, now: Gaps): boolean {
  return now.w - base.w > 160 || now.h - base.h > 160;
}

/**
 * APP_MODE=prod only: blocks the DevTools shortcuts and the right-click menu (text fields keep theirs), and covers the
 * page while DevTools is open. A deterrent, not security — the server stays the judge of anything that pays.
 */
export default function DevtoolsGuard() {
  const [open, setOpen] = useState(false);
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
    // Docked DevTools steal a strip of the window. Browser chrome (a sidebar, bookmarks, zoom) does too, so only a
    // strip that GROWS past the one measured at load counts; a zoom change measures the baseline again. (A console
    // probe was dropped: Next's dev overlay and extensions read logged objects and gave false alarms.)
    let base = gaps(), ratio = window.devicePixelRatio;
    const check = () => {
      if (window.devicePixelRatio !== ratio) { ratio = window.devicePixelRatio; base = gaps(); }
      setOpen(devtoolsDocked(base, gaps()));
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("contextmenu", onMenu, true);
    const id = setInterval(check, 1500);
    const first = setTimeout(check, 0);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("contextmenu", onMenu, true);
      clearInterval(id); clearTimeout(first);
    };
  }, []);
  if (!IS_PROD || !open) return null;
  return (
    <div
      role="alertdialog"
      aria-label="Đóng công cụ nhà phát triển"
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-3 bg-black/95 p-6 text-center font-vt text-parchment"
    >
      <p className="text-3xl">🔒 Đang mở công cụ nhà phát triển (DevTools)</p>
      <p className="text-xl opacity-80">Đóng DevTools để tiếp tục chơi và nghe nhạc.</p>
    </div>
  );
}

/** Inline, before React loads (prod only): React DevTools finds a disabled hook and does not attach. */
export const DISABLE_REACT_DEVTOOLS_SCRIPT =
  "try{var h=window.__REACT_DEVTOOLS_GLOBAL_HOOK__;if(h&&typeof h==='object'){for(var k in h){h[k]=typeof h[k]==='function'?function(){}:null}}else{Object.defineProperty(window,'__REACT_DEVTOOLS_GLOBAL_HOOK__',{value:{isDisabled:true,supportsFiber:true,inject:function(){},onCommitFiberRoot:function(){},onCommitFiberUnmount:function(){}},writable:false,configurable:false})}}catch(e){}";
