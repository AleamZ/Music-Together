"use client";

import { useCallback, useEffect, useState } from "react";
import { reasonText, subscribeAnticheat } from "@/lib/anticheat";
import { serverNow } from "@/lib/game/farm/clock";

export interface AnticheatView {
  /** The warning (strike 1) or the ban (strike 2), or none. */
  modal: "warn" | "ban" | null;
  /** Why, for the modal's "Lý do:" line. */
  reason: string;
  /** Whole seconds left of the running lock; 0 when none runs. */
  secondsLeft: number;
  /** Closes the modal. */
  dismiss: () => void;
}

/** The lock ends the warning has shown for on this page load. */
const warned = new Set<number>();

/** The game shell's side of the anti-cheat layer (spec §12.1): the modal the last strike asks for, and the lock's
 *  countdown on the server's clock. The warning shows once per lock end per page load; a lock that only an
 *  `account locked` refusal reported (its code unknown) runs the countdown without a warning. */
export function useAnticheat(): AnticheatView {
  const [modal, setModal] = useState<{ kind: "warn" | "ban"; code: string } | null>(null);
  const [until, setUntil] = useState<number | null>(null);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => subscribeAnticheat((e) => {
    const warn = (end: number, code: string) => {
      if (warned.has(end)) return;
      warned.add(end);
      setModal((m) => (m?.kind === "ban" ? m : { kind: "warn", code }));
    };
    if (e.kind === "unlock") {
      setUntil(null);
    } else if (e.kind === "lock") {
      setUntil(e.until);
      if (e.code !== null) warn(e.until, e.code);
    } else if (e.info.strike === 2) {
      setModal({ kind: "ban", code: e.info.code });
    } else if (e.info.lockedUntil !== null) {
      setUntil(e.info.lockedUntil);
      warn(e.info.lockedUntil, e.info.code);
    }
  }), []);

  // the countdown ticks every second while the lock runs
  const running = until !== null && (now === null || until > now);
  useEffect(() => {
    if (!running) return;
    const tick = () => setNow(serverNow());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [running]);

  return {
    modal: modal?.kind ?? null,
    reason: modal ? reasonText(modal.code) : "",
    secondsLeft: until !== null && now !== null ? Math.max(0, Math.ceil((until - now) / 1000)) : 0,
    dismiss: useCallback(() => setModal(null), []),
  };
}
