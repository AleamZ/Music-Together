import { nextRandom, rand32 } from "../fishing/reel";

// The field's minigames (v15.2 §6.2, R17; v15.3 §7.2, §8.2): pure state machines, deterministic for a seed, driven by
// thin overlays.
//
// Anti-cheat v2 (0061, 0062): the harvest and the crab games are 60 Hz integer sims on the server's seed; the server
// replays their input (public._harvest_replay, public._crab_replay) and decides the outcome. Any change here must be
// mirrored there — tests/fixtures/harvest-cases.json and crab-cases.json are checked by both.
//
// HarvestGame's round: 8 bundles. Holding raises the sickle's power bar from 0 to 1000 ‰ in 72 ticks (1.2 s), and
// letting go cuts the bundle at that level; the bar auto-releases at 1000. Each bundle has a seeded sweet band centred in
// [620, 780] ‰. A 21-tick (0.35 s) cut beat after each cut ignores input, and after an auto-release the sickle waits to be
// let go before the next charge. Scores are in half points: Δ ≤ 70 ‰ is chuẩn (2), ≤ 170 được (1); 8 (4 points) passes.

export const HARVEST = {
  bundles: 8,
  /** Ticks from an empty bar to a full one (1.2 s). */
  fillTicks: 72,
  /** The sweet band's centre: centreMin + u mod centreSpan ‰ (620 … 780). */
  centreMin: 620,
  centreSpan: 161,
  /** The chuẩn band is `band` ‰ wide; |level − centre| ≤ exact is chuẩn (2 half points), ≤ near được (1). */
  band: 140,
  exact: 70,
  near: 170,
  beatTicks: 21,
  /** Half points to pass (4 points). */
  pass2: 8,
  /** A round not over by then fails (120 s: the server's work window). */
  maxTicks: 7200,
  /** At most this many flips of the hold (and at most `rate` in any 60 ticks). */
  maxToggles: 400,
  rate: 45,
} as const;

export type HarvestMark = "chuan" | "duoc" | "sot" | "rung";
export const HARVEST_MARK: Record<HarvestMark, string> = {
  chuan: "Chuẩn!", duoc: "Được", sot: "Lệch — sót hạt", rung: "Lệch — rụng hạt",
};

/** A cut: the bar (‰), the band's centre (‰), the mark and its half points. */
export interface HarvestCut { level: number; centre: number; mark: HarvestMark; score2: number }

export interface HarvestRound {
  /** The 8 bands' centres, ‰. */
  centres: readonly number[];
  /** Bundles cut so far (0–8). */
  bundle: number;
  /** Ticks the current charge has been held, and the bar it gives (‰; 0 between charges). */
  charge: number;
  level: number;
  charging: boolean;
  /** Let go since the last auto-release: a new charge may start. */
  armed: boolean;
  /** Ticks of the cut beat left; input is ignored until it is over. */
  beat: number;
  cuts: HarvestCut[];
  /** Half points. */
  score2: number;
  tick: number;
  outcome: "pass" | "fail" | null;
}

/** Scores a cut at bar `level` against a band centred at `centre` (‰; the boundaries count). */
export function scoreRelease(level: number, centre: number): { mark: HarvestMark; score2: number } {
  const d = Math.abs(level - centre);
  if (d <= HARVEST.exact) return { mark: "chuan", score2: 2 };
  if (d <= HARVEST.near) return { mark: "duoc", score2: 1 };
  return { mark: level < centre ? "sot" : "rung", score2: 0 };
}

/** "3,5": a score with the Vietnamese decimal comma. */
export const scoreText = (n: number): string => String(n).replace(".", ",");

export function createHarvestRound(seed: number): HarvestRound {
  const centres: number[] = [];
  let rng = seed >>> 0;
  for (let i = 0; i < HARVEST.bundles; i++) {
    const [u, next] = rand32(rng);
    rng = next;
    centres.push(HARVEST.centreMin + (u % HARVEST.centreSpan));
  }
  return { centres, bundle: 0, charge: 0, level: 0, charging: false, armed: true, beat: 0, cuts: [], score2: 0, tick: 0, outcome: null };
}

