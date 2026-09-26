import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { AnticheatError, type AnticheatInfo } from "@/lib/anticheat";
import { clockOffset } from "@/lib/game/farm/clock";
import { NOT_OPEN_152, NOT_OPEN_17 } from "@/lib/game/farm/messages";
import { parseFarmMine, parseFieldState, type FieldState } from "@/lib/game/farm/state";

const rpc = vi.hoisted(() => ({
  fetchFieldState: vi.fn(), fetchFarmCatalog: vi.fn(), fieldAction: vi.fn(), sellRice: vi.fn(), buyFarmItem: vi.fn(),
  claimFarmGift: vi.fn(), loadSprayer: vi.fn(), sellProduce: vi.fn(),
  slingStart: vi.fn(), slingShoot: vi.fn(), dogHunt: vi.fn(), sellRats: vi.fn(),
}));
vi.mock("@/lib/game/farm/rpc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/game/farm/rpc")>()),
  ...rpc,
}));

import { FP_GATHER_MS, FP_MIN_GAP_MS, RAT_REFETCH_MIN_MS, useField } from "@/hooks/useField";

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

  it("shows no toast for a strike but fetches again; a strike-0 envelope toasts its refusal (anti-cheat §12.1)", async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useField("r", "tok", true, onError));
    await flush();
    rpc.fetchFieldState.mockClear();
    const info = (strike: 0 | 1 | 2, error: string): AnticheatInfo => ({
      code: "bad_plot", strike, error, lockedUntil: null, banned: strike === 2, serverNow: null,
    });
    rpc.fieldAction.mockRejectedValueOnce(new AnticheatError(info(1, "invalid plot")));
    await act(async () => { expect(await result.current.run({ kind: "rent", plot: 11 })).toBeNull(); });
    rpc.buyFarmItem.mockRejectedValueOnce(new AnticheatError(info(2, "invalid quantity")));
    await act(async () => { expect(await result.current.buyItem("fert_urea", 100)).toBeNull(); });
    await flush();
    expect(onError).not.toHaveBeenCalled();
    expect(rpc.fetchFieldState).toHaveBeenCalledTimes(2);
    rpc.fieldAction.mockRejectedValueOnce(new AnticheatError(info(0, "invalid price")));
    await act(async () => { await result.current.run({ kind: "list", plot: 1, price: 0 }); });
    expect(onError).toHaveBeenCalledWith("Số không hợp lệ.");
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

  it("starts fp refetches at least 2 s apart, with one trailing refetch (anti-cheat R35)", async () => {
    const { result } = renderHook(() => useField("r", "tok", true, () => {}));
    await flush();
    rpc.fetchFieldState.mockClear();
    // 10 fp in a second: one refetch 400 ms after the first, one more 2 s after that
    for (let i = 0; i < 10; i++) {
      act(() => result.current.plotChanged());
      await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    }
    expect(rpc.fetchFieldState).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(FP_GATHER_MS + FP_MIN_GAP_MS - 1000 - 1); });
    expect(rpc.fetchFieldState).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(rpc.fetchFieldState).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(rpc.fetchFieldState).toHaveBeenCalledTimes(2);
    // a lone fp later is gathered for 400 ms, as before
    act(() => result.current.plotChanged());
    await act(async () => { await vi.advanceTimersByTimeAsync(FP_GATHER_MS); });
    expect(rpc.fetchFieldState).toHaveBeenCalledTimes(3);
  });
});

