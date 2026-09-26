import { nextRandom } from "../fishing/reel";

// The field's minigames (v15.2 §6.2, R17; v15.3 §7.2, §8.2): pure state machines, deterministic for a seed, driven by
// thin overlays.
//
// HarvestGame's round: 8 bundles. Holding raises the sickle's power bar from 0 to 1 in 1.2 s, and letting go cuts the
// bundle at that level; the bar auto-releases at 1. Each bundle has a seeded sweet band. A 0.35 s cut beat after each
// cut ignores input, and after an auto-release the sickle waits to be let go before the next charge. A score of 4 or
// more passes.

export const HARVEST = {
  bundles: 8,
  /** Hold time from an empty bar to a full one. */
  fillMs: 1200,
  /** The sweet band: 0.14 wide (the chuẩn zone), centred in [0.62, 0.78]. */
  band: 0.14,
  centreMin: 0.62,
  centreMax: 0.78,
  /** |level − centre| up to this is chuẩn (1 point), up to `near` được (0.5). */
  exact: 0.07,
  near: 0.17,
  beatMs: 350,
  pass: 4,
  /** The longest frame a step counts (a hidden tab does not charge the bar). */
  maxDt: 0.05,
} as const;

export type HarvestMark = "chuan" | "duoc" | "sot" | "rung";
export const HARVEST_MARK: Record<HarvestMark, string> = {
  chuan: "Chuẩn!", duoc: "Được", sot: "Lệch — sót hạt", rung: "Lệch — rụng hạt",
};

export interface HarvestCut { level: number; centre: number; mark: HarvestMark; score: number }

export interface HarvestRound {
  /** The 8 bands' centres. */
  centres: readonly number[];
  /** Bundles cut so far (0–8). */
  bundle: number;
  /** How long the current charge has been held, and the bar it gives (0 between charges). */
  chargeMs: number;
  level: number;
  charging: boolean;
  /** Let go since the last auto-release: a new charge may start. */
  armed: boolean;
  /** The cut beat left; input is ignored until it is over. */
  beatMs: number;
  cuts: HarvestCut[];
  score: number;
  elapsedMs: number;
  outcome: "pass" | "fail" | null;
}

/** Scores a cut at bar `level` against a band centred at `centre` (the boundaries count, up to rounding). */
export function scoreRelease(level: number, centre: number): { mark: HarvestMark; score: number } {
  const d = Math.abs(level - centre);
  if (d <= HARVEST.exact + 1e-9) return { mark: "chuan", score: 1 };
  if (d <= HARVEST.near + 1e-9) return { mark: "duoc", score: 0.5 };
  return { mark: level < centre ? "sot" : "rung", score: 0 };
}

/** "3,5": a score with the Vietnamese decimal comma. */
export const scoreText = (n: number): string => String(n).replace(".", ",");

export function createHarvestRound(seed: number): HarvestRound {
  const centres: number[] = [];
  let rng = seed | 0;
  for (let i = 0; i < HARVEST.bundles; i++) {
    const [u, next] = nextRandom(rng);
    rng = next;
    centres.push(HARVEST.centreMin + u * (HARVEST.centreMax - HARVEST.centreMin));
  }
  return {
    centres, bundle: 0, chargeMs: 0, level: 0, charging: false, armed: true, beatMs: 0, cuts: [], score: 0, elapsedMs: 0,
    outcome: null,
  };
}

/** One frame: `dtSec` is clamped to [0, 50 ms]; `holding` is the sickle's button. Once there is an outcome the same
 *  state is returned. */
export function stepHarvestRound(s: HarvestRound, dtSec: number, holding: boolean): HarvestRound {
  if (s.outcome) return s;
  const dtMs = Math.min(HARVEST.maxDt, Math.max(0, dtSec)) * 1000;
  const elapsedMs = s.elapsedMs + dtMs;
  const armed = s.armed || !holding;
  if (s.beatMs > 0) {
    const beatMs = Math.max(0, s.beatMs - dtMs);
    const outcome = beatMs === 0 && s.bundle >= HARVEST.bundles ? (s.score >= HARVEST.pass ? "pass" : "fail") : null;
    return { ...s, beatMs, elapsedMs, armed, outcome };
  }
  if (!s.charging) {
    return holding && armed ? { ...s, charging: true, chargeMs: 0, level: 0, elapsedMs, armed } : { ...s, elapsedMs, armed };
  }
  if (!holding) return cut(s, s.level, elapsedMs, true);
  const chargeMs = s.chargeMs + dtMs;
  if (chargeMs >= HARVEST.fillMs) return cut(s, 1, elapsedMs, false);
  return { ...s, chargeMs, level: chargeMs / HARVEST.fillMs, elapsedMs, armed };
}

