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
