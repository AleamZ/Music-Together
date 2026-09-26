import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_TEST_URL;
const key = process.env.SUPABASE_TEST_ANON_KEY;
const run = url && key ? describe : describe.skip;

// v15.3's crab holes, snail beds and cô Út's cua & ốc end to end, as far as a fresh account can go without xu; the
// gates, the odds, the prices and the daily limit are covered by tests/sql/v15-gather-smoke.sql. The test project must
// be in log mode ("Chỉ ghi nhận"): a flagged call then answers with strike 0 and never locks the test account.
run("v15.3 crab holes and snail beds", () => {
  let db: SupabaseClient;
  beforeAll(() => { db = createClient(url!, key!, { auth: { persistSession: false } }); });

  let n = 0;
  const uniq = (p: string) => `${p}_${Date.now()}_${n++}`;
  const reg = async () => {
    const { data, error } = await db.rpc("register", { p_username: uniq("cua"), p_password: "pw123456" });
    if (error) throw error;
    return (Array.isArray(data) ? data[0] : data) as { account_id: string; token: string };
  };
  const room = async (token: string) => {
    const { data, error } = await db.rpc("create_room", { p_room_name: uniq("mương"), p_password: "pw", p_session_token: token });
    if (error) throw error;
    return (Array.isArray(data) ? data[0] : data) as { room_id: string; code: string };
  };
  type Held = Record<string, { n: number; xu: number }>;

  it("lets anyone read the critter kinds and the containers, but nobody read the critters or the cooldowns", async () => {
    const { data: kinds, error } = await db.from("critter_kinds").select("id, name, grp, base_price");
    expect(error).toBeNull();
    expect((kinds ?? []).map((k) => [k.id, k.name, k.grp, k.base_price]).sort()).toEqual([
      ["cua_dong", "Cua đồng", "crab", 12], ["cua_gach", "Cua gạch", "crab", 45],
      ["oc_buou_vang", "Ốc bươu vàng", "snail", 2], ["oc_dong", "Ốc đồng", "snail", 8],
    ]);
    const { data: boxes } = await db.from("shop_items").select("id, price, capacity").eq("kind", "critter_box");
    expect((boxes ?? []).map((b) => [b.id, b.price, b.capacity]).sort()).toEqual([["box_basket", 6000, 30], ["box_bucket", 1500, 15]]);
    for (const table of ["critters", "gather_cooldowns"]) expect((await db.from(table).select("*")).error, table).not.toBeNull();
  });

  it("visits a hole once per cooldown, gives up with nothing caught, and refuses what a fresh account cannot do", async () => {
    const me = await reg();
    const r = await room(me.token);
    const call = (fn: string, args: Record<string, unknown>) => db.rpc(fn, { p_room_id: r.room_id, p_session_token: me.token, ...args });
    const start = await call("crab_start", { p_hole: 1 });
    expect(start.error).toBeNull();
    const visit = (start.data as { visit: { id: string; hole: number } }).visit;
    expect(visit.hole).toBe(1);
    // hits 0 has no gate: the visit ends at once, with nothing caught
    const end = await call("crab_finish", { p_visit_id: visit.id, p_hits: 0 });
    expect(end.error).toBeNull();
    expect(end.data).toMatchObject({ crab: { hits: 0, caught: [], escaped: 0 } });
    expect((end.data as { mine: { critters: Held } }).mine.critters).toEqual({});
    expect((await call("crab_finish", { p_visit_id: visit.id, p_hits: 0 })).error?.message).toBe("visit not found");
    expect((await call("crab_start", { p_hole: 1 })).error?.message).toBe("hole empty");
    const mine = (fn: string, args: Record<string, unknown>) => db.rpc(fn, { p_session_token: me.token, ...args });
    expect((await mine("sell_critters", { p_kind: null })).error?.message).toBe("no critters");
    expect((await mine("sell_critters", { p_kind: "tom" })).error?.message).toBe("invalid kind");
    expect((await mine("buy_farm_item", { p_item_id: "box_bucket", p_qty: 2 })).error?.message).toBe("invalid quantity");
    expect((await mine("buy_farm_item", { p_item_id: "box_basket", p_qty: 1 })).error?.message).toBe("not enough coins");
  });

  it("picks 1–3 snails from a bed and sells them to cô Út at the prices fixed at the pick", async () => {
    const me = await reg();
    const r = await room(me.token);
    const bed = await db.rpc("pick_snail_bed", { p_room_id: r.room_id, p_session_token: me.token, p_bed: 1 });
    expect(bed.error).toBeNull();
    const held = Object.values((bed.data as { mine: { critters: Held } }).mine.critters);
    const count = held.reduce((s, c) => s + c.n, 0), xu = held.reduce((s, c) => s + c.xu, 0);
    expect(count).toBeGreaterThanOrEqual(1);
    expect(count).toBeLessThanOrEqual(3);
    const sale = await db.rpc("sell_critters", { p_session_token: me.token, p_kind: null });
    expect(sale.error).toBeNull();
    expect(sale.data).toMatchObject({ sold: { n: count, xu } });
    expect((sale.data as { mine: { critters: Held } }).mine.critters).toEqual({});
  });

  it("answers the tampered calls with strike-0 envelopes in log mode", async () => {
    const me = await reg();
    const r = await room(me.token);
    const call = (fn: string, args: Record<string, unknown>) => db.rpc(fn, { p_room_id: r.room_id, p_session_token: me.token, ...args });
    const fin = await call("crab_finish", { p_visit_id: "00000000-0000-4000-8000-000000000000", p_hits: 5 });
    expect(fin.error).toBeNull();
    expect(fin.data).toMatchObject({ anticheat: { code: "bad_qty", strike: 0, error: "invalid quantity", locked_until: null, banned: false } });
    expect((await call("crab_start", { p_hole: 7 })).data).toMatchObject({ anticheat: { code: "bad_spot", strike: 0, error: "invalid spot" } });
    expect((await call("pick_snail_bed", { p_bed: 0 })).data).toMatchObject({ anticheat: { code: "bad_spot", strike: 0, error: "invalid spot" } });
    // the account is not locked: an honest call still gets its normal refusal
    expect((await db.rpc("sell_critters", { p_session_token: me.token, p_kind: null })).error?.message).toBe("no critters");
  });
});
