import { nextRandom } from "../fishing/reel";

// SlingGame (v17 §6.2, D14–D16): a pure state machine, deterministic for a seed, driven by a thin overlay. A rat runs
// along a lane; the player aims (pointer or ←/→), holds to draw the band (power 0 → 1 in 1 s) and lets go: under 0.60
// the pellet falls short, over 0.85 it flies over (a full draw lets go by itself), otherwise it lands 0.3 s later and
// hits if the rat is within 9 px of the aim then. Every result waits out the flight, then goes to the server; 2.2 s of
// "Nạp đạn…" follow every answer, so an honest shot is sent at least 2.5 s (a miss) or 3.1 s (a hit) after the last
// answer, clear of the server's 2 s gate. A shot ready 55 s or more after the last answer is dropped for a new aim.

export const SLING = {
  /** The scene, in logical px; the rat's lane. */
  width: 320,
  height: 180,
  laneY: 70,
  laneMin: 16,
  laneMax: 304,
  /** The rat: runs of 0.5–1.2 s at 60–110 px/s, stops of 0.2–0.6 s; a run turns back with this chance. */
  runMinMs: 500,
  runMaxMs: 1200,
  speedMin: 60,
  speedMax: 110,
  stopMinMs: 200,
  stopMaxMs: 600,
  turnChance: 0.35,
  /** Shot i's rat moves on mulberry32(seed + shotStep · i). */
  shotStep: 7919,
  /** ←/→ move the aim this fast, px/s. */
  aimSpeed: 180,
  /** Holding draws the band from 0 to 1 in 1 s; the green band is [0.60, 0.85]. */
  fillMs: 1000,
  bandLow: 0.6,
  bandHigh: 0.85,
  flightMs: 300,
  hitPx: 9,
  reloadMs: 2200,
  /** A shot ready this long after the last sling answer is dropped: the client aims again (the server's bound is 60 s). */
  reaimMs: 55_000,
  maxDt: 0.05,
} as const;

/** A shot's result: a hit, short of the band, over it, or in it but wide of the rat. */
export type SlingMark = "hit" | "short" | "over" | "wide";

/** The misses' lines (§12.2); a hit's line carries the price and is the overlay's. */
export const SLING_MISS: Record<Exclude<SlingMark, "hit">, string> = {
  short: "Hụt — đạn rơi trước.",
  over: "Hụt — căng quá, đạn bay qua.",
  wide: "Hụt — lệch rồi.",
};

export type SlingStage = "reload" | "ready" | "draw" | "flight" | "send" | "reaim" | "wait";

export interface SlingRat { x: number; dir: 1 | -1; moving: boolean; speed: number; segMs: number; rng: number }

export interface SlingState {
  seed: number;
  /** Shots sent so far. */
  shots: number;
  rat: SlingRat;
  aimX: number;
  stage: SlingStage;
  stageMs: number;
  /** The band's draw (0 outside a draw); the draw that was let go, during the flight. */
  power: number;
  /** Let go since the last full draw: a new draw may start. */
  armed: boolean;
  /** The flight's result, and where the pellet went (for the scene). */
  mark: SlingMark | null;
  shotX: number | null;
  /** Since the last sling answer (sling_start's or sling_shoot's). */
  sinceAnswerMs: number;
}

