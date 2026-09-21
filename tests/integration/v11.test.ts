import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_TEST_URL;
const key = process.env.SUPABASE_TEST_ANON_KEY;
const run = url && key ? describe : describe.skip;

run("v11 per-member order limit", () => {
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
  const add = (roomId: string, token: string, videoId: string) =>
    db.rpc("add_queue_item", { p_room_id: roomId, p_session_token: token, p_video_id: videoId, p_title: videoId, p_thumb: null, p_duration: 100 });
  const addMany = (roomId: string, token: string, ids: string[], duration = 100) =>
    db.rpc("add_queue_items", { p_room_id: roomId, p_session_token: token, p_items: ids.map((id) => ({ video_id: id, title: id, thumb: null, duration })) });
  const settings = (roomId: string, token: string, maxOrders: number | null, approval = false) =>
    db.rpc("update_room_settings", {
      p_room_id: roomId, p_session_token: token, p_max_duration_seconds: 600, p_require_approval: approval, p_banned_keywords: [],
      ...(maxOrders === null ? {} : { p_max_orders_per_member: maxOrders }),
    });
  const limitOf = async (roomId: string) => {
    const { data } = await db.from("rooms").select("max_orders_per_member").eq("id", roomId).single();
    return (data as { max_orders_per_member: number }).max_orders_per_member;
  };

  it("default 5: the 6th add is refused with 'order limit reached'; admin is exempt", async () => {
    const admin = await reg(uniq("adm")); const room = await createRoom(admin.token);
    const member = await reg(uniq("mem")); await join(room.code, member.token);
    expect(await limitOf(room.room_id)).toBe(5);
    for (let i = 1; i <= 5; i++) expect((await add(room.room_id, member.token, `v${i}`)).error).toBeNull();
    const sixth = await add(room.room_id, member.token, "v6");
    expect(sixth.error?.code).toBe("23514"); expect(sixth.error?.message).toBe("order limit reached");
    for (let i = 1; i <= 6; i++) expect((await add(room.room_id, admin.token, `a${i}`)).error).toBeNull();
  });

  it("the playing row does not count", async () => {
    const admin = await reg(uniq("adm")); const room = await createRoom(admin.token);
    const member = await reg(uniq("mem")); await join(room.code, member.token);
    for (let i = 1; i <= 5; i++) expect((await add(room.room_id, member.token, `v${i}`)).error).toBeNull();
    expect((await db.rpc("advance_queue", { p_room_id: room.room_id, p_session_token: admin.token })).error).toBeNull();
    expect((await add(room.room_id, member.token, "v6")).error).toBeNull();
    expect((await add(room.room_id, member.token, "v7")).error?.message).toBe("order limit reached");
  });

  it("DJ is exempt", async () => {
    const admin = await reg(uniq("adm")); const room = await createRoom(admin.token);
    const dj = await reg(uniq("dj")); const djJoin = await join(room.code, dj.token);
    expect((await db.rpc("assign_dj", { p_room_id: room.room_id, p_session_token: admin.token, p_target_member: djJoin.member_id })).error).toBeNull();
    for (let i = 1; i <= 6; i++) expect((await add(room.room_id, dj.token, `d${i}`)).error).toBeNull();
  });

  it("playlist: inserts up to the remaining slots; rule-skipped elements do not use a slot; then 0", async () => {
    const admin = await reg(uniq("adm")); const room = await createRoom(admin.token);
    const member = await reg(uniq("mem")); await join(room.code, member.token);
    expect((await settings(room.room_id, admin.token, 2)).error).toBeNull();
    const { data, error } = await db.rpc("add_queue_items", { p_room_id: room.room_id, p_session_token: member.token, p_items: [
      { video_id: "p1", title: "ok", thumb: null, duration: 100 },
      { video_id: "p2", title: "too long", thumb: null, duration: 700 },
      { video_id: "p3", title: "ok", thumb: null, duration: 100 },
      { video_id: "p4", title: "ok", thumb: null, duration: 100 },
    ] });
    expect(error).toBeNull(); expect(data).toBe(2);
    const { data: rows } = await db.from("queue_items").select("youtube_video_id").eq("room_id", room.room_id).order("position");
    expect(rows).toEqual([{ youtube_video_id: "p1" }, { youtube_video_id: "p3" }]);
    const again = await addMany(room.room_id, member.token, ["p5"]);
    expect(again.error).toBeNull(); expect(again.data).toBe(0);
  });

  it("pending rows count; a rejected row frees a slot", async () => {
    const admin = await reg(uniq("adm")); const room = await createRoom(admin.token);
    const member = await reg(uniq("mem")); await join(room.code, member.token);
    expect((await settings(room.room_id, admin.token, 2, true)).error).toBeNull();
    const first = await add(room.room_id, member.token, "v1"); expect(first.error).toBeNull();
    expect((await add(room.room_id, member.token, "v2")).error).toBeNull();
    expect((await add(room.room_id, member.token, "v3")).error?.message).toBe("order limit reached");
    expect((await db.rpc("reject_queue_item", { p_room_id: room.room_id, p_session_token: admin.token, p_item_id: first.data })).error).toBeNull();
    expect((await add(room.room_id, member.token, "v3")).error).toBeNull();
  });

  it("settings: 0 = unlimited, omitted argument keeps the value, out of range rejected, member refused", async () => {
    const admin = await reg(uniq("adm")); const room = await createRoom(admin.token);
    const member = await reg(uniq("mem")); await join(room.code, member.token);
    expect((await settings(room.room_id, member.token, 3)).error?.code).toBe("42501");
    expect((await settings(room.room_id, admin.token, 0)).error).toBeNull();
    for (let i = 1; i <= 7; i++) expect((await add(room.room_id, member.token, `v${i}`)).error).toBeNull();
    expect((await settings(room.room_id, admin.token, null)).error).toBeNull();
    expect(await limitOf(room.room_id)).toBe(0);
    const over = await settings(room.room_id, admin.token, 101);
    expect(over.error?.code).toBe("22023"); expect(over.error?.message).toBe("invalid order limit");
    expect((await settings(room.room_id, admin.token, -1)).error?.code).toBe("22023");
    expect((await settings(room.room_id, admin.token, 100)).error).toBeNull();
    expect(await limitOf(room.room_id)).toBe(100);
  });
});
