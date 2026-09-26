import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_TEST_URL;
const key = process.env.SUPABASE_TEST_ANON_KEY;
const run = url && key ? describe : describe.skip;

// v17's rats and dog end to end, as far as a fresh account can go without xu; the spawns, the damage, the ná, the dog,
// the caps and the prices are covered by tests/sql/v17-smoke.sql. The test project must be in log mode ("Chỉ ghi nhận").
run("v17 rats and the dog", () => {
  let db: SupabaseClient;
  beforeAll(() => { db = createClient(url!, key!, { auth: { persistSession: false } }); });

  let n = 0;
  const uniq = (p: string) => `${p}_${Date.now()}_${n++}`;
  const reg = async () => {
    const { data, error } = await db.rpc("register", { p_username: uniq("chuot"), p_password: "pw123456" });
    if (error) throw error;
    return (Array.isArray(data) ? data[0] : data) as { account_id: string; token: string };
  };
  const room = async (token: string) => {
    const { data, error } = await db.rpc("create_room", { p_room_name: uniq("đồng"), p_password: "pw", p_session_token: token });
    if (error) throw error;
    return (Array.isArray(data) ? data[0] : data) as { room_id: string; code: string };
  };

  it("gives a fresh account no dog, and refuses what it cannot do yet", async () => {
    const me = await reg();
    const state = await db.rpc("dog_state", { p_session_token: me.token });
    expect(state.error).toBeNull();
    expect(state.data).toMatchObject({ dog: null, food: 0 });
    expect((await db.rpc("feed_dog", { p_session_token: me.token })).error?.message).toBe("no dog");
    expect((await db.rpc("rename_dog", { p_session_token: me.token, p_name: "Mực" })).error?.message).toBe("no dog");
    expect((await db.rpc("adopt_dog", { p_session_token: me.token, p_name: "Mực", p_coat: "muc" })).error?.message)
      .toBe("not enough coins");
    expect((await db.rpc("sell_rats", { p_session_token: me.token })).error?.message).toBe("nothing to sell");
  });

  it("carries the rats in field_state, and keeps the new tables private", async () => {
    const me = await reg();
    const r = await room(me.token);
    const f = await db.rpc("field_state", { p_room_id: r.room_id, p_session_token: me.token });
    expect(f.error).toBeNull();
    const rats = (f.data as { rats: { next_at: string; price: number; live: unknown[] } }).rats;
    expect(Number.isFinite(Date.parse(rats.next_at))).toBe(true);
    expect(rats.price).toBeGreaterThan(0);
    expect(rats.live).toEqual([]);
    expect((await db.rpc("sling_start", { p_room_id: r.room_id, p_session_token: me.token, p_rat_id: 1 })).error?.message)
      .toBe("no sling");
    for (const table of ["dogs", "rat_bag", "sling_aims", "field_rats", "rat_clocks"]) {
      expect((await db.from(table).select("*")).error, table).not.toBeNull();
    }
  });
});
