import { useCallback, useEffect, useRef, useState } from "react";
import { vehiclesState } from "@/lib/game/travel/rpc";

/** The vehicles I own (v18.5), fetched on mount and on `reload`. Before 0027 (or on an error) it stays empty: I walk. */
export function useVehicles(token: string | null): { owned: string[]; reload: () => Promise<void> } {
  const [held, setHeld] = useState<{ token: string; owned: string[] } | null>(null);
  const seq = useRef(0);
  const reload = useCallback(async () => {
    if (!token) return;
    const mine = ++seq.current;
    try {
      const r = await vehiclesState(token);
      if (mine === seq.current) setHeld({ token, owned: r.owned });
    } catch { /* keep what we had */ }
  }, [token]);
  useEffect(() => {
    if (!token) return;
    const counter = seq;
    const first = setTimeout(() => void reload(), 0);
    return () => { clearTimeout(first); counter.current++; };
  }, [token, reload]);
  const owned = held && held.token === token ? held.owned : EMPTY;
  return { owned, reload };
}

const EMPTY: string[] = [];
