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

/** The ready screen's RTT measurement (spec §v20.3 "Challenge flow" 2): PINGS pings, one every PING_EVERY_MS; each pong
 *  gives a round trip; the p90 decides L and N. Pure: the caller sends the pings, answers the opponent's and passes the
 *  pongs in. */
export class PingMeter {
  private sent = new Map<number, number>();
  private next = 0;
  private lastAt = -Infinity;
  readonly samples: number[] = [];

  /** The next ping to send now ({n, ms}), or null (not yet, or all sent). */
  ping(nowMs: number): { n: number; ms: number } | null {
    if (this.next >= PINGS || nowMs - this.lastAt < PING_EVERY_MS) return null;
    const n = this.next++;
    this.lastAt = nowMs;
    this.sent.set(n, nowMs);
    return { n, ms: nowMs };
  }
  /** A pong for ping `n` arrived. */
  pong(n: number, nowMs: number): void {
    const at = this.sent.get(n);
    if (at === undefined) return;
    this.sent.delete(n);
    this.samples.push(Math.max(0, nowMs - at));
  }
  /** Enough samples to decide (at least 3 once every ping went out; lost pings do not block). */
  get ready(): boolean {
    return this.samples.length >= PINGS || (this.next >= PINGS && this.samples.length >= 3);
  }
  get rtt(): number {
    return p90(this.samples);
  }
  /** Measure again (a new opponent). */
  reset(): void {
    this.sent.clear();
    this.next = 0;
    this.lastAt = -Infinity;
    this.samples.length = 0;
  }
}