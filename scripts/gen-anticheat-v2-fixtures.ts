// Builds anti-cheat v2 part 2's shared fixtures from the TS (docs/superpowers/plans/2026-09-28-anticheat-v2-part2.md):
//   tests/fixtures/fight-secret-cases.json  secret-bot matches (0060's _fx_step_secret, re-seeded every round),
//   tests/fixtures/kata-noise-cases.json    the kata's reveal, offsets and robotic flag (0060's _kata_*).
// tests/unit/anticheat-v2-fixtures.test.ts checks the JSON equals this; tests/sql/anticheat-v2-fight-smoke.sql replays
// them. Rewrite them (after a change, with the SQL changed in the same commit):
//   WRITE_AV2_FIXTURES=1 pnpm vitest run tests/unit/anticheat-v2-fixtures.test.ts

import { SecretBotStream } from "@/lib/game/fight/bot";
import {
  G_PHASE, PH_OVER, createMatch, fighterParams, hash, makeParams, roundResults, type MatchParams,
} from "@/lib/game/fight/engine";
import { kataChart, kataOffsets, kataReveal, kataRobotic } from "@/lib/game/fight/kata";
import { RateLimiter, encodeRuns } from "@/lib/game/fight/log";
import { shadowBot } from "./gen-dojo-fixtures";

/** The fixtures' stand-in for the server's _fx_bot_seed: (round · 2654435761 + case · 40503) mod 2³², as an int32. */
export function fixtureSeed(caseNo: number, round: number): number {
  return Number((BigInt(round) * BigInt(2654435761) + BigInt(caseNo) * BigInt(40503)) % BigInt(4294967296)) | 0;
}

export interface SecretCase {
  name: string;
  no: number;
  params: MatchParams;
  runs: number[];
  frames: number;
  expected: { rounds: ReturnType<typeof roundResults>; result: number; hash: number; hashes: [number, number][] };
}

export function buildSecretCases(): SecretCase[] {
  const defs: Array<[string, number, number, number, number, number]> = [
    // name, player style, player rank, bot level, player (shadow bot) level, frames cap
    ["exam-r1", 1, 0, 1, 3, 12_000], ["exam-r3", 3, 2, 3, 5, 12_000], ["ladder-l6", 5, 4, 6, 6, 12_000],
    ["ladder-l8", 7, 4, 8, 2, 12_000], ["idle-l4", 2, 1, 4, 0, 30_900],
  ];
  return defs.map(([name, style, rank, level, shadow, cap], no) => {
    const params = makeParams(fighterParams(style, rank), fighterParams(style, rank + 1 > 4 ? 4 : rank + 1, { bot: level }),
      { seed: 0, secretBot: true, rounds: 3 });
    const agent = shadow > 0 ? shadowBot(0, shadow, 1000 + no) : () => 0;
    const lim = new RateLimiter();
    const stream = new SecretBotStream((r) => fixtureSeed(no, r));
    let s = createMatch(params);
    const masks: number[] = [];
    for (let k = 0; k < cap && s[G_PHASE] !== PH_OVER; k++) {
      const m = lim.limit(agent(s));
      masks.push(m);
      s = stream.step(s, m, 0);
    }
    const replay = new SecretBotStream((r) => fixtureSeed(no, r));
    let r = createMatch(params);
    const hashes: [number, number][] = [];
    for (let k = 0; k < masks.length; k++) {
      r = replay.step(r, masks[k], 0);
      if ((k + 1) % 600 === 0) hashes.push([k + 1, hash(r)]);
    }
    return {
      name, no, params, runs: encodeRuns(masks), frames: masks.length,
      expected: { rounds: roundResults(r), result: r[7], hash: hash(r), hashes },
    };
  });
}

export interface KataNoiseCase {
  name: string;
  seed: number;
  rank: number;
  presses: number[];
  upto: number;
  expected: { reveal: number[]; offsets: number[]; robotic: boolean };
}

export function buildKataNoiseCases(): KataNoiseCase[] {
  const out: KataNoiseCase[] = [];
  for (const seed of [7, 99, 31337]) for (const rank of [1, 3, 4]) {
    const c = kataChart(seed, rank);
    const flat = c.notes.flatMap(([t, l]) => [t, l]);
    let x = (seed * 7919 + rank) >>> 0;
    const rnd = () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x; };
    const add = (name: string, presses: number[], upto: number) => {
      out.push({
        name: `${name}-s${seed}-r${rank}`, seed, rank, presses, upto,
        expected: { reveal: kataReveal(flat, upto), offsets: kataOffsets(c, presses), robotic: kataRobotic(kataOffsets(c, presses)) },
      });
    };
    add("exact", flat, 240);
    add("late2", c.notes.flatMap(([t, l]) => [t + 2, l]), 600);
    add("hand", c.notes.flatMap(([t, l]) => [t + (rnd() % 7) - 3, l]), 1200);
    add("tick-or-two", c.notes.flatMap(([t, l]) => [t + (rnd() % 2), l]), c.length);
    add("sloppy", c.notes.filter(() => rnd() % 4 !== 0).flatMap(([t, l]) => [t + (rnd() % 13) - 6, (rnd() % 9 === 0 ? (l + 1) % 8 : l)]), 0);
  }
  return out;
}
