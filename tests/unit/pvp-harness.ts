// A simulated two-client PvP harness for the v20.3 netcode tests: two PvpMatch clients on a fake transport (seeded
// latency, jitter, reordering and dropped bursts), each with its own error in the server clock, pushing to a TS model of
// 0051's fight_push (own runs, seen, the conflict check, the streamed sim over the frames both logs cover, the deferred
// hash check, the end). Everything runs on a virtual clock, so a run is deterministic per seed.

import { G_PHASE, G_RESULT, PH_OVER, createMatch, hash, step, type MatchParams, type State } from "@/lib/game/fight/engine";
import { recordBots } from "@/lib/game/fight/bot";
import { fighterParams, makeParams } from "@/lib/game/fight/engine";
import { PvpMatch, resumeLog, type PvpPush } from "@/lib/game/fight/pvp";
import type { FiBody } from "@/lib/game/fight/rollback";

export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const encode = (masks: readonly number[]): number[] => {
  const r: number[] = [];
  for (const m of masks) {
    const l = r.length;
    if (l > 0 && r[l - 2] === m) r[l - 1]++;
    else r.push(m, 1);
  }
  return r;
};

const expand = (runs: readonly number[]): number[] => {
  const out: number[] = [];
  for (let i = 0; i + 1 < runs.length; i += 2) for (let k = 0; k < runs[i + 1]; k++) out.push(runs[i]);
  return out;
};

export interface ServerAnswer {
  status: "live" | "done" | "disputed";
  simFrame: number;
  frontier: number;
  seenFrontier: number;
  resync: boolean;
}

/** A TS model of 0051's PvP pipeline (the SQL smoke pins the SQL; this pins the client against the same rules). */
export class FakeServer {
  sim: State;
  simFrame = 0;
  status: "live" | "done" | "disputed" = "live";
  readonly runs: [number[], number[]] = [[], []];
  readonly seen: [number[], number[]] = [[], []];
  private readonly checked = [-1, -1];
  private readonly pend: [[number, number] | null, [number, number] | null] = [null, null];
  readonly resyncFor = [false, false];
  readonly mismatches = [0, 0];
  pushes = 0;

  constructor(readonly params: MatchParams) {
    this.sim = createMatch(params);
  }

  push(side: 0 | 1, p: PvpPush): ServerAnswer {
    this.pushes++;
    if (this.status === "live") {
      this.append(this.runs[side], p.from, expand(p.runs));
      this.append(this.seen[side], p.seenFrom, expand(p.seenRuns));
      this.conflicts();
    }
    if (this.status === "live") {
      if (p.hashFrame !== null && p.hash !== null) this.pend[side] = [p.hashFrame, p.hash];
      const target = Math.min(this.runs[0].length, this.runs[1].length, this.simFrame + 300);
      const from = this.simFrame;
      for (let k = from; k < target && this.sim[G_PHASE] !== PH_OVER; k++) {
        this.sim = step(this.sim, this.runs[0][k], this.runs[1][k]);
        this.simFrame = k + 1;
        for (const s of [0, 1] as const) {
          const q = this.pend[s];
          if (q && q[0] === this.simFrame) {
            this.pend[s] = null;
            if (this.checked[s] >= q[0] - 1 && q[1] !== hash(this.sim)) {
              this.mismatches[s]++;
              this.resyncFor[s] = true;
            }
          }
        }
      }
      if (this.sim[G_PHASE] === PH_OVER) this.status = "done";
    }
    const resync = this.resyncFor[side];
    this.resyncFor[side] = false;
    return { status: this.status, simFrame: this.simFrame, frontier: this.runs[side].length - 1, seenFrontier: this.seen[side].length - 1, resync };
  }

  get result(): number {
    return this.sim[G_RESULT];
  }

  private append(log: number[], from: number, masks: number[]): void {
    if (from > log.length) throw new Error(`gap: from ${from}, have ${log.length}`);
    for (let i = 0; i < masks.length; i++) {
      const k = from + i;
      if (k < log.length) {
        if (log[k] !== masks[i]) throw new Error(`overlap differs at ${k}`);
      } else log.push(masks[i]);
    }
  }

  private conflicts(): void {
    for (const s of [0, 1] as const) {
      const hi = Math.min(this.seen[s].length, this.runs[1 - s].length) - 1;
      for (let k = this.checked[s] + 1; k <= hi; k++) {
        if (this.seen[s][k] !== this.runs[1 - s][k]) {
          this.status = "disputed";
          return;
        }
      }
      if (hi > this.checked[s]) this.checked[s] = hi;
    }
  }

  /** fight_state for a side: the sim, its frame, the opponent's canonical runs up to both frontiers. */
  state(side: 0 | 1): { sim: State; simFrame: number; oppRuns: number[] } {
    const n = Math.min(this.runs[0].length, this.runs[1].length);
    const opp = this.runs[1 - side].slice(0, n);
    const r: number[] = [];
    for (const m of opp) {
      const l = r.length;
      if (l > 0 && r[l - 2] === m) r[l - 1]++;
      else r.push(m, 1);
    }
    return { sim: this.sim.slice(), simFrame: this.simFrame, oppRuns: r };
  }
}

export interface DuelOptions {
  seed: number;
  /** One-way latency range (ms) of each packet (jitter reorders them). */
  latency: [number, number];
  /** Packets sent inside these windows (ms) are lost (a websocket reconnect). */
  drops?: Array<[number, number]>;
  /** Each client's error in its server clock (ms). */
  clockError?: [number, number];
  /** The RPC round trip (ms). */
  rpcMs?: number;
  delay?: number;
  rounds?: 1 | 3;
  /** Stop after this much virtual time (ms). */
  maxMs?: number;
  /** Called every virtual render tick (for extra assertions). */
  onTick?: (t: number, a: PvpMatch, b: PvpMatch, server: FakeServer) => void;
  /** Reload side 0's page at this time: a new client resumes from fight_state and its stored log (none: server runs). */
  reloadAt?: number;
  reloadStorage?: boolean;
  /** v20.4: every packet that made it onto the wire (a spectator on the topic hears them too). */
  tap?: (t: number, side: 0 | 1, p: FiBody) => void;
}

