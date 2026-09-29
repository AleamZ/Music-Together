import { rand32 } from "@/lib/game/fishing/reel";
import {
  CARE_TICKS, careGain, careInputError, FEED, feedLanes, feedSpawn, FETCH, fetchFlights, fetchStart, pack, pressOff, pressPower,
  pressRound, replayCare, RUB, rubLikes, rubSegStart, type CareKind, type CareResult,
} from "@/lib/game/pets/minigames";

// v22 pets' fixtures: generated from lib/game/pets/minigames.ts, replayed by 0085's public._pcare_* / _ppress_* in
// tests/sql/v22-pets-smoke.sql. WRITE_PET_CARE_FIXTURES=1 vitest tests/unit/pet-minigames.test.ts rewrites
// tests/fixtures/pet-care-cases.json.

export interface CareCase {
  name: string;
  kind: CareKind;
  seed: number;
  inputs: number[];
  ticks: number;
  expected: CareResult & { error: string | null; gains: number[] };
}
export interface PressCase { name: string; seed: number; press: number | null; round: [number, number]; off: number | null; power: number }

type Style = "sharp" | "sloppy" | "bot" | "idle";

function noise(st: number): [number, number] {
  return rand32(st);
}

function playFeed(seed: number, style: Style): number[] {
  if (style === "idle") return [];
  const lanes = feedLanes(seed);
  const out: number[] = [];
  let st = seed ^ 0x2545f491, bowl = 2;
  for (let i = 0; i < FEED.foods; i++) {
    let delay = style === "bot" ? 0 : 14;
    let lane = lanes[i];
    if (style === "sloppy") {
      const [u, n] = noise(st);
      st = n;
      delay = 10 + (u % 70);
      if (u % 4 === 0) lane = (lane + 1) % FEED.lanes;
    }
    if (lane === bowl) continue;
    const t = feedSpawn(i) + delay;
    if (out.length && Math.floor(out[out.length - 1] / 8) >= t) continue;
    out.push(pack(t, lane));
    bowl = lane;
  }
  return out;
}

function playRub(seed: number, style: Style): number[] {
  if (style === "idle") return [];
  const likes = rubLikes(seed);
  const out: number[] = [];
  let st = seed ^ 0x68e31da4;
  for (let k = 0; k < RUB.segs; k++) {
    const s = rubSegStart(k);
    if (style === "bot") { out.push(pack(s, likes[k] + 1)); continue; }
    // search: try spots until the liked one (the hearts show it)
    let t = s + 8;
    const [u, n] = noise(st);
    st = n;
    const tries = style === "sloppy" ? 1 + (u % 4) : 1 + (u % 2);
    for (let a = 0; a < tries - 1; a++) {
      out.push(pack(t, ((likes[k] + 1 + a) % RUB.spots) + 1));
      t += 12;
    }
    out.push(pack(t, likes[k] + 1));
    if (style === "sloppy") out.push(pack(t + 40, 0));
  }
  return out;
}

function playFetch(seed: number, style: Style): number[] {
  if (style === "idle") return [];
  const fl = fetchFlights(seed);
  const out: number[] = [];
  let st = seed ^ 0x1b873593;
  for (let i = 0; i < FETCH.throws; i++) {
    const [u, n] = noise(st);
    st = n;
    const off = style === "bot" ? 0 : style === "sharp" ? (u % 7) - 3 : (u % 31) - 15;
    out.push(fetchStart(i) + fl[i] + off);
  }
  return out;
}

const PLAY: Record<CareKind, (seed: number, s: Style) => number[]> = { feed: playFeed, pat: playRub, play: playFetch };

export function buildCareCases(): CareCase[] {
  const out: CareCase[] = [];
  let k = 0;
  for (const kind of ["feed", "pat", "play"] as const) {
    for (const style of ["sharp", "sloppy", "bot", "idle"] as const) {
      for (let r = 0; r < 4; r++) {
        const seed = (0x9e3779b1 * (++k + 11)) >>> 0;
        const inputs = PLAY[kind](seed, style);
        const ticks = CARE_TICKS[kind];
        const res = replayCare(kind, seed, inputs);
        out.push({ name: `${kind}-${style}-${r}`, kind, seed, inputs, ticks,
          expected: { ...res, error: careInputError(kind, inputs, ticks), gains: [careGain(2, res.permille), careGain(3, res.permille), careGain(5, res.permille), careGain(10, res.permille)] } });
      }
    }
  }
  // edge seeds and bad inputs
  for (const seed of [0, 1, 4294967295]) {
    for (const kind of ["feed", "pat", "play"] as const) {
      const inputs = PLAY[kind](seed, "sharp");
      const res = replayCare(kind, seed, inputs);
      out.push({ name: `edge-${kind}-${seed}`, kind, seed, inputs, ticks: CARE_TICKS[kind],
        expected: { ...res, error: careInputError(kind, inputs, CARE_TICKS[kind]), gains: [careGain(2, res.permille), careGain(3, res.permille), careGain(5, res.permille), careGain(10, res.permille)] } });
    }
  }
  const bad: Array<[string, CareKind, number[], number]> = [
    ["bad-lane", "feed", [pack(40, 5)], FEED.ticks],
    ["bad-zone", "pat", [pack(40, 6)], RUB.ticks],
    ["bad-order", "feed", [pack(50, 1), pack(50, 2)], FEED.ticks],
    ["bad-range", "play", [900], FETCH.ticks],
    ["bad-ticks", "play", [100], 700],
    ["bad-rate", "play", [100, 101, 102, 103, 104], FETCH.ticks],
    ["bad-neg", "pat", [-8], RUB.ticks],
  ];
  for (const [name, kind, inputs, ticks] of bad) {
    out.push({ name, kind, seed: 7, inputs, ticks,
      expected: { ...replayCare(kind, 7, []), error: careInputError(kind, inputs, ticks), gains: [0, 0, 0, 0] } });
  }
  return out;
}

export function buildPressCases(): PressCase[] {
  const out: PressCase[] = [];
  for (let i = 0; i < 24; i++) {
    const seed = (0x85ebca6b * (i + 3)) >>> 0;
    const [period, centre] = pressRound(seed);
    // presses around the sweet spot and anywhere
    const press = i % 6 === 5 ? null : (i * 37 + (i % 3) * period) % 290;
    out.push({ name: `press-${i}`, seed, press, round: [period, centre], off: press === null ? null : pressOff(seed, press), power: pressPower(seed, press) });
  }
  return out;
}
