"use client";

import { useEffect } from "react";
import { ensureNotifyPermission } from "@/lib/notify";

const NOTIFY_KEY = "music-together:notify";

/**
 * Request desktop-notification permission on first load. Chrome/Edge show the
 * prompt immediately; Firefox/Safari ignore non-gesture requests (ChatPanel's
 * gesture fallback — first send / bell — covers those). Only prompts when
 * notifications are enabled (default on) and permission is still undecided
 * (`ensureNotifyPermission` no-ops unless `Notification.permission === "default"`).
 */
export default function NotifyOnLoad() {
  useEffect(() => {
    let on = true;
    try { on = localStorage.getItem(NOTIFY_KEY) !== "0"; } catch { /* default on */ }
    if (on) void ensureNotifyPermission();
  }, []);
  return null;
}