export interface DuelResult {
  a: PvpMatch;
  b: PvpMatch;
  server: FakeServer;
  params: MatchParams;
  ms: number;
  maxDepth: number;
  desyncs: number;
}

/** Realistic held keys: a bot-vs-bot recording, replayed as each player's keys by local frame. */
export function botKeys(params: MatchParams, frames: number): [number[], number[]] {
  const out: [number[], number[]] = [[], []];
  for (let i = 0; out[0].length < frames; i++) {
    const botted = { ...params, seed: params.seed + i * 7919, p1: { ...params.p1, bot: 6 }, p2: { ...params.p2, bot: 5 } };
    const m = recordBots(createMatch(botted), frames - out[0].length).masks;
    out[0].push(...m[0]);
    out[1].push(...m[1]);
  }
  return out;
}

export function duelParams(o: { seed: number; delay?: number; rounds?: 1 | 3 }): MatchParams {
  return makeParams(fighterParams(3, 4, { en0: 500 }), fighterParams(2, 4, { en0: 500 }), { seed: o.seed, rounds: o.rounds ?? 1, delay: o.delay ?? 4 });
}

export function runDuel(o: DuelOptions): DuelResult {
  const rnd = mulberry(o.seed);
  const params = duelParams(o);
  const keys = botKeys(params, 40_000);
  const start = 1000;
  let stored: number[] | null = null;
  const a = new PvpMatch(params, 0, start, (runs) => { stored = runs; }), b = new PvpMatch(params, 1, start);
  const server = new FakeServer(params);
  const clients: [PvpMatch, PvpMatch] = [a, b];
  let reloaded = false;
  const err = o.clockError ?? [0, 0];
  const rpc = o.rpcMs ?? 120;
  type Msg = { at: number; to: 0 | 1; p: FiBody };
  const wire: Msg[] = [];
  const answers: Array<{ at: number; side: 0 | 1; ans: ServerAnswer }> = [];
  const nextTick = [start - 50, start - 40];
  let maxDepth = 0, desyncs = 0;
  const maxMs = o.maxMs ?? 400_000;
  let t = 0;
  for (t = 0; t < maxMs; t += 1) {
    // deliveries due now (jitter may deliver out of send order)
    for (let i = 0; i < wire.length; i++) {
      const m = wire[i];
      if (m.at <= t) {
        clients[m.to].session.onPacket(m.p, t);
        wire.splice(i--, 1);
      }
    }
    for (let i = 0; i < answers.length; i++) {
      const x = answers[i];
      if (x.at <= t) {
        answers.splice(i--, 1);
        const c = clients[x.side];
        c.pushDone(x.ans.frontier, x.ans.seenFrontier);
        if (x.ans.resync) {
          const st = server.state(x.side);
          c.resync(st.sim, st.simFrame, st.oppRuns);
        }
      }
    }
    if (o.reloadAt !== undefined && !reloaded && t >= o.reloadAt) {
      // the page reloads: in-flight answers to the old tab are lost; the new tab reads fight_state
      reloaded = true;
      for (let i = 0; i < answers.length; i++) if (answers[i].side === 0) answers.splice(i--, 1);
      const st = server.state(0);
      const serverRuns = encode(server.runs[0]);
      const fresh = new PvpMatch(params, 0, start, (runs) => { stored = runs; });
      fresh.restore(resumeLog(serverRuns, o.reloadStorage === false ? null : stored), st.oppRuns, st.sim, st.simFrame, server.runs[0].length - 1);
      clients[0] = fresh;
    }
    for (const side of [0, 1] as const) {
      if (t < nextTick[side]) continue;
      nextTick[side] = t + 16 + Math.floor(rnd() * 3);            // a ~60 Hz render loop with jitter
      const c = clients[side];
      const frame = c.session.frame;
      c.tick(t + err[side], t, keys[side][frame] ?? 0);
      if (c.session.desync !== null) {
        desyncs++;
        const st = server.state(side);
        c.resync(st.sim, st.simFrame, st.oppRuns);
      }
      maxDepth = Math.max(maxDepth, c.session.frame - c.session.confirmedFrame);
      const p = c.packet(t);
      if (p) {
        const lost = (o.drops ?? []).some(([lo, hi]) => t >= lo && t < hi);
        if (!lost) wire.push({ at: t + o.latency[0] + Math.floor(rnd() * (o.latency[1] - o.latency[0] + 1)), to: (1 - side) as 0 | 1, p });
        if (!lost) o.tap?.(t, side, p);
      }
      const push = c.nextPush(t);
      if (push) {
        const ans = server.push(side, push);                      // applied at once; the answer comes back a trip later
        answers.push({ at: t + rpc, side, ans });
      }
    }
    o.onTick?.(t, clients[0], clients[1], server);
    if (server.status !== "live" && clients[0].session.over && clients[1].session.over) break;
  }
  return { a: clients[0], b: clients[1], server, params, ms: t, maxDepth, desyncs };
}

/** The server's replay, independently: both pushed logs through the engine from frame 0. */
export function replay(params: MatchParams, runs: readonly [number[], number[]], frames: number): State {
  let s = createMatch(params);
  for (let k = 0; k < frames && s[G_PHASE] !== PH_OVER; k++) s = step(s, runs[0][k] ?? 0, runs[1][k] ?? 0);
  return s;
}
