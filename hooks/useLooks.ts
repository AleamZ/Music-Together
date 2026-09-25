"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchCharacters } from "@/lib/game/character";
import type { Look } from "@/lib/game/types";

/** Looks of other members: each account is fetched once, and again on refresh (their `lk`). Missing → DEFAULT_LOOK at the caller. */
export function useLooks(accountIds: string[]): { looks: Map<string, Look>; refresh: (accountId: string) => void } {
  const [looks, setLooks] = useState<Map<string, Look>>(() => new Map());
  const requested = useRef(new Set<string>());
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
    requested.current.add(accountId);
    load([accountId]);
  }, [load]);

  return { looks, refresh };
}
