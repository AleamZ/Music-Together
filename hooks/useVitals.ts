import { useCallback, useEffect, useRef, useState } from "react";
import { TICK_EVERY_MS } from "@/lib/game/vitals";
import { VITALS_EVENT, vitalsTick, type VitalsState, type VitalsWhere } from "@/lib/game/vitals-rpc";

/** The hunger/thirst heartbeat: ticks now and every 30 s while mounted (only while the tab is visible). Only the latest
 *  request's response is applied, and a state learned for another token is never shown. `where` (v18.10) reads where I
 *  stand at each tick (the heat). */
export function useVitals(token: string | null, roomId: string, where?: () => VitalsWhere | null): { state: VitalsState | null; reload: () => Promise<void> } {
  const [held, setHeld] = useState<{ token: string; state: VitalsState } | null>(null);
  const seq = useRef(0);
  const whereRef = useRef(where);
  useEffect(() => { whereRef.current = where; }, [where]);
  const reload = useCallback(async () => {
    if (!token) return;
    const mine = ++seq.current;
    try {
      const s = await vitalsTick(token, roomId, whereRef.current?.() ?? null);
      if (s && mine === seq.current) setHeld({ token, state: s });
    } catch { /* next tick retries */ }
  }, [token, roomId]);
  useEffect(() => {                                            // 0047: a cast's answer carries the new bars
    if (!token) return;
    const counter = seq;
    const on = (e: Event) => {
      const s = (e as CustomEvent<VitalsState>).detail;
      if (!s) return;
      counter.current++;                                       // an older tick in flight must not overwrite it
      setHeld({ token, state: s });
    };
    window.addEventListener(VITALS_EVENT, on);
    return () => window.removeEventListener(VITALS_EVENT, on);
  }, [token]);
  useEffect(() => {
    if (!token) return;
    const counter = seq;
    const first = setTimeout(() => void reload(), 0);
    const id = setInterval(() => { if (document.visibilityState === "visible") void reload(); }, TICK_EVERY_MS);
    return () => { clearTimeout(first); clearInterval(id); counter.current++; };
  }, [token, reload]);
  return { state: held && held.token === token ? held.state : null, reload };
}
