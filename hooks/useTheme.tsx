"use client";

import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { parseTheme, type ThemeName } from "@/lib/theme";

const KEY = "music-together:theme";

const ThemeCtx = createContext<{ theme: ThemeName; setTheme: (t: ThemeName) => void }>({
  theme: "salon", setTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>("salon");
  const hydrated = useRef(false);

  // Apply to <html> + persist on change. Skip the very first run so we don't
  // clobber the attribute the anti-FOUC inline script already set pre-paint.
  useEffect(() => {
    if (!hydrated.current) { hydrated.current = true; return; }
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem(KEY, theme); } catch { /* ignore */ }
  }, [theme]);

  // Hydrate React state from localStorage after mount (runs after the apply effect above).
  useEffect(() => {
    let v: string | null = null;
    try { v = localStorage.getItem(KEY); } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setThemeState(parseTheme(v));
  }, []);

  const setTheme = useCallback((t: ThemeName) => setThemeState(t), []);
  return <ThemeCtx.Provider value={{ theme, setTheme }}>{children}</ThemeCtx.Provider>;
}

export function useTheme() { return useContext(ThemeCtx); }
