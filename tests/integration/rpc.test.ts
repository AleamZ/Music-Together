import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_TEST_URL;
const key = process.env.SUPABASE_TEST_ANON_KEY;
const run = url && key ? describe : describe.skip;

run("v2 RPC accounts + session auth", () => {
  let db: SupabaseClient;
  beforeAll(() => { db = createClient(url!, key!, { auth: { persistSession: false } }); });

  let n = 0;
  const uniq = (p: string) => `${p}_${Date.now()}_${n++}`;
  const reg = async (username: string, password = "pw123456") => {
    const { data, error } = await db.rpc("register", { p_username: username, p_password: password });
    if (error) throw error;
    return (Array.isArray(data) ? data[0] : data) as { account_id: string; username: string; token: string };
  };
  const create = async (token: string, name = "Salon", pass = "secret") => {
    const { data, error } = await db.rpc("create_room", { p_room_name: name, p_password: pass, p_session_token: token });
    if (error) throw error;
    return (Array.isArray(data) ? data[0] : data) as { code: string; room_id: string; member_id: string };
  };

  it("register then login; duplicate username rejected; bad password rejected", async () => {
    const u = uniq("alice");
    const a = await reg(u);
    expect(a.token).toHaveLength(64);
    await expect(reg(u)).rejects.toMatchObject({ message: expect.stringContaining("already taken") });
    const { data: li } = await db.rpc("login", { p_username: u.toUpperCase(), p_password: "pw123456" }); // case-insensitive
    expect((Array.isArray(li) ? li[0] : li).account_id).toBe(a.account_id);
    const bad = await db.rpc("login", { p_username: u, p_password: "wrong" });
    expect(bad.error?.message).toContain("invalid username or password");
  });

  it("me() resolves the session; logout() invalidates it", async () => {
    const a = await reg(uniq("bob"));
    const { data: me } = await db.rpc("me", { p_token: a.token });
    expect((Array.isArray(me) ? me[0] : me).account_id).toBe(a.account_id);
    await db.rpc("logout", { p_token: a.token });
    const after = await db.rpc("me", { p_token: a.token });
    expect(after.error?.message).toContain("invalid session");
  });

  it("create_room makes creator admin+dj; join_room first needs password, re-join skips it", async () => {
    const admin = await reg(uniq("owner"));
    const r = await create(admin.token);
    const { data: room } = await db.from("rooms").select("admin_member_id,dj_member_id").eq("id", r.room_id).single();
    expect(room!.admin_member_id).toBe(r.member_id);
    expect(room!.dj_member_id).toBe(r.member_id);

    const guest = await reg(uniq("guest"));
    const wrong = await db.rpc("join_room", { p_code: r.code, p_password: "nope", p_session_token: guest.token });
    expect(wrong.error?.message).toContain("invalid password");
    const ok = await db.rpc("join_room", { p_code: r.code, p_password: "secret", p_session_token: guest.token });
    expect(ok.error).toBeNull();
    // re-join with WRONG password now succeeds because already a member
    const rejoin = await db.rpc("join_room", { p_code: r.code, p_password: "nope", p_session_token: guest.token });
    expect(rejoin.error).toBeNull();
  });

  it("role is enforced by account/session: guest cannot advance, admin can", async () => {
    const admin = await reg(uniq("dj"));
    const r = await create(admin.token);
    const guest = await reg(uniq("listener"));
    await db.rpc("join_room", { p_code: r.code, p_password: "secret", p_session_token: guest.token });
    await db.rpc("add_queue_item", { p_room_id: r.room_id, p_session_token: guest.token, p_video_id: "abc", p_title: "A", p_thumb: null, p_duration: 10 });
    const denied = await db.rpc("advance_queue", { p_room_id: r.room_id, p_session_token: guest.token });
    expect(denied.error?.message).toContain("dj role required");
    const adv = await db.rpc("advance_queue", { p_room_id: r.room_id, p_session_token: admin.token });
    expect(adv.error).toBeNull();
  });

  it("role follows the account across a NEW session (simulated second device)", async () => {
    const owner = await reg(uniq("multi"));
    const r = await create(owner.token);
    const { data: l } = await db.rpc("login", { p_username: owner.username, p_password: "pw123456" });
    const token2 = (Array.isArray(l) ? l[0] : l).token as string; // different device/session, same account
    const ok = await db.rpc("rename_room", { p_room_id: r.room_id, p_session_token: token2, p_new_name: "Renamed" });
    expect(ok.error).toBeNull(); // still admin via the account, not the session
  });

  it("secret tables are not client-readable", async () => {
    for (const t of ["account_secrets", "sessions", "room_secrets"]) {
      const { data, error } = await db.from(t).select("*");
      expect(error).toBeNull();
      expect(data ?? []).toHaveLength(0);
    }
  });
});
