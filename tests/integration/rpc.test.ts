import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_TEST_URL;
const key = process.env.SUPABASE_TEST_ANON_KEY;
const run = url && key ? describe : describe.skip;

run("RPC security & behavior", () => {
  let db: SupabaseClient;
  beforeAll(() => { db = createClient(url!, key!, { auth: { persistSession: false } }); });

  const create = async (room = "Salon", pass = "secret", user = "Admin") => {
    const { data, error } = await db.rpc("create_room", {
      p_room_name: room, p_password: pass, p_user_name: user,
    });
    if (error) throw error;
    return (Array.isArray(data) ? data[0] : data) as
      { code: string; room_id: string; member_id: string; token: string };
  };
  const join = async (code: string, user: string, pass: string) => {
    const { data, error } = await db.rpc("join_room", {
      p_code: code, p_user_name: user, p_password: pass,
    });
    if (error) throw error;
    return (Array.isArray(data) ? data[0] : data) as
      { room_id: string; member_id: string; token: string };
  };

  it("create_room makes creator admin+dj and returns a token", async () => {
    const r = await create();
    expect(r.code).toMatch(/^salon-/);
    expect(r.token).toHaveLength(64); // 32 bytes hex
    const { data: room } = await db.from("rooms").select("*").eq("id", r.room_id).single();
    expect(room!.admin_member_id).toBe(r.member_id);
    expect(room!.dj_member_id).toBe(r.member_id);
  });

  it("join_room rejects a wrong password", async () => {
    const r = await create("R", "right-pass", "A");
    await expect(join(r.code, "Bob", "wrong-pass")).rejects.toMatchObject({
      message: expect.stringContaining("invalid password"),
    });
  });

  it("member_secrets is not readable by clients", async () => {
    const { data, error } = await db.from("member_secrets").select("*");
    // RLS with no policy -> no rows (and no error) for anon.
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("add_queue_item requires a valid token", async () => {
    const a = await create();
    const guest = await join(a.code, "Guest", "secret");
    // good token works
    const ok = await db.rpc("add_queue_item", {
      p_room_id: a.room_id, p_member_id: guest.member_id, p_token: guest.token,
      p_video_id: "dQw4w9WgXcQ", p_title: "Song A", p_thumb: null, p_duration: 200,
    });
    expect(ok.error).toBeNull();
    // bad token rejected
    const bad = await db.rpc("add_queue_item", {
      p_room_id: a.room_id, p_member_id: guest.member_id, p_token: "deadbeef",
      p_video_id: "x", p_title: "Nope", p_thumb: null, p_duration: null,
    });
    expect(bad.error?.message).toContain("invalid token");
  });

  it("guests cannot advance the queue; DJ can", async () => {
    const a = await create();
    const guest = await join(a.code, "Guest", "secret");
    for (const t of ["S1", "S2"]) {
      await db.rpc("add_queue_item", {
        p_room_id: a.room_id, p_member_id: guest.member_id, p_token: guest.token,
        p_video_id: t, p_title: t, p_thumb: null, p_duration: 10,
      });
    }
    const denied = await db.rpc("advance_queue", {
      p_room_id: a.room_id, p_member_id: guest.member_id, p_token: guest.token,
    });
    expect(denied.error?.message).toContain("dj role required");

    const adv = await db.rpc("advance_queue", {
      p_room_id: a.room_id, p_member_id: a.member_id, p_token: a.token,
    });
    expect(adv.error).toBeNull();
    const { data: room } = await db.from("rooms").select("*").eq("id", a.room_id).single();
    expect(room!.current_item_id).not.toBeNull();
    expect(room!.is_playing).toBe(true);
  });

  it("delete_item refuses the currently playing item", async () => {
    const a = await create();
    await db.rpc("add_queue_item", {
      p_room_id: a.room_id, p_member_id: a.member_id, p_token: a.token,
      p_video_id: "C", p_title: "C", p_thumb: null, p_duration: 10,
    });
    await db.rpc("advance_queue", { p_room_id: a.room_id, p_member_id: a.member_id, p_token: a.token });
    const { data: room } = await db.from("rooms").select("current_item_id").eq("id", a.room_id).single();
    const del = await db.rpc("delete_item", {
      p_room_id: a.room_id, p_member_id: a.member_id, p_token: a.token, p_item_id: room!.current_item_id,
    });
    expect(del.error?.message).toContain("currently playing");
  });

  it("transfer_admin demotes the old admin", async () => {
    const a = await create();
    const bob = await join(a.code, "Bob", "secret");
    await db.rpc("transfer_admin", {
      p_room_id: a.room_id, p_member_id: a.member_id, p_token: a.token, p_target_member: bob.member_id,
    });
    // old admin can no longer rename
    const denied = await db.rpc("rename_room", {
      p_room_id: a.room_id, p_member_id: a.member_id, p_token: a.token, p_new_name: "X",
    });
    expect(denied.error?.message).toContain("admin role required");
  });
});
