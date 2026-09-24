import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_TEST_URL;
const key = process.env.SUPABASE_TEST_ANON_KEY;
const run = url && key ? describe : describe.skip;

run("v14 fishing economy", () => {
  let db: SupabaseClient;
  beforeAll(() => { db = createClient(url!, key!, { auth: { persistSession: false } }); });

  let n = 0;
  const uniq = (p: string) => `${p}_${Date.now()}_${n++}`;
  const reg = async () => {
    const { data, error } = await db.rpc("register", { p_username: uniq("fi"), p_password: "pw123456" });
    if (error) throw error;
    return (Array.isArray(data) ? data[0] : data) as { account_id: string; token: string };
  };

  it("starts empty and claims the daily bonus once", async () => {
    const me = await reg();
    const s = await db.rpc("fishing_state", { p_session_token: me.token });
    expect(s.error).toBeNull();
    expect(s.data).toMatchObject({ coins: 0, bait_cap: 20, fish_cap: 1, casts_left: 40, loadout: { rod: "rod_wood", bobber: "bobber_feather", bait: "bait_worm" } });
    const a = await db.rpc("claim_daily", { p_session_token: me.token });
    expect(a.data).toMatchObject({ claimed: true, amount: 20, state: { coins: 20 } });
    const b = await db.rpc("claim_daily", { p_session_token: me.token });
    expect(b.data).toMatchObject({ claimed: false, state: { coins: 20 } });
  });

  it("digs 1–3 worms, then has to wait", async () => {
    const me = await reg();
    const a = await db.rpc("dig_worms", { p_session_token: me.token });
    expect(a.error).toBeNull();
    expect((a.data as { gained: number }).gained).toBeGreaterThanOrEqual(1);
    const b = await db.rpc("dig_worms", { p_session_token: me.token });
    expect(b.error?.message).toBe("dig cooldown");
    expect(Number(b.error?.details)).toBeGreaterThan(0);
  });

  it("refuses what it cannot afford or does not sell, and sells bait", async () => {
    const me = await reg();
    expect((await db.rpc("buy_item", { p_session_token: me.token, p_item_id: "rod_bamboo", p_qty: 1 })).error?.message).toBe("not enough coins");
    expect((await db.rpc("buy_item", { p_session_token: me.token, p_item_id: "rod_wood", p_qty: 1 })).error?.message).toBe("item not available");
    await db.rpc("claim_daily", { p_session_token: me.token });
    const ok = await db.rpc("buy_item", { p_session_token: me.token, p_item_id: "bait_shrimp", p_qty: 4 });
    expect(ok.data).toMatchObject({ state: { coins: 0, bait: { bait_shrimp: 4 } } });
  });

  it("only equips gear the account owns", async () => {
    const me = await reg();
    const r = await db.rpc("set_loadout", { p_session_token: me.token, p_rod: "rod_carbon", p_bobber: "bobber_feather", p_bait: "bait_worm" });
    expect(r.error?.message).toBe("item not available");
  });

  it("cannot sell or release fish it does not have", async () => {
    const me = await reg();
    const id = crypto.randomUUID();
    expect((await db.rpc("sell_fish", { p_session_token: me.token, p_fish_ids: [id] })).error?.message).toBe("fish not found");
    expect((await db.rpc("release_fish", { p_session_token: me.token, p_fish_id: id })).error?.message).toBe("fish not found");
  });

  it("lets anyone read the catalog but nobody read wallets directly", async () => {
    const { data: species } = await db.from("fish_species").select("id");
    const { data: items } = await db.from("shop_items").select("id");
    expect(species ?? []).toHaveLength(12);
    expect(items ?? []).toHaveLength(12);
    const wallets = await db.from("wallets").select("*");
    expect(wallets.error !== null || (wallets.data ?? []).length === 0).toBe(true);
  });
});
