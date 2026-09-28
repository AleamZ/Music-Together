// v20.2 Bài quyền: the kata rhythm minigame of a belt exam (spec §v20.2 "Kata minigame", plan ruling P17). The chart
// comes from the server's seed and the server scores the presses: 0050_dojo.sql's _kata_chart / _kata_score /
// _kata_input_error mirror these functions statement for statement, and tests/fixtures/kata-cases.json pins the two
// (Vitest and tests/sql/v20-2-smoke.sql). Integer-only; the PRNG is mulberry32 (rand32 = 0046's _reel_rand).

import { rand32 } from "@/lib/game/fishing/reel";
import { kataRowFor } from "./dojo";

/** The eight lanes: ← → ↑ ↓ U I J K. */
export const KATA_LANES = 8;
export const LANE_LABELS = ["←", "→", "↑", "↓", "U", "I", "J", "K"] as const;
/** The first note's tick (a lead-in of 3 s). */
export const KATA_START = 180;
/** Hoàn hảo within this many ticks (2 points); Tốt within KATA_GOOD (1 point). */
export const KATA_PERFECT = 4;
export const KATA_GOOD = 9;
/** Presses are allowed up to this long after the last note, which is also where the chart ends. */
export const KATA_TAIL = 30;
/** From target rank 3, this share (%) of the gaps are half beats. */
export const KATA_HALF_PCT = 20;
/** The pacing: a submission may not come sooner than this share (‰) of the chart's length after the exam started. */
export const KATA_PACE_PERMILLE = 950;
/** kata_perfect: every note within this many ticks, with at least KATA_PERFECT_NOTES notes. */
export const KATA_SUSPECT_TICKS = 1;
export const KATA_PERFECT_NOTES = 24;

export interface KataChart {
  /** [tick, lane] per note, ticks increasing. */
  notes: [number, number][];
  tpb: number;
  /** The last note's tick + KATA_TAIL. */
  length: number;
}

/** The chart of an exam reaching `target` (1–4), from the exam's seed (u32). */
export function kataChart(seed: number, target: number): KataChart {
  const { notes: n, tpb, half } = kataRowFor(target);
  return kataChartOf(seed, n, tpb, half);
}

export function kataChartOf(seed: number, n: number, tpb: number, half: boolean): KataChart {
  let st = seed >>> 0;
  const roll = (mod: number): number => {
    const [u, next] = rand32(st);
    st = next;
    return u % mod;
  };
  const notes: [number, number][] = [];
  let tick = KATA_START;
  let p1 = -1, p2 = -1;
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      let gap = tpb;
      if (half && roll(100) < KATA_HALF_PCT) gap = Math.trunc(tpb / 2);
      tick += gap;
    }
    let lane = roll(KATA_LANES);
    if (lane === p1 && lane === p2) lane = (lane + 1) % KATA_LANES;
    notes.push([tick, lane]);
    p2 = p1;
    p1 = lane;
  }
  const last = notes.length > 0 ? notes[notes.length - 1][0] : KATA_START;
  return { notes, tpb, length: last + KATA_TAIL };
}

export type KataInputError = "shape" | "lane" | "tick" | "order" | "crowd" | "count" | "late";

/** Why a press list is malformed (null: fine). Presses are `[tick, lane, tick, lane, …]`. */
export function kataInputError(chart: KataChart, presses: readonly number[]): KataInputError | null {
  if (!Array.isArray(presses) || presses.length % 2 !== 0) return "shape";
  if (presses.length / 2 > 3 * chart.notes.length) return "count";
  let prev = -1, same = 0;
  for (let i = 0; i < presses.length; i += 2) {
    const t = presses[i], l = presses[i + 1];
    if (!Number.isInteger(t) || t < 0) return "tick";
    if (!Number.isInteger(l) || l < 0 || l >= KATA_LANES) return "lane";
    if (t < prev) return "order";
    same = t === prev ? same + 1 : 1;
    if (same > 2) return "crowd";
    if (t > chart.length) return "late";
    prev = t;
  }
  return null;
}

export interface KataScore {
  points: number;
  /** 2 × notes. */
  max: number;
  perfect: number;
  good: number;
  miss: number;
  extra: number;
  /** The largest |Δ| of a judged note (−1: none judged). */
  worst: number;
}

/** Scores well-formed presses (see kataInputError). */
export function kataScore(chart: KataChart, presses: readonly number[]): KataScore {
  const n = chart.notes.length;
  const judged = new Array<boolean>(n).fill(false);
  let points = 0, perfect = 0, good = 0, extra = 0, worst = -1;
  for (let i = 0; i < presses.length; i += 2) {
    const t = presses[i], l = presses[i + 1];
    let best = -1, bestD = KATA_GOOD + 1;
    for (let k = 0; k < n; k++) {
      if (judged[k] || chart.notes[k][1] !== l) continue;
      const d = Math.abs(chart.notes[k][0] - t);
      if (d < bestD) { best = k; bestD = d; }
    }
    if (best < 0) {
      points -= 1;
      extra += 1;
      continue;
    }
    judged[best] = true;
    if (bestD > worst) worst = bestD;
    if (bestD <= KATA_PERFECT) { points += 2; perfect += 1; }
    else { points += 1; good += 1; }
  }
  return { points: Math.max(0, points), max: 2 * n, perfect, good, miss: n - perfect - good, extra, worst };
}

/** Whole per-cent (floored) of a score. */
export const kataPct = (s: KataScore): number => (s.max > 0 ? Math.trunc((s.points * 100) / s.max) : 0);
/** Passed at `passPct` %. */
export const kataPassed = (s: KataScore, passPct: number): boolean => s.points * 100 >= passPct * s.max;
/** Soft kata_perfect: every note judged within ±1 tick, with at least 24 notes. */
export const kataSuspect = (chart: KataChart, s: KataScore): boolean =>
  chart.notes.length >= KATA_PERFECT_NOTES && s.miss === 0 && s.worst <= KATA_SUSPECT_TICKS;

export type KataJudgement = "perfect" | "good" | "miss";

/** The judgement a single press would get right now (the overlay's live feedback; the server re-scores everything). */
export function judge(delta: number): KataJudgement {
  const d = Math.abs(delta);
  return d <= KATA_PERFECT ? "perfect" : d <= KATA_GOOD ? "good" : "miss";
}
