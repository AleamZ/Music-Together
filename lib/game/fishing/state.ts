import type { ShopItem } from "./catalog";

// The account's fishing state as every fishing RPC returns it (spec §8.2), camelCased, plus the rules the HUD needs. Pure.

export interface FishRow { id: string; speciesId: string; weightG: number; price: number; caughtAt: string }
/** 0110: the hook / line / reel slots (null: empty); the bobber may be empty too. */
export interface Loadout { rod: string; bobber: string | null; bait: string; hook?: string | null; line?: string | null; reel?: string | null }
/** 0110: a slot fishing_equip mounts. */
export type GearSlot = "rod" | "hook" | "line" | "reel" | "bobber" | "bait";
/** 0110: what the gear adds up to (the server's _fishing_rig). */
export interface Rig {
  rod: string;
  /** Cần gỗ: its own hook, line and phao. */
  kit: boolean;
  /** The rod may cast (a bare rod needs a hook and a line). */
  ready: boolean;
  missing: Array<"hook" | "line">;
  hookClass: string | null;
  hooks: number;
  /** What the line holds (g). */
  lineG: number | null;
  /** What breaks the rod (g); null = never. */
  rodG: number | null;
  reelSpeed: number;
  reelEase: number;
  windowMs: number;
  showsRarity: boolean;
}
/** 0110: the groundbait thrown and still working. */
export interface GroundbaitOn { item: string; map: string; x: number; y: number; until: string }
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
  /** v18.2: durability left and max of each owned rod and net that wears ({} before migration 0034). */
  wear: Record<string, Wear>;
  /** 0110: groundbait bags by item id ({} before). */
  groundbait?: Record<string, number>;
  /** 0110: the groundbait working now, or null. */
  groundbaitOn?: GroundbaitOn | null;
  /** 0110: Sổ tay câu cá bought. */
  notebook?: boolean;
  /** 0110: the rig; null from a server before 0110. */
  rig?: Rig | null;
}
/** v18.2: [left, max]. */
export interface Wear { left: number; max: number }
export type CastBlocker = "no_bait" | "hands_full" | "bucket_full" | "cast_limit" | "daily_limit"
  /** 0110: a bare rod without its hook and line. */
  | "needs_parts";

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
    loadout: {
      rod: str(lo.rod, "rod_wood"), bobber: "bobber" in lo ? strOrNull(lo.bobber) : "bobber_feather", bait: str(lo.bait, "bait_worm"),
      hook: strOrNull(lo.hook), line: strOrNull(lo.line), reel: strOrNull(lo.reel),
    },
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
    wear: wearOf(j.wear),
    groundbait: countsOf(j.groundbait),
    groundbaitOn: groundbaitOnOf(j.groundbait_on),
    notebook: j.notebook === true,
    rig: rigOf(j.rig),
  };
}

function countsOf(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, x] of Object.entries(obj(v))) out[k] = num(x);
  return out;
}

function groundbaitOnOf(v: unknown): GroundbaitOn | null {
  const g = obj(v);
  if (typeof g.item !== "string" || typeof g.until !== "string") return null;
  return { item: g.item, map: str(g.map, "pond"), x: num(g.x), y: num(g.y), until: g.until };
}

/** 0110: the `rig` of the state; null when absent (a server before 0110). */
export function rigOf(v: unknown): Rig | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const numOrNull = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
  return {
    rod: str(r.rod, "rod_wood"), kit: r.kit === true, ready: r.ready !== false,
    missing: (Array.isArray(r.missing) ? r.missing : []).filter((x): x is "hook" | "line" => x === "hook" || x === "line"),
    hookClass: strOrNull(r.hook_class), hooks: num(r.hooks, 1), lineG: numOrNull(r.line_g), rodG: numOrNull(r.rod_g),
    reelSpeed: num(r.reel_speed, 1), reelEase: num(r.reel_ease, 0), windowMs: num(r.window_ms, 1500),
    showsRarity: r.shows_rarity === true,
  };
}

