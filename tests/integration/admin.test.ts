import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_TEST_URL;
const key = process.env.SUPABASE_TEST_ANON_KEY;
const run = url && key ? describe : describe.skip;

run("v3 feedback + admin gating", () => {
  let db: SupabaseClient;
  beforeAll(() => { db = createClient(url!, key!, { auth: { persistSession: false } }); });

  let n = 0;
  const uniq = (p: string) => `${p}_${Date.now()}_${n++}`;
  const reg = async (username: string) => {
    const { data, error } = await db.rpc("register", { p_username: username, p_password: "pw123456" });
    if (error) throw error;
    return (Array.isArray(data) ? data[0] : data) as { account_id: string; username: string; token: string };
  };

  it("submit_feedback validates category and message", async () => {
    const a = await reg(uniq("fb"));
    const bad = await db.rpc("submit_feedback", { p_session_token: a.token, p_category: "spam", p_message: "x" });
    expect(bad.error?.message).toContain("invalid category");
    const empty = await db.rpc("submit_feedback", { p_session_token: a.token, p_category: "bug", p_message: "   " });
    expect(empty.error?.message).toContain("empty message");
    const ok = await db.rpc("submit_feedback", { p_session_token: a.token, p_category: "suggestion", p_message: "Great app" });
    expect(ok.error).toBeNull();
  });

  it("submit_feedback is rate-limited to 10/hour", async () => {
    const a = await reg(uniq("rl"));
    for (let i = 0; i < 10; i++) {
      const r = await db.rpc("submit_feedback", { p_session_token: a.token, p_category: "other", p_message: `m${i}` });
      expect(r.error).toBeNull();
    }
    const over = await db.rpc("submit_feedback", { p_session_token: a.token, p_category: "other", p_message: "11th" });
    expect(over.error?.message).toContain("too many feedback");
  });

  it("non-root accounts are rejected by every admin/feedback-read RPC", async () => {
    const a = await reg(uniq("nonroot"));
    const t = a.token;
    const calls: Array<readonly [string, Record<string, unknown>]> = [
      ["list_feedback", { p_session_token: t }],
      ["set_feedback_status", { p_session_token: t, p_id: "00000000-0000-0000-0000-000000000000", p_status: "handled" }],
      ["delete_feedback", { p_session_token: t, p_id: "00000000-0000-0000-0000-000000000000" }],
      ["admin_list_rooms", { p_session_token: t }],
      ["admin_delete_room", { p_session_token: t, p_room_id: "00000000-0000-0000-0000-000000000000" }],
      ["admin_list_accounts", { p_session_token: t }],
      ["admin_set_ban", { p_session_token: t, p_account_id: "00000000-0000-0000-0000-000000000000", p_banned: true }],
      ["admin_delete_account", { p_session_token: t, p_account_id: "00000000-0000-0000-0000-000000000000" }],
      ["admin_stats", { p_session_token: t }],
    ];
    for (const [fn, args] of calls) {
      const r = await db.rpc(fn, args);
      expect(r.error?.message, fn).toContain("root role required");
    }
  });

  it("create_room is rate-limited to 10/hour", async () => {
    const a = await reg(uniq("rooms"));
    for (let i = 0; i < 10; i++) {
      const r = await db.rpc("create_room", { p_room_name: `R${i}`, p_password: "secret", p_session_token: a.token });
      expect(r.error).toBeNull();
    }
    const over = await db.rpc("create_room", { p_room_name: "R11", p_password: "secret", p_session_token: a.token });
    expect(over.error?.message).toContain("too many rooms");
  });

  it("me() returns is_root=false for a normal account", async () => {
    const a = await reg(uniq("me"));
    const { data } = await db.rpc("me", { p_token: a.token });
    expect((Array.isArray(data) ? data[0] : data).is_root).toBe(false);
  });
});
