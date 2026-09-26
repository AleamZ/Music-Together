import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: h.rpc, from: h.from } }));

import { AnticheatError, subscribeAnticheat, type AnticheatEvent } from "@/lib/anticheat";
import {
  actionCall, buyFarmItem, claimFarmGift, crabFinish, crabStart, fetchFarmCatalog, fetchFieldState, fieldAction, loadSprayer, pickSnailBed,
  RPCS_152, RPCS_153, sellCritters, sellProduce, sellRice,
} from "@/lib/game/farm/rpc";
import fixtures from "@/tests/fixtures/upland-cases.json";

const FIELD = {
  server_now: "2026-09-25T10:00:00+00:00",
  plots: [{ no: 5, kind: "village", owner: null, sale_price: null, sublease_price: null, farmer: null, lease: null, offers: 0, crop: null }],
  drying: [],
  mine: { items: {}, rice: {}, coins: 100, gift_claimed: false, owned_plot: null, farming: [], my_offers: [], incoming_offers: [] },
};
const MINE = { items: { seed_nep: 2 }, rice: {}, coins: 10, gift_claimed: true };

const filters: unknown[][] = [];
const chain = (rows: unknown[] | null, error: unknown = null) => {
  const c: Record<string, unknown> = {};
  c.select = () => c;
  c.in = (...args: unknown[]) => {
    filters.push(args);
    return c;
  };
  c.order = () => c;
  c.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows, error }).then(resolve);
  return c;
};

beforeEach(() => {
  h.rpc.mockReset();
  h.from.mockReset();
});

const VARIETY_ROW = { id: "nep", name: "Nếp", scale: 1, base_kg: 75, price_per_kg: 18, blast_mult: 1, sort_order: 20 };
const ITEM_ROW = { id: "seed_ot", kind: "seed", name: "Hạt ớt giống", price: 1500, sort_order: 60, variety: null, fert: null,
  pest_target: null, capacity: null, upland: "ot" };
const CRITTER_ROW = { id: "cua_dong", name: "Cua đồng", grp: "crab", base_price: 12, sort_order: 10 };
const rowsOf = (table: string, crops: unknown[] = []) =>
  table === "rice_varieties" ? [VARIETY_ROW] : table === "upland_crops" ? crops : table === "critter_kinds" ? [CRITTER_ROW] : [ITEM_ROW];

