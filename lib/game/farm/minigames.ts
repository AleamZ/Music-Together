import { nextRandom } from "../fishing/reel";

// The field's minigames (v15.2 §6.2, R17): pure state machines, deterministic for a seed, driven by thin overlays.
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
