// v20.3 PvP: the rollback (GGPO-style) session with a small input delay (spec §v20.3 "Netcode", plan rulings P9–P13).
// Pure: no clock, no network — the caller gives it the server-clock frame, the held keys, the time and the packets.
//
// Frames: frame k's inputs are (a[k], b[k]); the local mask sampled while the local sim steps frame t is my input of
// frame t + N (frames 0 … N − 1 are 0 for both sides). My inputs are final once generated. The session keeps the
// confirmed state at frame `confirmedFrame` (every input of the frames before it known) and re-simulates the prediction
// from it up to the local frame (the opponent's last confirmed mask repeated): the rollback depth is local − confirmed,
// never more than W — past that the local frame stalls. Banners, the KO, the end and the result come from the
// confirmed state only.

import { G_PHASE, IN_HK, IN_HP, IN_LK, IN_LP, IN_SK, PH_OVER, createMatch, hash, step, type MatchParams, type State } from "./engine";
import { RateLimiter, encodeRuns } from "./log";
import { FRAME_MS, MAX_SENDS_PER_S, ROLLBACK_W, SEND_EARLY_MS, SEND_EVERY_MS, p90 } from "./net";
import { MAX_FRAME, MAX_PACKET_RUNS, type FiPacket } from "./packets";

/** A checkpoint hash every this many confirmed frames (the `h` of a packet, the pushes' hash). */
export const CHECKPOINT = 60;
/** Time sync: a decision every this many local frames; a lead above SYNC_SLACK frames slows the local clock by one. */
export const SYNC_EVERY = 20;
export const SYNC_SLACK = 2;
/** At most this many frames are stepped per call when catching up (a hidden tab, the end of a stall). */
export const CATCH_UP_MAX = 240;

const ATTACK = IN_LP | IN_HP | IN_LK | IN_HK | IN_SK;

export type FiBody = Omit<FiPacket, "id">;

export interface SessionStats {
  /** Local frame − confirmed frame at the last draw. */
  depth: number;
  maxDepth: number;
  /** Predictions that turned out wrong. */
  rollbacks: number;
  /** Frames of the clock that passed while the local sim stalled (reported to the server). */
  stallFrames: number;
  /** The p90 of the ack round trips (ms), 0 before any. */
  rtt: number;
  /** Frames the local clock is held back by the time sync. */
  slip: number;
}

export class RollbackSession {
  readonly delay: number;
  readonly window: number;
  /** The local (displayed) frame: frames stepped. */
  frame = 0;
  /** Highest own frame the opponent acknowledged (−1: none). */
  acked = -1;
  /** The frame at which a peer hash differed from mine (a desync: run procedure R), else null. */
  desync: number | null = null;
  private own: number[];
  private remote: number[];
  private conf: State;
  private confAt = 0;
  private lim = new RateLimiter();
  private readonly checkpoints = new Map<number, number>();
  private readonly peerHashes = new Map<number, number>();
  private hashSent = 0;
  private lastSend = -Infinity;
  private readonly sends: number[] = [];
  private edge = false;
  private prevOwn = 0;
  private readonly sentAt = new Map<number, number>();
  private readonly rtts: number[] = [];
  private slip = 0;
  private sinceSync = 0;
  private remoteSeenAt = -Infinity;
  private lastGoal = 0;
  private stalledSince: number | null = null;
  private cache: { frame: number; confAt: number; remoteLen: number; state: State } | null = null;
  private predicted: { upTo: number; mask: number } | null = null;
  private readonly st = { depth: 0, maxDepth: 0, rollbacks: 0, stallFrames: 0 };

  constructor(readonly params: MatchParams, readonly side: 0 | 1, opts: { window?: number } = {}) {
    this.delay = Math.max(0, Math.trunc(params.delay ?? 2));
    this.window = opts.window ?? ROLLBACK_W;
    this.own = new Array<number>(this.delay).fill(0);
    this.remote = new Array<number>(this.delay).fill(0);
    this.conf = createMatch(params);
  }

