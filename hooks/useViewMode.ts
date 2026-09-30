"use client";

import { useCallback, useState } from "react";
import { parseViewMode, VIEW_MODE_KEY, type ViewMode } from "@/lib/view-mode";

export function readStoredMode(): ViewMode {
  if (typeof window === "undefined") return "game";
  try {
    return parseViewMode(window.localStorage.getItem(VIEW_MODE_KEY));
  } catch {
    return "game";
  }
}

export function useViewMode(): { mode: ViewMode; setMode: (m: ViewMode) => void } {
  const [mode, setModeState] = useState<ViewMode>(readStoredMode);
  const setMode = useCallback((m: ViewMode) => {
    setModeState(m);
    try { window.localStorage.setItem(VIEW_MODE_KEY, m); } catch { /* storage blocked: keep in memory */ }
  }, []);
  return { mode, setMode };
}
