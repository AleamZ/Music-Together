// v20.2: the client side of a refereed bot match (spec §v20.2 "The refereed-match pipeline", plan rulings P3, P11, P12).
// The server replays what is pushed (0049's fight_push) and decides the match; this only plays the same deterministic
// sim locally so the fight feels immediate. Frame 0 is at `started_at` in server time; the local sim never runs ahead
// of the clock, every mask passes the rate limiter, and the inputs are pushed in 60-frame steps with the hash of the
// state at the step's end. Pure: the overlay drives it with the clock and the keys.

import { stepWithBots } from "./bot";
import { G_PHASE, PH_OVER, createMatch, hash, type MatchParams, type State } from "./engine";
import { RateLimiter, RunRecorder } from "./log";

/** Frame 0 comes this long after the kata pass (0050's dojo_kata_submit). */
export const EXAM_START_DELAY_S = 8;
/** A bot match with no push for this long is the player's loss (0049's _fx_sweep). */
export const NO_PUSH_LOSS_S = 60;
/** The server lets a frontier run this many frames ahead of its clock (fight_push step 4). */
export const PACE_SLACK_FRAMES = 60;
/** At most this many frames per push. */
export const PUSH_MAX_FRAMES = 300;
/** The client pushes every this many frames (and at the end). */
export const PUSH_EVERY = 60;
/** At most this many frames are stepped per animation frame when catching up (a hidden tab). */
export const CATCH_UP_MAX = 240;

const FPS = 60;

/** The server clock from the `server_now_ms` of RPC answers: the median of the last 5 offsets (answer − half the trip). */
export class ServerClock {
  private readonly offsets: number[] = [];
  sample(serverNowMs: number, sentAtMs: number, receivedAtMs: number): void {
    if (!Number.isFinite(serverNowMs)) return;
    this.offsets.push(serverNowMs - (sentAtMs + receivedAtMs) / 2);
    if (this.offsets.length > 5) this.offsets.shift();
  }
  get offset(): number {
    if (this.offsets.length === 0) return 0;
    const s = [...this.offsets].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }
  now(clientNowMs: number): number {
    return clientNowMs + this.offset;
  }
}

export interface PushPlan {
  from: number;
  runs: number[];
  /** The frame count the hash is of (the push's end), with that hash. */
  hashFrame: number | null;
  hash: number | null;
  /** The frame count covered after this push. */
  to: number;
}

export class RefereedMatch {
  state: State;
  /** Frames stepped. */
  frame = 0;
  /** Frames the server has confirmed (its frontier + 1). */
  pushed = 0;
  private readonly rec = new RunRecorder();
  private readonly lim = new RateLimiter();
  private readonly hashes = new Map<number, number>();
  private inFlight = false;

  constructor(readonly params: MatchParams, readonly startedAtMs: number) {
    this.state = createMatch(params);
  }

  get over(): boolean {
    return this.state[G_PHASE] === PH_OVER;
  }

  /** How many frames may have been played by server time `serverNowMs` (never ahead of the clock). */
  due(serverNowMs: number): number {
    return Math.max(0, Math.floor(((serverNowMs - this.startedAtMs) * FPS) / 1000));
  }

  /** Seconds until frame 0 (the countdown), ≥ 0. */
  countdown(serverNowMs: number): number {
    return Math.max(0, Math.ceil((this.startedAtMs - serverNowMs) / 1000));
  }

  /** Steps the sim up to the clock with the held mask. Returns the frames stepped. */
  advance(serverNowMs: number, mask: number, max = CATCH_UP_MAX): number {
    const due = this.due(serverNowMs);
    let n = 0;
    while (this.frame < due && n < max && !this.over) {
      const m = this.lim.limit(mask);
      this.rec.push(m);
      this.state = stepWithBots(this.state, m, 0);
      this.frame += 1;
      n += 1;
      if (this.frame % PUSH_EVERY === 0 || this.over) this.hashes.set(this.frame, hash(this.state));
    }
    return n;
  }

  /** The next push, or null (one at a time; every 60 frames, or the rest once the match is over). */
  nextPush(): PushPlan | null {
    if (this.inFlight) return null;
    let to = this.over ? this.frame : Math.floor(this.frame / PUSH_EVERY) * PUSH_EVERY;
    if (to <= this.pushed) return null;
    to = Math.min(to, this.pushed + PUSH_MAX_FRAMES);
    const h = this.hashes.get(to);
    this.inFlight = true;
    return { from: this.pushed, runs: this.rec.runsBetween(this.pushed, to), hashFrame: h === undefined ? null : to, hash: h ?? null, to };
  }

  /** A push came back: the server's frontier (−1: none) is what it holds. */
  pushDone(frontier: number | null): void {
    this.inFlight = false;
    if (frontier !== null && frontier + 1 > this.pushed) this.pushed = frontier + 1;
    for (const k of this.hashes.keys()) if (k < this.pushed - PUSH_MAX_FRAMES) this.hashes.delete(k);
  }

  /** A push failed (network): try again later. */
  pushFailed(): void {
    this.inFlight = false;
  }

  /** Procedure R for a bot match: take the server's sim at `simFrame` and re-apply my own recorded frames past it. */
  resync(sim: State, simFrame: number): void {
    let s = sim.slice();
    for (let k = simFrame; k < this.frame; k++) s = stepWithBots(s, this.rec.maskAt(k), 0);
    this.state = s;
  }

  /** My recorded runs (for tests and a reload). */
  runs(): number[] {
    return this.rec.runs();
  }
}
