import { describe, it, expect } from "vitest";
import type { ShopItem } from "@/lib/game/fishing/catalog";
import {
  baitTotal, castBlocker, castWaitMin, dayCapped, digWaitSec, handFish, maxBuyQty, ownsItem, parseFishingState, type FishingState,
} from "@/lib/game/fishing/state";

const RAW = {
  coins: 120, daily_claimed: true,
  loadout: { rod: "rod_bamboo", bobber: "bobber_feather", bait: "bait_shrimp" },
  owned: ["rod_bamboo", "bucket_small"],
  bait: { bait_worm: 3, bait_shrimp: 1, bait_bloodworm: 0 },
  bait_cap: 20,
  fish: [
    { id: "f1", species_id: "ca_loc", weight_g: 1200, price: 72, caught_at: "2026-09-24T10:00:00Z" },
    { id: "f2", species_id: "ca_ro", weight_g: 150, price: 7, caught_at: "2026-09-24T10:05:00Z" },
  ],
  fish_cap: 6, casts_left: 37, window_resets_at: "2026-09-24T11:00:00Z", dig_ready_at: null,
};
const S = parseFishingState(RAW)!;
const withS = (over: Partial<FishingState>): FishingState => ({ ...S, ...over });
const item = (over: Partial<ShopItem>): ShopItem => ({
  id: "x", kind: "rod", name: "x", price: 1, starter: false, sortOrder: 0, zonePct: null, weightK: null, rareMult: 1,
  windowMs: null, biteMinMs: null, biteMaxMs: null, showsRarity: false, multHiem: 1, multQuy: 1, multLegend: 1, capacity: null,
  ...over,
});
const NOW = Date.parse("2026-09-24T10:30:00Z");

describe("parseFishingState", () => {
  it("camelCases the RPC state", () => {
    expect(S).toMatchObject({
      coins: 120, dailyClaimed: true, loadout: { rod: "rod_bamboo", bobber: "bobber_feather", bait: "bait_shrimp" },
      owned: ["rod_bamboo", "bucket_small"], baitCap: 20, fishCap: 6, castsLeft: 37,
      windowResetsAt: "2026-09-24T11:00:00Z", digReadyAt: null, serverNow: null,
    });
    expect(parseFishingState({ ...RAW, server_now: "2026-09-24T10:30:00Z" })?.serverNow).toBe("2026-09-24T10:30:00Z");
    expect(S.fish[0]).toEqual({ id: "f1", speciesId: "ca_loc", weightG: 1200, price: 72, caughtAt: "2026-09-24T10:00:00Z" });
  });
  it("rejects non-objects and fills defaults", () => {
    expect(parseFishingState(null)).toBeNull();
    expect(parseFishingState("x")).toBeNull();
    expect(parseFishingState({})).toMatchObject({
      coins: 0, dailyClaimed: false, loadout: { rod: "rod_wood", bobber: "bobber_feather", bait: "bait_worm" },
      owned: [], bait: {}, baitCap: 20, fish: [], fishCap: 1, castsLeft: 40, windowResetsAt: null, digReadyAt: null,
    });
  });
});

describe("the daily cap and the lock (anti-cheat spec §10.4)", () => {
  it("reads casts_today_left, day_resets_at and the running lock", () => {
    const s = parseFishingState({
      ...RAW, casts_today_left: 0, day_resets_at: "2026-09-24T17:00:00Z", lock: { until: "2026-09-24T10:35:00Z", code: "bad_qty" },
    });
    expect(s).toMatchObject({ castsTodayLeft: 0, dayResetsAt: "2026-09-24T17:00:00Z", lock: { until: "2026-09-24T10:35:00Z", code: "bad_qty" } });
    expect(S).toMatchObject({ castsTodayLeft: 300, dayResetsAt: null, lock: null });
    expect(parseFishingState({ ...RAW, lock: { until: "soon", code: "bad_qty" } })?.lock).toBeNull();
    expect(parseFishingState({ ...RAW, lock: "bad_qty" })?.lock).toBeNull();
  });
  it("blocks a cast at the daily cap until the Vietnam day turns, after the hourly cap", () => {
    const capped = withS({ castsTodayLeft: 0, dayResetsAt: "2026-09-24T17:00:00Z" });
    expect(dayCapped(capped, NOW)).toBe(true);
    expect(castBlocker(capped, NOW)).toBe("daily_limit");
    expect(dayCapped(capped, Date.parse("2026-09-24T17:00:00Z"))).toBe(false);
    expect(castBlocker(capped, Date.parse("2026-09-24T17:00:00Z"))).toBeNull();
    expect(castBlocker({ ...capped, castsLeft: 0 }, NOW)).toBe("cast_limit");
    expect(castBlocker({ ...capped, fish: [...S.fish, ...S.fish, ...S.fish] }, NOW)).toBe("daily_limit");
    expect(dayCapped(S, NOW)).toBe(false);
  });
});