  /** The opponent's highest contiguous frame received (−1: none). */
  get remoteAck(): number {
    return this.remote.length - 1;
  }
  /** Frames of my own inputs generated (0 … ownKnown − 1). */
  get ownKnown(): number {
    return this.own.length;
  }
  get confirmedFrame(): number {
    return this.confAt;
  }
  get confirmed(): State {
    return this.conf;
  }
  get over(): boolean {
    return this.conf[G_PHASE] === PH_OVER;
  }
  /** The local frame may not run more than W frames past the newest confirmed opponent frame. */
  get stalled(): boolean {
    return this.frame - this.remote.length >= this.window;
  }
  ownInput(k: number): number | undefined {
    return this.own[k];
  }
  remoteInput(k: number): number | undefined {
    return this.remote[k];
  }
  /** Milliseconds the local sim has been stalled (0 when it is not). */
  stalledFor(nowMs: number): number {
    return this.stalledSince === null ? 0 : Math.max(0, nowMs - this.stalledSince);
  }
  get stats(): SessionStats {
    return { ...this.st, rtt: p90(this.rtts), slip: this.slip };
  }

  /** My inputs of frames [from, to) as RLE runs (what a push sends). */
  ownRuns(from: number, to: number): number[] {
    return encodeRuns(this.own.slice(Math.max(0, from), Math.min(to, this.own.length)));
  }
  /** The opponent's inputs as received, frames [from, to) (the push's `seen`). */
  remoteRuns(from: number, to: number): number[] {
    return encodeRuns(this.remote.slice(Math.max(0, from), Math.min(to, this.remote.length)));
  }
  /** The confirmed checkpoint hash at `frame` (a multiple of 60), if still kept. */
  checkpoint(frame: number): number | undefined {
    return this.checkpoints.get(frame);
  }
  /** The newest checkpoint confirmed: [frame, hash], or null. */
  latestCheckpoint(): [number, number] | null {
    const f = Math.floor(this.confAt / CHECKPOINT) * CHECKPOINT;
    const h = this.checkpoints.get(f);
    return f > 0 && h !== undefined ? [f, h] : null;
  }

  /** Steps the local frame towards `target` (the server clock's frame) with the held keys; returns the frames stepped. */
  advanceTo(target: number, nowMs: number, mask: number, max = CATCH_UP_MAX): number {
    const goal = target - this.slip;
    let n = 0;
    while (this.frame < goal && n < max && !this.stalled && !this.over) {
      this.ensureOwn(this.frame + this.delay, mask);
      this.frame += 1;
      n += 1;
      if (++this.sinceSync >= SYNC_EVERY) {
        this.sinceSync = 0;
        this.sync(nowMs);
      }
    }
    // the clock frames that passed while stalled (what the push reports), and since when
    if (this.stalled && !this.over && goal > this.frame) {
      this.st.stallFrames += Math.max(0, goal - Math.max(this.lastGoal, this.frame));
      if (this.stalledSince === null) this.stalledSince = nowMs;
    } else this.stalledSince = null;
    this.lastGoal = goal;
    // the local frame runs on past the end of a match only until the end is confirmed
    if (this.over) this.stalledSince = null;
    this.confirm();
    return n;
  }

  /** The state to draw: the confirmed state, then the prediction up to the local frame. */
  display(): State {
    const c = this.cache;
    if (c && c.frame === this.frame && c.confAt === this.confAt && c.remoteLen === this.remote.length) return c.state;
    let s = this.conf;
    const last = this.remote[this.remote.length - 1] ?? 0;
    for (let k = this.confAt; k < this.frame && s[G_PHASE] !== PH_OVER; k++) {
      const mine = this.own[k] ?? 0;
      const theirs = k < this.remote.length ? this.remote[k] : last;
      s = this.side === 0 ? step(s, mine, theirs) : step(s, theirs, mine);
    }
    const depth = this.frame - this.confAt;
    this.st.depth = depth;
    if (depth > this.st.maxDepth) this.st.maxDepth = depth;
    this.predicted = this.frame > this.remote.length ? { upTo: this.frame, mask: last } : null;
    this.cache = { frame: this.frame, confAt: this.confAt, remoteLen: this.remote.length, state: s };
    return s;
  }

