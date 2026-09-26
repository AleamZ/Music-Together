import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_TEST_URL;
const key = process.env.SUPABASE_TEST_ANON_KEY;
const run = url && key ? describe : describe.skip;

// The v15.2 tools and hoa màu end to end, as far as a fresh account can go without xu; the seasons, the six parts and
// the harvester are covered by tests/sql/v15-2-smoke.sql. The test project must be in log mode ("Chỉ ghi nhận"): a
// flagged call then answers with strike 0 and never locks the test account.
run("v15.2 tools and hoa màu", () => {
  let db: SupabaseClient;
  beforeAll(() => { db = createClient(url!, key!, { auth: { persistSession: false } }); });

  let n = 0;
  const uniq = (p: string) => `${p}_${Date.now()}_${n++}`;
  const reg = async () => {
    const { data, error } = await db.rpc("register", { p_username: uniq("hm"), p_password: "pw123456" });
    if (error) throw error;
    return (Array.isArray(data) ? data[0] : data) as { account_id: string; token: string };
  };
  const room = async (token: string) => {
    const { data, error } = await db.rpc("create_room", { p_room_name: uniq("mau"), p_password: "pw", p_session_token: token });
    if (error) throw error;
    return (Array.isArray(data) ? data[0] : data) as { room_id: string; code: string };
  };

  it("lets anyone read the hoa-màu crops, their seeds and the tools, but nobody read the stock", async () => {
    const { data: uplands, error } = await db.from("upland_crops").select("id, name, method");
    expect(error).toBeNull();
    expect((uplands ?? []).map((u) => [u.id, u.name, u.method]).sort()).toEqual([
      ["bap", "Bắp", "direct"], ["khoai", "Khoai lang", "cutting"], ["ot", "Ớt", "nursery"],
    ]);
    const { data: items } = await db.from("shop_items").select("id, kind, upland, price")
      .in("id", ["seed_khoai", "seed_bap", "seed_ot", "tool_sickle", "tool_sprayer"]);
    expect((items ?? []).map((i) => [i.id, i.kind, i.upland, i.price]).sort()).toEqual([
      ["seed_bap", "seed", "bap", 1000], ["seed_khoai", "seed", "khoai", 800], ["seed_ot", "seed", "ot", 1500],
      ["tool_sickle", "tool", null, 1500], ["tool_sprayer", "tool", null, 5000],
    ]);
    expect((await db.from("produce_stock").select("*")).error).not.toBeNull();
  });

  it("gives the newcomer a sickle with the gift", async () => {
    const me = await reg();
    const a = await db.rpc("claim_farm_gift", { p_session_token: me.token });
    expect(a.error).toBeNull();
    expect(a.data).toMatchObject({
      gifted: true, mine: { items: { seed_short: 1, fert_urea: 1, tool_sickle: 1 }, produce: {}, tank: null },
    });
  });

  it("refuses the new actions on plots it does not farm, a tool bought twice at once and hoa màu it does not have", async () => {
    const me = await reg();
    const r = await room(me.token);
    const call = (fn: string, args: Record<string, unknown>) => db.rpc(fn, { p_room_id: r.room_id, p_session_token: me.token, ...args });
    expect((await call("prepare_beds", { p_plot: 5 })).error?.message).toBe("not your plot");
    expect((await call("plant_crop", { p_plot: 5, p_item_id: "seed_khoai" })).error?.message).toBe("not your plot");
    expect((await call("tend_crop", { p_plot: 5, p_act: "lat_day" })).error?.message).toBe("not your plot");
    expect((await call("harvest_part", { p_plot: 5, p_success: true })).error?.message).toBe("not your plot");
    expect((await call("rent_harvester", { p_plot: 5 })).error?.message).toBe("not your plot");
    const mine = (fn: string, args: Record<string, unknown>) => db.rpc(fn, { p_session_token: me.token, ...args });
    expect((await mine("buy_farm_item", { p_item_id: "tool_sickle", p_qty: 2 })).error?.message).toBe("invalid quantity");
    expect((await mine("buy_farm_item", { p_item_id: "tool_sprayer", p_qty: 1 })).error?.message).toBe("not enough coins");
    expect((await mine("load_sprayer", { p_item_id: "spray_insect" })).error?.message).toBe("no sprayer");
    expect((await mine("sell_produce", { p_upland: "khoai", p_kg: 1 })).error?.message).toBe("not enough crop");
    expect((await mine("sell_produce", { p_upland: "lua", p_kg: 1 })).error?.message).toBe("invalid crop");
  });

  it("answers the tampered calls with strike-0 envelopes in log mode", async () => {
    const me = await reg();
    const r = await room(me.token);
    const sale = await db.rpc("sell_produce", { p_session_token: me.token, p_upland: "khoai", p_kg: 0 });
    expect(sale.error).toBeNull();
    expect(sale.data).toMatchObject({ anticheat: { code: "bad_qty", strike: 0, error: "invalid quantity", locked_until: null, banned: false } });
    const tend = await db.rpc("tend_crop", { p_room_id: r.room_id, p_session_token: me.token, p_plot: 5, p_act: "x" });
    expect(tend.data).toMatchObject({ anticheat: { code: "bad_work", strike: 0, error: "invalid act" } });
    const part = await db.rpc("harvest_part", { p_room_id: r.room_id, p_session_token: me.token, p_plot: 11, p_success: true });
    expect(part.data).toMatchObject({ anticheat: { code: "bad_plot", strike: 0, error: "invalid plot" } });
    // an item of another kind is soft: logged, never a strike
    const load = await db.rpc("load_sprayer", { p_session_token: me.token, p_item_id: "fert_urea" });
    expect(load.data).toMatchObject({ anticheat: { code: "kind_mismatch", strike: 0, error: "invalid item" } });
    // the account is not locked: an honest call still gets its normal refusal
    const honest = await db.rpc("sell_produce", { p_session_token: me.token, p_upland: "khoai", p_kg: 1 });
    expect(honest.error?.message).toBe("not enough crop");
  });
});
