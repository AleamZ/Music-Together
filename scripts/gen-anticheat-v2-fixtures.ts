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
import {
  CRAB, crabClosed, createCrabRound, createHarvestRound, replayCrab, replayHarvest, stepCrabRound, stepHarvestRound, ToggleRecorder,
  type CrabRound, type HarvestRound,
} from "@/lib/game/farm/minigames";
import { ratAt, SLING, slingMark, type SlingShot } from "@/lib/game/farm/sling";

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

/** The fixtures' own noise (not the game's PRNG). */
function lcg(seed: number): () => number {
  let x = seed >>> 0;
  return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x; };
}

// ---------------------------------------------------------------- the harvest (0061)

export interface HarvestCase {
  name: string;
  seed: number;
  toggles: number[];
  expected: { centres: number[]; outcome: string; ticks: number; score2: number };
}

/** Plays a round holding until the bar reaches `aim(centre, bundle)` (‰), then letting go. */
function harvestAgent(seed: number, aim: (c: number, i: number) => number, jitter?: () => number): number[] {
  let s: HarvestRound = createHarvestRound(seed);
  const rec = new ToggleRecorder();
  let wait = 0;
  while (!s.outcome) {
    let holding: boolean;
    if (s.beat > 0 || wait > 0) { holding = false; if (wait > 0) wait--; }
    else holding = !(s.charging && s.level >= aim(s.centres[s.bundle], s.bundle));
    if (!holding && s.charging && jitter) wait = jitter();
    rec.hold(s.tick, holding);
    s = stepHarvestRound(s, holding);
  }
  return rec.toggles;
}

export function buildHarvestCases(): HarvestCase[] {
  const out: HarvestCase[] = [];
  const add = (name: string, seed: number, toggles: number[]) => {
    const r = replayHarvest(seed, toggles);
    out.push({ name: `${name}-s${seed}`, seed, toggles, expected: { centres: [...createHarvestRound(seed).centres], ...r } });
  };
  for (const seed of [1, 42, 777, 2654435761, 4294967295]) {
    const r = lcg(seed ^ 0x5bd1e995);
    add("clean", seed, harvestAgent(seed, (c) => c));
    add("near", seed, harvestAgent(seed, (c, i) => c + (i % 2 === 0 ? 120 : -120)));
    add("four", seed, harvestAgent(seed, (c, i) => (i < 4 ? c : 200)));
    add("late", seed, harvestAgent(seed, () => 1000));
    add("hand", seed, harvestAgent(seed, (c) => c + (r() % 161) - 80, () => r() % 9));
  }
  add("idle", 5, []);
  add("stuck", 6, [0]);                                         // held from the start: full draws, never let go
  add("stray", 7, [5, 9, 400, 401, 402, 403, 900, 1500]);
  return out;
}

// ---------------------------------------------------------------- the crab (0062)

export interface CrabCase {
  name: string;
  seed: number;
  grabs: number[];
  ticks: number;
  expected: { phases: number[]; hits: number; tries: number; ticks: number };
}

function crabAgent(seed: number, grab: (s: CrabRound) => boolean, stopAfter = 3): { grabs: number[]; ticks: number } {
  let s = createCrabRound(seed);
  const grabs: number[] = [];
  while (!s.outcome && !(s.tries.length >= stopAfter && s.stage === "beat")) {
    const g = s.stage === "claws" && grab(s);
    if (g) grabs.push(s.tick);
    s = stepCrabRound(s, g);
  }
  return { grabs, ticks: s.tick };
}

export function buildCrabCases(): CrabCase[] {
  const out: CrabCase[] = [];
  const add = (name: string, seed: number, g: { grabs: number[]; ticks: number }) => {
    const r = replayCrab(seed, g.grabs, g.ticks);
    out.push({ name: `${name}-s${seed}`, seed, grabs: g.grabs, ticks: g.ticks, expected: { phases: [...createCrabRound(seed).phases], ...r } });
  };
  /** The claws in the next tick, when a grab would be judged. */
  const next = (s: CrabRound) => crabClosed(CRAB.periods[s.tries.length], s.phases[s.tries.length], s.t + 1);
  for (const seed of [3, 42, 999, 2654435761, 4294967295]) {
    const r = lcg(seed ^ 0x27d4eb2d);
    add("hits", seed, crabAgent(seed, next));
    add("pinches", seed, crabAgent(seed, (s) => !next(s)));
    add("slips", seed, crabAgent(seed, () => false));
    add("random", seed, crabAgent(seed, () => r() % 11 === 0));
    add("stop1", seed, crabAgent(seed, next, 1));
  }
  add("late-grab", 8, { grabs: [5, 10, 40, 41, 42], ticks: 900 });
  add("cut-short", 9, { grabs: [], ticks: 50 });
  return out;
}

// ---------------------------------------------------------------- the sling (0063)

export interface SlingCase {
  name: string;
  seed: number;
  /** The rat's x (mpx) after each listed tick. */
  path: [number, number][];
  shots: { shot: SlingShot; mark: string }[];
}

export function buildSlingCases(): SlingCase[] {
  const out: SlingCase[] = [];
  for (const seed of [1, 7, 42, 31337, 2654435761, 4294967295]) {
    const r = lcg(seed ^ 0x1b873593);
    const path: [number, number][] = [];
    for (const n of [0, 1, 17, 60, 150, 300, 777, 1500, 3600, 7000]) path.push([n, ratAt(seed, n).xm]);
    const shots: { shot: SlingShot; mark: string }[] = [];
    let at = SLING.reloadTicks;
    for (let k = 0; k < 8; k++) {
      const press = at + 1 + (r() % 90);
      const held = k % 4 === 0 ? 40 + (r() % 12) : k % 4 === 1 ? 20 + (r() % 10) : k % 4 === 2 ? 60 : 38 + (r() % 13);
      const release = press + Math.min(SLING.fillTicks, held);
      const land = release + SLING.flightTicks;
      // aim at the rat (k even), or somewhere on the lane
      const aim = k % 2 === 0 ? ratAt(seed, land).xm + ((r() % 13_000) - 6_500) : SLING.laneMinM + (r() % (SLING.laneMaxM - SLING.laneMinM));
      const shot = { press, release, aim: Math.max(SLING.laneMinM, Math.min(SLING.laneMaxM, aim)) };
      shots.push({ shot, mark: slingMark(seed, shot) });
      at = land + SLING.reloadTicks;
    }
    out.push({ name: `sling-s${seed}`, seed, path, shots });
  }
  return out;
}