function cut(s: HarvestRound, level: number, armed: boolean, tick: number): HarvestRound {
  const centre = s.centres[s.bundle];
  const { mark, score2 } = scoreRelease(level, centre);
  return {
    ...s, bundle: s.bundle + 1, charge: 0, level: 0, charging: false, armed, beat: HARVEST.beatTicks,
    cuts: [...s.cuts, { level, centre, mark, score2 }], score2: s.score2 + score2, tick,
  };
}

/** One 1/60 s tick; `holding` is the sickle's button. Once there is an outcome the same state is returned; a round
 *  still going at HARVEST.maxTicks fails. */
export function stepHarvestRound(s: HarvestRound, holding: boolean): HarvestRound {
  if (s.outcome) return s;
  const next = harvestTick(s, holding);
  return !next.outcome && next.tick >= HARVEST.maxTicks ? { ...next, outcome: "fail" } : next;
}
function harvestTick(s: HarvestRound, holding: boolean): HarvestRound {
  const tick = s.tick + 1;
  const armed = s.armed || !holding;
  if (s.beat > 0) {
    const beat = s.beat - 1;
    const outcome = beat === 0 && s.bundle >= HARVEST.bundles ? (s.score2 >= HARVEST.pass2 ? "pass" : "fail") : null;
    return { ...s, beat, tick, armed, outcome };
  }
  if (!s.charging) return holding && armed ? { ...s, charging: true, charge: 0, level: 0, tick, armed } : { ...s, tick, armed };
  if (!holding) return cut(s, s.level, true, tick);
  const charge = s.charge + 1;
  if (charge >= HARVEST.fillTicks) return cut(s, 1000, false, tick);
  return { ...s, charge, level: Math.trunc((charge * 1000) / HARVEST.fillTicks), tick, armed };
}

/** What the server replays: {outcome, ticks, score2}. The hold starts released and flips before each listed tick is
 *  stepped (the reel's rule). */
export interface HarvestReplay { outcome: "pass" | "fail"; ticks: number; score2: number }
export function replayHarvest(seed: number, toggles: readonly number[]): HarvestReplay {
  let s = createHarvestRound(seed);
  let holding = false, i = 0;
  while (!s.outcome) {
    while (i < toggles.length && toggles[i] === s.tick) { holding = !holding; i++; }
    s = stepHarvestRound(s, holding);
  }
  return { outcome: s.outcome, ticks: s.tick, score2: s.score2 };
}

/** Why a toggle list is one no round makes (public._harvest_input_error; null = fine): ticks 1 … 7 200, toggles strictly
 *  increasing inside [0, ticks), at most 400, at most 45 in any 60 ticks. */
export function harvestInputError(toggles: readonly number[], ticks: number): string | null {
  return togglesError(toggles, ticks, HARVEST.maxTicks, HARVEST.maxToggles, HARVEST.rate);
}

/** The shared shape rule of the replayed minigames' input lists (ticks strictly increasing inside [0, ticks)). */
export function togglesError(list: readonly number[], ticks: number, maxTicks: number, max: number, rate: number): string | null {
  if (!Number.isInteger(ticks) || ticks < 1 || ticks > maxTicks) return "ticks";
  if (list.length > max) return "too_many";
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (!Number.isInteger(t) || t < 0 || t >= ticks) return "range";
    if (i > 0 && t <= list[i - 1]) return "order";
    if (i >= rate && t - list[i - rate] < 60) return "rate";
  }
  return null;
}

/** Records the hold state tick by tick as the compact list the server takes. */
export class ToggleRecorder {
  private holding = false;
  readonly toggles: number[] = [];
  /** Call before stepping tick `tick` with `holding`. */
  hold(tick: number, holding: boolean): void {
    if (holding === this.holding) return;
    this.holding = holding;
    this.toggles.push(tick);
  }
}

