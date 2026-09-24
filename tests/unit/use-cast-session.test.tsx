import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import type { GameCanvasHandle } from "@/components/game/GameCanvas";
import CatchCard from "@/components/game/fishing/CatchCard";
import ReelOverlay from "@/components/game/fishing/ReelOverlay";
import { useCastSession } from "@/hooks/useCastSession";
import type { FinishCast, StartCast } from "@/lib/game/fishing/rpc";
import { parseFishingState } from "@/lib/game/fishing/state";
import type { Interactable } from "@/lib/game/maps/types";

const SPOT: Interactable = {
  id: "fish_1", kind: "fish_spot", label: "Chỗ câu", prompt: "Quăng cần", rect: { x: 0, y: 0, w: 1, h: 1 }, use: { x: 252, y: 204 }, face: "up",
};
const STATE = parseFishingState({ loadout: { rod: "rod_wood", bobber: "bobber_lamp", bait: "bait_worm" } })!;
const answer = (over: Partial<StartCast> = {}): StartCast => ({
  castId: "c1", biteMs: 4000, windowMs: 2500, difficulty: 38, minReelMs: 3520, zonePct: 25, rarity: 3, baitSwitched: false,
  state: STATE, ...over,
});
const FISH = { id: "f1", speciesId: "ca_loc", weightG: 1200, price: 72, rarity: 2 as const };
const withHand = parseFishingState({ fish: [{ id: "f0", species_id: "ca_ro", weight_g: 100, price: 5, caught_at: "x" }] })!;

