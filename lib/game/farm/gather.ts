// v15.3 gathering (spec §7, §13.1): 0018's rules (tests/fixtures/gather-cases.json pins them against the SQL), the
// critter prices, the spot keys, the capacity, and each spot's state and prompt. Pure.
import type { Interactable } from "@/lib/game/maps/types";
import type { FarmCatalog, FarmItem } from "./catalog";
import type { FarmMine, GatherMine } from "./state";

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

/** Today's visits left (§7.5): the server's count, or a whole day's once its Vietnam midnight has passed. */
export function visitsLeft(g: GatherMine, now: number): number {
  return g.dayResetsAt !== null && now >= g.dayResetsAt ? GATHER.dailyVisits : g.leftToday;
}

/** How many critters are held, every kind together. */
export function critterCount(critters: Readonly<Record<string, { n: number }>>): number {
  return Object.values(critters).reduce((s, c) => s + c.n, 0);
}

/** Where a hole or a bed stands for me (§13.1), in the server's refusal order: the daily limit, a full container (or
 *  full hands: box null), the spot's cooldown on the server clock, ready. Before 0018 (no critter kinds) every spot is
 *  ready, and E shows NOT_OPEN_153. */
export type SpotState =
  | { kind: "limit" }
  | { kind: "full"; box: FarmItem | null }
  | { kind: "cooling"; readyAt: number }
  | { kind: "ready" };

export function spotState(it: Interactable, mine: FarmMine | null, catalog: FarmCatalog | null, now: number): SpotState {
  if (!mine || !catalog || catalog.critters.length === 0) return { kind: "ready" };
  const g = mine.gather;
  if (visitsLeft(g, now) <= 0) return { kind: "limit" };
  if (critterCount(mine.critters) >= mine.critterCap) return { kind: "full", box: heldBox(mine.items, catalog.items) };
  const key = spotKey(it.id);
  const readyAt = key === null ? undefined : g.readyAt[key];
  return readyAt !== undefined && readyAt > now ? { kind: "cooling", readyAt } : { kind: "ready" };
}

/** Whole minutes left, at least 1. */
export function minutesLeft(ms: number): number {
  return Math.max(1, Math.ceil(ms / 60_000));
}

/** A container's name mid-sentence: "Giỏ tre" → "giỏ tre". */
export const lowerFirst = (name: string): string => name.charAt(0).toLocaleLowerCase("vi-VN") + name.slice(1);

/** The field prompt of a hole or a bed (§13.1), after the shell's "E · ". */
export function gatherPrompt(it: Interactable, mine: FarmMine | null, catalog: FarmCatalog | null, now: number): string {
  const hole = it.kind === "crab_hole", n = it.spot ?? 0;
  const s = spotState(it, mine, catalog, now);
  switch (s.kind) {
    case "limit":
      return "Hết lượt bắt cua, mò ốc hôm nay";
    case "full":
      return `${hole ? "Hang" : "Bãi"} ${n} · ${s.box ? lowerFirst(s.box.name) : "tay"} đầy — bán ở vựa cô Út`;
    case "cooling": {
      const m = minutesLeft(s.readyAt - now);
      return hole ? `Hang ${n} · cua chưa ra (còn ${m} phút)` : `Bãi ${n} · còn ${m} phút`;
    }
    case "ready":
      return hole ? `Bắt cua hang ${n}` : `Mò ốc bãi ${n}`;
  }
}