describe("fetchFarmCatalog", () => {
  it("loads the varieties, the hoa-màu crops, the farm items and the critters once per page", async () => {
    const crops = (fixtures as unknown as { crops: unknown[] }).crops;
    h.from.mockImplementation((table: string) => chain(rowsOf(table, crops)));
    const a = await fetchFarmCatalog();
    expect(await fetchFarmCatalog()).toBe(a);
    expect(h.from.mock.calls.map(([t]) => t)).toEqual(["rice_varieties", "upland_crops", "shop_items", "critter_kinds"]);
    expect(a.varieties[0]).toMatchObject({ id: "nep", baseKg: 75 });
    expect(a.uplands.map((u) => u.id)).toEqual(["khoai", "bap", "ot"]);
    expect(a.items[0]).toMatchObject({ id: "seed_ot", kind: "seed", upland: "ot" });
    expect(a.critters).toEqual([{ id: "cua_dong", name: "Cua đồng", group: "crab", basePrice: 12, sortOrder: 10 }]);
    expect(filters).toEqual([["kind", ["seed", "fertilizer", "pesticide", "critter_box", "tool"]]]);
  });
  it("has no hoa-màu crops before 0016, and fails on any other error", async () => {
    vi.resetModules();
    const fresh = (await import("@/lib/game/farm/rpc")).fetchFarmCatalog;
    h.from.mockImplementation((table: string) => table === "upland_crops"
      ? chain(null, { code: "PGRST205", message: "Could not find the table 'public.upland_crops' in the schema cache" })
      : chain(rowsOf(table)));
    expect((await fresh()).uplands).toEqual([]);
    vi.resetModules();
    const again = (await import("@/lib/game/farm/rpc")).fetchFarmCatalog;
    h.from.mockImplementation((table: string) => table === "upland_crops" ? chain(null, { code: "42501", message: "denied" }) : chain([]));
    await expect(again()).rejects.toMatchObject({ code: "42501" });
  });
  it("has no critters before 0018 (v15.3 §4), and fails on their other errors", async () => {
    vi.resetModules();
    const fresh = (await import("@/lib/game/farm/rpc")).fetchFarmCatalog;
    h.from.mockImplementation((table: string) => table === "critter_kinds"
      ? chain(null, { code: "42P01", message: "relation \"public.critter_kinds\" does not exist" })
      : chain(rowsOf(table)));
    expect((await fresh()).critters).toEqual([]);
    vi.resetModules();
    const again = (await import("@/lib/game/farm/rpc")).fetchFarmCatalog;
    h.from.mockImplementation((table: string) => table === "critter_kinds" ? chain(null, { code: "57014", message: "timeout" }) : chain(rowsOf(table)));
    await expect(again()).rejects.toMatchObject({ code: "57014" });
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
  it("names the v15.2 room actions (§11.4)", () => {
    expect(actionCall({ kind: "prepare_beds", plot: 6 })).toEqual(["prepare_beds", { p_plot: 6 }]);
    expect(actionCall({ kind: "plant", plot: 6, item: "seed_ot" })).toEqual(["plant_crop", { p_plot: 6, p_item_id: "seed_ot" }]);
    expect(actionCall({ kind: "tend", plot: 6, act: "vun_goc" })).toEqual(["tend_crop", { p_plot: 6, p_act: "vun_goc" }]);
    expect(actionCall({ kind: "harvest_part", plot: 3, success: false })).toEqual(["harvest_part", { p_plot: 3, p_success: false }]);
    expect(actionCall({ kind: "rent_harvester", plot: 3 })).toEqual(["rent_harvester", { p_plot: 3 }]);
    expect([...RPCS_152].sort()).toEqual([
      "harvest_part", "load_sprayer", "plant_crop", "prepare_beds", "rent_harvester", "sell_produce", "tend_crop",
    ]);
  });
  it("reads a hand part and a picking", async () => {
    h.rpc.mockResolvedValue({ data: { ...FIELD, harvest_part: { variety: "nep", kg: 13, parts: 2, total: 25, done: false } }, error: null });
    const r = await fieldAction("r", "tok", { kind: "harvest_part", plot: 3, success: true });
    expect(h.rpc).toHaveBeenCalledWith("harvest_part", { p_room_id: "r", p_session_token: "tok", p_plot: 3, p_success: true });
    expect(r).toMatchObject({ harvest: null, picking: null, harvestPart: { variety: "nep", kg: 13, parts: 2, total: 25, done: false } });
    h.rpc.mockResolvedValue({ data: { ...FIELD, harvest: { upland: "ot", kg: 24, k: 1, pickings: 3, done: false } }, error: null });
    expect(await fieldAction("r", "tok", { kind: "harvest", plot: 6, quality: 1 })).toMatchObject({
      harvest: null, harvestPart: null, picking: { upland: "ot", kg: 24, k: 1, pickings: 3, done: false },
    });
    h.rpc.mockResolvedValue({ data: FIELD, error: null });
    expect(await fieldAction("r", "tok", { kind: "harvest_part", plot: 3, success: false })).toMatchObject({
      harvest: null, harvestPart: null, picking: null,
    });
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
      serverNow: "2026-09-25T10:00:00+00:00",
      mine: { items: { seed_nep: 2 }, rice: {}, coins: 10, giftClaimed: true, produce: {}, tank: null, critters: {}, critterCap: 3, gather: { readyAt: {}, leftToday: 200, dayResetsAt: null } },
    });
    expect(h.rpc).toHaveBeenLastCalledWith("sell_rice", { p_session_token: "tok", p_variety: "nep", p_dry: true, p_kg: 10 });
    await buyFarmItem("tok", "fert_npk", 3);
    expect(h.rpc).toHaveBeenLastCalledWith("buy_farm_item", { p_session_token: "tok", p_item_id: "fert_npk", p_qty: 3 });
    h.rpc.mockResolvedValue({ data: { gifted: true, server_now: "2026-09-25T10:00:00+00:00", mine: MINE }, error: null });
    expect((await claimFarmGift("tok")).gifted).toBe(true);
  });
  it("loads the sprayer and sells hoa màu (v15.2)", async () => {
    const mine = { ...MINE, produce: { khoai: 20 }, tank: { item: "spray_insect", charges: 3 } };
    h.rpc.mockResolvedValue({ data: { server_now: "2026-09-25T10:00:00+00:00", mine }, error: null });
    expect((await loadSprayer("tok", "spray_insect")).mine.tank).toEqual({ item: "spray_insect", charges: 3 });
    expect(h.rpc).toHaveBeenLastCalledWith("load_sprayer", { p_session_token: "tok", p_item_id: "spray_insect" });
    expect((await sellProduce("tok", "khoai", 160)).mine.produce).toEqual({ khoai: 20 });
    expect(h.rpc).toHaveBeenLastCalledWith("sell_produce", { p_session_token: "tok", p_upland: "khoai", p_kg: 160 });
  });
});

