// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { HUNGER_LINES, NAG_AT, NAG_EVERY_MS, NAG_HINT, nagLine, nagNeeds, shouldNag, THIRST_LINES } from "@/lib/game/hunger-nag";
import { useHungerNag } from "@/hooks/useHungerNag";
import type { VitalsState } from "@/lib/game/vitals-rpc";

const vit = (hunger: number, thirst: number, fainted: number | null = null): VitalsState =>
  ({ hunger, thirst, faintedUntilMs: fainted, serverNowMs: 0 });

describe("nag lines", () => {
  it("runs at or below 20 on either bar", () => {
    expect(NAG_AT).toBe(20);
    expect(NAG_EVERY_MS).toBe(10_000);
    expect(shouldNag(vit(21, 21))).toBe(false);
    expect(shouldNag(vit(20, 80))).toBe(true);
    expect(shouldNag(vit(80, 20))).toBe(true);
    expect(shouldNag(null)).toBe(false);
    expect(nagNeeds(vit(5, 5))).toEqual(["hunger", "thirst"]);
    expect(NAG_HINT).toBe("🍜 Ra Chợ Lớn ăn uống");
  });
  it("says hunger first, alternates when both are low, rotates each kind's lines", () => {
    expect(nagLine(vit(50, 50), 0)).toBeNull();
    expect(nagLine(vit(10, 50), 0)).toBe("Đói quá… đi Chợ Lớn ăn thôi!");
    expect(nagLine(vit(10, 50), 1)).toBe(HUNGER_LINES[1]);
    expect(nagLine(vit(10, 50), 2)).toBe(HUNGER_LINES[0]);
    expect(nagLine(vit(50, 10), 0)).toBe("Khát khô cổ… ra Chợ Lớn uống nước thôi!");
    expect([0, 1, 2, 3].map((n) => nagLine(vit(10, 10), n)))
      .toEqual([HUNGER_LINES[0], THIRST_LINES[0], HUNGER_LINES[1], THIRST_LINES[1]]);
    for (const l of [...HUNGER_LINES, ...THIRST_LINES]) expect(l).toMatch(/Chợ Lớn/);
  });
});

describe("useHungerNag", () => {
  afterEach(() => vi.useRealTimers());
  it("nags at once, then every 10 s, and stops above 20", () => {
    vi.useFakeTimers();
    const say = vi.fn();
    const { rerender } = renderHook(({ v, p }) => useHungerNag(v, p, say), { initialProps: { v: vit(15, 80), p: false } });
    expect(say).toHaveBeenCalledTimes(1);
    expect(say).toHaveBeenLastCalledWith(HUNGER_LINES[0]);
    vi.advanceTimersByTime(9_999);
    expect(say).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(say).toHaveBeenCalledTimes(2);
    rerender({ v: vit(60, 80), p: false });
    vi.advanceTimersByTime(30_000);
    expect(say).toHaveBeenCalledTimes(2);
  });
  it("stays quiet while paused (a panel / minigame) or fainted", () => {
    vi.useFakeTimers();
    const say = vi.fn();
    const { rerender } = renderHook(({ v, p }) => useHungerNag(v, p, say), { initialProps: { v: vit(10, 10), p: true } });
    vi.advanceTimersByTime(30_000);
    expect(say).not.toHaveBeenCalled();
    rerender({ v: vit(0, 0, 5_000), p: false });
    vi.advanceTimersByTime(30_000);
    expect(say).not.toHaveBeenCalled();
    rerender({ v: vit(10, 10), p: false });
    expect(say).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    expect(say).toHaveBeenLastCalledWith(THIRST_LINES[0]);
  });
});
