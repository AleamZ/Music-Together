import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { GameCanvasHandle } from "@/components/game/GameCanvas";
import { AnticheatError, subscribeAnticheat, type AnticheatEvent, type AnticheatInfo } from "@/lib/anticheat";
import { clockOffset, serverNow } from "@/lib/game/farm/clock";
import { parseFishingState, type FishingState } from "@/lib/game/fishing/state";
import type { QueueItem } from "@/lib/supabase";

const rpc = vi.hoisted(() => ({
  fetchFishingState: vi.fn(), fetchFishingCatalog: vi.fn(), claimDaily: vi.fn(), digWorms: vi.fn(), buyItem: vi.fn(),
  setLoadout: vi.fn(), sellFish: vi.fn(), releaseFish: vi.fn(), startCast: vi.fn(), finishCast: vi.fn(),
}));
vi.mock("@/lib/game/fishing/rpc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/game/fishing/rpc")>()),
  ...rpc,
}));

import { useFishing } from "@/hooks/useFishing";
import { useFishingController } from "@/hooks/useFishingController";

const state = (over: Record<string, unknown> = {}): FishingState => parseFishingState({ coins: 50, bait: { bait_worm: 3 }, ...over })!;
const CATALOG = { species: [{ id: "ca_ro", name: "Cá rô đồng", rarity: 1, minG: 50, maxG: 300, pricePerKg: 45, difficulty: 15, sortOrder: 10 }], items: [] };
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const song = (id: string, by: string | null): QueueItem => ({
  id, room_id: "r", youtube_video_id: "v", title: "t", thumbnail_url: null, duration_seconds: 120,
  added_by_account_id: by, added_by_name: "x", position: 0, created_at: "", status: "approved",
});

