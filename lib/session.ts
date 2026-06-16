export interface StoredSession {
  accountId: string;
  username: string;
  token: string;
}

const KEY = "music-together:auth";

export function saveSession(s: StoredSession): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}
export function loadSession(): StoredSession | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredSession;
  } catch {
    return null;
  }
}
export function clearSession(): void {
  localStorage.removeItem(KEY);
}
