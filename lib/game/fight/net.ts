// v20.3 PvP netcode numbers (spec §v20.3 "The numbers", plan rulings P12, P13). Pure.

export const FPS = 60;
export const FRAME_MS = 1000 / FPS;
/** The rollback window W: the local frame never runs more than W frames past the newest confirmed opponent frame. */
export const ROLLBACK_W = 12;
/** A lag L above this (≈ 300 ms) refuses the match on the ready screen. */
export const MAX_LAG = 18;
export const MIN_DELAY = 2;
export const MAX_DELAY = 6;
/** A packet every 100 ms (6 frames), early on an attack press edge after 50 ms, at most 12 a second. */
export const SEND_EVERY_MS = 100;
export const SEND_EARLY_MS = 50;
export const MAX_SENDS_PER_S = 12;
/** Ready-screen pings: 10 of them, 2 a second. */
export const PINGS = 10;
export const PING_EVERY_MS = 500;

/** The 90th percentile (nearest rank) of RTT samples; 0 without any. */
export function p90(samples: readonly number[]): number {
  if (samples.length === 0) return 0;
  const s = [...samples].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil(0.9 * s.length) - 1)];
}

/** L = ceil((rttP90 / 2 + 100 ms) / 16.67 ms): the expected lag of the opponent's confirmed input, in frames. The
 *  100 ms is the worst-case batching. Integer maths: (rtt / 2 + 100) × 60 / 1000 = (3 rtt + 600) / 100. */
export function lagFrames(rttMs: number): number {
  return Math.ceil((3 * Math.max(0, Math.round(rttMs)) + 600) / 100);
}

/** N = clamp(ceil(L / 2), 2, 6). */
export function inputDelay(lag: number): number {
  return Math.min(MAX_DELAY, Math.max(MIN_DELAY, Math.ceil(lag / 2)));
}

/** The ready screen's refusal for a link that is too slow, else null. */
export function lagRefusal(rttMs: number): string | null {
  return lagFrames(rttMs) > MAX_LAG ? `Mạng hai bên chậm quá để đấu (≈ ${Math.round(rttMs)} ms)` : null;
}
