import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: h.rpc, from: h.from } }));

import { AnticheatError, subscribeAnticheat, type AnticheatEvent } from "@/lib/anticheat";
import {
  buyItem, fetchFishingBoard, fetchFishingCatalog, finishCast, fishingErrorMessage, sellFish, startCast,
} from "@/lib/game/fishing/rpc";

const STATE = {
  coins: 5, loadout: { rod: "rod_wood", bobber: "bobber_feather", bait: "bait_worm" }, owned: [],
  bait: { bait_worm: 1 }, bait_cap: 20, fish: [], fish_cap: 1, casts_left: 39, window_resets_at: null, dig_ready_at: null,
};
/** A thenable query chain: .select/.in/.order return itself; awaiting it resolves to { data: rows, error: null }. */
const filters: unknown[][] = [];
const chain = (rows: unknown[]) => {
  const c: Record<string, unknown> = {};
  c.select = () => c;
  c.in = (...args: unknown[]) => {
    filters.push(args);
    return c;
  };
  c.order = () => c;
  c.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve);
  return c;
};
/** The same chain, but awaiting it rejects: an error thrown rather than returned as { error }. */
const rejecting = (err: unknown) => {
  const c: Record<string, unknown> = {};
  c.select = () => c;
  c.in = () => c;
  c.order = () => c;
  c.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.reject(err).then(resolve, reject);
  return c;
};

beforeEach(() => {
  h.rpc.mockReset();
  h.from.mockReset();
});

describe("fetchFishingCatalog", () => {
  it("loads both config tables once per page", async () => {
    h.from.mockImplementation((table: string) => chain(table === "fish_species"
      ? [{ id: "ca_ro", name: "Cá rô đồng", rarity: 1, min_g: 50, max_g: 300, price_per_kg: 45, difficulty: 15, sort_order: 10 }]
      : [{ id: "rod_wood", kind: "rod", name: "Cần gỗ", price: null, starter: true, sort_order: 10, zone_pct: 25, weight_k: 2, rare_mult: 1,
          window_ms: null, bite_min_ms: null, bite_max_ms: null, shows_rarity: false, mult_hiem: 1, mult_quy: 1, mult_legend: 1, capacity: null }]));
    const a = await fetchFishingCatalog();
    const b = await fetchFishingCatalog();
    expect(b).toBe(a);
    expect(h.from).toHaveBeenCalledTimes(2);
    expect(a.species[0]).toMatchObject({ id: "ca_ro", pricePerKg: 45 });
    expect(a.items[0]).toMatchObject({ id: "rod_wood", starter: true, zonePct: 25 });
    // farm items share shop_items since v15: the fishing shop asks for its own kinds only
    expect(filters).toEqual([["kind", ["rod", "bobber", "bait", "bait_box", "bucket"]]]);
  });

  it("does not keep a rejected load: the next call queries again", async () => {
    vi.resetModules(); // a fresh module: the test above left its catalog cached
    const { fetchFishingCatalog: load } = await import("@/lib/game/fishing/rpc");
    h.from.mockImplementation(() => rejecting(new TypeError("Failed to fetch")));
    await expect(load()).rejects.toThrow("Failed to fetch");
    h.from.mockImplementation(() => chain([]));
    await expect(load()).resolves.toEqual({ species: [], items: [] });
    expect(h.from).toHaveBeenCalledTimes(4);
  });
});

describe("RPC wrappers", () => {
  it("maps start_cast", async () => {
    h.rpc.mockResolvedValue({ data: { cast_id: "c1", bite_ms: 4200, window_ms: 2000, difficulty: 38, min_reel_ms: 3520, zone_pct: 30, rarity: 2, bait_switched: true, state: STATE }, error: null });
    const c = await startCast("room", "tok");
    expect(h.rpc).toHaveBeenCalledWith("start_cast", { p_room_id: "room", p_session_token: "tok" });
    expect(c).toMatchObject({ castId: "c1", biteMs: 4200, windowMs: 2000, difficulty: 38, minReelMs: 3520, zonePct: 30, rarity: 2, baitSwitched: true });
    expect(c.state.castsLeft).toBe(39);
  });
  it("hides an unknown rarity", async () => {
    h.rpc.mockResolvedValue({ data: { cast_id: "c1", bite_ms: 1, window_ms: 1, difficulty: 1, min_reel_ms: 1, zone_pct: 25, rarity: null, bait_switched: false, state: STATE }, error: null });
    expect((await startCast("room", "tok")).rarity).toBeNull();
  });
  it("maps finish_cast both ways", async () => {
    h.rpc.mockResolvedValueOnce({ data: { result: "caught", record: true, fish: { id: "f", species_id: "ca_loc", weight_g: 1200, price: 72, rarity: 2 }, state: STATE }, error: null });
    expect(await finishCast("tok", "c1", true)).toMatchObject({ result: "caught", record: true, fish: { id: "f", speciesId: "ca_loc", weightG: 1200, price: 72, rarity: 2 } });
    h.rpc.mockResolvedValueOnce({ data: { result: "lost", why: "too_early", state: STATE }, error: null });
    expect(await finishCast("tok", "c1", true)).toMatchObject({ result: "lost", why: "too_early" });
  });
  it("maps the board", async () => {
    h.rpc.mockResolvedValue({ data: {
      records: [{ species_id: "ca_tra", username: "Dat", weight_g: 5000 }], mine: [{ species_id: "ca_ro", weight_g: 200 }],
      richest: [{ username: "Dat", coins: 900 }], my_rank: 2, my_coins: 30,
    }, error: null });
    expect(await fetchFishingBoard("room", "tok")).toEqual({
      records: [{ speciesId: "ca_tra", username: "Dat", weightG: 5000 }], mine: [{ speciesId: "ca_ro", weightG: 200 }],
      richest: [{ username: "Dat", coins: 900 }], myRank: 2, myCoins: 30, prices: null,
    });
  });
  it("maps the board's fish prices", async () => {
    h.rpc.mockResolvedValue({ data: {
      records: [], mine: [], richest: [], my_rank: 1, my_coins: 0,
      prices: { mult: 2.24, wealth: 100000, ends_at: "2026-09-25T08:00:00+00:00", factors: { ca_ro: 1.12 } },
    }, error: null });
    expect((await fetchFishingBoard("room", "tok")).prices).toEqual(
      { mult: 2.24, wealth: 100000, endsAt: "2026-09-25T08:00:00+00:00", factors: { ca_ro: 1.12 } });
  });
  it("throws the Postgres error", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "fish not found" } });
    await expect(sellFish("tok", ["x"])).rejects.toMatchObject({ message: "fish not found" });
  });
});

