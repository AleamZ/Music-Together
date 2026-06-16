export interface Identity {
  roomId: string;
  memberId: string;
  token: string;
}
export interface StoredIdentity extends Identity {
  code: string;
}

const KEY = (code: string) => `music-together:${code}`;

export function saveIdentity(v: StoredIdentity): void {
  localStorage.setItem(KEY(v.code), JSON.stringify(v));
}
export function loadIdentity(code: string): StoredIdentity | null {
  const raw = localStorage.getItem(KEY(code));
  return raw ? (JSON.parse(raw) as StoredIdentity) : null;
}
export function clearIdentity(code: string): void {
  localStorage.removeItem(KEY(code));
}

/** Progress in ms derived from room playback fields (no streaming/heartbeat). */
export function computeElapsedMs(p: {
  is_playing: boolean;
  started_at: string | null;
  paused_elapsed_ms: number;
}): number {
  if (!p.is_playing || !p.started_at) return p.paused_elapsed_ms;
  return Date.now() - new Date(p.started_at).getTime();
}
