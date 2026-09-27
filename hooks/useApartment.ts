import { useCallback, useEffect, useRef, useState } from "react";
import { aptList, type AptList } from "@/lib/game/housing/apartment";

const POLL_MS = 5000;

/** The Chung cư Phú Mỹ list (v19.2): the 12 units, my home, my furniture storage and the knocks on my door. Fetched on
 *  mount, then every 5 s while `watch` (the lobby is open or I am at home, so knocks show up); `apply` takes the state an
 *  action RPC returned. Before 0041 (or on an error) it stays null. */
export function useApartment(token: string | null, watch: boolean): {
  state: AptList | null; apply: (s: AptList) => void; reload: () => Promise<void>;
} {
  const [held, setHeld] = useState<{ token: string; state: AptList } | null>(null);
  const seq = useRef(0);
  const apply = useCallback((s: AptList) => {
    if (!token) return;
    seq.current++;
    setHeld({ token, state: s });
  }, [token]);
  const reload = useCallback(async () => {
    if (!token) return;
    const mine = ++seq.current;
    try {
      const s = await aptList(token);
      if (mine === seq.current) setHeld({ token, state: s });
    } catch { /* keep what we had */ }
  }, [token]);
  useEffect(() => {
    if (!token) return;
    const first = setTimeout(() => void reload(), 0);
    const id = watch ? setInterval(() => void reload(), POLL_MS) : null;
    return () => {
      clearTimeout(first);
      if (id) clearInterval(id);
    };
  }, [token, reload, watch]);
  return { state: held && held.token === token ? held.state : null, apply, reload };
}