beforeEach(() => {
  vi.useFakeTimers();
  for (const f of Object.values(rpc)) f.mockReset();
  rpc.fetchFishingState.mockResolvedValue(state());
  rpc.fetchFishingCatalog.mockResolvedValue(CATALOG);
  rpc.claimDaily.mockResolvedValue({ claimed: false, amount: 0, state: state() });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useFishing", () => {
  it("loads the state and the catalog", async () => {
    const { result } = renderHook(() => useFishing("tok", () => {}));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.state?.coins).toBe(50);
    expect(result.current.catalog?.species[0].id).toBe("ca_ro");
    expect(result.current.failed).toBe(false);
  });

  it("sets the shared server clock from the state's server_now (v15 §11.6)", async () => {
    rpc.fetchFishingState.mockResolvedValue(state({ server_now: new Date(Date.now() + 90_000).toISOString() }));
    renderHook(() => useFishing("tok", () => {}));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(Math.abs(clockOffset() - 90_000)).toBeLessThan(1000);
  });

  it("marks a failed load so the HUD can offer a reload", async () => {
    rpc.fetchFishingState.mockRejectedValue(new Error("down"));
    const { result } = renderHook(() => useFishing("tok", () => {}));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.state).toBeNull();
    expect(result.current.failed).toBe(true);
    rpc.fetchFishingState.mockResolvedValue(state({ coins: 7 }));
    await act(async () => { await result.current.reload(); });
    expect(result.current).toMatchObject({ failed: false, state: { coins: 7 } });
  });

  it("fetches a failed catalog again on the next reload, and only until it has loaded", async () => {
    rpc.fetchFishingCatalog.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { result } = renderHook(() => useFishing("tok", () => {}));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.catalog).toBeNull();
    expect(rpc.fetchFishingCatalog).toHaveBeenCalledTimes(1);
    await act(async () => { await result.current.reload(); });
    expect(result.current.catalog?.species[0].id).toBe("ca_ro");
    expect(rpc.fetchFishingCatalog).toHaveBeenCalledTimes(2);
    await act(async () => { await result.current.reload(); });
    expect(rpc.fetchFishingCatalog).toHaveBeenCalledTimes(2);
  });

  it("replaces the state with each answer, and on an error toasts and fetches again", async () => {
    const errors: string[] = [];
    const { result } = renderHook(() => useFishing("tok", (t) => errors.push(t)));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    rpc.buyItem.mockResolvedValue(state({ coins: 45, bait: { bait_worm: 3, bait_shrimp: 1 } }));
    await act(async () => { expect(await result.current.buy("bait_shrimp", 1)).toBe(true); });
    expect(result.current.state?.coins).toBe(45);
    rpc.buyItem.mockRejectedValue({ message: "not enough coins" });
    rpc.fetchFishingState.mockResolvedValue(state({ coins: 44 }));
    await act(async () => { expect(await result.current.buy("rod_carbon", 1)).toBe(false); });
    await flush();
    expect(errors).toEqual(["Không đủ xu."]);
    expect(result.current.state?.coins).toBe(44);
  });

  it("shows no toast for a strike, which the modal shows instead, but fetches again (anti-cheat §12.1)", async () => {
    const errors: string[] = [];
    const { result } = renderHook(() => useFishing("tok", (t) => errors.push(t)));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const info = (strike: 0 | 1 | 2): AnticheatInfo => ({
      code: "bad_qty", strike, error: "invalid quantity", lockedUntil: null, banned: strike === 2, serverNow: null,
    });
    rpc.fetchFishingState.mockClear();
    rpc.buyItem.mockRejectedValueOnce(new AnticheatError(info(1)));
    await act(async () => { expect(await result.current.buy("bait_shrimp", 500)).toBe(false); });
    rpc.buyItem.mockRejectedValueOnce(new AnticheatError(info(2)));
    await act(async () => { expect(await result.current.buy("bait_shrimp", 500)).toBe(false); });
    await flush();
    expect(errors).toEqual([]);
    expect(rpc.fetchFishingState).toHaveBeenCalledTimes(2);
    rpc.buyItem.mockRejectedValueOnce(new AnticheatError(info(0)));
    await act(async () => { await result.current.buy("bait_shrimp", 500); });
    expect(errors).toEqual(["Món này không mua được."]);
  });

  it("reports the running lock a state carries (anti-cheat R14)", async () => {
    const events: AnticheatEvent[] = [];
    const off = subscribeAnticheat((e) => events.push(e));
    rpc.fetchFishingState.mockResolvedValue(state({ lock: { until: "2026-10-02T10:20:00+00:00", code: "bad_plot" } }));
    renderHook(() => useFishing("tok", () => {}));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    off();
    expect(events).toEqual([{ kind: "lock", until: Date.parse("2026-10-02T10:20:00Z"), code: "bad_plot" }]);
  });

  it("says the fish got away when finish_cast fails on the network", async () => {
    const errors: string[] = [];
    const { result } = renderHook(() => useFishing("tok", (t) => errors.push(t)));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    rpc.finishCast.mockRejectedValue(new TypeError("Failed to fetch"));
    await act(async () => { expect(await result.current.finishCast("c1", true)).toBeNull(); });
    expect(errors).toEqual(["Mất kết nối — cá đã thoát."]);
  });

  it("ignores an answer that was overtaken by a newer one", async () => {
    const { result } = renderHook(() => useFishing("tok", () => {}));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    let slow!: (s: FishingState) => void;
    rpc.fetchFishingState.mockReturnValue(new Promise<FishingState>((r) => { slow = r; }));
    rpc.releaseFish.mockResolvedValue(state({ coins: 99 }));
    let reloading!: Promise<unknown>;
    act(() => { reloading = result.current.reload(); });
    await act(async () => { await result.current.release("f1"); });
    await act(async () => { slow(state({ coins: 1 })); await reloading; });
    expect(result.current.state?.coins).toBe(99);
  });
});