function setup(start: () => Promise<StartCast | null>, finish: (id: string, ok: boolean) => Promise<FinishCast | null>) {
  const canvas = {
    plant: vi.fn(), setFishing: vi.fn(), landCatch: vi.fn(),
  } as unknown as GameCanvasHandle & { plant: ReturnType<typeof vi.fn>; setFishing: ReturnType<typeof vi.fn>; landCatch: ReturnType<typeof vi.fn> };
  const toasts: string[] = [];
  const startCast = vi.fn(start);
  const finishCast = vi.fn(finish);
  const hook = renderHook(() => useCastSession({ roomId: "r", data: { startCast, finishCast }, canvas: () => canvas, toast: (t) => toasts.push(t) }));
  return { ...hook, canvas, toasts, startCast, finishCast };
}
const phases = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.map((c) => (c[0] as { phase: string }).phase);

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useCastSession", () => {
  it("plants, swings, waits, bites (lamp: glowing, rarity tint), hooks and lands the fish", async () => {
    const s = setup(async () => answer(), async () => ({ result: "caught", fish: FISH, record: true, state: withHand }));
    act(() => s.result.current.cast(SPOT));
    expect(s.canvas.plant).toHaveBeenCalledWith({ x: 252, y: 204 }, "up");
    expect(s.result.current.view.phase).toBe("casting");
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(s.result.current.view.phase).toBe("waiting");
    act(() => s.result.current.hook()); // too early: nothing
    expect(s.result.current.view.phase).toBe("waiting");
    await act(async () => { await vi.advanceTimersByTimeAsync(3400); });
    expect(s.result.current.view.phase).toBe("bite");
    expect(s.canvas.setFishing).toHaveBeenLastCalledWith({ phase: "bite", tint: "#2f80ed", glow: true });
    act(() => s.result.current.hook());
    expect(s.result.current.view).toMatchObject({ phase: "reeling", params: { zonePct: 25, difficulty: 38, minReelMs: 3520 } });
    await act(async () => { s.result.current.reelDone(true); await vi.advanceTimersByTimeAsync(0); });
    expect(s.finishCast).toHaveBeenCalledWith("c1", true);
    expect(s.canvas.landCatch).toHaveBeenCalledWith("ca_loc", 1200, "ca_ro");
    expect(s.result.current.caught).toEqual({ fish: FISH, record: true });
    expect(s.result.current.view.phase).toBe("idle");
    expect(phases(s.canvas.setFishing)).toEqual(["casting", "waiting", "bite", "reeling"]);
  });

  it("hooks a bite only once (a double tap, or Space twice before the re-render)", async () => {
    const s = setup(async () => answer(), async () => null);
    act(() => s.result.current.cast(SPOT));
    await act(async () => { await vi.advanceTimersByTimeAsync(4100); });
    expect(s.result.current.view.phase).toBe("bite");
    const hookAtBite = s.result.current.hook; // what input routed at the bite still calls
    act(() => hookAtBite());
    const first = s.result.current.view;
    const params = "params" in first ? first.params : null;
    expect(params).not.toBeNull();
    act(() => hookAtBite());
    const second = s.result.current.view;
    expect("params" in second ? second.params : null).toBe(params);
    expect(phases(s.canvas.setFishing)).toEqual(["casting", "waiting", "bite", "reeling"]); // one reel start
  });

  it("gives a missed bite up and says so", async () => {
    const s = setup(async () => answer({ rarity: null }), async () => ({ result: "lost", why: "gave_up", state: STATE }));
    act(() => s.result.current.cast(SPOT));
    await act(async () => { await vi.advanceTimersByTimeAsync(4000 + 2500); });
    expect(s.finishCast).toHaveBeenCalledWith("c1", false);
    expect(s.toasts).toEqual(["Cá ăn mồi rồi chạy mất!"]);
    expect(s.canvas.setFishing).toHaveBeenLastCalledWith({ phase: "idle" });
  });

  it("reels in while waiting (the bait is lost)", async () => {
    const s = setup(async () => answer(), async () => ({ result: "lost", why: "gave_up", state: STATE }));
    act(() => s.result.current.cast(SPOT));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    await act(async () => { s.result.current.reelIn(); await vi.advanceTimersByTimeAsync(0); });
    expect(s.finishCast).toHaveBeenCalledWith("c1", false);
    expect(s.toasts).toEqual(["Đã thu cần."]);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(s.finishCast).toHaveBeenCalledTimes(1);
  });

  it("brings the rod back when start_cast is refused, and toasts a bait switch", async () => {
    const r = setup(async () => null, async () => null);
    act(() => r.result.current.cast(SPOT));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(r.result.current.view.phase).toBe("idle");
    expect(r.canvas.setFishing).toHaveBeenLastCalledWith({ phase: "idle" });
    const b = setup(async () => answer({ baitSwitched: true }), async () => null);
    act(() => b.result.current.cast(SPOT));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(b.toasts).toEqual(["Hết mồi đang chọn — dùng trùn đất."]);
  });

  it("explains a won reel the server still refused", async () => {
    const full = setup(async () => answer(), async () => ({ result: "lost", why: "full", state: STATE }));
    act(() => full.result.current.cast(SPOT));
    await act(async () => { await vi.advanceTimersByTimeAsync(4100); });
    act(() => full.result.current.hook());
    await act(async () => { full.result.current.reelDone(true); await vi.advanceTimersByTimeAsync(0); });
    expect(full.toasts).toEqual(["Tay đang cầm cá — ra vựa bán hoặc sắm xô nhé!"]);
    const lost = setup(async () => answer(), async () => ({ result: "lost", why: "gave_up", state: STATE }));
    act(() => lost.result.current.cast(SPOT));
    await act(async () => { await vi.advanceTimersByTimeAsync(4100); });
    act(() => lost.result.current.hook());
    await act(async () => { lost.result.current.reelDone(false); await vi.advanceTimersByTimeAsync(0); });
    expect(lost.finishCast).toHaveBeenCalledWith("c1", false);
    expect(lost.toasts).toEqual(["Cá đã thoát!"]);
  });

  it("gives the cast up quietly when abandoned, even before start_cast answered", async () => {
    let answerNow!: (a: StartCast) => void;
    const s = setup(() => new Promise<StartCast>((r) => { answerNow = r; }), async () => ({ result: "lost", why: "gave_up", state: STATE }));
    act(() => s.result.current.cast(SPOT));
    act(() => s.result.current.abandon());
    expect(s.result.current.view.phase).toBe("idle");
    expect(s.finishCast).not.toHaveBeenCalled();
    await act(async () => { answerNow(answer()); await vi.advanceTimersByTimeAsync(0); });
    expect(s.finishCast).toHaveBeenCalledWith("c1", false);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(s.toasts).toEqual([]);
    expect(s.finishCast).toHaveBeenCalledTimes(1);
  });

  it("gives the cast up when the shell unmounts", async () => {
    const s = setup(async () => answer(), async () => ({ result: "lost", why: "gave_up", state: STATE }));
    act(() => s.result.current.cast(SPOT));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    s.unmount();
    expect(s.finishCast).toHaveBeenCalledWith("c1", false);
  });
});

describe("ReelOverlay", () => {
  it("lets an idle player lose the fish", () => {
    let frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    vi.spyOn(performance, "now").mockReturnValue(0);
    const onDone = vi.fn();
    render(<ReelOverlay params={{ zonePct: 25, difficulty: 15, minReelMs: 2600, seed: 7 }} rarity={null} onDone={onDone} />);
    expect(screen.getByRole("progressbar", { name: "Tiến độ kéo cá" })).toHaveAttribute("aria-valuenow", "30");
    for (let t = 16; t < 60_000 && onDone.mock.calls.length === 0; t += 16) {
      const run = frames;
      frames = [];
      act(() => run.forEach((cb) => cb(t)));
    }
    expect(onDone).toHaveBeenCalledWith(false);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
});

describe("CatchCard", () => {
  it("shows the fish and a new record, and closes by itself after 5 s", () => {
    const onClose = vi.fn();
    render(<CatchCard fish={FISH} name="Cá lóc" record onClose={onClose} />);
    expect(screen.getByText("Cá lóc")).toBeInTheDocument();
    expect(screen.getByText("≈ 72 xu")).toBeInTheDocument();
    expect(screen.getByText("🏆 Kỷ lục mới!")).toBeInTheDocument();
    expect(screen.getByText("Khá")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(4999); });
    expect(onClose).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
