"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { econErrText, type TradeState } from "./model";
import { tradeOpen, tradeState } from "./rpc";

/** Polling of the trade window (v21 #40): every 5 s while nothing is open, every 2 s while a trade is. A finished trade
 *  is toasted once. */
export function useTrade(token: string | null, roomId: string, toast: (text: string) => void) {
  const [state, setState] = useState<TradeState | null>(null);
  const seen = useRef<number | null>(null);
  const toastRef = useRef(toast);
  useEffect(() => { toastRef.current = toast; }, [toast]);
  const open = state?.trade != null;

  const apply = useCallback((s: TradeState) => {
    setState(s);
    if (s.lastDone && s.lastDone.id !== seen.current) {
      seen.current = s.lastDone.id;
      toastRef.current(s.lastDone.status === "done" ? `🤝 Giao dịch với ${s.lastDone.partnerName} đã xong!` : `Giao dịch với ${s.lastDone.partnerName} đã huỷ.`);
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    let live = true;
    const tick = () => { tradeState(token).then((s) => { if (live) apply(s); }, () => {}); };
    tick();
    const id = window.setInterval(tick, open ? 2000 : 5000);
    return () => { live = false; window.clearInterval(id); };
  }, [token, open, apply]);

  /** Open a window with a player standing near me; resolves to an error text, or null. */
  const start = useCallback(async (partner: string): Promise<string | null> => {
    if (!token) return "Có lỗi, thử lại sau nhé.";
    try {
      apply(await tradeOpen(roomId, token, partner));
      return null;
    } catch (e) {
      return econErrText(e);
    }
  }, [token, roomId, apply]);

  return { state, apply, start };
}
