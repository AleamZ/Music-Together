"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchCharacters } from "@/lib/game/character";
import type { Look } from "@/lib/game/types";

/** A member's `lk` refreshes their look at most once in this window; one more inside it waits for its end (anti-cheat
 *  spec §14). */
export const LK_WINDOW_MS = 30_000;

/** Looks of other members: each account is fetched once, and again on refresh (their `lk`). Missing → DEFAULT_LOOK at the caller. */
export function useLooks(accountIds: string[]): { looks: Map<string, Look>; refresh: (accountId: string) => void } {
  const [looks, setLooks] = useState<Map<string, Look>>(() => new Map());
  const requested = useRef(new Set<string>());
  // per account: when its look was last refreshed, and the refresh waiting for the end of its window
  const refreshedAt = useRef(new Map<string, number>());
  const trailing = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const timers = trailing.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);
  const key = [...new Set(accountIds)].sort().join(",");

  const load = useCallback((ids: string[]) => {
    fetchCharacters(ids)
      .then((found) => {
        if (found.size === 0) return;
        setLooks((prev) => {
          const next = new Map(prev);
          for (const [id, look] of found) next.set(id, look);
          return next;
        });
      })
      .catch(() => {
        for (const id of ids) requested.current.delete(id); // retried on the next roster change
      });
  }, []);

  useEffect(() => {
    const missing = (key ? key.split(",") : []).filter((id) => !requested.current.has(id));
    if (missing.length === 0) return;
    for (const id of missing) requested.current.add(id);
    load(missing);
  }, [key, load]);

  const refresh = useCallback((accountId: string) => {
    if (trailing.current.has(accountId)) return;
    const run = () => {
      refreshedAt.current.set(accountId, Date.now());
      requested.current.add(accountId);
      load([accountId]);
    };
    const last = refreshedAt.current.get(accountId);
    const wait = last === undefined ? 0 : last + LK_WINDOW_MS - Date.now();
    if (wait <= 0) {
      run();
      return;
    }
    trailing.current.set(accountId, setTimeout(() => {
      trailing.current.delete(accountId);
      run();
    }, wait));
  }, [load]);

  return { looks, refresh };
}
