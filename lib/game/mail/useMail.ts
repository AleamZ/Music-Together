"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MailBox } from "./model";
import { mailList } from "./rpc";

/** The mailbox's poll (0111): once a minute, and at once on refresh() (after a trade, a purchase, opening the box). The
 *  HUD shows `box.unread`. */
export function useMail(token: string | null, everyMs = 60_000) {
  const [box, setBox] = useState<MailBox | null>(null);
  const live = useRef(true);
  const refresh = useCallback(() => {
    if (!token) return;
    mailList(token).then((b) => { if (live.current) setBox(b); }, () => {});
  }, [token]);

  useEffect(() => {
    live.current = true;
    refresh();
    const id = window.setInterval(refresh, everyMs);
    return () => { live.current = false; window.clearInterval(id); };
  }, [refresh, everyMs]);

  return { box, apply: setBox, refresh };
}
