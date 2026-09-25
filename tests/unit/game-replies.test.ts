import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createReplyScheduler, replyWindowMs, unseenGraceMs } from "@/lib/game/net/replies";

describe("answer window and unseen grace", () => {
  it("grow by 150 ms per player in the world; the grace outlasts the window by 500 ms", () => {
    expect(replyWindowMs(0)).toBe(1500);
    expect(replyWindowMs(1)).toBe(1650);
    expect(replyWindowMs(10)).toBe(3000);
    expect(replyWindowMs(-2)).toBe(1500);
    expect(unseenGraceMs(1)).toBe(2150);
    expect(unseenGraceMs(10)).toBe(3500);
  });
});

describe("createReplyScheduler", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("serves every hello that arrives before the answer goes out with that one answer", () => {
    const send = vi.fn();
    const replies = createReplyScheduler({ send, windowMs: () => 1500, random: () => 0.5 });
    replies.onHello();
    vi.advanceTimersByTime(500);
    replies.onHello();
    replies.onHello();
    vi.advanceTimersByTime(249);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); // 0.5 × 1500 ms after the first hello
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    expect(send).toHaveBeenCalledTimes(1);
    replies.dispose();
  });

  it("answers a hello that arrives after the answer went out again", () => {
    const send = vi.fn();
    const replies = createReplyScheduler({ send, windowMs: () => 1500, random: () => 0.5 });
    replies.onHello();
    vi.advanceTimersByTime(750);
    expect(send).toHaveBeenCalledTimes(1);
    replies.onHello();
    vi.advanceTimersByTime(750);
    expect(send).toHaveBeenCalledTimes(2);
    replies.dispose();
  });

  it("dispose cancels the pending answer and ignores later hellos", () => {
    const send = vi.fn();
    const replies = createReplyScheduler({ send, windowMs: () => 1500, random: () => 0.5 });
    replies.onHello();
    replies.dispose();
    replies.onHello();
    vi.advanceTimersByTime(10_000);
    expect(send).not.toHaveBeenCalled();
  });

  it("picks the delay inside the window when no random source is injected", () => {
    const send = vi.fn();
    const replies = createReplyScheduler({ send, windowMs: () => 1500 });
    replies.onHello();
    vi.advanceTimersByTime(1500);
    expect(send).toHaveBeenCalledTimes(1);
    replies.dispose();
  });

  it("spreads the answer over a window that grows with the world", () => {
    const timers: Array<{ fn: () => void; ms: number }> = [];
    let players = 2;
    const replies = createReplyScheduler({
      send: () => {},
      windowMs: () => replyWindowMs(players),
      random: () => 0.5,
      setTimer: (fn, ms) => timers.push({ fn, ms }),
      clearTimer: () => {},
    });
    replies.onHello();
    timers[0].fn(); // the first answer goes out
    players = 10;
    replies.onHello();
    expect(timers.map((t) => t.ms)).toEqual([900, 1500]); // 0.5 × 1800 ms, 0.5 × 3000 ms
  });
});
