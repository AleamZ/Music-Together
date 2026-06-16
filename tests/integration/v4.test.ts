import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_TEST_URL;
const key = process.env.SUPABASE_TEST_ANON_KEY;
const run = url && key ? describe : describe.skip;

run("v4 roles + chat", () => {
  let db: SupabaseClient;
  beforeAll(() => { db = createClient(url!, key!, { auth: { persistSession: false } }); });

  let n = 0;
  const uniq = (p: string) => `${p}_${Date.now()}_${n++}`;
  const reg = async (username: string) => {
    const { data, error } = await db.rpc("register", { p_username: username, p_password: "pw123456" });
    if (error) throw error;
    return (Array.isArray(data) ? data[0] : data) as { account_id: string; username: string; token: string };
  };
  const createRoom = async (token: string) => {
    const { data, error } = await db.rpc("create_room", { p_room_name: "R", p_password: "secret", p_session_token: token });
    if (error) throw error;
    return (Array.isArray(data) ? data[0] : data) as { code: string; room_id: string; member_id: string };
  };
  const join = async (code: string, token: string) => {
    const { data, error } = await db.rpc("join_room", { p_code: code, p_password: "secret", p_session_token: token });
    if (error) throw error;
    return (Array.isArray(data) ? data[0] : data) as { room_id: string; member_id: string };
  };
  const idOf = (r: { data: unknown }) => (Array.isArray(r.data) ? r.data[0] : r.data) as string;

  it("assign_dj revoke returns DJ to the admin", async () => {
    const owner = await reg(uniq("own"));
    const room = await createRoom(owner.token);
    const m2 = await reg(uniq("dj"));
    const j = await join(room.code, m2.token);
    expect((await db.rpc("assign_dj", { p_room_id: room.room_id, p_session_token: owner.token, p_target_member: j.member_id })).error).toBeNull();
    expect((await db.rpc("assign_dj", { p_room_id: room.room_id, p_session_token: owner.token, p_target_member: null })).error).toBeNull();
    const { data } = await db.from("rooms").select("dj_member_id, admin_member_id").eq("id", room.room_id).single();
    const r = data as { dj_member_id: string; admin_member_id: string };
    expect(r.dj_member_id).toBe(r.admin_member_id);
    expect(r.dj_member_id).toBe(room.member_id);
  });

  it("send_chat_message validates body", async () => {
    const owner = await reg(uniq("chat"));
    const room = await createRoom(owner.token);
    const empty = await db.rpc("send_chat_message", { p_session_token: owner.token, p_room_id: room.room_id, p_body: "   " });
    expect(empty.error?.message).toContain("invalid message");
    const long = await db.rpc("send_chat_message", { p_session_token: owner.token, p_room_id: room.room_id, p_body: "x".repeat(501) });
    expect(long.error?.message).toContain("invalid message");
    const ok = await db.rpc("send_chat_message", { p_session_token: owner.token, p_room_id: room.room_id, p_body: "Xin chào" });
    expect(ok.error).toBeNull();
  });

  it("send_chat_message is rate-limited (10 / 15s)", async () => {
    const owner = await reg(uniq("rl"));
    const room = await createRoom(owner.token);
    for (let i = 0; i < 10; i++) {
      const r = await db.rpc("send_chat_message", { p_session_token: owner.token, p_room_id: room.room_id, p_body: `m${i}` });
      expect(r.error).toBeNull();
    }
    const over = await db.rpc("send_chat_message", { p_session_token: owner.token, p_room_id: room.room_id, p_body: "11" });
    expect(over.error?.message).toContain("too many messages");
  });

  it("non-members cannot send", async () => {
    const owner = await reg(uniq("o2"));
    const room = await createRoom(owner.token);
    const outsider = await reg(uniq("out"));
    const r = await db.rpc("send_chat_message", { p_session_token: outsider.token, p_room_id: room.room_id, p_body: "hi" });
    expect(r.error?.message).toContain("not a member");
  });

  it("delete_chat_message: author yes, other member no, admin yes", async () => {
    const owner = await reg(uniq("o3"));
    const room = await createRoom(owner.token);
    const a = await reg(uniq("a")); await join(room.code, a.token);
    const b = await reg(uniq("b")); await join(room.code, b.token);
    const id1 = idOf(await db.rpc("send_chat_message", { p_session_token: a.token, p_room_id: room.room_id, p_body: "from a #1" }));
    const id2 = idOf(await db.rpc("send_chat_message", { p_session_token: a.token, p_room_id: room.room_id, p_body: "from a #2" }));
    const bDel = await db.rpc("delete_chat_message", { p_session_token: b.token, p_room_id: room.room_id, p_message_id: id1 });
    expect(bDel.error?.message).toContain("not allowed");
    const aDel = await db.rpc("delete_chat_message", { p_session_token: a.token, p_room_id: room.room_id, p_message_id: id1 });
    expect(aDel.error).toBeNull();
    const oDel = await db.rpc("delete_chat_message", { p_session_token: owner.token, p_room_id: room.room_id, p_message_id: id2 });
    expect(oDel.error).toBeNull();
  });
});
