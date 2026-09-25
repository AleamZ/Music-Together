import { describe, it, expect, vi } from "vitest";

const h = vi.hoisted(() => {
  const calls: Record<string, unknown[]> = {};
  const rows = [
    { id: "2", room_id: "r", account_id: null, username: "Ao cá", body: "b", created_at: "2026-10-02T10:00:02Z", system: true },
    { id: "1", room_id: "r", account_id: "a", username: "Lan", body: "a", created_at: "2026-10-02T10:00:01Z", system: false },
  ];
  const chain: Record<string, unknown> = {};
  for (const k of ["select", "eq", "order", "limit"]) {
    chain[k] = (...args: unknown[]) => {
      calls[k] = args;
      return chain;
    };
  }
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve);
  return { calls, chain };
});
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      h.calls.from = [table];
      return h.chain;
    },
  },
}));

import { fetchRecentMessages } from "@/lib/chat";

describe("fetchRecentMessages", () => {
  it("reads the system flag with the last messages, oldest first (anti-cheat §6.1)", async () => {
    const out = await fetchRecentMessages("r", 50);
    expect(h.calls.from).toEqual(["chat_messages"]);
    expect(h.calls.select).toEqual(["id, room_id, account_id, username, body, created_at, system"]);
    expect(h.calls.eq).toEqual(["room_id", "r"]);
    expect(out.map((m) => [m.id, m.system])).toEqual([["1", false], ["2", true]]);
  });
});
