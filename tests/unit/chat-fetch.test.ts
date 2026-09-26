import { beforeEach, describe, it, expect, vi } from "vitest";

// One query builder: it records every call, and each query it runs gets the next answer.
const h = vi.hoisted(() => {
  const calls: Record<string, unknown[][]> = {};
  const answers: Array<{ data: unknown; error: unknown }> = [];
  const chain: Record<string, unknown> = {};
  for (const k of ["select", "eq", "order", "limit"]) {
    chain[k] = (...args: unknown[]) => {
      (calls[k] ??= []).push(args);
      return chain;
    };
  }
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(answers.shift() ?? { data: [], error: null }).then(resolve);
  return { calls, answers, chain };
});
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      (h.calls.from ??= []).push([table]);
      return h.chain;
    },
  },
}));

import { fetchRecentMessages } from "@/lib/chat";

const COLUMNS = "id, room_id, account_id, username, body, created_at";

beforeEach(() => {
  for (const k of Object.keys(h.calls)) delete h.calls[k];
  h.answers.length = 0;
});

describe("fetchRecentMessages", () => {
  it("reads the system flag with the last messages, oldest first (anti-cheat §6.1)", async () => {
    h.answers.push({
      data: [
        { id: "2", room_id: "r", account_id: null, username: "Ao cá", body: "b", created_at: "2026-10-02T10:00:02Z", system: true },
        { id: "1", room_id: "r", account_id: "a", username: "Lan", body: "a", created_at: "2026-10-02T10:00:01Z", system: false },
      ],
      error: null,
    });
    const out = await fetchRecentMessages("r", 50);
    expect(h.calls.from).toEqual([["chat_messages"]]);
    expect(h.calls.select).toEqual([[`${COLUMNS}, system`]]);
    expect(h.calls.eq).toEqual([["room_id", "r"]]);
    expect(out.map((m) => [m.id, m.system])).toEqual([["1", false], ["2", true]]);
  });

  it("reads them once more without the flag before migration 0015, and none is a system line", async () => {
    h.answers.push({ data: null, error: { code: "42703", message: "column chat_messages.system does not exist" } });
    h.answers.push({
      data: [
        { id: "2", room_id: "r", account_id: null, username: "Ao cá", body: "[catch:x|ca_ro|120] b", created_at: "2026-10-02T10:00:02Z" },
        { id: "1", room_id: "r", account_id: "a", username: "Lan", body: "a", created_at: "2026-10-02T10:00:01Z" },
      ],
      error: null,
    });
    const out = await fetchRecentMessages("r", 50);
    expect(h.calls.select).toEqual([[`${COLUMNS}, system`], [COLUMNS]]);
    expect(out.map((m) => [m.id, m.system])).toEqual([["1", false], ["2", false]]);
  });

  it("throws any other error, without a second read", async () => {
    const denied = { code: "42501", message: "permission denied for table chat_messages" };
    h.answers.push({ data: null, error: denied });
    await expect(fetchRecentMessages("r", 50)).rejects.toBe(denied);
    expect(h.calls.select).toHaveLength(1);
  });
});