function cut(s: HarvestRound, level: number, elapsedMs: number, armed: boolean): HarvestRound {
  const centre = s.centres[s.bundle];
  const { mark, score } = scoreRelease(level, centre);
  return {
    ...s, bundle: s.bundle + 1, chargeMs: 0, level: 0, charging: false, armed, beatMs: HARVEST.beatMs,
    cuts: [...s.cuts, { level, centre, mark, score }], score: s.score + score, elapsedMs,
  };
}

// CrabGame's round (v15.3 §7.2, R17): 3 tries. Each opens with a 0.6 s lead-in, then the claws cycle — open for the
// first 60 % of a period, closed for the last 40 %, from a seeded phase — with periods of 1.2, 0.95 and 0.75 s. A grab
// ends the try: while closed a hit, while open a pinch (that crab is lost); no grab in 4 cycles is a slip. A 0.5 s beat
// follows each try. The lead-in and the beat ignore input.

export const CRAB = {
  tries: 3,
  periodsMs: [1200, 950, 750],
  /** The claws are open for this share of a cycle, then closed. */
  openShare: 0.6,
  leadMs: 600,
  /** A try without a grab ends after this many cycles. */
  cycles: 4,
  beatMs: 500,
  maxDt: 0.05,
} as const;

export type CrabMark = "hit" | "pinch" | "slip";
export const CRAB_MARK: Record<CrabMark, string> = { hit: "Bắt được!", pinch: "Á! Bị cua kẹp", slip: "Cua chui mất" };

export interface CrabRound {
  /** Each try's seeded phase, in [0, its period). */
  phases: readonly number[];
  /** The marks of the tries done (0–3). */
  tries: CrabMark[];
  hits: number;
  stage: "lead" | "claws" | "beat";
  /** Time spent in the stage. */
  stageMs: number;
  elapsedMs: number;
  outcome: "done" | null;
}

/** The claws at `tMs` into a try: closed in the last 40 % of each cycle. */
export function crabClosed(periodMs: number, phaseMs: number, tMs: number): boolean {
  return (phaseMs + tMs) % periodMs >= CRAB.openShare * periodMs - 1e-9;
}

export function createCrabRound(seed: number): CrabRound {
  const phases: number[] = [];
  let rng = seed | 0;
  for (const p of CRAB.periodsMs) {
    const [u, next] = nextRandom(rng);
    rng = next;
    phases.push(u * p);
  }
  return { phases, tries: [], hits: 0, stage: "lead", stageMs: 0, elapsedMs: 0, outcome: null };
}

/** One frame: `dtSec` is clamped to [0, 50 ms]; `grab` is a press since the last frame. */
export function stepCrabRound(s: CrabRound, dtSec: number, grab: boolean): CrabRound {
  if (s.outcome) return s;
  const dtMs = Math.min(CRAB.maxDt, Math.max(0, dtSec)) * 1000;
  const elapsedMs = s.elapsedMs + dtMs, t = s.stageMs + dtMs;
  if (s.stage === "lead") {
    return t >= CRAB.leadMs ? { ...s, stage: "claws", stageMs: t - CRAB.leadMs, elapsedMs } : { ...s, stageMs: t, elapsedMs };
  }
  if (s.stage === "claws") {
    const i = s.tries.length, period = CRAB.periodsMs[i];
    const mark: CrabMark | null = grab ? (crabClosed(period, s.phases[i], t) ? "hit" : "pinch") : t >= CRAB.cycles * period ? "slip" : null;
    if (!mark) return { ...s, stageMs: t, elapsedMs };
    return { ...s, tries: [...s.tries, mark], hits: s.hits + (mark === "hit" ? 1 : 0), stage: "beat", stageMs: 0, elapsedMs };
  }
  if (t < CRAB.beatMs) return { ...s, stageMs: t, elapsedMs };
  return s.tries.length >= CRAB.tries
    ? { ...s, stageMs: t, elapsedMs, outcome: "done" }
    : { ...s, stage: "lead", stageMs: t - CRAB.beatMs, elapsedMs };
}

