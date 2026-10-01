"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GROUNDBAIT_POLL_MS, liveSpots, type GroundbaitSpotView } from "@/lib/game/fishing/groundbait-spots";
import { fetchGroundbaitSpots } from "@/lib/game/fishing/rpc";

/** 0117: the room's active ổ thính, polled every 15 s while the page is visible (and at once on `reload`, after a
 *  throw); a spot past its time drops out between polls. A failed poll keeps the last list. */
export function useGroundbaitSpots(token: string, roomId: string, enabled = true): { spots: GroundbaitSpotView[]; reload: () => void } {
  const [spots, setSpots] = useState<GroundbaitSpotView[]>([]);
  const seq = useRef(0);
  const reload = useCallback(() => {
    const n = ++seq.current;
    fetchGroundbaitSpots(roomId, token).then((s) => { if (n === seq.current) setSpots(s); }, () => {});
  }, [roomId, token]);
  useEffect(() => {
    if (!enabled) return;
    const first = window.setTimeout(reload, 0);
    const poll = window.setInterval(() => { if (document.visibilityState !== "hidden") reload(); }, GROUNDBAIT_POLL_MS);
    // the countdown's end: drop the spent ones without waiting for the next poll
    const sweep = window.setInterval(() => setSpots((s) => {
      const now = Date.now();
      return s.some((x) => x.untilMs <= now) ? liveSpots(s, now) : s;
    }), 1000);
    return () => { window.clearTimeout(first); window.clearInterval(poll); window.clearInterval(sweep); };
  }, [enabled, reload]);
  return { spots: enabled ? spots : [], reload };
}
