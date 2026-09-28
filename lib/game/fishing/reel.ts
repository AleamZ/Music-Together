// Stardew-style reel minigame (spec §6.2): hold to lift the catch zone, keep the fish inside it.
// Server-authoritative since 0046 (reel anti-cheat): the sim runs on a fixed 60 Hz tick in integer math, the fish moves
// from a seeded mulberry32, and the client sends only the ticks where it pressed or let go. finish_cast replays the same
// steps in SQL (public._reel_replay, supabase/migrations/0046_reel_verify.sql) and decides the outcome itself. Any change
// here must be mirrored there — tests/fixtures/reel-cases.json is checked by both (game-reel.test.ts, reel-verify-smoke.sql).
// Every number below stays an integer below 2^53, so JS and plpgsql bigint agree bit for bit.

/** zonePct / difficulty / minReelMs come from the server (start_cast); `seed` is the server's reel_seed (u32). */
export interface ReelParams { zonePct: number; difficulty: number; minReelMs: number; seed: number }
export interface ReelState {
  /** Bottom of the catch zone (0 … FX − zone height) and its speed per tick, in FX units (FX = the bar's height). */
  zone: number;
  zoneV: number;
  /** Fish position and where it is heading, FX units (0 = bottom, FX = top). */
  fish: number;
  target: number;
  /** PFX = full. */
  progress: number;
  /** Ticks stepped so far. */
  tick: number;
  /** mulberry32 state, u32. */
  rng: number;
  outcome: "caught" | "escaped" | null;
}

/** Fixed point of positions (the bar = FX) and of progress (full = PFX). */
export const FX = 1_000_000;
export const PFX = 1_000_000_000;
const U32 = 4_294_967_296;
const HALF = 2_147_483_648;

export const REEL = {
  hz: 60,
  /** 60 s. */
  maxTicks: 3600,
  /** Progress at the hook — fixed: a perfect reel fills 0.3 → 1 in minReelMs (the server's time gate). */
  start: 300_000_000,
  /** Per tick², FX: 3.0 and 2.2 bars/s² at 60 Hz. */
  lift: 833,
  gravity: 611,
  /** Per tick, FX: 1.4 bars/s. */
  maxV: 23_333,
  bouncePct: 35,
  fishStart: 450_000,
  /** The fish stays at least this far above the resting zone, so doing nothing never lands a fish. */
  floorGap: 50_000,
  /** A fish this close to its target picks a new one. */
  close: 20_000,
  /** At most this many ticks catch up in one animation frame (a stalled tab plays slower, as the old 50 ms clamp did). */
  maxCatchUp: 3,
} as const;

/** mulberry32: [value in [0, 1), next state]. Kept for the farm minigames. */
export function nextRandom(state: number): [number, number] {
  const s = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), s | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, s];
}

/** mulberry32 on u32s: [output u32, next state u32] (public._reel_rand). */
export function rand32(state: number): [number, number] {
  const s = (state + 0x6d2b79f5) >>> 0;
  let t = Math.imul(s ^ (s >>> 15), s | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [(t ^ (t >>> 14)) >>> 0, s];
}

const clampInt = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, Math.trunc(v)));

/** Zone height in FX units: zonePct 5 … 90. */
export function zoneUnits(p: ReelParams): number {
  return clampInt(p.zonePct, 5, 90) * 10_000;
}
/** Lowest point the fish swims to, FX units. */
export function floorUnits(p: ReelParams): number {
  return Math.min(500_000, zoneUnits(p) + REEL.floorGap);
}
/** The same two as fractions of the bar (the overlay draws them). */
export const zoneHeight = (p: ReelParams): number => zoneUnits(p) / FX;
export const fishFloor = (p: ReelParams): number => floorUnits(p) / FX;

const diffOf = (p: ReelParams): number => clampInt(p.difficulty, 0, 100);
const minReelOf = (p: ReelParams): number => clampInt(p.minReelMs, 1000, 60_000);

export function createReel(p: ReelParams): ReelState {
  const floor = floorUnits(p);
  const [u, rng] = rand32(p.seed >>> 0);
  return {
    zone: 0, zoneV: 0, fish: Math.max(REEL.fishStart, floor), target: floor + Math.floor((u * (FX - floor)) / U32),
    progress: REEL.start, tick: 0, rng, outcome: null,
  };
}

export function inZone(s: Pick<ReelState, "zone" | "fish">, p: ReelParams): boolean {
  return s.fish >= s.zone && s.fish <= s.zone + zoneUnits(p);
}

/** One 1/60 s tick. Once there is an outcome the same state is returned. */
export function stepReel(s: ReelState, p: ReelParams, holding: boolean): ReelState {
  if (s.outcome) return s;
  const h = zoneUnits(p), d = diffOf(p), floor = floorUnits(p);

  let zoneV = Math.max(-REEL.maxV, Math.min(REEL.maxV, s.zoneV + (holding ? REEL.lift : -REEL.gravity)));
  let zone = s.zone + zoneV;
  if (zone < 0) {
    zone = 0;
    if (zoneV < 0) zoneV = Math.floor((-zoneV * REEL.bouncePct) / 100);
  }
  if (zone > FX - h) {
    zone = FX - h;
    zoneV = 0;
  }

  let [u, rng] = rand32(s.rng);
  let target = s.target;
  if (Math.abs(target - s.fish) < REEL.close || u < Math.floor(((300 + 12 * d) * U32) / 60_000)) {
    [u, rng] = rand32(rng);
    target = Math.min(FX, Math.max(floor, s.fish + Math.trunc(((u - HALF) * (250_000 + 6_000 * d)) / U32)));
  }
  const step = Math.floor((180_000 + 6_200 * d) / 60);
  const gap = target - s.fish;
  const fish = Math.abs(gap) <= step ? target : s.fish + Math.sign(gap) * step;

  const tick = s.tick + 1;
  let progress = s.progress + (inZone({ zone, fish }, p)
    ? Math.floor(700_000_000_000 / (60 * minReelOf(p)))
    : -Math.floor((75_000_000 + 700_000 * d) / 60));
  let outcome: ReelState["outcome"] = null;
  if (progress >= PFX) {
    progress = PFX;
    outcome = "caught";
  } else if (progress <= 0) {
    progress = 0;
    outcome = "escaped";
  } else if (tick >= REEL.maxTicks) {
    outcome = "escaped";
  }
  return { zone, zoneV, fish, target, progress, tick, rng, outcome };
}

export interface ReelReplay { outcome: "caught" | "escaped"; ticks: number; progress: number }

/** Plays a reel from its toggle ticks: holding starts released and flips before stepping each listed tick. Toggles
 *  at or after the outcome are ignored here (the server refuses them). */
export function replayReel(p: ReelParams, toggles: readonly number[]): ReelReplay {
  let s = createReel(p);
  let holding = false, i = 0;
  while (!s.outcome) {
    while (i < toggles.length && toggles[i] === s.tick) {
      holding = !holding;
      i++;
    }
    s = stepReel(s, p, holding);
  }
  return { outcome: s.outcome, ticks: s.tick, progress: s.progress };
}

/** What the overlay hands back: the local outcome plus what finish_cast replays. */
export interface ReelResult { caught: boolean; toggles: number[]; ticks: number }

/** Records the hold state tick by tick as the compact list finish_cast takes. */
export class ReelRecorder {
  private holding = false;
  readonly toggles: number[] = [];
  /** Call before stepping tick `tick` with `holding`. */
  hold(tick: number, holding: boolean): void {
    if (holding === this.holding) return;
    this.holding = holding;
    this.toggles.push(tick);
  }
}
