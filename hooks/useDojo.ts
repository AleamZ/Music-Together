import { useCallback, useRef, useState } from "react";
import { ServerClock } from "@/lib/game/fight/referee";
import { dojoState, type DojoState } from "@/lib/game/fight/rpc";

/** My dojo state (v20.2): fetched when the dojo or the punching bag opens (not on mount); `apply` takes a state an
 *  action returned. The clock is the server's (plan ruling P19). Before 0050 (or on an error) it stays null. */
export function useDojo(token: string | null): {
  state: DojoState | null; apply: (s: DojoState, sentAt?: number, receivedAt?: number) => void; reload: () => Promise<DojoState | null>;
  clock: ServerClock; error: unknown;
} {
  const [state, setState] = useState<DojoState | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [clock] = useState(() => new ServerClock());
  const seq = useRef(0);
  const apply = useCallback((s: DojoState, sentAt?: number, receivedAt?: number) => {
    seq.current++;
    const now = Date.now();
    clock.sample(s.serverNowMs, sentAt ?? now, receivedAt ?? now);
    setState(s);
    setError(null);
  }, [clock]);
  const reload = useCallback(async () => {
    if (!token) return null;
    const mine = ++seq.current;
    try {
      const r = await dojoState(token);
      clock.sample(r.value.serverNowMs, r.sentAt, r.receivedAt);
      if (mine === seq.current) {
        setState(r.value);
        setError(null);
      }
      return r.value;
    } catch (e) {
      if (mine === seq.current) setError(e);
      return null;
    }
  }, [token, clock]);
  return { state, apply, reload, clock, error };
}
