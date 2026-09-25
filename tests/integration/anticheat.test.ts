import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_TEST_URL;
const key = process.env.SUPABASE_TEST_ANON_KEY;
const run = url && key ? describe : describe.skip;
// The ban check needs a root account of the test project (it bans and unbans a fresh account).
const rootUser = process.env.SUPABASE_TEST_ROOT_USERNAME;
const rootPass = process.env.SUPABASE_TEST_ROOT_PASSWORD;

// The anti-cheat layer end to end (spec §15.3). The test project must be in log mode ("Chỉ ghi nhận"): a flagged
// call then answers with strike 0 and never locks the test account.
run("anti-cheat", () => {
  let db: SupabaseClient;
  beforeAll(() => { db = createClient(url!, key!, { auth: { persistSession: false } }); });

  let n = 0;
  const uniq = (p: string) => `${p}_${Date.now()}_${n++}`;
  const reg = async (username = uniq("ac")) => {
    const { data, error } = await db.rpc("register", { p_username: username, p_password: "pw123456" });
    if (error) throw error;
    return (Array.isArray(data) ? data[0] : data) as { account_id: string; username: string; token: string };
  };
  const room = async (token: string) => {
    const { data, error } = await db.rpc("create_room", { p_room_name: uniq("ac"), p_password: "pw", p_session_token: token });
    if (error) throw error;
    return (Array.isArray(data) ? data[0] : data) as { room_id: string; code: string };
  };

  it("refuses reserved and malformed names", async () => {
    for (const name of ["Ao cá", "hợp  tác xã", "ROOT", "a", "x".repeat(25), "an\u200bh"]) {
      const r = await db.rpc("register", { p_username: name, p_password: "pw123456" });
      expect(r.error?.message, name).toBe("invalid username");
    }
  });

  (rootUser && rootPass ? it : it.skip)("refuses a banned account at login, after the right password", async () => {
    const root = await db.rpc("login", { p_username: rootUser, p_password: rootPass });
    expect(root.error).toBeNull();
    const rootToken = (Array.isArray(root.data) ? root.data[0] : root.data).token as string;
    const me = await reg();
    const ban = (banned: boolean) => db.rpc("admin_set_ban", { p_session_token: rootToken, p_account_id: me.account_id, p_banned: banned });
    expect((await ban(true)).error).toBeNull();
    expect((await db.rpc("login", { p_username: me.username, p_password: "wrong" })).error?.message).toBe("invalid username or password");
    expect((await db.rpc("login", { p_username: me.username, p_password: "pw123456" })).error?.message).toBe("account banned");
    expect((await ban(false)).error).toBeNull();
    expect((await db.rpc("login", { p_username: me.username, p_password: "pw123456" })).error).toBeNull();
  });

  it("tells the fishing state how many casts are left today", async () => {
    const me = await reg();
    const s = await db.rpc("fishing_state", { p_session_token: me.token });
    expect(s.error).toBeNull();
    expect(s.data).toMatchObject({ casts_today_left: 300, day_resets_at: null, lock: null });
  });

  it("answers a tampered call with a strike-0 envelope in log mode", async () => {
    const me = await reg();
    const r = await room(me.token);
    const w = await db.rpc("water", { p_room_id: r.room_id, p_session_token: me.token, p_plot: 7, p_delta: 5 });
    expect(w.error).toBeNull();
    expect(w.data).toMatchObject({ anticheat: { code: "bad_water", strike: 0, error: "invalid quantity", locked_until: null, banned: false } });
    // the account is not locked: an honest call still gets its normal refusal
    const honest = await db.rpc("water", { p_room_id: r.room_id, p_session_token: me.token, p_plot: 7, p_delta: 1 });
    expect(honest.error?.message).toBe("not your plot");
  });

  it("takes 11-character video ids only", async () => {
    const me = await reg();
    const r = await room(me.token);
    const add = (id: string) => db.rpc("add_queue_item", {
      p_room_id: r.room_id, p_session_token: me.token, p_video_id: id, p_title: "t", p_thumb: "https://example.com/x.png", p_duration: 100,
    });
    expect((await add("abc")).error?.message).toBe("invalid video");
    const ok = await add("dQw4w9WgXcQ");
    expect(ok.error).toBeNull();
    const { data } = await db.from("queue_items").select("thumbnail_url").eq("id", ok.data as string).single();
    expect(data).toEqual({ thumbnail_url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg" });
  });

  it("keeps the evidence and the admin RPCs away from everyone but root", async () => {
    for (const table of ["anticheat_config", "anticheat_status", "anticheat_events", "anticheat_wipes"]) {
      expect((await db.from(table).select("*")).error, table).not.toBeNull();
    }
    const me = await reg();
    const zero = "00000000-0000-0000-0000-000000000000";
    const calls: Array<readonly [string, Record<string, unknown>]> = [
      ["admin_anticheat_list", { p_session_token: me.token }],
      ["admin_anticheat_account", { p_session_token: me.token, p_account_id: zero }],
      ["admin_anticheat_resolve", { p_session_token: me.token, p_account_id: zero, p_action: "pardon" }],
      ["admin_anticheat_set_mode", { p_session_token: me.token, p_mode: "enforce" }],
    ];
    for (const [fn, args] of calls) expect((await db.rpc(fn, args)).error?.message, fn).toContain("root role required");
  });
});
