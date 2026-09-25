import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactionData } from "@/lib/reactions";

const h = vi.hoisted(() => ({ onReact: null as ((d: ReactionData) => void) | null }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ account: { accountId: "me", username: "Me", isRoot: false } }) }));
vi.mock("@/lib/reactions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/reactions")>()),
  joinReactions: (_roomId: string, onReact: (d: ReactionData) => void) => {
    h.onReact = onReact;
    return { send: () => {}, unsubscribe: () => {} };
  },
}));

import { useReactions } from "@/hooks/useReactions";

beforeEach(() => {
  vi.useFakeTimers();
  h.onReact = null;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useReactions", () => {
  it("drops the reactions a sender sends over its budget (anti-cheat §14)", () => {
    const onEvent = vi.fn();
    renderHook(() => useReactions("r", "Me", { onEvent }));
    act(() => {
      for (let i = 0; i < 7; i++) h.onReact!({ emoji: "🔥", accountId: "spam", username: "Spam" });
    });
    expect(onEvent).toHaveBeenCalledTimes(5);
    act(() => h.onReact!({ emoji: "🎉", accountId: "lan", username: "Lan" }));
    expect(onEvent).toHaveBeenCalledTimes(6);
    act(() => { vi.advanceTimersByTime(1000); });
    act(() => h.onReact!({ emoji: "🔥", accountId: "spam", username: "Spam" }));
    expect(onEvent).toHaveBeenCalledTimes(7);
  });
});
