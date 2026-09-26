import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_TEST_URL;
const key = process.env.SUPABASE_TEST_ANON_KEY;
const run = url && key ? describe : describe.skip;

// The land and farm RPCs end to end, as far as a fresh account can go without xu; the time-dependent season is
// covered by tests/sql/v15-smoke.sql.
run("v15 field and land", () => {
  let db: SupabaseClient;
  beforeAll(() => { db = createClient(url!, key!, { auth: { persistSession: false } }); });

  let n = 0;
  const uniq = (p: string) => `${p}_${Date.now()}_${n++}`;
  const reg = async () => {
    const { data, error } = await db.rpc("register", { p_username: uniq("fa"), p_password: "pw123456" });
    if (error) throw error;
    return (Array.isArray(data) ? data[0] : data) as { account_id: string; token: string };
  };
  const room = async (token: string) => {
    const { data, error } = await db.rpc("create_room", { p_room_name: uniq("dong"), p_password: "pw", p_session_token: token });
    if (error) throw error;
    return (Array.isArray(data) ? data[0] : data) as { room_id: string; code: string };
  };
  type Field = { server_now: string; plots: Array<{ no: number; kind: string; owner: unknown; farmer: unknown }>; mine: Record<string, unknown> };

  it("opens the field lazily: 10 plots, nothing of mine yet, the server's clock", async () => {
    const me = await reg();
    const r = await room(me.token);
    const s = await db.rpc("field_state", { p_room_id: r.room_id, p_session_token: me.token });
    expect(s.error).toBeNull();
    const f = s.data as Field;
    expect(f.plots.map((p) => [p.no, p.kind]).sort((a, b) => Number(a[0]) - Number(b[0]))).toEqual([
      [1, "private"], [2, "private"], [3, "private"], [4, "private"],
      [5, "village"], [6, "village"], [7, "village"], [8, "village"], [9, "village"], [10, "village"],
    ]);
    expect(f.plots.every((p) => p.owner === null && p.farmer === null)).toBe(true);
    expect(f.mine).toMatchObject({ coins: 0, farming: [], owned_plot: null, gift_claimed: false });
    expect(Math.abs(Date.parse(f.server_now) - Date.now())).toBeLessThan(5 * 60_000);
    expect((await db.rpc("touch_room", { p_room_id: r.room_id, p_session_token: me.token })).error).toBeNull();
  });

  it("gives the newcomer gift once per account", async () => {
    const me = await reg();
    const a = await db.rpc("claim_farm_gift", { p_session_token: me.token });
    expect(a.error).toBeNull();
    expect(a.data).toMatchObject({ gifted: true, mine: { items: { seed_short: 1, fert_urea: 1 }, gift_claimed: true } });
    const b = await db.rpc("claim_farm_gift", { p_session_token: me.token });
    expect(b.data).toMatchObject({ gifted: false, mine: { items: { seed_short: 1, fert_urea: 1 } } });
  });

  it("refuses land it cannot pay for and plots it does not farm", async () => {
    const me = await reg();
    const r = await room(me.token);
    const call = (fn: string, args: Record<string, unknown>) => db.rpc(fn, { p_room_id: r.room_id, p_session_token: me.token, ...args });
    expect((await call("rent_plot", { p_plot: 5 })).error?.message).toBe("not enough coins");
    expect((await call("buy_plot", { p_plot: 1 })).error?.message).toBe("not enough coins");
    expect((await call("rent_plot", { p_plot: 1 })).error?.message).toBe("invalid plot");
    expect((await call("offer_plot", { p_plot: 2, p_price: 100 })).error?.message).toBe("not for sale");
    expect((await call("prepare_plot", { p_plot: 5 })).error?.message).toBe("not your plot");
    expect((await call("water", { p_plot: 7, p_delta: 1 })).error?.message).toBe("not your plot");
    expect((await call("pick_snails", { p_plot: 7 })).error?.message).toBe("no snails");
    expect((await call("dry_start", { p_variety: "nep", p_kg: 5 })).error?.message).toBe("not enough rice");
  });

  it("keeps outsiders off the field", async () => {
    const owner = await reg();
    const stranger = await reg();
    const r = await room(owner.token);
    const s = await db.rpc("field_state", { p_room_id: r.room_id, p_session_token: stranger.token });
    expect(s.error?.message).toBe("account is not a member of this room");
    const t = await db.rpc("touch_room", { p_room_id: r.room_id, p_session_token: stranger.token });
    expect(t.error?.message).toBe("account is not a member of this room");
  });

  it("sells rice only when there is some, and farm items only at anh Hai", async () => {
    const me = await reg();
    expect((await db.rpc("sell_rice", { p_session_token: me.token, p_variety: "nep", p_dry: true, p_kg: 1 })).error?.message).toBe("not enough rice");
    expect((await db.rpc("buy_farm_item", { p_session_token: me.token, p_item_id: "seed_nep", p_qty: 1 })).error?.message).toBe("not enough coins");
    // an item of the other shop: since 0015 a soft kind_mismatch, answered with an envelope instead of raising
    const wrongShop = { anticheat: { code: "kind_mismatch", strike: 0, error: "item not available" } };
    expect((await db.rpc("buy_farm_item", { p_session_token: me.token, p_item_id: "rod_bamboo", p_qty: 1 })).data).toMatchObject(wrongShop);
    expect((await db.rpc("buy_item", { p_session_token: me.token, p_item_id: "seed_nep", p_qty: 1 })).data).toMatchObject(wrongShop);
    const fishing = await db.rpc("fishing_state", { p_session_token: me.token });
    expect(typeof (fishing.data as { server_now?: unknown }).server_now).toBe("string");
  });

  it("lets anyone read the varieties and farm items but nobody read the fields directly", async () => {
    const { data: varieties } = await db.from("rice_varieties").select("id");
    expect((varieties ?? []).map((v) => v.id).sort()).toEqual(["nep", "short", "thom"]);
    // v15.2 adds the three hoa-màu seeds (kind seed): 11 + 3
    const { data: items } = await db.from("shop_items").select("id").in("kind", ["seed", "fertilizer", "pesticide", "critter_box"]);
    expect(items ?? []).toHaveLength(14);
    for (const table of ["field_plots", "crops", "rice_stock", "land_offers", "fish_price_index"]) {
      expect((await db.from(table).select("*")).error, table).not.toBeNull();
    }
  });

  it("prices fish by the room: a new room pays today's prices, with a season factor per species", async () => {
    const me = await reg();
    const r = await room(me.token);
    const b = await db.rpc("fishing_board", { p_room_id: r.room_id, p_session_token: me.token });
    expect(b.error).toBeNull();
    const p = (b.data as { prices: { mult: number; wealth: number; ends_at: string; factors: Record<string, number> } }).prices;
    expect(p.mult).toBe(1);
    expect(p.wealth).toBe(0);
    expect(Date.parse(p.ends_at) - Date.now()).toBeLessThanOrEqual(3 * 3600_000);
    const { data: species } = await db.from("fish_species").select("id");
    expect(Object.keys(p.factors).sort()).toEqual((species ?? []).map((s) => s.id).sort());
    expect(Object.values(p.factors).every((f) => f >= 0.8 && f <= 1.39)).toBe(true);
  });
});
