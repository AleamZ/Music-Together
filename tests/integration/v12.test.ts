import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_TEST_URL;
const key = process.env.SUPABASE_TEST_ANON_KEY;
const run = url && key ? describe : describe.skip;

run("v12 auto-replay history", () => {
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
  /** 0015 takes 11-character YouTube ids only: the short test ids are padded. */
  const vid = (id: string) => id.padEnd(11, "0");
  const add = (roomId: string, token: string, videoId: string) =>
    db.rpc("add_queue_item", { p_room_id: roomId, p_session_token: token, p_video_id: vid(videoId), p_title: videoId, p_thumb: null, p_duration: 100 });
  const setReplay = (roomId: string, token: string, enable: boolean) =>
    db.rpc("update_room_settings", {
      p_room_id: roomId, p_session_token: token,
      p_max_duration_seconds: 600, p_require_approval: false, p_banned_keywords: [],
      p_max_orders_per_member: 5,
      p_auto_replay_history: enable,
    });

  it("when auto_replay is disabled and queue is empty, advance_queue clears current_item_id and stops", async () => {
    const admin = await reg(uniq("adm"));
    const room = await createRoom(admin.token);
    await add(room.room_id, admin.token, "track1");

    // Advance to play track1
    await db.rpc("advance_queue", { p_room_id: room.room_id, p_session_token: admin.token });
    let { data: r } = await db.from("rooms").select("current_item_id, is_playing").eq("id", room.room_id).single();
    expect(r?.is_playing).toBe(true);

    // Advance again when queue is empty -> stops
    await db.rpc("advance_queue", { p_room_id: room.room_id, p_session_token: admin.token });
    r = (await db.from("rooms").select("current_item_id, is_playing").eq("id", room.room_id).single()).data;
    expect(r?.is_playing).toBe(false);
    expect(r?.current_item_id).toBeNull();
  });

  it("when auto_replay is enabled and queue is empty, advance_queue picks from play_history", async () => {
    const admin = await reg(uniq("adm"));
    const room = await createRoom(admin.token);
    await setReplay(room.room_id, admin.token, true);

    await add(room.room_id, admin.token, "track_hist1");
    // Play track_hist1
    await db.rpc("advance_queue", { p_room_id: room.room_id, p_session_token: admin.token });

    // Track finishes and queue has no more items -> auto-replays from history
    await db.rpc("advance_queue", { p_room_id: room.room_id, p_session_token: admin.token });

    const { data: r } = await db.from("rooms").select("current_item_id, is_playing").eq("id", room.room_id).single();
    expect(r?.is_playing).toBe(true);
    expect(r?.current_item_id).not.toBeNull();

    // Check that the currently playing item is marked as is_replay
    const { data: qItem } = await db.from("queue_items").select("*").eq("id", r!.current_item_id!).single();
    expect(qItem?.youtube_video_id).toBe("track_hist1");
    expect(qItem?.is_replay).toBe(true);
  });
});
