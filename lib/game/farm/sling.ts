import { rand32 } from "../fishing/reel";

// SlingGame (v17 §6.2, D14–D16): a pure state machine on a 60 Hz tick, deterministic for the server's seed, driven by a
// thin overlay. A rat runs along a lane; the player aims (pointer or ←/→), holds to draw the band (power 0 → 1000 ‰ in
// 60 ticks) and lets go: under 600 ‰ the pellet falls short, over 850 ‰ it flies over (a full draw lets go by itself),
// otherwise it lands 18 ticks later and hits if the rat is within 9 px of the aim then.
//
// Anti-cheat v2 (0063): the rat's run is one continuous path from sling_start's seed, in ticks since that answer; the
// server replays it (public._sling_rat) and judges each shot from its press and release ticks and its aim — the client's
// "hit" must agree. Integer math only: positions in milli-px. tests/fixtures/sling-cases.json pins both.
//
// Every result waits out the flight, then goes to the server; 2.2 s of "Nạp đạn…" follow every answer, so an honest shot
// is sent at least 2.5 s after the last answer, clear of the server's 2 s gate. A shot ready 55 s or more after the last
// answer is dropped for a new aim (a new seed).

export const SLING = {
  /** The scene, in logical px; the rat's lane. */
  width: 320,
  height: 180,
  laneY: 70,
  laneMin: 16,
  laneMax: 304,
  /** The same lane in milli-px (the sim's unit). */
  laneMinM: 16_000,
  laneMaxM: 304_000,
  startXM: 160_000,
  /** The rat: runs of 30–72 ticks at 1 000–1 833 mpx a tick (60–110 px/s), stops of 12–36 ticks; a run turns back 35 %. */
  runMin: 30,
  runSpan: 43,
  speedMin: 1_000,
  speedSpan: 834,
  stopMin: 12,
  stopSpan: 25,
  turnPct: 35,
  /** ←/→ move the aim this fast, px/s. */
  aimSpeed: 180,
  /** Holding draws the band from 0 to 1000 ‰ in 60 ticks; the green band is [600, 850] ‰. */
  fillTicks: 60,
  bandLowM: 600,
  bandHighM: 850,
  /** The same band as fractions (the scene draws it). */
  bandLow: 0.6,
  bandHigh: 0.85,
  flightTicks: 18,
  flightMs: 300,
  hitM: 9_000,
  reloadTicks: 132,
  reloadMs: 2200,
  /** A shot ready this long after the last sling answer is dropped: the client aims again (the server's bound is 60 s). */
  reaimTicks: 3300,
  reaimMs: 55_000,
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

/** The rat: `xm` in milli-px (`x` the same in px, for the scene), the ticks left of its segment, its mulberry32 state. */
export interface SlingRat { xm: number; x: number; dir: 1 | -1; moving: boolean; speed: number; seg: number; rng: number }

/** A shot as the server takes it: the press and release ticks, the aim (mpx). */
export interface SlingShot { press: number; release: number; aim: number }

export interface SlingState {
  seed: number;
  /** Shots sent so far. */
  shots: number;
  /** Ticks since the sling_start answer. */
  tick: number;
  rat: SlingRat;
  /** The aim, px (the shot sends it rounded to mpx). */
  aimX: number;
  stage: SlingStage;
  /** Ticks in the stage, and the same in ms (the scene). */
  stageTicks: number;
  stageMs: number;
  /** The band's draw, ‰ (0 outside a draw; the draw let go during the flight), and as a fraction for the scene. */
  powerM: number;
  power: number;
  /** The draw's press tick. */
  pressTick: number;
  /** Let go since the last full draw: a new draw may start. */
  armed: boolean;
  /** The flight's result, where the pellet went (px), and the shot the server replays. */
  mark: SlingMark | null;
  shotX: number | null;
  shot: SlingShot | null;
  /** The last shot's landing tick (a new press must come after it). */
  lastLand: number;
  /** Ticks since the last sling answer. */
  sinceAnswer: number;
}

export interface SlingInput {
  holding: boolean;
  /** A pointer's x in scene px, or null. */
  aimTo: number | null;
  left: boolean;
  right: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The rat's next segment: after a run a stop, after a stop a run (sometimes turning back). */
function nextSegment(r: SlingRat): SlingRat {
  if (r.moving) {
    const [u, rng] = rand32(r.rng);
    return { ...r, moving: false, seg: SLING.stopMin + (u % SLING.stopSpan), rng };
  }
  const [u1, a] = rand32(r.rng);
  const [u2, b] = rand32(a);
  const [u3, rng] = rand32(b);
  const dir: 1 | -1 = u3 % 100 < SLING.turnPct ? (r.dir === 1 ? -1 : 1) : r.dir;
  return { ...r, moving: true, seg: SLING.runMin + (u1 % SLING.runSpan), speed: SLING.speedMin + (u2 % SLING.speedSpan), dir, rng };
}

/** One tick of the rat (public._sling_rat's step). */
export function stepRat(r: SlingRat): SlingRat {
  let { xm, dir } = r;
  if (r.moving) {
    xm += dir * r.speed;
    if (xm <= SLING.laneMinM || xm >= SLING.laneMaxM) {
      xm = clamp(xm, SLING.laneMinM, SLING.laneMaxM);
      dir = dir === 1 ? -1 : 1;
    }
  }
  const next: SlingRat = { ...r, xm, x: xm / 1000, dir, seg: r.seg - 1 };
  return next.seg <= 0 ? nextSegment(next) : next;
}

/** The rat of a seed at tick 0: mid-lane, starting a run. */
export function ratStart(seed: number): SlingRat {
  return nextSegment({ xm: SLING.startXM, x: SLING.startXM / 1000, dir: 1, moving: false, speed: 0, seg: 0, rng: seed >>> 0 });
}

/** The rat after `n` ticks. */
export function ratAt(seed: number, n: number): SlingRat {
  let r = ratStart(seed);
  for (let k = 0; k < n; k++) r = stepRat(r);
  return r;
}

/** The power ‰ of a draw let go `held` ticks after the press. */
export const slingPower = (held: number): number => Math.min(1000, Math.trunc((held * 1000) / SLING.fillTicks));

/** Where a draw let go lands: short, over, or in the band (then the rat decides, after the flight). */
export function bandMark(powerM: number): "short" | "over" | "in" {
  if (powerM < SLING.bandLowM) return "short";
  if (powerM > SLING.bandHighM) return "over";
  return "in";
}

/** A shot's mark (public._sling_mark): the band, then the rat at the landing tick against the aim. */
export function slingMark(seed: number, shot: SlingShot, rat?: SlingRat): SlingMark {
  const band = bandMark(slingPower(shot.release - shot.press));
  if (band !== "in") return band;
  const r = rat ?? ratAt(seed, shot.release + SLING.flightTicks);
  return Math.abs(r.xm - shot.aim) <= SLING.hitM ? "hit" : "wide";
}

/** Why a shot is one no sling makes (public._sling_input_error; null = fine): after the last landing, a release 1–60
 *  ticks after the press, an aim on the lane. */
export function slingInputError(shot: SlingShot, lastLand: number): string | null {
  const { press, release, aim } = shot;
  if (![press, release, aim].every(Number.isInteger)) return "shape";
  if (press <= lastLand || press < 1) return "order";
  if (release <= press || release > press + SLING.fillTicks) return "draw";
  if (aim < SLING.laneMinM || aim > SLING.laneMaxM) return "aim";
  return null;
}

/** A new game, just after sling_start's answer: the rat mid-lane and starting a run, the aim centred, reloading. */
export function createSling(seed: number): SlingState {
  return {
    seed, shots: 0, tick: 0, rat: ratStart(seed), aimX: SLING.width / 2, stage: "reload", stageTicks: 0, stageMs: 0, powerM: 0,
    power: 0, pressTick: 0, armed: true, mark: null, shotX: null, shot: null, lastLand: 0, sinceAnswer: 0,
  };
}

const staged = (ticks: number) => ({ stageTicks: ticks, stageMs: (ticks * 1000) / 60 });

/** One 1/60 s tick. The rat always runs; the aim follows the pointer or the keys. */
export function stepSling(s: SlingState, input: SlingInput): SlingState {
  const tick = s.tick + 1;
  const rat = stepRat(s.rat);
  const keys = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const aimX = clamp(input.aimTo ?? s.aimX + (keys * SLING.aimSpeed) / 60, SLING.laneMin, SLING.laneMax);
  const sinceAnswer = s.sinceAnswer + 1, st = s.stageTicks + 1;
  const armed = s.armed || !input.holding;
  const base = { ...s, tick, rat, aimX, sinceAnswer, armed };
  switch (s.stage) {
    case "reload":
      return st >= SLING.reloadTicks ? { ...base, stage: "ready", ...staged(0) } : { ...base, ...staged(st) };
    case "ready":
      return input.holding && armed && tick > s.lastLand
        ? { ...base, stage: "draw", ...staged(0), powerM: 0, power: 0, pressTick: tick } : { ...base, ...staged(st) };
    case "draw": {
      const powerM = slingPower(tick - s.pressTick);
      if (input.holding && powerM < 1000) return { ...base, ...staged(st), powerM, power: powerM / 1000 };
      const aim = Math.round(aimX * 1000);
      return {
        ...base, stage: "flight", ...staged(0), powerM, power: powerM / 1000, armed: !input.holding, shotX: aimX, mark: null,
        shot: { press: s.pressTick, release: tick, aim },
      };
    }
    case "flight": {
      if (st < SLING.flightTicks) return { ...base, ...staged(st) };
      // Measured when the shot would be sent: too late, and the shot is dropped (no result) for a new sling_start.
      if (sinceAnswer >= SLING.reaimTicks) return { ...base, stage: "reaim", ...staged(0), mark: null, shot: null };
      const mark = s.shot ? slingMark(s.seed, s.shot, rat) : "wide";
      return { ...base, stage: "send", ...staged(0), mark, lastLand: tick };
    }
    default:
      return { ...base, ...staged(st) };
  }
}

/** The overlay has sent the shot (sling_shoot, stage "send") or the new aim (sling_start, stage "reaim"): wait. */
export function slingSent(s: SlingState): SlingState {
  return s.stage === "send" || s.stage === "reaim" ? { ...s, stage: "wait", ...staged(0) } : s;
}

/** A sling answer came (a miss): 2.2 s of reload; the rat runs on. */
export function slingAnswered(s: SlingState): SlingState {
  const shots = s.mark !== null ? s.shots + 1 : s.shots;
  return { ...s, shots, stage: "reload", ...staged(0), powerM: 0, power: 0, mark: null, shotX: null, shot: null, sinceAnswer: 0 };
}
