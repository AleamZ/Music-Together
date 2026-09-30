"use client";

// 0087: the dig at an ore rock (0072) and the treasure shovel (0086) played live. The round stays on the server:
// mg_sync('mine' | 'dig') reveals the first vein at a secret tick and each next one once the strike that found the last
// one has been stamped, so a strike waits a moment after its vein shows (GATE_GUARD_MS; the server refuses a blind
// one). The strikes go up as they are made; the end (pass / fail / given up) goes to `onEnd` once.
import { useCallback, useEffect, useRef, useState } from "react";
import { GATE_GUARD_MS, liveTick, useLive, type LiveSync } from "@/lib/game/mglive";
import { canStrike, createMineRoundFrom, stepMineRound, withVeins, type MineRound } from "@/lib/game/mining/game";

export interface LiveDig {
  s: MineRound;
  ready: boolean;
  /** The current vein is on screen (a strike may go). */
  armed: boolean;
  strike: () => void;
  /** Give the dig up. */
  stop: () => void;
}

export function useLiveDig(sync: LiveSync | null, period: number, need: number, win: number,
                           onEnd: (strikes: readonly number[], ticks: number, pass: boolean) => void,
                           onStrike?: (hit: boolean) => void): LiveDig {
  const [s, setS] = useState(() => createMineRoundFrom(period, need, win));
  const [armed, setArmed] = useState(false);
  const struck = useRef(false);
  const latest = useRef(s);
  const over = useRef(false);
  const cb = useRef({ onEnd, onStrike });
  useEffect(() => {
    cb.current = { onEnd, onStrike };
  });
  const live = useLive(sync, () => [latest.current.strikes, null]);
  const liveRef = useRef(live);
  useEffect(() => {
    liveRef.current = live;
  });
  const end = useCallback((strikes: readonly number[], ticks: number, pass: boolean) => {
    if (over.current) return;
    over.current = true;
    liveRef.current.stop();
    cb.current.onEnd(strikes, ticks, pass);
  }, []);
  const stop = useCallback(() => end(latest.current.strikes.slice(), Math.max(1, latest.current.tick), false), [end]);
  useEffect(() => {
    if (live.failed) stop();
  }, [live.failed, stop]);

  useEffect(() => {
    if (!live.ready) return;
    const t0 = live.t0;
    let cur = createMineRoundFrom(period, need, win);
    let raf = requestAnimationFrame(function loop(now: number) {
      const due = liveTick(t0, now);
      cur = withVeins(cur, liveRef.current.ev.current ?? {});
      const seenAt = liveRef.current.at.current?.[cur.hits + 1];
      const on = cur.centres[cur.hits] >= 0 && seenAt !== undefined && now - seenAt >= GATE_GUARD_MS;
      while (cur.tick < due && cur.outcome === "open") {
        // a press is stamped on the tick it was made (the last one due), not on the first of a catch-up after a slow
        // frame: an earlier tick could claim the strike before its vein showed, and the server refuses that
        const hit = struck.current && on && canStrike(cur) && cur.tick === due - 1;
        if (cur.tick === due - 1) struck.current = false;
        const before = cur.hits;
        cur = stepMineRound(cur, hit);
        if (hit) {
          cb.current.onStrike?.(cur.hits > before);
          liveRef.current.flush();          // the next vein comes once this strike is stamped
          break;
        }
      }
      latest.current = cur;
      setS(cur);
      setArmed(on);
      if (cur.outcome !== "open") {
        end(cur.strikes.slice(), cur.tick, cur.outcome === "pass");
        return;
      }
      raf = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(raf);
  }, [live.ready, live.t0, period, need, win, end]);

  return { s, ready: live.ready, armed, strike: () => { struck.current = true; }, stop };
}
