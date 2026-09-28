// Builds v20.2's shared fixtures from the TS (ruling R1):
//   tests/fixtures/kata-cases.json       charts and press lists with their scores (0050's _kata_*),
//   tests/fixtures/fight-bot-cases.json  player logs against the bot (0049's _fx_bot / _fx_step_bots / _fx_run_bots).
// tests/unit/dojo-fixtures.test.ts checks the JSON equals this; tests/sql/v20-2-smoke.sql replays both.
// Rewrite them (after a change, with the SQL changed in the same commit):
//   WRITE_DOJO_FIXTURES=1 pnpm vitest run tests/unit/dojo-fixtures.test.ts

import { botInput, stepWithBots } from "@/lib/game/fight/bot";
import {
  BOT_DUMMY, F_BOT, F_BOTMEM, G_PHASE, G_RNG, PH_OVER, createMatch, fb, fighterParams, hash, makeParams, roundResults,
  type FighterParams, type MatchParams, type State,
} from "@/lib/game/fight/engine";
import { kataChart, kataInputError, kataScore } from "@/lib/game/fight/kata";
import { RateLimiter, encodeRuns } from "@/lib/game/fight/log";

// ---------------------------------------------------------------- kata

export interface KataCase {
  name: string;
  seed: number;
  rank: number;
  /** The chart, flat: [tick, lane, …]. */
  chart: number[];
  length: number;
  presses: number[];
  expected: { error: string | null; score: [number, number, number, number, number, number] | null };
}

/** A small deterministic generator for the fixtures' own noise (not the game's PRNG). */
function lcg(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x;
  };
}

export function buildKataCases(): KataCase[] {
  const out: KataCase[] = [];
  const seeds = [1, 42, 777, 2654435761, 4294967295];
  for (const seed of seeds) for (const rank of [1, 2, 3, 4]) {
    const c = kataChart(seed, rank);
    const flat = c.notes.flatMap(([t, l]) => [t, l]);
    const add = (name: string, presses: number[]) => {
      const error = kataInputError(c, presses);
      const s = error ? null : kataScore(c, presses);
      out.push({
        name: `${name}-s${seed}-r${rank}`, seed, rank, chart: flat, length: c.length, presses,
        expected: { error, score: s ? [s.points, s.perfect, s.good, s.miss, s.extra, s.worst] : null },
      });
    };
    const r = lcg(seed ^ (rank * 7919));
    add("perfect", flat);
    add("late3", c.notes.flatMap(([t, l]) => [t + 3, l]));
    add("early7", c.notes.flatMap(([t, l]) => [t - 7, l]));
    add("half", c.notes.filter((_, i) => i % 2 === 0).flatMap(([t, l]) => [t, l]));
    // jitter ±12 with a wrong lane now and then, and stray presses
    const jit: [number, number][] = [];
    for (const [t, l] of c.notes) {
      const d = (r() % 25) - 12;
      jit.push([Math.max(0, t + d), r() % 10 === 0 ? (l + 3) % 8 : l]);
      if (r() % 6 === 0) jit.push([Math.max(0, t + 5), r() % 8]);
    }
    jit.sort((a, b) => a[0] - b[0]);
    const capped = jit.filter((_, i) => i < 3 * c.notes.length);
    // at most 2 presses per tick
    const ok: [number, number][] = [];
    for (const p of capped) if (ok.filter((q) => q[0] === p[0]).length < 2) ok.push(p);
    add("jitter", ok.flat());
    if (seed === 42) {
      add("bad-order", [200, 1, 199, 1]);
      add("bad-lane", [200, 9]);
      add("bad-crowd", [200, 1, 200, 2, 200, 3]);
      add("bad-late", [c.length + 1, 0]);
      add("bad-count", Array.from({ length: 3 * c.notes.length + 1 }, (_, i) => [200 + i, i % 8]).flat());
      add("empty", []);
    }
  }
  return out;
}

// ---------------------------------------------------------------- the bot

export interface BotCase {
  name: string;
  params: MatchParams;
  /** The player's side ("p1" or "p2"); the other side is a bot. */
  player: "p1" | "p2";
  runs: number[];
  frames: number;
  expected: {
    rounds: { reason: number; winner: number; hp1: number; hp2: number; frame: number }[];
    result: number;
    hash: number;
    hashes: [number, number][];
  };
}

