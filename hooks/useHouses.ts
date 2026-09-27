import { useCallback, useEffect, useRef, useState } from "react";
import { houseList, type HouseList } from "@/lib/game/housing/house";

/** Khu nhà's lots (v19.3): the houses on the street, my lot and my rented room. Fetched on mount and then every
 *  `pollMs` while it is set (on Khu nhà, or a lot's panel is open); `apply` takes the state an action RPC returned.
 *  Before 0042 (or on an error) it stays null. */
export function useHouses(token: string | null, pollMs: number | null): {
  state: HouseList | null; apply: (s: HouseList) => void; reload: () => Promise<void>;
} {
  const [held, setHeld] = useState<{ token: string; state: HouseList } | null>(null);
  const seq = useRef(0);
  const apply = useCallback((s: HouseList) => {
    if (!token) return;
    seq.current++;
    setHeld({ token, state: s });
  }, [token]);
  const reload = useCallback(async () => {
    if (!token) return;
    const mine = ++seq.current;
    try {
      const s = await houseList(token);
      if (mine === seq.current) setHeld({ token, state: s });
    } catch { /* keep what we had */ }
  }, [token]);
  useEffect(() => {
    if (!token) return;
    const first = setTimeout(() => void reload(), 0);
    const id = pollMs ? setInterval(() => void reload(), pollMs) : null;
    return () => {
      clearTimeout(first);
      if (id) clearInterval(id);
    };
  }, [token, reload, pollMs]);
  return { state: held && held.token === token ? held.state : null, apply, reload };
}
