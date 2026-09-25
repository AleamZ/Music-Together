import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_TEST_URL;
const key = process.env.SUPABASE_TEST_ANON_KEY;
const run = url && key ? describe : describe.skip;

run("v13 characters", () => {
  let db: SupabaseClient;
  beforeAll(() => { db = createClient(url!, key!, { auth: { persistSession: false } }); });

  let n = 0;
  const uniq = (p: string) => `${p}_${Date.now()}_${n++}`;
  const reg = async () => {
    const { data, error } = await db.rpc("register", { p_username: uniq("ch"), p_password: "pw123456" });
    if (error) throw error;
    return (Array.isArray(data) ? data[0] : data) as { account_id: string; token: string };
  };
  const base = {
    p_skin: "warm", p_hair: "short", p_hair_color: "black", p_hat: "hat_nonla" as string | null,
    p_top: "top_baba_yellow" as string | null, p_bottom: "bottom_shorts_red", p_shoes: "shoes_dep_blue",
    p_neck: "neck_khanran" as string | null,
  };
  const save = (token: string, over: Partial<typeof base> = {}) =>
    db.rpc("save_character", { p_session_token: token, ...base, ...over });

  it("creates then updates the caller's character", async () => {
    const me = await reg();
    const first = await save(me.token);
    expect(first.error).toBeNull();
    const second = await save(me.token, { p_hat: null, p_top: "top_tee_blue", p_neck: null });
    expect(second.error).toBeNull();
    const { data } = await db.from("characters").select("*").eq("account_id", me.account_id).single();
    expect(data).toMatchObject({ skin: "warm", hat: null, top: "top_tee_blue", neck: null });
  });

  it("rejects unknown body options", async () => {
    const me = await reg();
    const { error } = await save(me.token, { p_hair: "mohawk" });
    expect(error?.message).toMatch(/invalid character option/);
  });

  it("rejects an item in the wrong slot and unknown items", async () => {
    const me = await reg();
    expect((await save(me.token, { p_hat: "top_baba_yellow" })).error?.message).toMatch(/item not available/);
    expect((await save(me.token, { p_top: "top_does_not_exist" })).error?.message).toMatch(/item not available/);
  });

  it("requires a top", async () => {
    const me = await reg();
    expect((await save(me.token, { p_top: null })).error?.message).toMatch(/item not available/);
  });

  it("rejects a bad session", async () => {
    expect((await save("not-a-token")).error?.message).toMatch(/invalid session/);
  });

  it("lets anyone read the catalog and characters", async () => {
    const { data: items } = await db.from("item_catalog").select("id").eq("starter", true);
    expect((items ?? []).length).toBeGreaterThanOrEqual(15);
  });
});
