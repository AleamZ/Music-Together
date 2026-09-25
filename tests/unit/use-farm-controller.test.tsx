import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { GameCanvasHandle } from "@/components/game/GameCanvas";
import { farmItemFromRow, varietyFromRow } from "@/lib/game/farm/catalog";
import { GIFT_TEXT, NOT_OPEN } from "@/lib/game/farm/messages";
import { parseFarmMine, parseFieldState, type FieldState } from "@/lib/game/farm/state";
import { getMap } from "@/lib/game/maps/registry";
import type { Interactable } from "@/lib/game/maps/types";

const rpc = vi.hoisted(() => ({
  fetchFieldState: vi.fn(), fetchFarmCatalog: vi.fn(), fieldAction: vi.fn(), sellRice: vi.fn(), buyFarmItem: vi.fn(),
  claimFarmGift: vi.fn(),
}));
vi.mock("@/lib/game/farm/rpc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/game/farm/rpc")>()),
  ...rpc,
}));

import { useFarmController, WORK_MS } from "@/hooks/useFarmController";

const NOW = Date.parse("2026-09-25T10:00:00Z");
const iso = (h: number) => new Date(NOW + h * 3_600_000).toISOString();
const ME = { id: "me", name: "Me" };
const LAN = { id: "lan", name: "Lan" };
const nep = varietyFromRow({ id: "nep", name: "Nếp", scale: 1, base_kg: 75, price_per_kg: 18, blast_mult: 1, sort_order: 20 });
const CATALOG = {
  varieties: [nep],
  items: [farmItemFromRow({ id: "spray_hopper", kind: "pesticide", name: "Thuốc trừ rầy", price: 80, sort_order: 20, variety: null, fert: null, pest_target: "hopper", capacity: null })],
};

/** Plot 5: my ripe nếp, drained, with brown planthoppers; plot 6: Lan's; plot 1: for sale. */
const field = (over: { coins?: number; giftClaimed?: boolean } = {}): FieldState => parseFieldState({
  server_now: iso(0),
  plots: [
    { no: 1, kind: "private", owner: null, sale_price: null, sublease_price: null, farmer: null, lease: null, offers: 0, crop: null },
    {
      no: 5, kind: "village", owner: null, sale_price: null, sublease_price: null, farmer: ME,
      lease: { source: "village", until: iso(40), price: 250 }, offers: 0,
      crop: {
        variety: "nep", phase: "ripe", prepared_at: iso(-64), soak_at: iso(-63), sow_at: iso(-60), transplant_at: iso(-50),
        water: 1, water_set_at: iso(-3), pests: [{ kind: "hopper", since: iso(-1), treated_at: null }], excess_n: false, ripe: true,
        rotted_at: null,
        log: { water: [{ t: iso(-64), l: 3 }, { t: iso(-3), l: 1 }], fert: [], spray: [], picks: [], q_transplant: 1 },
      },
    },
    { no: 6, kind: "village", owner: null, sale_price: null, sublease_price: null, farmer: LAN, lease: { source: "village", until: iso(40), price: 250 }, offers: 0, crop: null },
  ],
  drying: [],
  mine: {
    items: { spray_hopper: 1 }, rice: { nep: { wet: 0, dry: 50 } }, coins: over.coins ?? 1000,
    gift_claimed: over.giftClaimed ?? true, owned_plot: null, farming: [5], my_offers: [], incoming_offers: [],
  },
})!;

const handle = () => ({
  setPlots: vi.fn(), farmAnim: vi.fn(), plotChanged: vi.fn(), plant: vi.fn(),
}) as unknown as GameCanvasHandle & Record<"setPlots" | "farmAnim" | "plotChanged" | "plant", ReturnType<typeof vi.fn>>;
const spot = (id: string): Interactable => getMap("field").interactables.find((i) => i.id === id)!;
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });

