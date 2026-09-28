import { useCallback, useEffect, useRef, useState } from "react";
import { PET_TICK_MS } from "@/lib/game/pets/model";
import { petsState, petTick, type PetsState } from "@/lib/game/pets/rpc";

/** My pets (v18.12): fetched on mount, then a pet_tick every minute for this room (the sóc's forage; `onFound` hears the
 *  xu). Before 0036 (or on an error) the state stays null: no pet follows. `apply` takes the state an action RPC
 *  returned. */
export function usePets(token: string | null, roomId: string, onFound?: (xu: number) => void): {
  state: PetsState | null; apply: (s: PetsState) => void; reload: () => Promise<void>;
} {
  const [held, setHeld] = useState<{ token: string; state: PetsState } | null>(null);
  const seq = useRef(0);
  const found = useRef(onFound);
  useEffect(() => { found.current = onFound; }, [onFound]);
  const apply = useCallback((s: PetsState) => {
    if (!token) return;
    seq.current++;
    setHeld({ token, state: s });
  }, [token]);
  const load = useCallback(async (tick: boolean) => {
    if (!token) return;
    const mine = ++seq.current;
    try {
      const s = tick ? await petTick(token, roomId) : await petsState(token);
      if (mine !== seq.current) return;
      setHeld({ token, state: s });
      if (s.found && s.found > 0) found.current?.(s.found);
    } catch { /* keep what we had */ }
  }, [token, roomId]);
  const reload = useCallback(() => load(false), [load]);
  useEffect(() => {
    if (!token) return;
    const counter = seq;
    const first = setTimeout(() => void load(true), 0);
    const every = setInterval(() => void load(true), PET_TICK_MS);
    return () => { clearTimeout(first); clearInterval(every); counter.current++; };
  }, [token, load]);
  return { state: held && held.token === token ? held.state : null, apply, reload };
}
