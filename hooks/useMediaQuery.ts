"use client";

import { useSyncExternalStore } from "react";

/**
 * Subscribes to a CSS media query and returns whether it matches.
 * Uses useSyncExternalStore for hydration-safe rendering with zero layout flicker.
 */
export function useMediaQuery(query: string, serverFallback = false): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
        return () => {};
      }
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onStoreChange);
      return () => {
        mql.removeEventListener("change", onStoreChange);
      };
    },
    () => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
        return serverFallback;
      }
      return window.matchMedia(query).matches;
    },
    () => serverFallback
  );
}

/**
 * Returns true if viewport is desktop size (>= 1024px, corresponding to Tailwind's 'lg' breakpoint).
 */
export function useIsDesktop(): boolean {
  return useMediaQuery("(min-width: 1024px)", true);
}