  /** A packet from the opponent: its ack of my inputs, its inputs (only the contiguous new frames count; duplicates
   *  and a packet past a gap change nothing), and its checkpoint hash. */
  onPacket(p: FiBody, nowMs: number): void {
    if (p.a > this.acked) {
      // the round trip of the newest frame this ack covers (the older ones were resent since)
      let best = -1, at = 0;
      for (const [f, t] of this.sentAt) {
        if (f > p.a) continue;
        if (f > best) {
          best = f;
          at = t;
        }
        this.sentAt.delete(f);
      }
      if (best >= 0) this.sampleRtt(nowMs - at);
      this.acked = Math.min(p.a, this.own.length - 1);
    }
    if (p.f <= this.remote.length) {
      const before = this.remote.length;
      let at = p.f;
      for (let i = 0; i + 1 < p.r.length && this.remote.length < MAX_FRAME; i += 2) {
        const m = p.r[i], end = at + p.r[i + 1];
        for (let k = Math.max(at, this.remote.length); k < end && this.remote.length < MAX_FRAME; k++) this.remote.push(m);
        at = end;
      }
      if (this.remote.length > before) {
        this.remoteSeenAt = nowMs;
        const pr = this.predicted;
        if (pr) {
          for (let k = before; k < Math.min(this.remote.length, pr.upTo); k++) {
            if (this.remote[k] !== pr.mask) {
              this.st.rollbacks += 1;
              break;
            }
          }
          this.predicted = null;
        }
      }
    }
    if (p.h) {
      const [f, h] = p.h;
      const mine = this.checkpoints.get(f);
      if (mine !== undefined) {
        if (mine !== h && this.desync === null) this.desync = f;
      } else if (f > this.confAt) this.peerHashes.set(f, h);
    }
    this.confirm();
  }

  /** My next `fi` (without the sender id), or null when it is not time yet: every 100 ms, early on an attack press
   *  edge after 50 ms, at most 12 a second. It resends every frame the opponent has not acknowledged (cut to 200 runs). */
  packet(nowMs: number): FiBody | null {
    const since = nowMs - this.lastSend;
    if (since < SEND_EVERY_MS && !(this.edge && since >= SEND_EARLY_MS)) return null;
    while (this.sends.length > 0 && this.sends[0] <= nowMs - 1000) this.sends.shift();
    if (this.sends.length >= MAX_SENDS_PER_S) return null;
    const from = this.acked + 1;
    const r: number[] = [];
    let covered = 0;
    for (let k = from; k < this.own.length; k++) {
      const n = r.length;
      if (n > 0 && r[n - 2] === this.own[k]) r[n - 1] += 1;
      else {
        if (n >= 2 * MAX_PACKET_RUNS) break;
        r.push(this.own[k], 1);
      }
      covered += 1;
    }
    const out: FiBody = { f: from, r, a: this.remote.length - 1 };
    const cp = this.latestCheckpoint();
    if (cp && cp[0] > this.hashSent) {
      out.h = cp;
      this.hashSent = cp[0];
    }
    if (covered > 0) this.sentAt.set(from + covered - 1, nowMs);
    if (this.sentAt.size > 64) this.sentAt.delete(this.sentAt.keys().next().value as number);
    this.lastSend = nowMs;
    this.sends.push(nowMs);
    this.edge = false;
    return out;
  }

  /** Procedure R: the server's sim at `simFrame` is canonical, the opponent's canonical inputs (`oppRuns`, from frame
   *  0) replace what was received for those frames, my own inputs stay (pushed inputs are final). */
  resync(sim: readonly number[], simFrame: number, oppRuns: readonly number[]): void {
    let at = 0;
    for (let i = 0; i + 1 < oppRuns.length && at < MAX_FRAME; i += 2) {
      for (let k = 0; k < oppRuns[i + 1] && at < MAX_FRAME; k++, at++) {
        if (at < this.remote.length) this.remote[at] = oppRuns[i];
        else this.remote.push(oppRuns[i]);
      }
    }
    this.conf = sim.slice();
    this.confAt = simFrame;
    if (simFrame > this.frame) this.frame = simFrame;
    for (const f of [...this.checkpoints.keys()]) if (f > simFrame) this.checkpoints.delete(f);
    if (simFrame % CHECKPOINT === 0 && simFrame > 0) this.checkpoints.set(simFrame, hash(this.conf));
    this.hashSent = Math.min(this.hashSent, Math.floor(simFrame / CHECKPOINT) * CHECKPOINT);
    this.desync = null;
    this.cache = null;
    this.predicted = null;
    this.confirm();
  }

