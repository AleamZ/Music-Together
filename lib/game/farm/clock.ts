// The server's clock as this client knows it (spec §11.6). Every farm answer and the fishing state carry server_now;
// countdowns and window checks use Date.now() + offset, so a client clock that is minutes off still shows the right
// times. Shared by the farm and the fishing HUD.

let offset = 0;

/** Note a server timestamp that arrived at `receivedAt` (client ms). Anything unreadable is ignored. */
export function syncClock(serverNow: string | number | null | undefined, receivedAt = Date.now()): void {
  const t = typeof serverNow === "number" ? serverNow : typeof serverNow === "string" ? Date.parse(serverNow) : NaN;
  if (Number.isFinite(t)) offset = t - receivedAt;
}

/** Now on the server's clock (ms since the epoch). */
export function serverNow(): number {
  return Date.now() + offset;
}

/** server − client, in ms. */
export function clockOffset(): number {
  return offset;
}