describe("useFishingController", () => {
  const spies = { setSpecies: vi.fn(), setHand: vi.fn(), puff: vi.fn() };
  const canvas = spies as unknown as GameCanvasHandle;
  beforeEach(() => {
    for (const f of Object.values(spies)) f.mockClear();
  });
  const setup = (current: QueueItem | null = null) => {
    const toasts: string[] = [];
    const hook = renderHook((p: { current: QueueItem | null }) => useFishingController({
      token: "tok", roomId: "r", accountId: "me", canvas: () => canvas, current: p.current, toast: (t) => toasts.push(t),
    }), { initialProps: { current } });
    return { ...hook, toasts };
  };

  it("claims the daily bonus once and toasts only when it paid", async () => {
    rpc.claimDaily.mockResolvedValue({ claimed: true, amount: 20, state: state({ coins: 70 }) });
    const { toasts } = setup();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(rpc.claimDaily).toHaveBeenCalledTimes(1);
    expect(toasts).toEqual(["🪙 Điểm danh hôm nay: +20 xu"]);
  });

  it("waits for the first state before claiming, so the claimed coins are the ones kept", async () => {
    let loadState!: (s: FishingState) => void;
    rpc.fetchFishingState.mockReturnValue(new Promise<FishingState>((r) => { loadState = r; }));
    rpc.claimDaily.mockResolvedValue({ claimed: true, amount: 20, state: state({ coins: 120 }) });
    const { result, toasts } = setup();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(rpc.fetchFishingState).toHaveBeenCalledTimes(1);
    expect(rpc.claimDaily).not.toHaveBeenCalled();
    await act(async () => { loadState(state({ coins: 100 })); await vi.advanceTimersByTimeAsync(0); });
    expect(rpc.claimDaily).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(rpc.claimDaily).toHaveBeenCalledTimes(1);
    expect(result.current.data.state?.coins).toBe(120);
    expect(toasts).toEqual(["🪙 Điểm danh hôm nay: +20 xu"]);
  });

  it("hands the species names and my hand fish to the canvas", async () => {
    rpc.fetchFishingState.mockResolvedValue(state({ fish: [{ id: "f1", species_id: "ca_ro", weight_g: 120, price: 5, caught_at: "x" }] }));
    rpc.claimDaily.mockResolvedValue({ claimed: false, amount: 0, state: state({ fish: [{ id: "f1", species_id: "ca_ro", weight_g: 120, price: 5, caught_at: "x" }] }) });
    setup();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(canvas.setSpecies).toHaveBeenCalledWith([{ id: "ca_ro", name: "Cá rô đồng", rarity: 1 }]);
    expect(canvas.setHand).toHaveBeenLastCalledWith("ca_ro");
  });

  it("toasts the song bonus when my song stopped playing and the coins went up by 10", async () => {
    const { rerender, toasts } = setup(song("s1", "me"));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    rpc.fetchFishingState.mockResolvedValue(state({ coins: 60 }));
    rerender({ current: song("s2", "other") });
    await act(async () => { await vi.advanceTimersByTimeAsync(1499); });
    expect(toasts).toEqual([]);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(toasts).toEqual(["🎵 Bài bạn gọi đã phát xong: +10 xu"]);
    // someone else's song ending checks nothing
    rpc.fetchFishingState.mockClear();
    rerender({ current: song("s3", "other") });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(rpc.fetchFishingState).not.toHaveBeenCalled();
  });

  it("digs after a second of dust, and refuses during the cooldown or with a full bait box", async () => {
    rpc.digWorms.mockResolvedValue({ gained: 2, state: state({ bait: { bait_worm: 5 }, dig_ready_at: "2099-01-01T00:00:00Z" }) });
    const { result, toasts } = setup();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const mound = { id: "dig_1", kind: "dig_spot" as const, label: "x", prompt: "Đào trùn", rect: { x: 0, y: 0, w: 1, h: 1 }, use: { x: 56, y: 184 } };
    act(() => { expect(result.current.interact(mound)).toBe(true); });
    expect(canvas.puff).toHaveBeenCalledWith({ x: 56, y: 172 });
    expect(rpc.digWorms).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(toasts).toEqual(["🪱 Đào được 2 trùn đất!"]);
    act(() => { result.current.interact(mound); });
    expect(toasts.at(-1)).toMatch(/^Đất còn cứng, chờ \d+ giây nữa nhé\.$/);
    expect(result.current.interact({ ...mound, kind: "portal" })).toBe(false);
  });

  it("shows the daily cap at a fishing spot until the day turns (anti-cheat §12.4)", async () => {
    const capped = () => state({ casts_today_left: 0, day_resets_at: new Date(serverNow() + 5000).toISOString() });
    const first = capped();
    rpc.fetchFishingState.mockResolvedValue(first);
    rpc.claimDaily.mockResolvedValue({ claimed: false, amount: 0, state: first });
    const { result } = setup();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const spot = { id: "fish_1", kind: "fish_spot" as const, label: "x", prompt: "Quăng cần", rect: { x: 0, y: 0, w: 1, h: 1 }, use: { x: 0, y: 0 } };
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(result.current.promptText(spot)).toBe("Hết lượt câu hôm nay");
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(result.current.promptText(spot)).toBe("Quăng cần");
  });

  it("does not dig into a full bait box", async () => {
    rpc.fetchFishingState.mockResolvedValue(state({ bait: { bait_worm: 20 } }));
    rpc.claimDaily.mockResolvedValue({ claimed: false, amount: 0, state: state({ bait: { bait_worm: 20 } }) });
    const { result, toasts } = setup();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    act(() => { result.current.interact({ id: "dig_1", kind: "dig_spot", label: "x", prompt: "Đào trùn", rect: { x: 0, y: 0, w: 1, h: 1 }, use: { x: 56, y: 184 } }); });
    expect(toasts).toEqual(["Hộp mồi đầy rồi."]);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(rpc.digWorms).not.toHaveBeenCalled();
  });
});