type Agent = (s: State) => number;

/** A "player" that plays like bot `level` from its own memory and PRNG kept outside the match (so the match's PRNG is
 *  the opponent's alone, as on the server). */
function shadowBot(side: number, level: number, seed: number): Agent {
  const mem = new Array<number>(6).fill(0);
  let rng = seed | 0;
  return (s) => {
    const t = s.slice();
    const b = fb(side);
    t[b + F_BOT] = level;
    for (let i = 0; i < 6; i++) t[b + F_BOTMEM + i] = mem[i];
    t[G_RNG] = rng;
    const m = botInput(t, side);
    for (let i = 0; i < 6; i++) mem[i] = t[b + F_BOTMEM + i];
    rng = t[G_RNG];
    return m;
  };
}
const idle: Agent = () => 0;

function botCase(name: string, params: MatchParams, player: "p1" | "p2", agent: Agent, limit = 30_900): BotCase {
  const lim = new RateLimiter();
  let s = createMatch(params);
  const masks: number[] = [];
  for (let k = 0; k < limit && s[G_PHASE] !== PH_OVER; k++) {
    const m = lim.limit(agent(s));
    masks.push(m);
    s = player === "p1" ? stepWithBots(s, m, 0) : stepWithBots(s, 0, m);
  }
  // replay from the log, as the server does, with the hashes every 600th frame
  let r = createMatch(params);
  const hashes: [number, number][] = [];
  for (let k = 0; k < masks.length; k++) {
    r = player === "p1" ? stepWithBots(r, masks[k], 0) : stepWithBots(r, 0, masks[k]);
    if ((k + 1) % 600 === 0) hashes.push([k + 1, hash(r)]);
  }
  return {
    name, params, player, runs: encodeRuns(masks), frames: masks.length,
    expected: { rounds: roundResults(r), result: r[7], hash: hash(r), hashes },
  };
}

/** An exam's params: the player at `rank` of `style` against the master at `rank + 1` with the belt's bot level. */
export function examParams(style: number, rank: number, level: number, seed: number): MatchParams {
  const master: FighterParams = fighterParams(style, rank + 1, { bot: level });
  return makeParams(fighterParams(style, rank), master, { seed, rounds: 3, maxRounds: 5 });
}

export function buildBotCases(): BotCase[] {
  const out: BotCase[] = [];
  // exams: a strong player (plays like level 8) against every exam level, and an idle one who loses
  for (const [style, rank, level, seed] of [[1, 0, 1, 101], [2, 1, 2, 102], [3, 2, 3, 103], [7, 3, 4, 104]] as const) {
    out.push(botCase(`exam-strong-style${style}-r${rank}-l${level}`, examParams(style, rank, level, seed), "p1", shadowBot(0, 8, seed * 31)));
    out.push(botCase(`exam-idle-style${style}-r${rank}-l${level}`, examParams(style, rank, level, seed + 50), "p1", idle));
  }
  // every level 1–8 against a middling player, across the styles
  for (let level = 1; level <= 8; level++) {
    const style = 1 + ((level - 1) % 7);
    const p = makeParams(fighterParams((style % 7) + 1, 4), fighterParams(style, 4, { bot: level }), { seed: 200 + level });
    out.push(botCase(`level${level}-style${style}`, p, "p1", shadowBot(0, 4, 900 + level)));
  }
  // one round, the dummy, and a bot on the red side
  out.push(botCase("one-round-l5", makeParams(fighterParams(4, 2), fighterParams(5, 4, { bot: 5 }), { seed: 301, rounds: 1, maxRounds: 1 }), "p1", shadowBot(0, 6, 5)));
  out.push(botCase("dummy", makeParams(fighterParams(6, 4), fighterParams(0, 0, { bot: BOT_DUMMY }), { seed: 302 }), "p1", shadowBot(0, 8, 6)));
  out.push(botCase("bot-as-red", makeParams(fighterParams(2, 4, { bot: 6 }), fighterParams(3, 4), { seed: 303 }), "p2", shadowBot(1, 5, 7)));
  return out;
}