// TransplantGame's round (v15.3 §8.2, R18): a 1 s lead-in, then 12 hills. For each, a hand sweeps x from 0 to 1 in
// 1.4 s over a seeded band centred in [0.35, 0.65]; a press plants the hill there. A 0.25 s beat follows each hill; the
// lead-in and the beat ignore input. A score of 6 or more passes.

export const TRANSPLANT = {
  hills: 12,
  leadMs: 1000,
  sweepMs: 1400,
  centreMin: 0.35,
  centreMax: 0.65,
  /** |x − centre| up to this is chuẩn (1 point), up to `near` được (0.5). */
  exact: 0.08,
  near: 0.18,
  beatMs: 250,
  pass: 6,
  maxDt: 0.05,
} as const;

export type TransplantMark = "chuan" | "duoc" | "lech" | "sot";
const TRANSPLANT_MARK: Record<TransplantMark, string> = { chuan: "Thẳng hàng!", duoc: "Được", lech: "Lệch hàng", sot: "Bỏ sót khóm" };
/** A hill's mark; the ớt round says "cây" for "khóm". */
export function transplantMarkText(mark: TransplantMark, ot: boolean): string {
  return ot && mark === "sot" ? "Bỏ sót cây" : TRANSPLANT_MARK[mark];
}

export interface TransplantHill { x: number | null; centre: number; mark: TransplantMark; score: number }

export interface TransplantRound {
  /** The 12 bands' centres. */
  centres: readonly number[];
  hills: TransplantHill[];
  score: number;
  stage: "lead" | "sweep" | "beat";
  stageMs: number;
  /** The hand, 0–1 across the row (0 outside a sweep). */
  x: number;
  elapsedMs: number;
  outcome: "pass" | "fail" | null;
}

/** Scores a press at `x` against a band centred at `centre` (the boundaries count, up to rounding). */
export function scoreHill(x: number, centre: number): { mark: TransplantMark; score: number } {
  const d = Math.abs(x - centre);
  if (d <= TRANSPLANT.exact + 1e-9) return { mark: "chuan", score: 1 };
  if (d <= TRANSPLANT.near + 1e-9) return { mark: "duoc", score: 0.5 };
  return { mark: "lech", score: 0 };
}

export function createTransplantRound(seed: number): TransplantRound {
  const centres: number[] = [];
  let rng = seed | 0;
  for (let i = 0; i < TRANSPLANT.hills; i++) {
    const [u, next] = nextRandom(rng);
    rng = next;
    centres.push(TRANSPLANT.centreMin + u * (TRANSPLANT.centreMax - TRANSPLANT.centreMin));
  }
  return { centres, hills: [], score: 0, stage: "lead", stageMs: 0, x: 0, elapsedMs: 0, outcome: null };
}

/** One frame: `dtSec` is clamped to [0, 50 ms]; `press` is a press since the last frame. */
export function stepTransplantRound(s: TransplantRound, dtSec: number, press: boolean): TransplantRound {
  if (s.outcome) return s;
  const dtMs = Math.min(TRANSPLANT.maxDt, Math.max(0, dtSec)) * 1000;
  const elapsedMs = s.elapsedMs + dtMs, t = s.stageMs + dtMs;
  if (s.stage === "lead") {
    return t >= TRANSPLANT.leadMs ? { ...s, stage: "sweep", stageMs: t - TRANSPLANT.leadMs, x: 0, elapsedMs } : { ...s, stageMs: t, elapsedMs };
  }
  if (s.stage === "sweep") {
    const x = Math.min(1, t / TRANSPLANT.sweepMs), centre = s.centres[s.hills.length];
    if (!press && x < 1) return { ...s, stageMs: t, x, elapsedMs };
    const hill: TransplantHill = press ? { x, centre, ...scoreHill(x, centre) } : { x: null, centre, mark: "sot", score: 0 };
    return { ...s, hills: [...s.hills, hill], score: s.score + hill.score, stage: "beat", stageMs: 0, x: 0, elapsedMs };
  }
  if (t < TRANSPLANT.beatMs) return { ...s, stageMs: t, elapsedMs };
  return s.hills.length >= TRANSPLANT.hills
    ? { ...s, stageMs: t, elapsedMs, outcome: s.score >= TRANSPLANT.pass ? "pass" : "fail" }
    : { ...s, stage: "sweep", stageMs: t - TRANSPLANT.beatMs, x: 0, elapsedMs };
}
