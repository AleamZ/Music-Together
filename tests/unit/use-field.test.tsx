import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { clockOffset } from "@/lib/game/farm/clock";
import { parseFarmMine, parseFieldState, type FieldState } from "@/lib/game/farm/state";

const rpc = vi.hoisted(() => ({
  fetchFieldState: vi.fn(), fetchFarmCatalog: vi.fn(), fieldAction: vi.fn(), sellRice: vi.fn(), buyFarmItem: vi.fn(),
  claimFarmGift: vi.fn(),
}));
vi.mock("@/lib/game/farm/rpc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/game/farm/rpc")>()),
  ...rpc,
}));

import { FP_GATHER_MS, useField } from "@/hooks/useField";

const NOW = "2026-09-25T10:00:00+00:00";
const field = (coins: number, serverNow = NOW): FieldState => parseFieldState({
  server_now: serverNow,
  plots: [{ no: 1, kind: "private", owner: null, sale_price: null, sublease_price: null, farmer: null, lease: null, offers: 0, crop: null }],
  drying: [],
  mine: { items: {}, rice: {}, coins, gift_claimed: false, owned_plot: null, farming: [], my_offers: [], incoming_offers: [] },
})!;
const CATALOG = { varieties: [], items: [] };
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse(NOW) - 60_000); // this client runs a minute behind the server
  for (const f of Object.values(rpc)) f.mockReset();
  rpc.fetchFieldState.mockResolvedValue(field(100));
  rpc.fetchFarmCatalog.mockResolvedValue(CATALOG);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useField", () => {
  it("fetches the field and the catalog only while I am on the field, and sets the clock", async () => {
    const { result, rerender } = renderHook(({ active }) => useField("r", "tok", active, () => {}), { initialProps: { active: false } });
    await flush();
    expect(rpc.fetchFieldState).not.toHaveBeenCalled();
    rerender({ active: true });
    await flush();
    expect(rpc.fetchFieldState).toHaveBeenCalledWith("r", "tok");
    expect(result.current.state?.mine.coins).toBe(100);
    expect(result.current.catalog).toEqual(CATALOG);
    expect(clockOffset()).toBe(60_000);
  });

  it("marks a failed load, and a missing migration as not open", async () => {
    rpc.fetchFieldState.mockRejectedValueOnce(new Error("down"));
    const { result } = renderHook(() => useField("r", "tok", true, () => {}));
    await flush();
    expect(result.current).toMatchObject({ state: null, failed: true, notOpen: false });
    rpc.fetchFieldState.mockRejectedValueOnce({ code: "PGRST202", message: "Could not find the function public.field_state" });
    await act(async () => { await result.current.reload(); });
    expect(result.current.notOpen).toBe(true);
    await act(async () => { await result.current.reload(); });
    expect(result.current).toMatchObject({ failed: false, notOpen: false, state: { mine: { coins: 100 } } });
  });

  it("offers the reload while the catalog has not loaded, and fetches it again with the next reload", async () => {
    rpc.fetchFarmCatalog.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { result } = renderHook(() => useField("r", "tok", true, () => {}));
    await flush();
    expect(result.current).toMatchObject({ catalog: null, failed: true, state: { mine: { coins: 100 } } });
    rpc.fieldAction.mockResolvedValueOnce({ state: field(90), harvest: null });
    await act(async () => { await result.current.run({ kind: "rent", plot: 5 }); });
    expect(result.current.failed).toBe(true); // a field answer does not bring the catalog
    await act(async () => { await result.current.reload(); });
    expect(result.current).toMatchObject({ catalog: CATALOG, failed: false });
    expect(rpc.fetchFarmCatalog).toHaveBeenCalledTimes(2);
  });

  it("applies an action's answer; on error it toasts the Vietnamese text and fetches again", async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useField("r", "tok", true, onError));
    await flush();
    rpc.fieldAction.mockResolvedValueOnce({ state: field(50), harvest: null });
    await act(async () => { await result.current.run({ kind: "rent", plot: 5 }); });
    expect(rpc.fieldAction).toHaveBeenCalledWith("r", "tok", { kind: "rent", plot: 5 });
    expect(result.current.state?.mine.coins).toBe(50);
    rpc.fieldAction.mockRejectedValueOnce({ message: "not enough coins" });
    rpc.fetchFieldState.mockResolvedValueOnce(field(7));
    let answer: unknown = "unset";
    await act(async () => { answer = await result.current.run({ kind: "buy_plot", plot: 1 }); });
    expect(answer).toBeNull();
    expect(onError).toHaveBeenCalledWith("Không đủ xu.");
    await flush();
    expect(result.current.state?.mine.coins).toBe(7);
  });

  it("keeps the newest answer when answers overtake each other", async () => {
    const { result } = renderHook(() => useField("r", "tok", true, () => {}));
    await flush();
    let slow!: (s: FieldState) => void;
    rpc.fetchFieldState.mockReturnValueOnce(new Promise((resolve) => { slow = resolve; }));
    let reloading!: Promise<unknown>;
    act(() => { reloading = result.current.reload(); });
    rpc.fieldAction.mockResolvedValueOnce({ state: field(300), harvest: null });
    await act(async () => { await result.current.run({ kind: "prepare", plot: 1 }); });
    await act(async () => { slow(field(1)); await reloading; });
    expect(result.current.state?.mine.coins).toBe(300);
  });

  it("keeps a field answer that an account answer overtook, with the newer account part", async () => {
    const { result } = renderHook(() => useField("r", "tok", true, () => {}));
    await flush();
    let slow!: (s: FieldState) => void;
    rpc.fetchFieldState.mockReturnValueOnce(new Promise((resolve) => { slow = resolve; }));
    let reloading!: Promise<unknown>;
    act(() => { reloading = result.current.reload(); }); // an fp's refetch, waiting behind the plot locks
    rpc.buyFarmItem.mockResolvedValueOnce({ serverNow: NOW, mine: parseFarmMine({ items: { urea: 2 }, coins: 60 })! });
    await act(async () => { await result.current.buyItem("urea", 2); });
    const planted = field(100);
    planted.plots[0] = { ...planted.plots[0], farmer: { id: "lan", name: "Lan" } };
    await act(async () => { slow(planted); await reloading; });
    expect(result.current.state?.plots[0].farmer).toEqual({ id: "lan", name: "Lan" });
    expect(result.current.state?.mine).toMatchObject({ coins: 60, items: { urea: 2 } });
  });

  it("shows the first field, or its failure, even when an account answer overtook it", async () => {
    let answer!: { resolve: (s: FieldState) => void; reject: (e: unknown) => void };
    const pending = () => new Promise<FieldState>((resolve, reject) => { answer = { resolve, reject }; });
    rpc.fetchFieldState.mockReturnValueOnce(pending());
    const { result } = renderHook(() => useField("r", "tok", true, () => {}));
    await flush();
    rpc.claimFarmGift.mockResolvedValueOnce({ serverNow: NOW, mine: parseFarmMine({ coins: 1100, gift_claimed: true })!, gifted: true });
    await act(async () => { await result.current.claimGift(); });
    await act(async () => { answer.reject(new Error("down")); await vi.advanceTimersByTimeAsync(0); });
    expect(result.current).toMatchObject({ state: null, failed: true });
    rpc.fetchFieldState.mockReturnValueOnce(pending());
    let reloading!: Promise<unknown>;
    act(() => { reloading = result.current.reload(); });
    rpc.buyFarmItem.mockResolvedValueOnce({ serverNow: NOW, mine: parseFarmMine({ items: { urea: 1 }, coins: 1050, gift_claimed: true })! });
    await act(async () => { await result.current.buyItem("urea", 1); });
    await act(async () => { answer.resolve(field(100)); await reloading; });
    expect(result.current).toMatchObject({ failed: false, state: { mine: { coins: 1050, items: { urea: 1 }, giftClaimed: true } } });
  });

  it("puts the account part of sell_rice, buy_farm_item and claim_farm_gift into the field", async () => {
    const { result } = renderHook(() => useField("r", "tok", true, () => {}));
    await flush();
    const mine = parseFarmMine({ items: { seed_nep: 3 }, rice: { nep: { wet: 0, dry: 10 } }, coins: 420, gift_claimed: true })!;
    rpc.sellRice.mockResolvedValueOnce({ serverNow: NOW, mine });
    await act(async () => { await result.current.sellRice("nep", true, 50); });
    expect(rpc.sellRice).toHaveBeenCalledWith("tok", "nep", true, 50);
    expect(result.current.state?.mine).toMatchObject({ coins: 420, items: { seed_nep: 3 }, giftClaimed: true, farming: [] });
    rpc.claimFarmGift.mockResolvedValueOnce({ serverNow: NOW, mine, gifted: false });
    let gift: unknown;
    await act(async () => { gift = await result.current.claimGift(); });
    expect(gift).toMatchObject({ gifted: false });
  });

  it("answers a burst of fp with one refetch", async () => {
    const { result } = renderHook(() => useField("r", "tok", true, () => {}));
    await flush();
    rpc.fetchFieldState.mockClear();
    act(() => {
      result.current.plotChanged();
      result.current.plotChanged();
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(FP_GATHER_MS - 1); });
    act(() => result.current.plotChanged());
    expect(rpc.fetchFieldState).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(rpc.fetchFieldState).toHaveBeenCalledTimes(1);
  });
});