function setup(opts: { toast?: (t: string) => void; onCoinsChanged?: () => void } = {}) {
  const canvas = handle();
  const toast = opts.toast ?? vi.fn();
  const view = renderHook(() => useFarmController({
    token: "tok", roomId: "r", accountId: "me", mapId: "field", canvas: () => canvas, toast,
    onCoinsChanged: opts.onCoinsChanged ?? (() => {}),
  }));
  return { canvas, toast, ...view };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  for (const f of Object.values(rpc)) f.mockReset();
  rpc.fetchFieldState.mockResolvedValue(field());
  rpc.fetchFarmCatalog.mockResolvedValue(CATALOG);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useFarmController", () => {
  it("lists my due tasks and draws the plots with my urgent ring", async () => {
    const { result, canvas } = setup();
    await flush();
    expect(result.current.tasks).toEqual([
      { plot: 5, text: "Thửa 5 · Rầy nâu! Xịt thuốc trừ rầy", urgent: true },
      { plot: 5, text: "Thửa 5 · Gặt — còn 10 giờ", urgent: false },
    ]);
    expect(result.current.urgent).toBe(1);
    const draws = canvas.setPlots.mock.calls.at(-1)![0] as Array<{ no: number; look: { stage: string } | null; label: string; urgent: boolean }>;
    expect(draws.map((d) => [d.no, d.look?.stage ?? null, d.label, d.urgent])).toEqual([
      [1, null, "1 · đất bán", false], [5, "ripe", "5 · Me", true], [6, null, "6 · Lan", false],
    ]);
  });

  it("names my next job in a plot's prompt and leaves other maps' prompts alone", async () => {
    const { result } = setup();
    await flush();
    expect(result.current.promptText(spot("plot_5"))).toBe("Gặt lúa thửa 5");
    expect(result.current.promptText(spot("plot_6"))).toBe("Xem thửa 6 (của Lan)");
    expect(result.current.promptText(spot("coop"))).toBe("Hợp tác xã · chú Tám");
    expect(result.current.promptText(getMap("pond").interactables.find((i) => i.kind === "depot")!)).toBeNull();
  });

  it("opens the field's panels, or says the field is not open before the migration", async () => {
    const { result } = setup();
    await flush();
    act(() => { expect(result.current.interact(spot("plot_6"))).toBe(true); });
    expect(result.current.panel).toEqual({ kind: "plot", plot: 6 });
    act(() => { result.current.interact(spot("rice_depot")); });
    expect(result.current.panel).toEqual({ kind: "depot" });
    expect(result.current.interact(getMap("pond").interactables.find((i) => i.kind === "shop")!)).toBe(false);

    rpc.fetchFieldState.mockRejectedValue({ code: "PGRST202", message: "Could not find the function" });
    const closed = setup();
    await flush();
    act(() => { closed.result.current.interact(spot("coop")); });
    expect(closed.toast).toHaveBeenCalledWith(NOT_OPEN);
    expect(closed.result.current.panel).toBeNull();
  });

  it("claims the newcomer gift once, with chú Tám's greeting", async () => {
    rpc.fetchFieldState.mockResolvedValue(field({ giftClaimed: false }));
    rpc.claimFarmGift.mockResolvedValue({ serverNow: iso(0), mine: parseFarmMine({ items: {}, rice: {}, coins: 1000, gift_claimed: true }), gifted: true });
    const { result, toast } = setup();
    await flush();
    await flush();
    expect(rpc.claimFarmGift).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(GIFT_TEXT);
    expect(result.current.data.state?.mine.giftClaimed).toBe(true);
  });

  it("animates an instant action and tells the others", async () => {
    const { result, canvas, toast } = setup();
    await flush();
    rpc.fieldAction.mockResolvedValue({ state: field(), harvest: null });
    await act(async () => { await result.current.act({ kind: "spray", plot: 5, item: "spray_hopper" }, "Đã xịt."); });
    expect(rpc.fieldAction).toHaveBeenCalledWith("r", "tok", { kind: "spray", plot: 5, item: "spray_hopper" });
    expect(canvas.farmAnim).toHaveBeenCalledWith(4);
    expect(canvas.plotChanged).toHaveBeenCalledWith(5);
    expect(toast).toHaveBeenCalledWith("Đã xịt.");
  });

  it("harvests: begin_work, the progress with movement locked, then harvest with q 1.0", async () => {
    const { result, canvas, toast } = setup();
    await flush();
    rpc.fieldAction.mockResolvedValueOnce({ state: field(), harvest: null });
    await act(async () => { await result.current.act({ kind: "work", plot: 5, work: "harvest" }); });
    expect(rpc.fieldAction).toHaveBeenLastCalledWith("r", "tok", { kind: "begin_work", plot: 5, work: "harvest" });
    const use = spot("plot_5");
    expect(canvas.plant).toHaveBeenCalledWith(use.use, use.face);
    expect(canvas.farmAnim).toHaveBeenCalledWith(2);
    expect(result.current.work).toMatchObject({ plot: 5, work: "harvest" });
    rpc.fieldAction.mockResolvedValueOnce({ state: field(), harvest: { variety: "nep", kg: 70 } });
    await act(async () => { await vi.advanceTimersByTimeAsync(WORK_MS); });
    expect(rpc.fieldAction).toHaveBeenLastCalledWith("r", "tok", { kind: "harvest", plot: 5, quality: 1 });
    expect(toast).toHaveBeenCalledWith("🌾 Gặt được 70 kg nếp (lúa ướt) — đem phơi rồi bán cho cô Út nhé!");
    expect(canvas.plotChanged).toHaveBeenCalledWith(5);
    expect(result.current.work).toBeNull();
  });

  it("cancels the work before it is sent", async () => {
    const { result, canvas } = setup();
    await flush();
    rpc.fieldAction.mockResolvedValue({ state: field(), harvest: null });
    await act(async () => { await result.current.act({ kind: "work", plot: 5, work: "transplant" }); });
    act(() => result.current.cancelWork());
    expect(canvas.farmAnim).toHaveBeenLastCalledWith(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(WORK_MS); });
    expect(rpc.fieldAction).toHaveBeenCalledTimes(1);
    expect(result.current.work).toBeNull();
  });

  it("toasts a rice sale with what it earned and has the wallet fetched again", async () => {
    const onCoinsChanged = vi.fn();
    const { result, toast } = setup({ onCoinsChanged });
    await flush();
    rpc.sellRice.mockResolvedValue({ serverNow: iso(0), mine: parseFarmMine({ items: {}, rice: {}, coins: 1900, gift_claimed: true }) });
    await act(async () => { await result.current.sell("nep", true, 50); });
    expect(toast).toHaveBeenCalledWith("💰 Bán 50 kg nếp khô được 900 xu.");
    expect(onCoinsChanged).toHaveBeenCalledTimes(1);
  });

  it("toasts the price paid even when the shared wallet moved without a field answer", async () => {
    const { result, toast } = setup();
    await flush();
    // A song bonus (+10 xu) landed after the last field answer: the wallet held 1010 before the sale, not the field's 1000.
    rpc.sellRice.mockResolvedValue({ serverNow: iso(0), mine: parseFarmMine({ items: {}, rice: {}, coins: 1910, gift_claimed: true }) });
    await act(async () => { await result.current.sell("nep", true, 50); });
    expect(toast).toHaveBeenLastCalledWith("💰 Bán 50 kg nếp khô được 900 xu.");
    // A variety the catalog does not know: the wallet's change is all there is to go by.
    rpc.sellRice.mockResolvedValue({ serverNow: iso(0), mine: parseFarmMine({ items: {}, rice: {}, coins: 2010, gift_claimed: true }) });
    await act(async () => { await result.current.sell("thom", false, 10); });
    expect(toast).toHaveBeenLastCalledWith("💰 Bán 10 kg thom ướt được 100 xu.");
  });
});
