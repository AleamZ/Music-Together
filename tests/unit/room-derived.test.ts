import { describe, it, expect } from "vitest";
import { deriveRoom } from "@/lib/room-derived";
import type { Member, QueueItem, Room } from "@/lib/supabase";

const room: Room = {
  id: "r1", code: "ABC", name: "R", play_mode: "order",
  admin_member_id: "m-admin", dj_member_id: "m-dj", current_item_id: "q1",
  is_playing: true, started_at: null, paused_elapsed_ms: 0, created_at: "",
  max_duration_seconds: 600, require_approval: true, banned_keywords: ["x"], max_orders_per_member: 5,
  auto_replay_history: false,
};
const q = (id: string, status: "approved" | "pending", by: string | null): QueueItem => ({
  id, room_id: "r1", youtube_video_id: id, title: id, thumbnail_url: null, duration_seconds: 100,
  added_by_account_id: by, added_by_name: "n", position: 1, created_at: "", status,
});
const members: Member[] = [
  { id: "m-admin", room_id: "r1", account_id: "a-admin", joined_at: "" },
  { id: "m-dj", room_id: "r1", account_id: "a-dj", joined_at: "" },
  { id: "m-me", room_id: "r1", account_id: "a-me", joined_at: "" },
];
const queue = [q("q1", "approved", "a-me"), q("q2", "approved", "a-me"), q("q3", "pending", "a-me"), q("q4", "pending", "a-dj")];
const listener = { isAdmin: false, isDj: false, canManageQueue: false, canControlPlayback: false };

describe("deriveRoom", () => {
  it("splits the queue and finds the current item", () => {
    const d = deriveRoom({ room, members, queue }, "a-me", listener, ["a-dj"]);
    expect(d.current?.id).toBe("q1");
    expect(d.approved.map((i) => i.id)).toEqual(["q1", "q2"]);
    expect(d.pending.map((i) => i.id)).toEqual(["q3", "q4"]);
    expect(d.myPending.map((i) => i.id)).toEqual(["q3"]);
  });
  it("copies the rules and computes approval + order limit for a listener", () => {
    const d = deriveRoom({ room, members, queue }, "a-me", listener, []);
    expect(d.rules).toEqual({ max_duration_seconds: 600, banned_keywords: ["x"], max_orders_per_member: 5 });
    expect(d.willPend).toBe(true);
    expect(d.orderLimit).toEqual({ mine: 2, exempt: false }); // q2 + q3 (q1 is playing)
  });
  it("exempts queue managers", () => {
    const d = deriveRoom({ room, members, queue }, "a-me", { ...listener, canManageQueue: true }, []);
    expect(d.willPend).toBe(false);
    expect(d.orderLimit.exempt).toBe(true);
  });
  it("maps the DJ member to an account and checks presence", () => {
    expect(deriveRoom({ room, members, queue }, "a-me", listener, ["a-dj"]).djAccountId).toBe("a-dj");
    expect(deriveRoom({ room, members, queue }, "a-me", listener, ["a-dj"]).djOnline).toBe(true);
    expect(deriveRoom({ room, members, queue }, "a-me", listener, []).djOnline).toBe(false);
  });
});
