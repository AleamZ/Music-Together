import type { ShopItem } from "./catalog";

// The account's fishing state as every fishing RPC returns it (spec §8.2), camelCased, plus the rules the HUD needs. Pure.

export interface FishRow { id: string; speciesId: string; weightG: number; price: number; caughtAt: string }
export interface Loadout { rod: string; bobber: string; bait: string }
/** A running anti-cheat lock (anti-cheat spec R14): its end and the signal that caused it. */
export interface FishingLock { until: string; code: string }
export interface FishingState {
  coins: number;
  dailyClaimed: boolean;
  loadout: Loadout;
  /** Non-starter gear the account owns. */
  owned: string[];
  /** Bait counts by item id. */
  bait: Record<string, number>;
  baitCap: number;
  /** Oldest first — fish[0] is the one in hand. */
  fish: FishRow[];
  fishCap: number;
  castsLeft: number;
  windowResetsAt: string | null;
  digReadyAt: string | null;
  /** The server's clock at the answer (v15 §11.6; null before migration 0013). */
  serverNow: string | null;
  /** Casts left today (300 per Vietnam day, anti-cheat R21; 300 before migration 0015). */
  castsTodayLeft: number;
  /** The next Vietnam midnight, while no cast is left today. */
  dayResetsAt: string | null;
  lock: FishingLock | null;
}
export type CastBlocker = "no_bait" | "hands_full" | "bucket_full" | "cast_limit" | "daily_limit";

const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

function lockOf(v: unknown): FishingLock | null {
  const l = obj(v);
  return typeof l.until === "string" && Number.isFinite(Date.parse(l.until)) ? { until: l.until, code: str(l.code) } : null;
}

/** The `state` JSON of any fishing RPC; null when it is not an object. */
export function parseFishingState(json: unknown): FishingState | null {
  if (!json || typeof json !== "object") return null;
  const j = json as Record<string, unknown>;
  const lo = obj(j.loadout);
  const bait: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj(j.bait))) bait[k] = num(v);
  const fish = (Array.isArray(j.fish) ? j.fish : []).map(obj).map((f) => ({
    id: str(f.id), speciesId: str(f.species_id), weightG: num(f.weight_g), price: num(f.price), caughtAt: str(f.caught_at),
  }));
  return {
    coins: num(j.coins),
    dailyClaimed: j.daily_claimed === true,
    loadout: { rod: str(lo.rod, "rod_wood"), bobber: str(lo.bobber, "bobber_feather"), bait: str(lo.bait, "bait_worm") },
    owned: (Array.isArray(j.owned) ? j.owned : []).filter((x): x is string => typeof x === "string"),
    bait,
    baitCap: num(j.bait_cap, 20),
    fish,
    fishCap: num(j.fish_cap, 1),
    castsLeft: num(j.casts_left, 40),
    windowResetsAt: strOrNull(j.window_resets_at),
    digReadyAt: strOrNull(j.dig_ready_at),
    serverNow: strOrNull(j.server_now),
    castsTodayLeft: num(j.casts_today_left, 300),
    dayResetsAt: strOrNull(j.day_resets_at),
    lock: lockOf(j.lock),
  };
}

export function handFish(s: FishingState): FishRow | null {
  return s.fish[0] ?? null;
}

export function baitCount(s: FishingState, id: string): number {
  return s.bait[id] ?? 0;
}

export function baitTotal(s: FishingState): number {
  return Object.values(s.bait).reduce((a, b) => a + b, 0);
}

/** Owned: a starter item, a bought one, or a bucket / bait box no bigger than what the account already has. */
export function ownsItem(s: FishingState, item: ShopItem): boolean {
  if (item.starter || s.owned.includes(item.id)) return true;
  if (item.kind === "bucket") return (item.capacity ?? 0) <= s.fishCap - 1;
  if (item.kind === "bait_box") return (item.capacity ?? 0) <= s.baitCap;
  return false;
}

/** No cast is left today and the Vietnam day has not turned yet. */
export function dayCapped(s: FishingState, now: number): boolean {
  return s.castsTodayLeft <= 0 && !(s.dayResetsAt !== null && Date.parse(s.dayResetsAt) <= now);
}

/** Why start_cast would refuse right now (same order as the server), or null. `now` = serverNow(). */
export function castBlocker(s: FishingState, now: number): CastBlocker | null {
  const windowOver = s.windowResetsAt !== null && Date.parse(s.windowResetsAt) <= now;
  if (s.castsLeft <= 0 && !windowOver) return "cast_limit";
  if (dayCapped(s, now)) return "daily_limit";
  if (s.fish.length >= s.fishCap) return s.fishCap <= 1 ? "hands_full" : "bucket_full";
  if (baitCount(s, s.loadout.bait) < 1 && baitCount(s, "bait_worm") < 1) return "no_bait";
  return null;
}

/** How many the account can buy now: bait up to the free capacity and the coins (max 99); gear 0 or 1. */
export function maxBuyQty(s: FishingState, item: ShopItem): number {
  if (item.price === null) return 0;
  const affordable = Math.floor(s.coins / item.price);
  if (item.kind === "bait") return Math.max(0, Math.min(99, s.baitCap - baitTotal(s), affordable));
  return ownsItem(s, item) || affordable < 1 ? 0 : 1;
}

/** Seconds until the dig cooldown ends (0 = ready). */
export function digWaitSec(s: FishingState, now: number): number {
  return s.digReadyAt ? Math.max(0, Math.ceil((Date.parse(s.digReadyAt) - now) / 1000)) : 0;
}

/** Minutes until the hourly cast window resets (0 = casts available). */
export function castWaitMin(s: FishingState, now: number): number {
  if (s.castsLeft > 0 || !s.windowResetsAt) return 0;
  return Math.max(0, Math.ceil((Date.parse(s.windowResetsAt) - now) / 60_000));
}
