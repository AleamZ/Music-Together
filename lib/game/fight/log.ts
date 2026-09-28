// v20 Võ đài: input logs as RLE runs `[mask, count, mask, count, …]` (spec §v20.1 "Client modules" and 0048's
// _fx_runs_decode / _fx_runs_error, which mirror decodeRuns / runsError).

export const MAX_MASK = 1023;
/** "rate": more than this many mask changes in any RATE_WINDOW frames. */
export const RATE_CHANGES = 20;
export const RATE_WINDOW = 60;

export type RunsError = "shape" | "odd" | "mask" | "count" | "too_long" | "rate";

/** Per-frame masks → runs (adjacent equal masks merge). */
export function encodeRuns(masks: readonly number[]): number[] {
  const out: number[] = [];
  for (const m of masks) {
    const n = out.length;
    if (n > 0 && out[n - 2] === m) out[n - 1] += 1;
    else out.push(m, 1);
  }
  return out;
}

/** Records one mask per frame. */
export class RunRecorder {
  private readonly r: number[] = [];
  private total = 0;
  push(mask: number): void {
    const n = this.r.length;
    if (n > 0 && this.r[n - 2] === mask) this.r[n - 1] += 1;
    else this.r.push(mask, 1);
    this.total += 1;
  }
  get frames(): number {
    return this.total;
  }
  runs(): number[] {
    return this.r.slice();
  }
  /** The runs of frames [from, frames): what a push or a packet sends. */
  runsFrom(from: number): number[] {
    return this.runsBetween(from, this.total);
  }
  /** The runs of frames [from, to). */
  runsBetween(from: number, to: number): number[] {
    const out: number[] = [];
    let at = 0;
    for (let i = 0; i < this.r.length && at < to; i += 2) {
      const m = this.r[i], c = this.r[i + 1];
      const lo = Math.max(at, from), hi = Math.min(at + c, to);
      if (hi > lo) out.push(m, hi - lo);
      at += c;
    }
    return out;
  }
  /** The mask of frame `k` (0 past the end). */
  maskAt(k: number): number {
    let at = 0;
    for (let i = 0; i < this.r.length; i += 2) {
      if (k < at + this.r[i + 1]) return this.r[i];
      at += this.r[i + 1];
    }
    return 0;
  }
}

/** v20.2 (plan ruling P11): keeps a player's own mask changes to at most RATE_CHANGES in any RATE_WINDOW frames, so an
 *  honest log never trips the server's "rate" rule. A change that would exceed it is held back (the previous mask stays)
 *  and the sim sees the limited mask, so what is pushed is what was played. */
export class RateLimiter {
  private prev = 0;
  private frame = 0;
  private readonly changes: number[] = [];
  limit(mask: number): number {
    const k = this.frame++;
    if (mask === this.prev) return mask;
    while (this.changes.length > 0 && this.changes[0] <= k - RATE_WINDOW) this.changes.shift();
    if (this.changes.length >= RATE_CHANGES) return this.prev;
    this.changes.push(k);
    this.prev = mask;
    return mask;
  }
}

/** Why runs are malformed (null: fine). `max` bounds the frames they cover. */
export function runsError(runs: readonly number[], max: number): RunsError | null {
  if (!Array.isArray(runs)) return "shape";
  if (runs.length % 2 !== 0) return "odd";
  let total = 0;
  const changes: number[] = [];
  let prev = -1;
  for (let i = 0; i < runs.length; i += 2) {
    const m = runs[i], c = runs[i + 1];
    if (!Number.isInteger(m) || m < 0 || m > MAX_MASK) return "mask";
    if (!Number.isInteger(c) || c < 1) return "count";
    if (i > 0 && m !== prev) changes.push(total);
    prev = m;
    total += c;
    if (total > max) return "too_long";
  }
  for (let k = RATE_CHANGES; k < changes.length; k++) {
    if (changes[k] - changes[k - RATE_CHANGES] < RATE_WINDOW) return "rate";
  }
  return null;
}

/** Runs → one mask per frame; null when they are malformed (see runsError) or cover more than `limit` frames. */
export function decodeRuns(runs: readonly number[], limit: number): number[] | null {
  if (runs.length % 2 !== 0) return null;
  const out: number[] = [];
  for (let i = 0; i < runs.length; i += 2) {
    const m = runs[i], c = runs[i + 1];
    if (!Number.isInteger(m) || m < 0 || m > MAX_MASK || !Number.isInteger(c) || c < 1) return null;
    if (out.length + c > limit) return null;
    for (let k = 0; k < c; k++) out.push(m);
  }
  return out;
}

/** The number of frames runs cover. */
export function runsLength(runs: readonly number[]): number {
  let n = 0;
  for (let i = 1; i < runs.length; i += 2) n += runs[i];
  return n;
}
