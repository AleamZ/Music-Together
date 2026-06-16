import { describe, it, expect, afterEach, vi } from "vitest";
import { computeElapsedMs } from "@/lib/identity";

describe("computeElapsedMs", () => {
  afterEach(() => vi.useRealTimers());

  it("returns paused elapsed when not playing", () => {
    expect(computeElapsedMs({ is_playing: false, started_at: null, paused_elapsed_ms: 4200 })).toBe(4200);
  });

  it("derives elapsed from started_at when playing", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-16T00:00:10.000Z"));
    const startedAt = "2026-06-16T00:00:00.000Z";
    expect(computeElapsedMs({ is_playing: true, started_at: startedAt, paused_elapsed_ms: 0 })).toBe(10_000);
  });
});
