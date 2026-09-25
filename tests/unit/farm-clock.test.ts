import { afterEach, describe, it, expect, vi } from "vitest";
import { clockOffset, serverNow, syncClock } from "@/lib/game/farm/clock";

afterEach(() => {
  syncClock(0, 0);
  vi.useRealTimers();
});

describe("server clock", () => {
  it("keeps the offset between the server's clock and ours", () => {
    syncClock("2026-09-25T10:00:05Z", Date.parse("2026-09-25T10:00:00Z"));
    expect(clockOffset()).toBe(5000);
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-09-25T11:00:00Z"));
    expect(serverNow()).toBe(Date.parse("2026-09-25T11:00:05Z"));
  });
  it("takes ms too, and ignores what it cannot read", () => {
    syncClock(1_000, 4_000);
    expect(clockOffset()).toBe(-3000);
    syncClock("not a time", 0);
    syncClock(null, 0);
    syncClock(undefined, 0);
    expect(clockOffset()).toBe(-3000);
  });
});
