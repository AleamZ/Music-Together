import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_TEST_URL;
const key = process.env.SUPABASE_TEST_ANON_KEY;
const run = url && key ? describe : describe.skip;

run("v5 batch queue add", () => {
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
  const items = [
    { video_id: "aaaaaaaaaaa", title: "A", thumb: "ta" },
    { video_id: "bbbbbbbbbbb", title: "B", thumb: "tb" },
    { video_id: "ccccccccccc", title: "C", thumb: null },
  ];

  it("a member batch-adds items with increasing positions", async () => {
    const owner = await reg(uniq("own"));
    const room = await createRoom(owner.token);
    const { data, error } = await db.rpc("add_queue_items", { p_room_id: room.room_id, p_session_token: owner.token, p_items: items });
    expect(error).toBeNull();
    expect(data).toBe(3);
    const { data: rows } = await db.from("queue_items").select("youtube_video_id, position").eq("room_id", room.room_id).order("position");
    const r = (rows ?? []) as { youtube_video_id: string; position: number }[];
    expect(r.map((x) => x.youtube_video_id)).toEqual(["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc"]);
    expect(r[0].position).toBeLessThan(r[1].position);
    expect(r[1].position).toBeLessThan(r[2].position);
  });

  it("empty array inserts nothing and returns 0", async () => {
    const owner = await reg(uniq("empty"));
    const room = await createRoom(owner.token);
    const { data, error } = await db.rpc("add_queue_items", { p_room_id: room.room_id, p_session_token: owner.token, p_items: [] });
    expect(error).toBeNull();
    expect(data).toBe(0);
  });

  it("a non-member cannot batch-add", async () => {
    const owner = await reg(uniq("o2"));
    const room = await createRoom(owner.token);
    const outsider = await reg(uniq("out"));
    const { error } = await db.rpc("add_queue_items", { p_room_id: room.room_id, p_session_token: outsider.token, p_items: items });
    expect(error?.message).toContain("not a member");
  });
});
