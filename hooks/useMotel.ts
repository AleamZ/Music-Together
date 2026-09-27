import { useCallback, useEffect, useRef, useState } from "react";
import { motelState, type MotelState } from "@/lib/game/housing/motel";

/** My motel room and my "Ngủ ngon" buff (v19.1): fetched on mount; `apply` takes the state an action RPC returned.
 *  `rested` flips off by itself when the buff runs out. Before 0039 (or on an error) the state stays null: no buff. */
export function useMotel(token: string | null): {
  state: MotelState | null; apply: (s: MotelState) => void; reload: () => Promise<void>; rested: boolean; offsetMs: number;
} {
  const [held, setHeld] = useState<{ token: string; state: MotelState; offsetMs: number } | null>(null);
  const [ended, setEnded] = useState<number | null>(null);
  const seq = useRef(0);
  const apply = useCallback((s: MotelState) => {
    if (!token) return;
    seq.current++;
    setHeld({ token, state: s, offsetMs: s.serverNowMs - Date.now() });
  }, [token]);
  const reload = useCallback(async () => {
    if (!token) return;
    const mine = ++seq.current;
    try {
      const s = await motelState(token);
      if (mine === seq.current) setHeld({ token, state: s, offsetMs: s.serverNowMs - Date.now() });
    } catch { /* keep what we had */ }
  }, [token]);
  useEffect(() => {
    if (!token) return;
    const first = setTimeout(() => void reload(), 0);
    return () => clearTimeout(first);
  }, [token, reload]);
  const state = held && held.token === token ? held.state : null;
  const offsetMs = held?.offsetMs ?? 0;
  // the server sends buff_until_ms only while the buff runs; a timer marks it ended at its end
  const until = state?.rest.buffUntilMs ?? null;
  useEffect(() => {
    if (until === null) return;
    const left = Math.max(0, until - (Date.now() + offsetMs));
    const id = setTimeout(() => setEnded(until), Math.min(left + 50, 2 ** 31 - 1));
    return () => clearTimeout(id);
  }, [until, offsetMs]);
  const rested = until !== null && ended !== until;
  return { state, apply, reload, rested, offsetMs };
}