describe("v15.3 (§11.4)", () => {
  const NOW = "2026-09-25T10:00:00+00:00";
  const mine = { ...MINE, critters: { cua_dong: { n: 2, xu: 52 } }, critter_cap: 18, gather: { ready_at: {}, left_today: 199 } };
  it("names the RPCs 0018 adds", () => {
    expect([...RPCS_153].sort()).toEqual(["crab_finish", "crab_start", "pick_snail_bed", "sell_critters"]);
  });
  it("starts and finishes a crab visit", async () => {
    h.rpc.mockResolvedValueOnce({ data: { server_now: NOW, mine, visit: { id: "v1", hole: 3, started_at: NOW } }, error: null });
    const s = await crabStart("r", "tok", 3);
    expect(h.rpc).toHaveBeenLastCalledWith("crab_start", { p_room_id: "r", p_session_token: "tok", p_hole: 3 });
    expect(s.visit).toEqual({ id: "v1", hole: 3, startedAt: Date.parse(NOW) });
    expect(s.mine).toMatchObject({ critterCap: 18, gather: { leftToday: 199 } });
    const crab = { hits: 3, caught: [{ kind: "cua_gach", price: 100 }, { kind: "cua_dong", price: 26 }], escaped: 1 };
    h.rpc.mockResolvedValueOnce({ data: { server_now: NOW, mine, crab }, error: null });
    expect((await crabFinish("r", "tok", "v1", 3)).crab).toEqual(crab);
    expect(h.rpc).toHaveBeenLastCalledWith("crab_finish", { p_room_id: "r", p_session_token: "tok", p_visit_id: "v1", p_hits: 3 });
    h.rpc.mockResolvedValueOnce({ data: { server_now: NOW, mine }, error: null });
    await expect(crabStart("r", "tok", 3)).rejects.toThrow("bad crab visit");
  });
  it("picks a snail bed and sells critters", async () => {
    h.rpc.mockResolvedValueOnce({ data: { server_now: NOW, mine, snails: { caught: [{ kind: "oc_dong", price: 17 }], escaped: 0 } }, error: null });
    expect((await pickSnailBed("r", "tok", 2)).snails).toEqual({ caught: [{ kind: "oc_dong", price: 17 }], escaped: 0 });
    expect(h.rpc).toHaveBeenLastCalledWith("pick_snail_bed", { p_room_id: "r", p_session_token: "tok", p_bed: 2 });
    h.rpc.mockResolvedValueOnce({ data: { server_now: NOW, mine: { ...mine, critters: {} }, sold: { n: 2, xu: 52 } }, error: null });
    const sold = await sellCritters("tok", null);
    expect(h.rpc).toHaveBeenLastCalledWith("sell_critters", { p_session_token: "tok", p_kind: null });
    expect(sold).toMatchObject({ sold: { n: 2, xu: 52 }, mine: { critters: {} } });
    h.rpc.mockResolvedValueOnce({ data: { server_now: NOW, mine, sold: { n: 1, xu: 26 } }, error: null });
    await sellCritters("tok", "cua_dong");
    expect(h.rpc).toHaveBeenLastCalledWith("sell_critters", { p_session_token: "tok", p_kind: "cua_dong" });
  });
  it("reads the picker's snails from pick_snails, none before 0018", async () => {
    h.rpc.mockResolvedValueOnce({ data: { ...FIELD, snails: { caught: [{ kind: "oc_buou_vang", price: 4 }], escaped: 2 } }, error: null });
    expect((await fieldAction("r", "tok", { kind: "pick_snails", plot: 5 })).snails)
      .toEqual({ caught: [{ kind: "oc_buou_vang", price: 4 }], escaped: 2 });
    h.rpc.mockResolvedValueOnce({ data: FIELD, error: null });
    expect((await fieldAction("r", "tok", { kind: "pick_snails", plot: 5 })).snails).toBeNull();
  });
});

describe("the anti-cheat envelope (anti-cheat spec §12.1)", () => {
  it("throws an AnticheatError for an envelope, reports a strike, and reports a lock", async () => {
    const events: AnticheatEvent[] = [];
    const off = subscribeAnticheat((e) => events.push(e));
    const envelope = { code: "bad_water", strike: 0, error: "invalid quantity", locked_until: null, banned: false, server_now: "2026-10-02T10:15:00+00:00" };
    h.rpc.mockResolvedValueOnce({ data: { anticheat: envelope }, error: null });
    const err = await fieldAction("r", "tok", { kind: "water", plot: 7, delta: 1 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AnticheatError);
    expect(err).toMatchObject({ message: "invalid quantity", info: { code: "bad_water", strike: 0 } });
    expect(events).toEqual([]);
    h.rpc.mockResolvedValueOnce({
      data: { anticheat: { ...envelope, code: "bad_qty", strike: 1, locked_until: "2026-10-02T10:20:00+00:00" } }, error: null,
    });
    await expect(sellRice("tok", "nep", true, 0)).rejects.toBeInstanceOf(AnticheatError);
    expect(events).toMatchObject([{ kind: "strike", info: { code: "bad_qty", strike: 1 } }]);
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: "account locked", details: "60", hint: "anticheat" } });
    await expect(claimFarmGift("tok")).rejects.toMatchObject({ message: "account locked" });
    expect(events[1]).toEqual({ kind: "lock", until: expect.any(Number), code: null });
    off();
  });
});
