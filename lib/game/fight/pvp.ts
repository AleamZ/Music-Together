// v20.3 PvP: one fighter's side of a refereed ring match (spec §v20.3 "Netcode" and "Pushes", plan rulings P9–P15, P20).
// It drives the rollback session from the server clock (frame 0 at `started_at`), hands out the packets, and plans the
// pushes to fight_push: my own runs every 60 frames, what I received of the opponent (`seen`) and my newest confirmed
// checkpoint hash; an empty keepalive every 3 s during a stall; the rest at the confirmed end. Pure: the component owns
// the RPCs, the transport and the storage.

import type { MatchParams, State } from "./engine";
import { FPS } from "./net";
import { RollbackSession, type FiBody } from "./rollback";

/** A push every this many of my frames; at most PUSH_MAX frames (own or seen) per push. */
export const PUSH_EVERY = 60;
export const PUSH_MAX = 300;
/** During a stall the client still pushes (an empty keepalive) this often, so it is never claimable while present. */
export const KEEPALIVE_MS = 3000;
/** The claim rule (0051's fight_claim): the absentee's last push is older than CLAIM_AFTER_MS, mine within FRESH_MS. */
export const CLAIM_AFTER_MS = 20_000;
export const FRESH_MS = 10_000;
/** "⏳ Đang chờ đối thủ…" after a stall this long. */
export const STALL_BANNER_MS = 3000;
/** Frame 0 comes this long after both accepted (ring_accept). */
export const PVP_START_DELAY_S = 3;

export interface PvpPush {
  from: number;
  runs: number[];
  seenFrom: number;
  seenRuns: number[];
  hashFrame: number | null;
  hash: number | null;
  /** Stall frames since the last push (the server adds them up). */
  stall: number;
  /** My frames covered after this push (the server's frontier + 1). */
  to: number;
  seenTo: number;
}

export class PvpMatch {
  readonly session: RollbackSession;
  /** My frames the server holds (its frontier + 1) and the opponent frames it holds as my `seen`. */
  pushed = 0;
  seenPushed = 0;
  private inFlight: PvpPush | null = null;
  private lastPushAt = -Infinity;
  private hashPushed = 0;
  private stallPushed = 0;

  constructor(readonly params: MatchParams, readonly side: 0 | 1, readonly startedAtMs: number,
              private readonly persist?: (ownRuns: number[]) => void) {
    this.session = new RollbackSession(params, side);
  }

  /** Frames due by server time `serverNowMs` (the local sim never runs ahead of it). */
  due(serverNowMs: number): number {
    return Math.max(0, Math.floor(((serverNowMs - this.startedAtMs) * FPS) / 1000));
  }
  /** Seconds before frame 0 (the 3·2·1), ≥ 0. */
  countdown(serverNowMs: number): number {
    return Math.max(0, Math.ceil((this.startedAtMs - serverNowMs) / 1000));
  }

  /** Advance to the server clock with the held keys; returns the state to draw (the prediction). */
  tick(serverNowMs: number, nowMs: number, mask: number): State {
    this.session.advanceTo(this.due(serverNowMs), nowMs, mask);
    return this.session.display();
  }

  /** The next packet to broadcast (my log is stored first, so what the opponent saw survives a reload). */
  packet(nowMs: number): FiBody | null {
    const p = this.session.packet(nowMs);
    if (p && this.persist) this.persist(this.session.ownRuns(0, this.session.ownKnown));
    return p;
  }

  /** The next push, or null (one at a time). */
  nextPush(nowMs: number): PvpPush | null {
    if (this.inFlight) return null;
    const s = this.session;
    const end = s.over;
    let to = end ? s.ownKnown : Math.floor(s.ownKnown / PUSH_EVERY) * PUSH_EVERY;
    to = Math.min(to, this.pushed + PUSH_MAX);
    const seenTo = Math.min(s.remoteAck + 1, this.seenPushed + PUSH_MAX);
    const keepalive = nowMs - this.lastPushAt >= KEEPALIVE_MS;
    const ownDue = to - this.pushed >= (end ? 1 : PUSH_EVERY);
    const seenDue = end && seenTo > this.seenPushed;
    if (!ownDue && !seenDue && !keepalive) return null;
    to = Math.max(to, this.pushed);
    const cp = s.latestCheckpoint();
    const withHash = cp !== null && cp[0] > this.hashPushed;
    const stall = s.stats.stallFrames - this.stallPushed;
    const plan: PvpPush = {
      from: this.pushed, runs: s.ownRuns(this.pushed, to),
      seenFrom: this.seenPushed, seenRuns: s.remoteRuns(this.seenPushed, Math.max(seenTo, this.seenPushed)),
      hashFrame: withHash ? cp[0] : null, hash: withHash ? cp[1] : null, stall, to, seenTo: Math.max(seenTo, this.seenPushed),
    };
    this.inFlight = plan;
    this.lastPushAt = nowMs;
    return plan;
  }

  /** A push came back: the frontiers the server holds for me (own, seen; −1 none). */
  pushDone(frontier: number | null, seenFrontier: number | null): void {
    const p = this.inFlight;
    this.inFlight = null;
    if (frontier !== null && frontier + 1 > this.pushed) this.pushed = frontier + 1;
    if (seenFrontier !== null && seenFrontier + 1 > this.seenPushed) this.seenPushed = seenFrontier + 1;
    if (p) {
      this.stallPushed += p.stall;
      if (p.hashFrame !== null && p.hashFrame > this.hashPushed) this.hashPushed = p.hashFrame;
    }
  }

  /** A push failed (the network): it is planned again later. */
  pushFailed(): void {
    this.inFlight = null;
  }

  /** Procedure R (a desync, a push answering resync, the opponent's `fr`): the server's sim and the opponent's
   *  canonical runs from fight_state. */
  resync(sim: readonly number[], simFrame: number, oppRuns: readonly number[]): void {
    this.session.resync(sim, simFrame, oppRuns);
  }

  /** Resume after a reload: my own log (the longer of the stored one and the server's), the opponent's runs, the sim. */
  restore(ownRuns: readonly number[], oppRuns: readonly number[], sim: readonly number[], simFrame: number, pushedFrontier: number): void {
    this.session.restore(ownRuns, oppRuns, sim, simFrame);
    this.pushed = pushedFrontier + 1;
  }
}

/** The own log to resume with: the stored one when it extends the server's runs frame for frame, else the server's. */
export function resumeLog(serverRuns: readonly number[], stored: readonly number[] | null): number[] {
  if (!stored) return serverRuns.slice();
  const expand = (r: readonly number[]): number[] => {
    const out: number[] = [];
    for (let i = 0; i + 1 < r.length && out.length < 40_000; i += 2) for (let k = 0; k < r[i + 1]; k++) out.push(r[i]);
    return out;
  };
  const a = expand(serverRuns), b = expand(stored);
  if (b.length < a.length) return serverRuns.slice();
  for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return serverRuns.slice();
  return stored.slice();
}

/** localStorage key of a match's own log. */
export const logKey = (matchId: string): string => `fight:${matchId}`;
