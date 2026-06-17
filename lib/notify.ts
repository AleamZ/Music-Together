/** True if the browser supports the Notification API (and we're client-side). */
export function notifySupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

/** Request notification permission (must be called from a user gesture when status is "default").
 *  Returns the resulting permission; "denied" if unsupported. */
export async function ensureNotifyPermission(): Promise<NotificationPermission> {
  if (!notifySupported()) return "denied";
  if (Notification.permission === "default") {
    try { return await Notification.requestPermission(); } catch { return Notification.permission; }
  }
  return Notification.permission;
}

/** Show a desktop notification, but only when granted AND the tab is backgrounded. Fail-soft. */
export function notifyDesktop(title: string, body: string): void {
  if (!notifySupported() || Notification.permission !== "granted") return;
  if (typeof document !== "undefined" && !document.hidden) return; // only when tab is hidden
  try {
    const n = new Notification(title, { body, icon: "/logo.png" });
    n.onclick = () => { try { window.focus(); } catch { /* ignore */ } n.close(); };
  } catch { /* some browsers require the SW path — silent */ }
}
