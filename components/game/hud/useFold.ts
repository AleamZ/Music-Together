"use client";

import { useState, useSyncExternalStore } from "react";

// A HUD part the player folds and unfolds, kept per browser (every storage access guarded). `null` = no choice yet:
// the caller's CSS decides by the screen's width (folded on a phone, open on a computer).

const noSubscribe = () => () => {};

function read(key: string): boolean | null {
  try {
    const v = window.localStorage.getItem(key);
    return v === "1" ? true : v === "0" ? false : null;
  } catch {
    return null;
  }
}

export function useFold(key: string): [open: boolean | null, setOpen: (open: boolean) => void] {
  const stored = useSyncExternalStore(noSubscribe, () => read(key), () => null);   // null on the server: no mismatch
  const [choice, setChoice] = useState<boolean | null>(null);
  const setOpen = (o: boolean) => {
    setChoice(o);
    try { window.localStorage.setItem(key, o ? "1" : "0"); } catch { /* storage blocked: this page only */ }
  };
  return [choice ?? stored, setOpen];
}

/** The classes that show a foldable flex part: open / folded as chosen, else open from `sm` up only. */
export function foldClass(open: boolean | null): string {
  return open === null ? "hidden sm:flex" : open ? "flex" : "hidden";
}
