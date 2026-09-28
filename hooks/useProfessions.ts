import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { GameCanvasHandle } from "@/components/game/GameCanvas";
import { VITALS_EVENT } from "@/lib/game/vitals-rpc";
import { professionState, staminaTick } from "@/lib/game/professions/rpc";
import { speedBuffFactor, staminaNow, type ProfState, type StaminaState } from "@/lib/game/professions/model";

const TICK_MS = 15000;
const STATE_MS = 60000;

/** v21 (0077): the professions state (panel) and the stamina heartbeat — every 15 s (and soon after a cast or dig, whose
 *  answer carries vitals) it reports the sprint time and the hammock, and gets the bar back. The bar between answers is
 *  extrapolated from the server's regen rate; the engine may sprint while it holds more than 1. */
export function useProfessions(token: string | null, canvasRef: RefObject<GameCanvasHandle | null>) {
  const [held, setHeld] = useState<{ token: string; state: ProfState } | null>(null);
  const [stam, setStam] = useState<{ token: string; s: StaminaState; at: number } | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const seq = useRef(0);

  const apply = useCallback((s: ProfState) => {
    if (!token) return;
    setHeld({ token, state: s });
    if (s.stamina) setStam({ token, s: s.stamina, at: Date.now() });
  }, [token]);

  const reload = useCallback(async () => {
    if (!token) return;
    const mine = ++seq.current;
    try {
      const s = await professionState(token);
      if (mine === seq.current) apply(s);
    } catch { /* next time */ }
  }, [token, apply]);

  const tick = useCallback(async () => {
    if (!token) return;
    const c = canvasRef.current;
    try {
      const s = await staminaTick(token, c?.takeSprintMs() ?? 0, c?.inHammock() ?? false);
      if (s) setStam({ token, s, at: Date.now() });
    } catch { /* next tick */ }
  }, [token, canvasRef]);

  useEffect(() => {
    if (!token) return;
    const first = setTimeout(() => { void reload(); }, 0);
    const a = setInterval(() => { if (document.visibilityState === "visible") void tick(); }, TICK_MS);
    const b = setInterval(() => { if (document.visibilityState === "visible") void reload(); }, STATE_MS);
    const c = setInterval(() => setNowMs(Date.now()), 1000);
    let soon: ReturnType<typeof setTimeout> | null = null;
    const onVitals = () => { if (soon === null) soon = setTimeout(() => { soon = null; void tick(); }, 800); };
    window.addEventListener(VITALS_EVENT, onVitals);
    return () => {
      clearTimeout(first); clearInterval(a); clearInterval(b); clearInterval(c);
      if (soon !== null) clearTimeout(soon);
      window.removeEventListener(VITALS_EVENT, onVitals);
    };
  }, [token, reload, tick]);

  const state = held && held.token === token ? held.state : null;
  const st = stam && stam.token === token ? stam : null;
  const value = st ? staminaNow(st.s, nowMs - st.at) : null;
  const boost = state ? speedBuffFactor(state.buffs, nowMs) : 1;
  const canSprint = value !== null && value > 1;

  useEffect(() => { canvasRef.current?.setSprint(canSprint, boost); }, [canvasRef, canSprint, boost]);

  return { state, stamina: st?.s ?? null, staminaValue: value, nowMs, reload, apply, tick };
}