  /** After a reload: my own log (from frame 0, the delay's zeros included), the opponent's canonical runs and the
   *  server's sim at `simFrame`. The local frame resumes where my inputs end. */
  restore(ownRuns: readonly number[], oppRuns: readonly number[], sim: readonly number[], simFrame: number): void {
    const own: number[] = [];
    for (let i = 0; i + 1 < ownRuns.length && own.length < MAX_FRAME; i += 2) {
      for (let k = 0; k < ownRuns[i + 1] && own.length < MAX_FRAME; k++) own.push(ownRuns[i]);
    }
    while (own.length < this.delay) own.push(0);
    this.own = own;
    this.lim = new RateLimiter();
    for (let k = this.delay; k < own.length; k++) this.lim.limit(own[k]);
    this.prevOwn = own[own.length - 1] ?? 0;
    this.frame = Math.max(0, own.length - this.delay);
    this.acked = -1;
    this.remote = new Array<number>(this.delay).fill(0);
    this.checkpoints.clear();
    this.peerHashes.clear();
    this.hashSent = 0;
    this.resync(sim, simFrame, oppRuns);
  }

  // ---------- internals ----------

  /** My inputs up to frame `k` exist (each through the rate limiter, so what is pushed is what was played). */
  private ensureOwn(k: number, mask: number): void {
    while (this.own.length <= k && this.own.length < MAX_FRAME) {
      const m = this.lim.limit(mask);
      if ((m & ATTACK & ~this.prevOwn) !== 0) this.edge = true;
      this.prevOwn = m;
      this.own.push(m);
    }
  }

  /** The confirmed state moves over every frame both sides' inputs are known (not past the local frame). */
  private confirm(): void {
    const lim = Math.min(this.own.length, this.remote.length, this.frame);
    while (this.confAt < lim && this.conf[G_PHASE] !== PH_OVER) {
      const k = this.confAt;
      this.conf = this.side === 0 ? step(this.conf, this.own[k], this.remote[k]) : step(this.conf, this.remote[k], this.own[k]);
      this.confAt += 1;
      if (this.confAt % CHECKPOINT === 0) {
        const h = hash(this.conf);
        this.checkpoints.set(this.confAt, h);
        const peer = this.peerHashes.get(this.confAt);
        if (peer !== undefined) {
          this.peerHashes.delete(this.confAt);
          if (peer !== h && this.desync === null) this.desync = this.confAt;
        }
        for (const f of this.checkpoints.keys()) if (f < this.confAt - 20 * CHECKPOINT) this.checkpoints.delete(f);
      }
    }
  }

  /** Time sync (GGPO): the opponent's frame is estimated from its newest input frame, the time since it arrived and
   *  half the round trip; a lead above 2 frames holds the local clock back one frame, a lag gives it back. */
  private sync(nowMs: number): void {
    if (!Number.isFinite(this.remoteSeenAt)) return;
    const theirs = this.remote.length - 1 - this.delay + 1 + (nowMs - this.remoteSeenAt + p90(this.rtts) / 2) / FRAME_MS;
    const adv = this.frame - theirs;
    if (adv > SYNC_SLACK) this.slip += 1;
    else if (adv < -SYNC_SLACK && this.slip > 0) this.slip -= 1;
  }

  private sampleRtt(ms: number): void {
    if (!(ms >= 0)) return;
    this.rtts.push(ms);
    if (this.rtts.length > 20) this.rtts.shift();
  }

  /** How many frames the local clock leads the estimated opponent frame (for tests and the network chip). */
  advantage(nowMs: number): number {
    if (!Number.isFinite(this.remoteSeenAt)) return 0;
    return this.frame - (this.remote.length - this.delay + (nowMs - this.remoteSeenAt + p90(this.rtts) / 2) / FRAME_MS);
  }
}