// CrabGame's round (v15.3 §7.2, R17): 3 tries. Each opens with a 36-tick (0.6 s) lead-in, then the claws cycle — open
// for the first 60 % of a period, closed for the last 40 %, from a seeded phase — with periods of 72, 57 and 45 ticks
// (1.2, 0.95, 0.75 s). A grab ends the try: while closed a hit, while open a pinch (that crab is lost); no grab in 4
// cycles is a slip. A 30-tick (0.5 s) beat follows each try. The lead-in and the beat ignore input.

export const CRAB = {
  tries: 3,
  periods: [72, 57, 45],
  /** The claws are closed when 10 · ((phase + t) mod P) ≥ 6 · P. */
  openTenths: 6,
  leadTicks: 36,
  /** A try without a grab ends after this many cycles. */
  cycles: 4,
  beatTicks: 30,
  /** A game not over by then ends (120 s: the visit window). */
  maxTicks: 7200,
  maxGrabs: 60,
  rate: 20,
} as const;

export type CrabMark = "hit" | "pinch" | "slip";
export const CRAB_MARK: Record<CrabMark, string> = { hit: "Bắt được!", pinch: "Á! Bị cua kẹp", slip: "Cua chui mất" };

export interface CrabRound {
  /** Each try's seeded phase, in [0, its period) ticks. */
  phases: readonly number[];
  /** The marks of the tries done (0–3). */
  tries: CrabMark[];
  hits: number;
  stage: "lead" | "claws" | "beat";
  /** Ticks spent in the stage. */
  t: number;
  tick: number;
  outcome: "done" | null;
}

/** The claws `t` ticks into a try: closed in the last 40 % of each cycle. */
export function crabClosed(period: number, phase: number, t: number): boolean {
  return 10 * ((phase + t) % period) >= CRAB.openTenths * period;
}

export function createCrabRound(seed: number): CrabRound {
  const phases: number[] = [];
  let rng = seed >>> 0;
  for (const p of CRAB.periods) {
    const [u, next] = rand32(rng);
    rng = next;
    phases.push(u % p);
  }
  return { phases, tries: [], hits: 0, stage: "lead", t: 0, tick: 0, outcome: null };
}

/** One 1/60 s tick; `grab` is a press in this tick. */
export function stepCrabRound(s: CrabRound, grab: boolean): CrabRound {
  if (s.outcome) return s;
  const tick = s.tick + 1, t = s.t + 1;
  if (s.stage === "lead") {
    return t >= CRAB.leadTicks ? { ...s, stage: "claws", t: t - CRAB.leadTicks, tick } : { ...s, t, tick };
  }
  if (s.stage === "claws") {
    const i = s.tries.length, period = CRAB.periods[i];
    const mark: CrabMark | null = grab ? (crabClosed(period, s.phases[i], t) ? "hit" : "pinch") : t >= CRAB.cycles * period ? "slip" : null;
    if (!mark) return { ...s, t, tick };
    return { ...s, tries: [...s.tries, mark], hits: s.hits + (mark === "hit" ? 1 : 0), stage: "beat", t: 0, tick };
  }
  if (t < CRAB.beatTicks) return { ...s, t, tick };
  return s.tries.length >= CRAB.tries
    ? { ...s, t, tick, outcome: "done" }
    : { ...s, stage: "lead", t: t - CRAB.beatTicks, tick };
}

/** What the server replays: the game from its grabs (the ticks — s.tick before the step — where a press came) up to
 *  `ticks` (Dừng may end it after a try) or its end: {hits, tries, ticks}. */
export interface CrabReplay { hits: number; tries: number; ticks: number }
export function replayCrab(seed: number, grabs: readonly number[], ticks: number): CrabReplay {
  let s = createCrabRound(seed);
  let i = 0;
  while (!s.outcome && s.tick < ticks) {
    let g = false;
    while (i < grabs.length && grabs[i] === s.tick) { g = true; i++; }
    s = stepCrabRound(s, g);
  }
  return { hits: s.hits, tries: s.tries.length, ticks: s.tick };
}

/** Why a grab list is one no game makes (public._crab_input_error; null = fine). */
export function crabInputError(grabs: readonly number[], ticks: number): string | null {
  return togglesError(grabs, ticks, CRAB.maxTicks, CRAB.maxGrabs, CRAB.rate);
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
