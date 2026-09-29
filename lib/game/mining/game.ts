import { togglesError } from "../farm/minigames";
import { rand32 } from "../fishing/reel";

// The dig at an ore rock (v21 #19): a marker sweeps a bar back and forth (a triangle over `period` ticks); a strike
// (Space, a click or a tap) hits when the marker is within `win` ‰ of the glowing vein. `need` hits pass; need + 3
// strikes without them fail. A 60 Hz integer sim on the server's seed: public._mine_replay replays the strike ticks and
// decides the outcome (0072). Any change here must be mirrored there — tests/fixtures/mine-cases.json pins both.
// 0087: the server rolls the dig itself and reveals it through mg_sync (hooks/useLiveDig.ts): the bar's period at the
// start, each vein (centre) when it may be struck at; createMineRoundFrom / withVeins build the round from that.

export const MINE = {
  hz: 60,
  /** The dig times out (a fail) after this many ticks. */
  maxTicks: 3600,
  /** Strikes at most, and at most `rate` in any 60 ticks (public._mine_input_error). */
  maxStrikes: 12,
  rate: 4,
  /** Extra strikes allowed beyond `need`. */
  spare: 3,
} as const;

/** [period, centre 1 … centre need] (public._mine_round). */
export function mineRound(seed: number, need: number): number[] {
  let st = seed >>> 0;
  let [u, next] = rand32(st);
  st = next;
  const out = [80 + (u % 61)];
  for (let i = 0; i < need; i++) {
    [u, next] = rand32(st);
    st = next;
    out.push(150 + (u % 701));
  }
  return out;
}

/** The marker at tick t, 0 … 1000 ‰ (public._mine_pos). */
export function minePos(period: number, t: number): number {
  const x = Math.floor(((t % period) * 2000) / period);
  return x <= 1000 ? x : 2000 - x;
}

/** The hit half-window in ‰ for a pickaxe tier and its +level (public._mine_win). */
export const mineWin = (tier: number, level: number): number => Math.min(220, 70 + 20 * tier + 12 * level);

export type MineOutcome = "pass" | "fail" | "open";
export interface MineReplay { outcome: MineOutcome; ticks: number | null; hits: number; used: number }

/** The dig from its strike ticks (public._mine_replay). */
export function replayMine(seed: number, need: number, win: number, strikes: readonly number[]): MineReplay {
  return replayMineP(mineRound(seed, need), need, win, strikes);
}
/** The same from the round [period, centre 1 … need] (0087's _mine_replay_p). */
export function replayMineP(rd: readonly number[], need: number, win: number, strikes: readonly number[]): MineReplay {
  let hits = 0, used = 0;
  for (const s of strikes) {
    used++;
    if (Math.abs(minePos(rd[0], s) - rd[hits + 1]) <= win) hits++;
    if (hits >= need) return { outcome: "pass", ticks: s + 1, hits, used };
    if (used >= need + MINE.spare) return { outcome: "fail", ticks: s + 1, hits, used };
  }
  return { outcome: "open", ticks: null, hits, used };
}

/** Why a strike list is one no dig makes (public._mine_input_error; null = fine). */
export function mineInputError(strikes: readonly number[], ticks: number): string | null {
  return togglesError(strikes, ticks, MINE.maxTicks, MINE.maxStrikes, MINE.rate);
}

/** A dig in progress, stepped once per tick on the client. */
export interface MineRound {
  seed: number;
  need: number;
  win: number;
  period: number;
  centres: number[];
  tick: number;
  hits: number;
  strikes: number[];
  /** The last strike's mark, for the feedback line. */
  last: "hit" | "miss" | null;
  outcome: MineOutcome;
}

export function createMineRound(seed: number, need: number, win: number): MineRound {
  const rd = mineRound(seed, need);
  return { seed, need, win, period: rd[0], centres: rd.slice(1), tick: 0, hits: 0, strikes: [], last: null, outcome: "open" };
}

/** 0087: a dig whose veins are not known yet (−1) — mg_sync reveals them one by one (events 1 … need: { c }). */
export function createMineRoundFrom(period: number, need: number, win: number): MineRound {
  return { seed: 0, need, win, period, centres: new Array<number>(need).fill(-1), tick: 0, hits: 0, strikes: [], last: null, outcome: "open" };
}
export function withVeins(s: MineRound, ev: Record<number, Record<string, number>>): MineRound {
  let centres = s.centres;
  for (let i = 1; i <= centres.length; i++) {
    const c = ev[i]?.c;
    if (c !== undefined && centres[i - 1] !== c) { if (centres === s.centres) centres = centres.slice(); centres[i - 1] = c; }
  }
  return centres === s.centres ? s : { ...s, centres };
}

/** One tick; `strike` is a strike at this tick (the rate limit is the caller's). */
export function stepMineRound(s: MineRound, strike: boolean): MineRound {
  if (s.outcome !== "open") return s;
  if (strike) {
    const hit = Math.abs(minePos(s.period, s.tick) - s.centres[s.hits]) <= s.win;
    const hits = s.hits + (hit ? 1 : 0);
    const strikes = [...s.strikes, s.tick];
    const outcome: MineOutcome = hits >= s.need ? "pass" : strikes.length >= s.need + MINE.spare ? "fail" : "open";
    return { ...s, hits, strikes, last: hit ? "hit" : "miss", outcome, tick: s.tick + 1 };
  }
  const tick = s.tick + 1;
  return tick >= MINE.maxTicks ? { ...s, tick, outcome: "fail" } : { ...s, tick };
}

/** A strike is allowed when the last `rate` strikes span at least 60 ticks (the server's rate rule). */
export function canStrike(s: MineRound): boolean {
  const n = s.strikes.length;
  return s.outcome === "open" && s.centres[s.hits] >= 0 && n < MINE.maxStrikes && (n < MINE.rate || s.tick - s.strikes[n - MINE.rate] >= 60);
}
