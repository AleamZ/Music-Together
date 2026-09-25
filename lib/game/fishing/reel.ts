// Stardew-style reel minigame (spec §6.2): hold to lift the catch zone, keep the fish inside it. Pure and deterministic
// for a seed. The constants were tuned in a simulation with bots of several skill levels.

export interface ReelParams { zonePct: number; difficulty: number; minReelMs: number; seed: number }
export interface ReelState {
  /** Bottom of the catch zone (0 … 1 − zone height) and its speed, in bar heights per second. */
  zone: number;
  zoneV: number;
  /** Fish position and where it is heading (0 = bottom, 1 = top). */
  fish: number;
  target: number;
  progress: number;
  elapsedMs: number;
  rng: number;
  outcome: "caught" | "escaped" | null;
}

export const REEL = {
  /** Progress at the hook — fixed: the server's time gate assumes a perfect reel fills 0.3 → 1 in minReelMs. */
  start: 0.3,
  lift: 3.0,
  gravity: 2.2,
  maxSpeed: 1.4,
  bounce: 0.35,
  fishStart: 0.45,
  /** The fish stays at least this far above the resting zone, so doing nothing never lands a fish. */
  floorGap: 0.05,
  maxMs: 60_000,
  maxDt: 0.05,
} as const;

/** mulberry32: [value in [0, 1), next state]. */
export function nextRandom(state: number): [number, number] {
  const s = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), s | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, s];
}

export function zoneHeight(p: ReelParams): number {
  return Math.min(0.9, Math.max(0.05, p.zonePct / 100));
}

/** Lowest point the fish swims to. */
export function fishFloor(p: ReelParams): number {
  return Math.min(0.5, zoneHeight(p) + REEL.floorGap);
}

const level = (p: ReelParams): number => Math.min(1, Math.max(0, p.difficulty / 100));

export function createReel(p: ReelParams): ReelState {
  const floor = fishFloor(p);
  const [u, rng] = nextRandom(p.seed | 0);
  return {
    zone: 0, zoneV: 0, fish: Math.max(REEL.fishStart, floor), target: floor + u * (1 - floor),
    progress: REEL.start, elapsedMs: 0, rng, outcome: null,
  };
}

export function inZone(s: Pick<ReelState, "zone" | "fish">, p: ReelParams): boolean {
  return s.fish >= s.zone && s.fish <= s.zone + zoneHeight(p);
}

/** One frame. `dtSec` is clamped to 50 ms; once there is an outcome the same state is returned. */
export function stepReel(s: ReelState, p: ReelParams, dtSec: number, holding: boolean): ReelState {
  if (s.outcome) return s;
  const dt = Math.min(REEL.maxDt, Math.max(0, dtSec));
  const h = zoneHeight(p), d = level(p), floor = fishFloor(p);

  let zoneV = Math.max(-REEL.maxSpeed, Math.min(REEL.maxSpeed, s.zoneV + (holding ? REEL.lift : -REEL.gravity) * dt));
  let zone = s.zone + zoneV * dt;
  if (zone < 0) {
    zone = 0;
    if (zoneV < 0) zoneV = -zoneV * REEL.bounce;
  }
  if (zone > 1 - h) {
    zone = 1 - h;
    zoneV = 0;
  }

  let [u, rng] = nextRandom(s.rng);
  let target = s.target;
  if (Math.abs(target - s.fish) < 0.02 || u < (0.3 + 1.2 * d) * dt) {
    [u, rng] = nextRandom(rng);
    target = Math.min(1, Math.max(floor, s.fish + (u - 0.5) * (0.25 + 0.6 * d)));
  }
  const step = (0.18 + 0.62 * d) * dt;
  const gap = target - s.fish;
  const fish = Math.abs(gap) <= step ? target : s.fish + Math.sign(gap) * step;

  const elapsedMs = s.elapsedMs + dt * 1000;
  let progress = s.progress + (inZone({ zone, fish }, p) ? (0.7 / (p.minReelMs / 1000)) * dt : -(0.075 + 0.07 * d) * dt);
  let outcome: ReelState["outcome"] = null;
  if (progress >= 1) {
    progress = 1;
    outcome = "caught";
  } else if (progress <= 0) {
    progress = 0;
    outcome = "escaped";
  } else if (elapsedMs >= REEL.maxMs) {
    outcome = "escaped";
  }
  return { zone, zoneV, fish, target, progress, elapsedMs, rng, outcome };
}
