import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: h.rpc, from: h.from } }));

import { fetchFishingBoard, fetchFishingCatalog, finishCast, fishingErrorMessage, sellFish, startCast } from "@/lib/game/fishing/rpc";

const STATE = {
  coins: 5, loadout: { rod: "rod_wood", bobber: "bobber_feather", bait: "bait_worm" }, owned: [],
  bait: { bait_worm: 1 }, bait_cap: 20, fish: [], fish_cap: 1, casts_left: 39, window_resets_at: null, dig_ready_at: null,
};
/** A thenable query chain: .select/.order return itself; awaiting it resolves to { data: rows, error: null }. */
const chain = (rows: unknown[]) => {
  const c: Record<string, unknown> = {};
  c.select = () => c;
  c.order = () => c;
  c.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve);
  return c;
};
/** The same chain, but awaiting it rejects: an error thrown rather than returned as { error }. */
const rejecting = (err: unknown) => {
  const c: Record<string, unknown> = {};
  c.select = () => c;
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
      richest: [{ username: "Dat", coins: 900 }], myRank: 2, myCoins: 30,
    });
  });
  it("throws the Postgres error", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "fish not found" } });
    await expect(sellFish("tok", ["x"])).rejects.toMatchObject({ message: "fish not found" });
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
});
