import { describe, it, expect } from "vitest";
import { needsResync, shouldPlay, targetSeconds } from "@/lib/playback-sync";

const NOW = 1_700_000_000_000;
const playing = (startedAgoMs: number) => ({ is_playing: true, started_at: new Date(NOW - startedAgoMs).toISOString(), paused_elapsed_ms: 0 });
const paused = (elapsedMs: number) => ({ is_playing: false, started_at: null, paused_elapsed_ms: elapsedMs });

describe("targetSeconds", () => {
  it("is the wall-clock elapsed time while playing, floored to seconds", () => {
    expect(targetSeconds(playing(65_400), NOW)).toBe(65);
    expect(targetSeconds(playing(999), NOW)).toBe(0);
  });
  it("is the frozen paused position while paused", () => {
    expect(targetSeconds(paused(12_999), NOW)).toBe(12);
    expect(targetSeconds(paused(0), NOW)).toBe(0);
  });
  it("never goes negative (started_at slightly in the future from clock skew)", () => {
    expect(targetSeconds(playing(-5_000), NOW)).toBe(0);
  });
  it("treats a playing room without started_at as paused at paused_elapsed_ms", () => {
    expect(targetSeconds({ is_playing: true, started_at: null, paused_elapsed_ms: 30_000 }, NOW)).toBe(30);
  });
});

describe("needsResync", () => {
  it("is false within the 2 s default tolerance (inclusive) and true beyond it", () => {
    expect(needsResync(65, playing(65_400), NOW)).toBe(false);
    expect(needsResync(63, playing(65_400), NOW)).toBe(false);
    expect(needsResync(67, playing(65_400), NOW)).toBe(false);
    expect(needsResync(62, playing(65_400), NOW)).toBe(true);
    expect(needsResync(70, playing(65_400), NOW)).toBe(true);
  });
  it("honours a custom tolerance", () => {
    expect(needsResync(64, playing(65_400), NOW, 0.5)).toBe(true);
    expect(needsResync(64, playing(65_400), NOW, 5)).toBe(false);
  });
  it("compares against the paused position while paused", () => {
    expect(needsResync(12, paused(12_000), NOW)).toBe(false);
    expect(needsResync(30, paused(12_000), NOW)).toBe(true);
  });
});

describe("shouldPlay", () => {
  it("plays only when the room plays, the device is unlocked and there is a track", () => {
    expect(shouldPlay({ is_playing: true }, true, true)).toBe(true);
    expect(shouldPlay({ is_playing: false }, true, true)).toBe(false);
    expect(shouldPlay({ is_playing: true }, false, true)).toBe(false);
    expect(shouldPlay({ is_playing: true }, true, false)).toBe(false);
  });
});
