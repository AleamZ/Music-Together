import { describe, it, expect, vi } from "vitest";
import { markLeaving } from "@/lib/channel-lifecycle";
import { joinReactions, parseReaction, throttled, REACTION_EMOJIS, type ReactionData } from "@/lib/reactions";

// Fake Realtime channel for joinReactions: on/subscribe chain, send and removeChannel resolve "ok".
const { fakeChannel, sendMock } = vi.hoisted(() => {
  const sendMock = vi.fn(() => Promise.resolve("ok"));
  const fakeChannel = {
    on() { return fakeChannel; },
    subscribe() { return fakeChannel; },
    send: sendMock,
  };
  return { fakeChannel, sendMock };
});
vi.mock("@/lib/supabase", () => ({
  supabase: { channel: () => fakeChannel, removeChannel: () => Promise.resolve("ok") },
}));

describe("parseReaction", () => {
  it("reads the broadcast envelope and keeps username + accountId", () => {
    expect(parseReaction({ type: "broadcast", event: "react", payload: { emoji: "🔥", username: " hunglt ", accountId: "acc-1" } }))
      .toEqual({ emoji: "🔥", username: "hunglt", accountId: "acc-1" });
  });
  it("accepts old clients: bare emoji strings and payloads without accountId", () => {
    expect(parseReaction({ payload: "🎉" })).toEqual({ emoji: "🎉" });
    expect(parseReaction({ payload: { emoji: "👏", username: "" } })).toEqual({ emoji: "👏" });
  });
  it("drops unknown emojis and junk", () => {
    expect(parseReaction({ payload: { emoji: "💩" } })).toBeNull();
    expect(parseReaction({ payload: 42 })).toBeNull();
    expect(parseReaction(null)).toBeNull();
  });
});

describe("throttled", () => {
  it("allows the first call (lastAt null)", () => {
    expect(throttled(null, 1000)).toBe(false);
  });
  it("blocks a call within the gap", () => {
    expect(throttled(1000, 1100, 250)).toBe(true);
  });
  it("allows a call at/after the gap", () => {
    expect(throttled(1000, 1250, 250)).toBe(false);
    expect(throttled(1000, 1600, 250)).toBe(false);
  });
});

describe("REACTION_EMOJIS", () => {
  it("is the fixed 5-emoji palette", () => {
    expect(REACTION_EMOJIS).toEqual(["❤️", "😂", "🔥", "👏", "🎉"]);
  });
});

describe("ReactionData", () => {
  it("supports emoji and optional username", () => {
    const data: ReactionData = { emoji: "🔥", username: "hunglt" };
    expect(data.emoji).toBe("🔥");
    expect(data.username).toBe("hunglt");
  });
});

describe("joinReactions", () => {
  it("delivers a reaction sent while the previous subscriber of the topic is still leaving", async () => {
    let finishLeave!: () => void;
    markLeaving("reactions:r1", new Promise<void>((resolve) => { finishLeave = resolve; }));
    const handle = joinReactions("r1", () => {});
    handle.send({ emoji: "🔥" });
    await Promise.resolve();
    expect(sendMock).not.toHaveBeenCalled();
    finishLeave();
    await vi.waitFor(() => expect(sendMock).toHaveBeenCalledWith({ type: "broadcast", event: "react", payload: { emoji: "🔥" } }));
    handle.unsubscribe();
  });
});