function wearOf(v: unknown): Record<string, Wear> {
  const out: Record<string, Wear> = {};
  for (const [k, x] of Object.entries(obj(v))) {
    if (Array.isArray(x) && typeof x[0] === "number" && typeof x[1] === "number") out[k] = { left: x[0], max: x[1] };
  }
  return out;
}

/** v18.2: the item's wear, or null when it does not wear (rod_wood, gear before 0034). */
export function wearFor(s: FishingState, id: string): Wear | null {
  return s.wear[id] ?? null;
}

/** v18.2: a rod at durability 0 stays in the bag but cannot be equipped or cast with. */
export function rodBroken(s: FishingState, id: string): boolean {
  const w = wearFor(s, id);
  return w !== null && w.left <= 0;
}

/** v18.2: Sửa cần costs 30% of the rod's price, rounded up (SQL `_repair_price`). */
export function repairPrice(item: ShopItem): number {
  return Math.ceil((item.price ?? 0) * 0.3);
}

/** v18.2: a rod below its max durability that chú Tư can repair. */
export function needsRepair(s: FishingState, item: ShopItem): boolean {
  const w = wearFor(s, item.id);
  return item.kind === "rod" && item.durability != null && w !== null && w.left < w.max;
}

/** v18.2: the net a throw uses — the widest owned one with throws left; null without one. */
export function bestNet(s: FishingState, items: readonly ShopItem[]): ShopItem | null {
  return items.filter((i) => i.kind === "net" && s.owned.includes(i.id) && (wearFor(s, i.id)?.left ?? 0) > 0)
    .sort((a, b) => (b.radiusPx ?? 0) - (a.radiusPx ?? 0))[0] ?? null;
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

/** 0110: groundbait bags of one kind. */
export function groundbaitCount(s: FishingState, id: string): number {
  return s.groundbait?.[id] ?? 0;
}

/** 0110: the most bags of a groundbait kind (buy_item's cap). */
export const GROUNDBAIT_MAX = 99;

/** Owned: a starter item, a bought one, or a bucket / bait box / fishing kit no bigger than what the account already has. */
export function ownsItem(s: FishingState, item: ShopItem): boolean {
  if (item.starter || s.owned.includes(item.id)) return true;
  if (item.kind === "bucket") return (item.capacity ?? 0) <= s.fishCap - 1;
  if (item.kind === "bait_box") return (item.capacity ?? 0) <= s.baitCap;
  // Bộ câu cá: owned once both its bait box and its crate would add nothing (same rule as the server's buy_item).
  if (item.kind === "fishing_kit") return (item.capacity ?? 0) <= s.baitCap && (item.capacity ?? 0) <= s.fishCap - 1;
  return false;
}

/** Why start_cast would refuse right now (same order as the server), or null. 0047: no hourly or daily cast cap any
 *  more — casts cost hunger and thirst ("cast_limit" / "daily_limit" stay in the type for old server errors only). */
export function castBlocker(s: FishingState): CastBlocker | null {
  if (s.rig && !s.rig.ready) return "needs_parts";                                     // 0110: before anything is spent
  if (s.fish.length >= s.fishCap) return s.fishCap <= 1 ? "hands_full" : "bucket_full";
  if (baitCount(s, s.loadout.bait) < 1 && baitCount(s, "bait_worm") < 1) return "no_bait";
  return null;
}

/** How many the account can buy now: bait up to the free capacity and the coins (max 99); gear 0 or 1. */
export function maxBuyQty(s: FishingState, item: ShopItem): number {
  if (item.price === null) return 0;
  const affordable = Math.floor(s.coins / item.price);
  if (item.kind === "bait") return Math.max(0, Math.min(99, s.baitCap - baitTotal(s), affordable));
  if (item.kind === "groundbait") return Math.max(0, Math.min(99, GROUNDBAIT_MAX - groundbaitCount(s, item.id), affordable));   // 0110
  return ownsItem(s, item) || affordable < 1 ? 0 : 1;
}

/** Seconds until the dig cooldown ends (0 = ready). */
export function digWaitSec(s: FishingState, now: number): number {
  return s.digReadyAt ? Math.max(0, Math.ceil((Date.parse(s.digReadyAt) - now) / 1000)) : 0;
}