describe("useField, v15.2", () => {
  it("loads the sprayer and sells hoa màu into the field's account part", async () => {
    const { result } = renderHook(() => useField("r", "tok", true, () => {}));
    await flush();
    rpc.loadSprayer.mockResolvedValueOnce({ serverNow: NOW, mine: parseFarmMine({ coins: 100, tank: { item: "spray_insect", charges: 3 } })! });
    await act(async () => { await result.current.loadSprayer("spray_insect", "Thuốc trừ sâu"); });
    expect(rpc.loadSprayer).toHaveBeenCalledWith("tok", "spray_insect");
    expect(result.current.state?.mine.tank).toEqual({ item: "spray_insect", charges: 3 });
    rpc.sellProduce.mockResolvedValueOnce({ serverNow: NOW, mine: parseFarmMine({ coins: 47_800, produce: {} })! });
    await act(async () => { await result.current.sellProduce("khoai", 180); });
    expect(rpc.sellProduce).toHaveBeenCalledWith("tok", "khoai", 180);
    expect(result.current.state?.mine.coins).toBe(47_800);
  });

  it("reads a harvest round's refusals in its own words, and hands them to the round instead of the toast", async () => {
    const onError = vi.fn(), onRound = vi.fn();
    const { result } = renderHook(() => useField("r", "tok", true, onError));
    await flush();
    rpc.fieldAction.mockRejectedValueOnce({ message: "too fast" });
    await act(async () => { await result.current.run({ kind: "harvest_part", plot: 5, success: true }, undefined, onRound); });
    rpc.fieldAction.mockRejectedValueOnce({ message: "not your plot" });
    await act(async () => { await result.current.run({ kind: "harvest_part", plot: 5, success: true }, undefined, onRound); });
    expect(onRound.mock.calls).toEqual([["Chưa xong bó lúa — thử lại sau vài giây."], ["Hết hạn thuê — phần lúa chưa gặt đã mất."]]);
    expect(onError).not.toHaveBeenCalled();
    rpc.fieldAction.mockRejectedValueOnce({ message: "too fast" });
    await act(async () => { await result.current.run({ kind: "water", plot: 5, delta: 1 }); });
    expect(onError).toHaveBeenCalledWith("Từ từ thôi…");
  });

  it("says a v15.2 call waits for 0016 and leaves the field open; a missing v15 call still closes it", async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useField("r", "tok", true, onError));
    await flush();
    rpc.fetchFieldState.mockReturnValue(new Promise(() => {})); // the refetches after the errors never answer
    const missing = (fn: string) => ({ code: "PGRST202", message: `Could not find the function public.${fn}` });
    rpc.fieldAction.mockRejectedValueOnce(missing("prepare_beds"));
    await act(async () => { await result.current.run({ kind: "prepare_beds", plot: 5 }); });
    rpc.sellProduce.mockRejectedValueOnce(missing("sell_produce"));
    await act(async () => { await result.current.sellProduce("khoai", 1); });
    expect(onError.mock.calls).toEqual([[NOT_OPEN_152], [NOT_OPEN_152]]);
    expect(result.current.notOpen).toBe(false);
    rpc.fieldAction.mockRejectedValueOnce(missing("prepare_plot"));
    await act(async () => { await result.current.run({ kind: "prepare", plot: 5 }); });
    expect(result.current.notOpen).toBe(true);
  });
});

