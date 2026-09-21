import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_TEST_URL;
const key = process.env.SUPABASE_TEST_ANON_KEY;
const run = url && key ? describe : describe.skip;

run("v9 room rules", () => {
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
    const { error } = await db.rpc("join_room", { p_code: code, p_password: "secret", p_session_token: token });
    if (error) throw error;
  };
  const add = (roomId: string, token: string, videoId: string, title: string, duration: number | null) =>
    db.rpc("add_queue_item", { p_room_id: roomId, p_session_token: token, p_video_id: videoId, p_title: title, p_thumb: null, p_duration: duration });
  const settings = (roomId: string, token: string, max: number, approval: boolean, kws: string[]) =>
    db.rpc("update_room_settings", { p_room_id: roomId, p_session_token: token, p_max_duration_seconds: max, p_require_approval: approval, p_banned_keywords: kws });
  const row = async (id: string) => {
    const { data } = await db.from("queue_items").select("status, position").eq("id", id).maybeSingle();
    return data as { status: string; position: number } | null;
  };

  it("enforces the default 10-minute limit and unknown durations", async () => {
    const admin = await reg(uniq("adm")); const room = await createRoom(admin.token);
    const tooLong = await add(room.room_id, admin.token, "v1", "Long", 601);
    expect(tooLong.error?.code).toBe("23514"); expect(tooLong.error?.message).toBe("video too long");
    const unknown = await add(room.room_id, admin.token, "v2", "Unknown", null);
    expect(unknown.error?.code).toBe("23514"); expect(unknown.error?.message).toBe("duration unknown");
    const ok = await add(room.room_id, admin.token, "v3", "Fine", 599);
    expect(ok.error).toBeNull();
  });

  it("settings: admin/dj only, validated, keywords trimmed + deduped (accent-insensitive); 0 = unlimited", async () => {
    const admin = await reg(uniq("adm")); const room = await createRoom(admin.token);
    const member = await reg(uniq("mem")); await join(room.code, member.token);
    expect((await settings(room.room_id, member.token, 0, false, [])).error?.code).toBe("42501");
    expect((await settings(room.room_id, admin.token, -1, false, [])).error?.code).toBe("22023");
    expect((await settings(room.room_id, admin.token, 0, false, ["  Nhạc Chế ", "nhac che", "karaoke", ""])).error).toBeNull();
    const { data } = await db.from("rooms").select("max_duration_seconds, require_approval, banned_keywords").eq("id", room.room_id).single();
    expect(data).toEqual({ max_duration_seconds: 0, require_approval: false, banned_keywords: ["Nhạc Chế", "karaoke"] });
    expect((await add(room.room_id, admin.token, "v4", "No duration is fine when unlimited", null)).error).toBeNull();
  });

  it("banned keywords match the title case- and accent-insensitively", async () => {
    const admin = await reg(uniq("adm")); const room = await createRoom(admin.token);
    await settings(room.room_id, admin.token, 0, false, ["nhạc chế"]);
    const banned = await add(room.room_id, admin.token, "v5", "NHAC CHE hay nhất", 100);
    expect(banned.error?.code).toBe("23514"); expect(banned.error?.message).toBe("banned keyword: nhạc chế");
  });

  it("approval: member rows pend, admin rows do not; approve / reject / approve-all; advance skips pending", async () => {
    const admin = await reg(uniq("adm")); const room = await createRoom(admin.token);
    const member = await reg(uniq("mem")); await join(room.code, member.token);
    await settings(room.room_id, admin.token, 0, true, []);
    const { data: memId } = await add(room.room_id, member.token, "m1", "Member", 100);
    expect(await row(memId as string)).toEqual({ status: "pending", position: 0 });
    const { data: admId } = await add(room.room_id, admin.token, "a1", "Admin", 100);
    expect((await row(admId as string))?.status).toBe("approved");
    // advance (admin is dj on create) plays a1, then finds nothing approved
    await db.rpc("advance_queue", { p_room_id: room.room_id, p_session_token: admin.token });
    let { data: r } = await db.from("rooms").select("current_item_id").eq("id", room.room_id).single();
    expect(r?.current_item_id).toBe(admId);
    await db.rpc("advance_queue", { p_room_id: room.room_id, p_session_token: admin.token });
    ({ data: r } = await db.from("rooms").select("current_item_id").eq("id", room.room_id).single());
    expect(r?.current_item_id).toBeNull();
    // approve one
    expect((await db.rpc("approve_queue_item", { p_room_id: room.room_id, p_session_token: admin.token, p_item_id: memId })).error).toBeNull();
    expect((await row(memId as string))?.status).toBe("approved");
    // reject
    const { data: rejId } = await add(room.room_id, member.token, "m2", "Reject", 100);
    await db.rpc("reject_queue_item", { p_room_id: room.room_id, p_session_token: admin.token, p_item_id: rejId });
    expect(await row(rejId as string)).toBeNull();
    // approve all
    await add(room.room_id, member.token, "m3", "P1", 100); await add(room.room_id, member.token, "m4", "P2", 100);
    const { data: count } = await db.rpc("approve_all_pending", { p_room_id: room.room_id, p_session_token: admin.token });
    expect(count).toBe(2);
    // member cannot approve
    const { data: m5 } = await add(room.room_id, member.token, "m5", "P3", 100);
    expect((await db.rpc("approve_queue_item", { p_room_id: room.room_id, p_session_token: member.token, p_item_id: m5 })).error?.code).toBe("42501");
  });

  it("owner can withdraw own pending row; others cannot; approval off auto-approves", async () => {
    const admin = await reg(uniq("adm")); const room = await createRoom(admin.token);
    const member = await reg(uniq("mem")); await join(room.code, member.token);
    const other = await reg(uniq("oth")); await join(room.code, other.token);
    await settings(room.room_id, admin.token, 0, true, []);
    const { data: id1 } = await add(room.room_id, member.token, "w1", "Withdraw", 100);
    expect((await db.rpc("delete_item", { p_room_id: room.room_id, p_session_token: other.token, p_item_id: id1 })).error?.code).toBe("42501");
    expect((await db.rpc("delete_item", { p_room_id: room.room_id, p_session_token: member.token, p_item_id: id1 })).error).toBeNull();
    expect(await row(id1 as string)).toBeNull();
    const { data: id2 } = await add(room.room_id, member.token, "w2", "Auto", 100);
    await settings(room.room_id, admin.token, 0, false, []);
    expect((await row(id2 as string))?.status).toBe("approved");
  });

  it("batch add skips rule violators and pends member rows", async () => {
    const admin = await reg(uniq("adm")); const room = await createRoom(admin.token);
    const member = await reg(uniq("mem")); await join(room.code, member.token);
    await settings(room.room_id, admin.token, 600, true, ["karaoke"]);
    const { data, error } = await db.rpc("add_queue_items", { p_room_id: room.room_id, p_session_token: member.token, p_items: [
      { video_id: "b1", title: "ok", thumb: null, duration: 100 },
      { video_id: "b2", title: "too long", thumb: null, duration: 700 },
      { video_id: "b3", title: "Karaoke x", thumb: null, duration: 100 },
      { video_id: "b4", title: "no duration", thumb: null },
    ] });
    expect(error).toBeNull(); expect(data).toBe(1);
    const { data: rows } = await db.from("queue_items").select("youtube_video_id, status").eq("room_id", room.room_id);
    expect(rows).toEqual([{ youtube_video_id: "b1", status: "pending" }]);
  });
});