describe("hand, bait and ownership", () => {
  it("puts the oldest fish in hand and counts all bait", () => {
    expect(handFish(S)?.id).toBe("f1");
    expect(handFish(withS({ fish: [] }))).toBeNull();
    expect(baitTotal(S)).toBe(4);
  });
  it("treats starter, bought, and not-bigger buckets / bait boxes as owned", () => {
    expect(ownsItem(S, item({ id: "rod_wood", starter: true, price: null }))).toBe(true);
    expect(ownsItem(S, item({ id: "rod_bamboo" }))).toBe(true);
    expect(ownsItem(S, item({ id: "rod_carbon" }))).toBe(false);
    expect(ownsItem(S, item({ id: "bucket_small", kind: "bucket", capacity: 5 }))).toBe(true);
    expect(ownsItem(S, item({ id: "bucket_large", kind: "bucket", capacity: 15 }))).toBe(false);
    expect(ownsItem(S, item({ id: "bait_box", kind: "bait_box", capacity: 60 }))).toBe(false);
    expect(ownsItem(withS({ baitCap: 60 }), item({ id: "bait_box", kind: "bait_box", capacity: 60 }))).toBe(true);
  });
});

describe("castBlocker", () => {
  it("allows a cast when nothing is in the way", () => {
    expect(castBlocker(S, NOW)).toBeNull();
  });
  it("checks in start_cast's order: hourly cap, capacity, bait (with the worm fallback)", () => {
    expect(castBlocker(withS({ castsLeft: 0 }), NOW)).toBe("cast_limit");
    expect(castBlocker(withS({ castsLeft: 0 }), Date.parse("2026-09-24T11:00:01Z"))).toBeNull();
    expect(castBlocker(withS({ fishCap: 2 }), NOW)).toBe("bucket_full");
    expect(castBlocker(withS({ fishCap: 1, fish: [S.fish[0]] }), NOW)).toBe("hands_full");
    expect(castBlocker(withS({ bait: { bait_worm: 0, bait_shrimp: 0, bait_bloodworm: 0 } }), NOW)).toBe("no_bait");
    expect(castBlocker(withS({ bait: { bait_worm: 2, bait_shrimp: 0, bait_bloodworm: 0 } }), NOW)).toBeNull();
  });
});

describe("maxBuyQty", () => {
  it("limits bait by the free capacity, the coins and 99", () => {
    expect(maxBuyQty(S, item({ kind: "bait", price: 5 }))).toBe(16);
    expect(maxBuyQty(withS({ coins: 30 }), item({ kind: "bait", price: 12 }))).toBe(2);
    expect(maxBuyQty(withS({ coins: 100_000, baitCap: 200, bait: {} }), item({ kind: "bait", price: 5 }))).toBe(99);
  });
  it("sells gear once, and only when affordable", () => {
    expect(maxBuyQty(S, item({ id: "bobber_foam", kind: "bobber", price: 150 }))).toBe(0);
    expect(maxBuyQty(S, item({ id: "bobber_foam", kind: "bobber", price: 100 }))).toBe(1);
    expect(maxBuyQty(S, item({ id: "rod_bamboo", price: 1 }))).toBe(0);
    expect(maxBuyQty(S, item({ id: "rod_wood", starter: true, price: null }))).toBe(0);
  });
});

describe("timers", () => {
  it("counts down the dig cooldown and the hourly cap", () => {
    expect(digWaitSec(S, NOW)).toBe(0);
    expect(digWaitSec(withS({ digReadyAt: "2026-09-24T10:30:12.200Z" }), NOW)).toBe(13);
    expect(castWaitMin(S, NOW)).toBe(0);
    expect(castWaitMin(withS({ castsLeft: 0 }), NOW)).toBe(30);
  });
});
