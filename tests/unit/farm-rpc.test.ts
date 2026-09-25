import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: h.rpc, from: h.from } }));

import { actionCall, buyFarmItem, claimFarmGift, fetchFarmCatalog, fetchFieldState, fieldAction, sellRice } from "@/lib/game/farm/rpc";

const FIELD = {
  server_now: "2026-09-25T10:00:00+00:00",
  plots: [{ no: 5, kind: "village", owner: null, sale_price: null, sublease_price: null, farmer: null, lease: null, offers: 0, crop: null }],
  drying: [],
  mine: { items: {}, rice: {}, coins: 100, gift_claimed: false, owned_plot: null, farming: [], my_offers: [], incoming_offers: [] },
};
const MINE = { items: { seed_nep: 2 }, rice: {}, coins: 10, gift_claimed: true };

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

beforeEach(() => {
  h.rpc.mockReset();
  h.from.mockReset();
});

describe("fetchFarmCatalog", () => {
  it("loads the varieties and the farm items once per page", async () => {
    h.from.mockImplementation((table: string) => chain(table === "rice_varieties"
      ? [{ id: "nep", name: "Nếp", scale: 1, base_kg: 75, price_per_kg: 18, blast_mult: 1, sort_order: 20 }]
      : [{ id: "seed_nep", kind: "seed", name: "Giống nếp", price: 90, sort_order: 20, variety: "nep", fert: null, pest_target: null,
          capacity: null }]));
    const a = await fetchFarmCatalog();
    expect(await fetchFarmCatalog()).toBe(a);
    expect(h.from).toHaveBeenCalledTimes(2);
    expect(a.varieties[0]).toMatchObject({ id: "nep", baseKg: 75 });
    expect(a.items[0]).toMatchObject({ id: "seed_nep", kind: "seed", variety: "nep" });
    expect(filters).toEqual([["kind", ["seed", "fertilizer", "pesticide", "critter_box"]]]);
  });
});

describe("field RPCs", () => {
  it("reads field_state", async () => {
    h.rpc.mockResolvedValue({ data: FIELD, error: null });
    const s = await fetchFieldState("r", "tok");
    expect(h.rpc).toHaveBeenCalledWith("field_state", { p_room_id: "r", p_session_token: "tok" });
    expect(s.plots[0].no).toBe(5);
  });
  it("names each action's RPC and arguments", () => {
    expect(actionCall({ kind: "rent", plot: 5 })).toEqual(["rent_plot", { p_plot: 5 }]);
    expect(actionCall({ kind: "sell_back", plot: 1 })).toEqual(["sell_plot_to_village", { p_plot: 1 }]);
    expect(actionCall({ kind: "list", plot: 1, price: null })).toEqual(["list_plot", { p_plot: 1, p_price: null }]);
    expect(actionCall({ kind: "buy_listed", plot: 1, expected: 900 })).toEqual(["buy_listed_plot", { p_plot: 1, p_expected_price: 900 }]);
    expect(actionCall({ kind: "accept_offer", offer: "o" })).toEqual(["accept_offer", { p_offer_id: "o" }]);
    expect(actionCall({ kind: "rent_sublease", plot: 2, expected: 300 })).toEqual(["rent_sublease", { p_plot: 2, p_expected_price: 300 }]);
    expect(actionCall({ kind: "abandon", plot: 7 })).toEqual(["abandon_crop", { p_plot: 7 }]);
    expect(actionCall({ kind: "fertilize", plot: 7, item: "fert_npk" })).toEqual(["apply_fertilizer", { p_plot: 7, p_item_id: "fert_npk" }]);
    expect(actionCall({ kind: "begin_work", plot: 7, work: "harvest" })).toEqual(["begin_work", { p_plot: 7, p_work: "harvest" }]);
    expect(actionCall({ kind: "water", plot: 7, delta: -1 })).toEqual(["water", { p_plot: 7, p_delta: -1 }]);
    expect(actionCall({ kind: "dry_start", variety: "nep", kg: 70 })).toEqual(["dry_start", { p_variety: "nep", p_kg: 70 }]);
    expect(actionCall({ kind: "dry_collect", slot: 2 })).toEqual(["dry_collect", { p_slot: 2 }]);
  });
  it("sends an action with the room and the token, and reads a harvest", async () => {
    h.rpc.mockResolvedValue({ data: { ...FIELD, harvest: { variety: "nep", kg: 70 } }, error: null });
    const r = await fieldAction("r", "tok", { kind: "harvest", plot: 7, quality: 1 });
    expect(h.rpc).toHaveBeenCalledWith("harvest", { p_room_id: "r", p_session_token: "tok", p_plot: 7, p_quality: 1 });
    expect(r.harvest).toEqual({ variety: "nep", kg: 70 });
    expect(r.state.mine.coins).toBe(100);
  });
  it("throws the server's error", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "farm limit" } });
    await expect(fieldAction("r", "tok", { kind: "rent", plot: 5 })).rejects.toMatchObject({ message: "farm limit" });
  });
});

describe("account RPCs", () => {
  it("sell, buy and claim the gift", async () => {
    h.rpc.mockResolvedValue({ data: { server_now: "2026-09-25T10:00:00+00:00", mine: MINE }, error: null });
    expect(await sellRice("tok", "nep", true, 10)).toEqual({
      serverNow: "2026-09-25T10:00:00+00:00", mine: { items: { seed_nep: 2 }, rice: {}, coins: 10, giftClaimed: true },
    });
    expect(h.rpc).toHaveBeenLastCalledWith("sell_rice", { p_session_token: "tok", p_variety: "nep", p_dry: true, p_kg: 10 });
    await buyFarmItem("tok", "fert_npk", 3);
    expect(h.rpc).toHaveBeenLastCalledWith("buy_farm_item", { p_session_token: "tok", p_item_id: "fert_npk", p_qty: 3 });
    h.rpc.mockResolvedValue({ data: { gifted: true, server_now: "2026-09-25T10:00:00+00:00", mine: MINE }, error: null });
    expect((await claimFarmGift("tok")).gifted).toBe(true);
  });
});
