// v15.3 gathering (spec §7, §13.1): 0018's rules (tests/fixtures/gather-cases.json pins them against the SQL), the
// critter prices, the spot keys and the capacity. Pure.
import type { FarmItem } from "./catalog";

/** 0018's rules (R1–R5, R7, R19): the hands, a spot's cooldown, the visits a Vietnam day, the gates and windows, the
 *  odds, and the snails a bed gives. */
export const GATHER = {
  hand: 3,
  cooldownMs: 20 * 60_000,
  dailyVisits: 200,
  crabGateMs: 3_000,
  visitWindowMs: 120_000,
  transplantGateMs: 8_000,
  workWindowMs: 120_000,
  cuaGachOdds: 0.1,
  ocDongOdds: 0.7,
  bedSnails: [1, 3],
} as const;

/** The crab holes and the snail beds on the field (§6). */
export const HOLE_COUNT = 6;
export const BED_COUNT = 4;
/** The client's waits (R7, §8.1): a catch goes 4 s after crab_start's answer, a transplant 9 s after begin_work's. */
export const CRAB_FINISH_WAIT_MS = 4_000;
export const TRANSPLANT_WAIT_MS = 9_000;
/** A snail bed's progress bar (R9). */
export const BED_BAR_MS = 3_000;

/** max(1, floor(base × M)) in whole hundredths of M (R4), as 0018's _critter_price: 45 × 1.40 is 63, where the float
 *  product is 62.99…. */
export function critterPrice(base: number, mult: number): number {
  return Math.max(1, Math.floor((base * Math.round(mult * 100)) / 100));
}

const SPOT_ID = /^(crab|bed)_(\d)$/;
const SPOT_KEY = /^(crab|bed)(\d)$/;
const inRange = (grp: string, n: number): boolean => n >= 1 && n <= (grp === "crab" ? HOLE_COUNT : BED_COUNT);

/** The server's key of a hole's or a bed's interactable (§6): crab_1 → crab1, bed_4 → bed4; null for any other id. */
export function spotKey(id: string): string | null {
  const m = SPOT_ID.exec(id);
  return m && inRange(m[1], Number(m[2])) ? `${m[1]}${m[2]}` : null;
}

/** The interactable of a server key: crab1 → crab_1; null for any other key. */
export function spotId(key: string): string | null {
  const m = SPOT_KEY.exec(key);
  return m && inRange(m[1], Number(m[2])) ? `${m[1]}_${m[2]}` : null;
}

/** The largest container among the items held (R5), or null: bare hands. */
export function heldBox(items: Readonly<Record<string, number>>, all: readonly FarmItem[]): FarmItem | null {
  let best: FarmItem | null = null;
  for (const it of all) {
    if (it.kind === "critter_box" && (items[it.id] ?? 0) > 0 && (it.capacity ?? 0) > (best?.capacity ?? 0)) best = it;
  }
  return best;
}

/** 3 by hand plus the largest container: the server's critter_cap. */
export function critterCap(items: Readonly<Record<string, number>>, all: readonly FarmItem[]): number {
  return GATHER.hand + (heldBox(items, all)?.capacity ?? 0);
}

/** How many critters are held, every kind together. */
export function critterCount(critters: Readonly<Record<string, { n: number }>>): number {
  return Object.values(critters).reduce((s, c) => s + c.n, 0);
}