export interface SlingInput {
  holding: boolean;
  /** A pointer's x in scene px, or null. */
  aimTo: number | null;
  left: boolean;
  right: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function draw(rng: number, lo: number, hi: number): [number, number] {
  const [u, next] = nextRandom(rng);
  return [lo + u * (hi - lo), next];
}

/** The rat's next segment: after a run a stop, after a stop a run (sometimes turning back). */
function nextSegment(r: SlingRat): SlingRat {
  if (r.moving) {
    const [ms, rng] = draw(r.rng, SLING.stopMinMs, SLING.stopMaxMs);
    return { ...r, moving: false, segMs: ms, rng };
  }
  const [ms, a] = draw(r.rng, SLING.runMinMs, SLING.runMaxMs);
  const [speed, b] = draw(a, SLING.speedMin, SLING.speedMax);
  const [turn, rng] = nextRandom(b);
  return { ...r, moving: true, segMs: ms, speed, dir: turn < SLING.turnChance ? (r.dir === 1 ? -1 : 1) : r.dir, rng };
}

function stepRat(r: SlingRat, dtMs: number): SlingRat {
  let rat = r, left = dtMs;
  while (left > 0) {
    const t = Math.min(left, rat.segMs);
    if (rat.moving) {
      let x = rat.x + rat.dir * rat.speed * (t / 1000), dir = rat.dir;
      if (x <= SLING.laneMin || x >= SLING.laneMax) {
        x = clamp(x, SLING.laneMin, SLING.laneMax);
        dir = dir === 1 ? -1 : 1;
      }
      rat = { ...rat, x, dir };
    }
    rat = { ...rat, segMs: rat.segMs - t };
    left -= t;
    if (rat.segMs <= 0) rat = nextSegment(rat);
  }
  return rat;
}

/** A new game, just after sling_start's answer: the rat mid-lane and starting a run, the aim centred, reloading. */
export function createSling(seed: number): SlingState {
  const rat = nextSegment({ x: (SLING.laneMin + SLING.laneMax) / 2, dir: 1, moving: false, speed: 0, segMs: 0, rng: seed | 0 });
  return {
    seed, shots: 0, rat, aimX: SLING.width / 2, stage: "reload", stageMs: 0, power: 0, armed: true, mark: null, shotX: null,
    sinceAnswerMs: 0,
  };
}

/** Where a draw let go lands: short, over, or in the band (then the rat decides, after the flight). */
export function bandMark(power: number): "short" | "over" | "in" {
  if (power < SLING.bandLow) return "short";
  if (power > SLING.bandHigh) return "over";
  return "in";
}

/** One frame: `dtSec` is clamped to [0, 50 ms]. The rat always runs; the aim follows the pointer or the keys. */
export function stepSling(s: SlingState, dtSec: number, input: SlingInput): SlingState {
  const dtMs = Math.min(SLING.maxDt, Math.max(0, dtSec)) * 1000;
  const rat = stepRat(s.rat, dtMs);
  const keys = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const aimX = clamp(input.aimTo ?? s.aimX + keys * SLING.aimSpeed * (dtMs / 1000), SLING.laneMin, SLING.laneMax);
  const sinceAnswerMs = s.sinceAnswerMs + dtMs, stageMs = s.stageMs + dtMs;
  const armed = s.armed || !input.holding;
  const base = { ...s, rat, aimX, sinceAnswerMs, armed };
  switch (s.stage) {
    case "reload":
      return stageMs >= SLING.reloadMs ? { ...base, stage: "ready", stageMs: 0 } : { ...base, stageMs };
    case "ready":
      return input.holding && armed ? { ...base, stage: "draw", stageMs: 0, power: 0 } : { ...base, stageMs };
    case "draw": {
      const power = Math.min(1, stageMs / SLING.fillMs);
      if (input.holding && power < 1) return { ...base, stageMs, power };
      return { ...base, stage: "flight", stageMs: 0, power, armed: !input.holding, shotX: aimX, mark: null };
    }
    case "flight": {
      if (stageMs < SLING.flightMs) return { ...base, stageMs };
      // Measured when the shot would be sent: too late, and the shot is dropped (no result) for a new sling_start.
      if (sinceAnswerMs >= SLING.reaimMs) return { ...base, stage: "reaim", stageMs: 0, mark: null };
      const band = bandMark(s.power);
      const mark: SlingMark = band !== "in" ? band : Math.abs(rat.x - (s.shotX ?? aimX)) <= SLING.hitPx ? "hit" : "wide";
      return { ...base, stage: "send", stageMs: 0, mark };
    }
    default:
      return { ...base, stageMs };
  }
}

/** The overlay has sent the shot (sling_shoot, stage "send") or the new aim (sling_start, stage "reaim"): wait. */
export function slingSent(s: SlingState): SlingState {
  return s.stage === "send" || s.stage === "reaim" ? { ...s, stage: "wait", stageMs: 0 } : s;
}

/** A sling answer came (a miss, or the new aim): 2.2 s of reload, and the next shot's rat moves on its own seed. */
export function slingAnswered(s: SlingState): SlingState {
  const shots = s.mark !== null ? s.shots + 1 : s.shots;
  return {
    ...s, shots, stage: "reload", stageMs: 0, power: 0, mark: null, shotX: null, sinceAnswerMs: 0,
    rat: { ...s.rat, rng: (s.seed + SLING.shotStep * shots) | 0 },
  };
}