describe("the anti-cheat envelope (anti-cheat spec §12.1)", () => {
  const envelope = (strike: 0 | 1 | 2) => ({
    code: "bad_qty", strike, error: "invalid quantity", locked_until: strike === 1 ? "2026-10-02T10:20:00+00:00" : null,
    banned: strike === 2, server_now: "2026-10-02T10:15:00+00:00",
  });
  const events: AnticheatEvent[] = [];
  let off = () => {};
  beforeEach(() => {
    events.length = 0;
    off = subscribeAnticheat((e) => events.push(e));
  });
  afterEach(() => off());

  it("throws an AnticheatError for every strike, and reports strikes 1 and 2", async () => {
    for (const strike of [0, 1, 2] as const) {
      h.rpc.mockResolvedValueOnce({ data: { anticheat: envelope(strike) }, error: null });
      const err = await buyItem("tok", "bait_shrimp", 500).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AnticheatError);
      expect(err).toMatchObject({ message: "invalid quantity", info: { code: "bad_qty", strike } });
    }
    expect(events.map((e) => (e.kind === "strike" ? e.info.strike : null))).toEqual([1, 2]);
  });

  it("returns the lost answer of finish_cast with its envelope", async () => {
    h.rpc.mockResolvedValueOnce({
      data: { result: "lost", why: "too_early", state: STATE, anticheat: { ...envelope(1), code: "reel_too_fast", error: null } },
      error: null,
    });
    expect(await finishCast("tok", "c1", true)).toMatchObject({
      result: "lost", why: "too_early", anticheat: { code: "reel_too_fast", strike: 1, error: null },
    });
    expect(events).toHaveLength(1);
    h.rpc.mockResolvedValueOnce({ data: { result: "lost", why: "gave_up", state: STATE }, error: null });
    expect(await finishCast("tok", "c1", false)).toMatchObject({ result: "lost", why: "gave_up", anticheat: null });
  });

  it("reports the lock of an account locked refusal, then throws it", async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: "account locked", details: "125", hint: "anticheat" } });
    await expect(sellFish("tok", ["x"])).rejects.toMatchObject({ message: "account locked" });
    expect(events).toEqual([{ kind: "lock", until: expect.any(Number), code: null }]);
  });
});

describe("fishingErrorMessage", () => {
  it("translates every server message", () => {
    const t = (message: string, details?: string) => fishingErrorMessage({ message, details });
    expect(t("not enough coins")).toBe("Không đủ xu.");
    expect(t("already owned")).toBe("Bạn có món này rồi.");
    expect(t("item not available")).toBe("Món này không mua được.");
    expect(t("invalid quantity")).toBe("Món này không mua được.");
    expect(t("bait full")).toBe("Hộp mồi đầy rồi.");
    expect(t("no bait")).toBe("Hết mồi — đào trùn hoặc mua mồi ở tiệm nhé.");
    expect(t("hands full")).toBe("Tay đang cầm cá — ra vựa bán hoặc sắm xô nhé!");
    expect(t("bucket full")).toBe("Xô đầy rồi — ra vựa bán bớt nhé!");
    expect(t("cast limit", "1500")).toBe("Câu nhiều quá rồi, nghỉ tay chút nhé (còn 25 phút).");
    expect(t("dig cooldown", "32")).toBe("Đất còn cứng, chờ 32 giây nữa nhé.");
    expect(t("cast not found")).toBe("Cá đã thoát mất rồi.");
    expect(t("fish not found")).toBe("Con cá này không còn nữa.");
    expect(t("invalid session")).toBe("Phiên đăng nhập đã hết hạn — hãy đăng nhập lại.");
    expect(t("account banned")).toBe("Tài khoản đã bị khoá.");
    expect(t("account is not a member of this room")).toBe("Bạn không còn ở trong phòng này.");
    expect(fishingErrorMessage(new TypeError("Failed to fetch"))).toBe("Có lỗi, thử lại nhé.");
  });
  it("tells a locked account how long the lock runs, and a capped angler to come back tomorrow (anti-cheat §13)", () => {
    expect(fishingErrorMessage({ message: "account locked", details: "125", hint: "anticheat" }))
      .toBe("🔒 Tài khoản đang bị tạm khoá vì thao tác bất thường — còn 2 phút 5 giây.");
    expect(fishingErrorMessage({ message: "daily cast limit", details: "3600" })).toBe("Hôm nay bạn câu đủ 300 lần rồi — mai quay lại nhé!");
    const info = { code: "bad_qty", strike: 0 as const, error: "invalid quantity", lockedUntil: null, banned: false, serverNow: null };
    expect(fishingErrorMessage(new AnticheatError(info))).toBe("Món này không mua được.");
  });
});