describe("useField, v17", () => {
  const at = (s: number) => new Date(Date.parse(NOW) + s * 1000).toISOString();
  /** A field with rats: next_at `nextS` seconds after NOW, and the live rats given. */
  const ratField = (nextS: number, live: unknown[] = [], serverNow = NOW): FieldState => parseFieldState({
    server_now: serverNow,
    plots: [{ no: 5, kind: "village", owner: null, sale_price: null, sublease_price: null, farmer: null, lease: null, offers: 0, crop: null }],
    drying: [],
    mine: { items: {}, rice: {}, coins: 10, gift_claimed: true },
    rats: { next_at: at(nextS), price: 150, live, recent: [], plots: {} },
  })!;
  const RAT = { id: 1, plot: 5, since: NOW, seed: 1 };

  it("aims, shoots, pounces and sells, applying their answers", async () => {
    const { result } = renderHook(() => useField("r", "tok", true, () => {}));
    await flush();
    rpc.slingStart.mockResolvedValueOnce({ state: field(40), aim: { rat: 1, startedAt: 5 } });
    await act(async () => { expect(await result.current.slingStart(1)).toMatchObject({ aim: { rat: 1 } }); });
    expect(rpc.slingStart).toHaveBeenCalledWith("r", "tok", 1);
    expect(result.current.state?.mine.coins).toBe(40);
    rpc.slingShoot.mockResolvedValueOnce({ state: field(41), shot: { hit: true, price: 336, pellets: 9 } });
    await act(async () => { await result.current.slingShoot(1, true); });
    expect(rpc.slingShoot).toHaveBeenCalledWith("r", "tok", 1, true);
    expect(result.current.state?.mine.coins).toBe(41);
    rpc.dogHunt.mockResolvedValueOnce({ state: field(42), price: 169 });
    await act(async () => { expect(await result.current.dogHunt(1)).toMatchObject({ price: 169 }); });
    expect(rpc.dogHunt).toHaveBeenCalledWith("r", "tok", 1);
    rpc.sellRats.mockResolvedValueOnce({ serverNow: NOW, mine: parseFarmMine({ coins: 528 })!, sold: { count: 3, xu: 486 } });
    await act(async () => { expect(await result.current.sellRats()).toMatchObject({ sold: { count: 3, xu: 486 } }); });
    expect(rpc.sellRats).toHaveBeenCalledWith("tok");
    expect(result.current.state?.mine.coins).toBe(528);
  });

  it("reads the ná's refusals in the SlingGame's words and hands them to it; a hunt's go to its own handler", async () => {
    const onError = vi.fn(), onGame = vi.fn(), onHunt = vi.fn();
    const { result } = renderHook(() => useField("r", "tok", true, onError));
    await flush();
    rpc.slingShoot.mockRejectedValueOnce({ message: "too fast" });
    await act(async () => { expect(await result.current.slingShoot(1, false, onGame)).toBeNull(); });
    rpc.slingStart.mockRejectedValueOnce({ message: "rat gone" });
    await act(async () => { await result.current.slingStart(1, onGame); });
    expect(onGame.mock.calls).toEqual([["Đang nạp đạn…"], ["Con chuột này không còn nữa."]]);
    rpc.dogHunt.mockRejectedValueOnce({ message: "dog resting", details: "192" });
    await act(async () => { await result.current.dogHunt(1, onHunt); });
    expect(onHunt).toHaveBeenCalledWith("Chó đang nghỉ — 3 phút 12 giây nữa mới vồ tiếp.");
    expect(onError).not.toHaveBeenCalled();
    rpc.sellRats.mockRejectedValueOnce({ message: "nothing to sell" });
    await act(async () => { await result.current.sellRats(); });
    expect(onError).toHaveBeenCalledWith("Chưa có con chuột nào để bán.");
  });

  it("says a v17 call waits for 0019 and leaves the field open", async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useField("r", "tok", true, onError));
    await flush();
    rpc.fetchFieldState.mockReturnValue(new Promise(() => {}));
    rpc.sellRats.mockRejectedValueOnce({ code: "PGRST202", message: "Could not find the function public.sell_rats" });
    await act(async () => { await result.current.sellRats(); });
    expect(onError).toHaveBeenCalledWith(NOT_OPEN_17);
    expect(result.current.notOpen).toBe(false);
  });

  it("refetches at next_at plus 0–10 s in rat season, at most once a minute", async () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
    rpc.fetchFieldState.mockResolvedValue(ratField(30, [RAT]));
    const { result } = renderHook(() => useField("r", "tok", true, () => {}));
    await flush();
    expect(result.current.state?.rats?.live).toHaveLength(1);
    rpc.fetchFieldState.mockClear();
    // next_at in 30 s, plus 5 s of jitter
    await act(async () => { await vi.advanceTimersByTimeAsync(34_999); });
    expect(rpc.fetchFieldState).not.toHaveBeenCalled();
    rpc.fetchFieldState.mockResolvedValue(ratField(40, [RAT], at(35)));
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(rpc.fetchFieldState).toHaveBeenCalledTimes(1);
    // the next next_at is 5 s away (+ 5 s): the minute since the last one wins
    await act(async () => { await vi.advanceTimersByTimeAsync(RAT_REFETCH_MIN_MS - 1); });
    expect(rpc.fetchFieldState).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(rpc.fetchFieldState).toHaveBeenCalledTimes(2);
    random.mockRestore();
  });

  it("waits for no spawn out of rat season, or before 0019", async () => {
    rpc.fetchFieldState.mockResolvedValue(ratField(30));
    const { result, unmount } = renderHook(() => useField("r", "tok", true, () => {}));
    await flush();
    expect(result.current.state?.rats).not.toBeNull();
    rpc.fetchFieldState.mockClear();
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000); });
    expect(rpc.fetchFieldState).not.toHaveBeenCalled();
    unmount();
    rpc.fetchFieldState.mockResolvedValue(field(1));
    renderHook(() => useField("r", "tok", true, () => {}));
    await flush();
    rpc.fetchFieldState.mockClear();
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000); });
    expect(rpc.fetchFieldState).not.toHaveBeenCalled();
  });
});
