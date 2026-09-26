import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { GameCanvasHandle } from "@/components/game/GameCanvas";
import { farmItemFromRow, PART_WAIT_MS, uplandFromRow, varietyFromRow, type UplandCropRow } from "@/lib/game/farm/catalog";
import { GIFT_TEXT, NOT_OPEN } from "@/lib/game/farm/messages";
import { parseFarmMine, parseFieldState, type FieldState } from "@/lib/game/farm/state";
import { getMap } from "@/lib/game/maps/registry";
import type { Interactable } from "@/lib/game/maps/types";
import { FARM_ANIM } from "@/lib/game/net/protocol";
import fixtures from "@/tests/fixtures/upland-cases.json";

const rpc = vi.hoisted(() => ({
  fetchFieldState: vi.fn(), fetchFarmCatalog: vi.fn(), fieldAction: vi.fn(), sellRice: vi.fn(), buyFarmItem: vi.fn(),
  claimFarmGift: vi.fn(), loadSprayer: vi.fn(), sellProduce: vi.fn(),
}));
vi.mock("@/lib/game/farm/rpc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/game/farm/rpc")>()),
  ...rpc,
}));

import { HARVESTER_REFETCH_MS, ROUND_FA_MS, useFarmController, WORK_MS } from "@/hooks/useFarmController";

const NOW = Date.parse("2026-09-25T10:00:00Z");
const iso = (h: number) => new Date(NOW + h * 3_600_000).toISOString();
const ME = { id: "me", name: "Me" };
const LAN = { id: "lan", name: "Lan" };
const nep = varietyFromRow({ id: "nep", name: "Nếp", scale: 1, base_kg: 75, price_per_kg: 18, blast_mult: 1, sort_order: 20 });
const CATALOG = {
  varieties: [nep],
  uplands: [],
  items: [farmItemFromRow({ id: "spray_hopper", kind: "pesticide", name: "Thuốc trừ rầy", price: 80, sort_order: 20, variety: null, fert: null, pest_target: "hopper", capacity: null })],
};

/** Plot 5: my ripe nếp, drained, with brown planthoppers (I have a sickle); plot 6: Lan's; plot 1: for sale. */
const field = (over: { coins?: number; giftClaimed?: boolean; crop5?: Record<string, unknown> | null; wet?: number } = {}): FieldState => parseFieldState({
  server_now: iso(0),
  plots: [
    { no: 1, kind: "private", owner: null, sale_price: null, sublease_price: null, farmer: null, lease: null, offers: 0, crop: null },
    {
      no: 5, kind: "village", owner: null, sale_price: null, sublease_price: null, farmer: ME,
      lease: { source: "village", until: iso(40), price: 250 }, offers: 0,
      crop: over.crop5 === null ? null : {
        variety: "nep", phase: "ripe", prepared_at: iso(-64), soak_at: iso(-63), sow_at: iso(-60), transplant_at: iso(-50),
        water: 1, water_set_at: iso(-3), pests: [{ kind: "hopper", since: iso(-1), treated_at: null }], excess_n: false, ripe: true,
        rotted_at: null,
        log: { water: [{ t: iso(-64), l: 3 }, { t: iso(-3), l: 1 }], fert: [], spray: [], picks: [], q_transplant: 1 },
        ...over.crop5,
      },
    },
    { no: 6, kind: "village", owner: null, sale_price: null, sublease_price: null, farmer: LAN, lease: { source: "village", until: iso(40), price: 250 }, offers: 0, crop: null },
  ],
  drying: [],
  mine: {
    items: { spray_hopper: 1, tool_sickle: 1 }, rice: { nep: { wet: over.wet ?? 0, dry: 50 } }, coins: over.coins ?? 1000,
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
    expect(result.current.promptText(spot("plot_5"))).toBe("Gặt bằng liềm thửa 5");
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

describe("useFarmController, v15.2", () => {
  const ROWS = (fixtures as unknown as { crops: UplandCropRow[] }).crops;
  const UPLANDS = ROWS.map(uplandFromRow);
  const seed = (id: string, name: string, upland: string) =>
    farmItemFromRow({ id, kind: "seed", name, price: 800, sort_order: 40, variety: null, fert: null, pest_target: null, capacity: null, upland });
  const BEDS = {
    ...CATALOG, uplands: UPLANDS,
    items: [
      ...CATALOG.items, seed("seed_khoai", "Dây khoai giống", "khoai"), seed("seed_bap", "Hạt bắp giống", "bap"),
      farmItemFromRow({ id: "spray_insect", kind: "pesticide", name: "Thuốc trừ sâu", price: 700, sort_order: 10, variety: null, fert: null, pest_target: "insect", capacity: null }),
    ],
  };
  /** Plot 5 as beds of khoai lang, planted 49 h ago: ripe. */
  const KHOAI5 = {
    kind: "upland", upland: "khoai", variety: null, phase: "ripe", soak_at: null, sow_at: null, transplant_at: null, plant_at: iso(-49),
    pests: [], picking: 1, pickings: 1,
    log: { water: [{ t: iso(-2), l: 1 }], fert: [], spray: [], picks: [], q_transplant: 1, work: [], harvests: [] },
  };
  const answer = (s: FieldState, over: Record<string, unknown> = {}) => ({ state: s, harvest: null, harvestPart: null, picking: null, ...over });
  const part = (i: number, kg: number) => ({ variety: "nep", kg, parts: i, total: kg * i, done: i === 6 });
  const fa = (canvas: ReturnType<typeof handle>, a: number) => canvas.farmAnim.mock.calls.filter(([x]) => x === a).length;

  it("plays a harvest round: begin_work, fa 2 every 2 s, and the claim of a pass no earlier than 9 s after the answer", async () => {
    const { result, canvas } = setup();
    await flush();
    rpc.fieldAction.mockResolvedValueOnce(answer(field()));
    await act(async () => { expect(await result.current.act({ kind: "round", plot: 5 })).toBe(true); });
    expect(rpc.fieldAction).toHaveBeenLastCalledWith("r", "tok", { kind: "begin_work", plot: 5, work: "harvest" });
    const use = spot("plot_5");
    expect(canvas.plant).toHaveBeenCalledWith(use.use, use.face);
    expect(result.current.round).toMatchObject({ plot: 5, part: 1, phase: "playing", score: null });
    expect(fa(canvas, FARM_ANIM.harvest)).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(ROUND_FA_MS * 2); });
    expect(fa(canvas, FARM_ANIM.harvest)).toBe(3);
    // won at 5 s: fa 0, then "Đang bó lúa…" until 9 s after the begin_work answer
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    act(() => result.current.endRound(true, 6.5));
    expect(canvas.farmAnim).toHaveBeenLastCalledWith(FARM_ANIM.stop);
    expect(result.current.round).toMatchObject({ phase: "waiting", score: 6.5 });
    rpc.fieldAction.mockResolvedValueOnce(answer(field(), { harvestPart: part(1, 12) }));
    await act(async () => { await vi.advanceTimersByTimeAsync(PART_WAIT_MS - 5000 - 1); });
    expect(rpc.fieldAction).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(rpc.fieldAction).toHaveBeenLastCalledWith("r", "tok", { kind: "harvest_part", plot: 5, success: true });
    expect(result.current.round).toMatchObject({ phase: "won", result: part(1, 12) });
    expect(canvas.plotChanged).toHaveBeenCalledWith(5);
    expect(fa(canvas, FARM_ANIM.harvest)).toBe(3);
  });

  it("reports a lost round at once, and Thử lại begins a new one", async () => {
    const { result } = setup();
    await flush();
    rpc.fieldAction.mockResolvedValue(answer(field()));
    await act(async () => { await result.current.act({ kind: "round", plot: 5 }); });
    act(() => result.current.endRound(false, 3.5));
    expect(result.current.round).toMatchObject({ phase: "lost", score: 3.5 });
    await flush();
    expect(rpc.fieldAction).toHaveBeenLastCalledWith("r", "tok", { kind: "harvest_part", plot: 5, success: false });
    await act(async () => { result.current.nextRound(); await vi.advanceTimersByTimeAsync(0); });
    expect(rpc.fieldAction).toHaveBeenLastCalledWith("r", "tok", { kind: "begin_work", plot: 5, work: "harvest" });
    expect(result.current.round).toMatchObject({ phase: "playing", score: null });
  });

  it("sends nothing on Esc, and shows a refused claim in the round's own words", async () => {
    const { result, canvas, toast } = setup();
    await flush();
    rpc.fieldAction.mockResolvedValue(answer(field()));
    await act(async () => { await result.current.act({ kind: "round", plot: 5 }); });
    act(() => result.current.closeRound());
    expect(result.current.round).toBeNull();
    expect(canvas.farmAnim).toHaveBeenLastCalledWith(FARM_ANIM.stop);
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(rpc.fieldAction).toHaveBeenCalledTimes(1);
    // the lease ran out mid-round: the claim finds the plot gone
    await act(async () => { await result.current.act({ kind: "round", plot: 5 }); });
    act(() => result.current.endRound(true, 5));
    rpc.fieldAction.mockRejectedValueOnce({ message: "not your plot" });
    await act(async () => { await vi.advanceTimersByTimeAsync(PART_WAIT_MS); });
    expect(result.current.round).toMatchObject({ phase: "refused", message: "Hết hạn thuê — phần lúa chưa gặt đã mất." });
    expect(toast).not.toHaveBeenCalled();
  });

  it("fetches a harvester of mine 1 s after its end, tells the others and toasts the wet rice it brought", async () => {
    const ends = new Date(Date.parse(iso(0)) + 10_000).toISOString();
    rpc.fetchFieldState.mockResolvedValue(field({ crop5: { harvester: { started_at: iso(0), ends_at: ends } } }));
    const { canvas, toast } = setup();
    await flush();
    rpc.fetchFieldState.mockClear();
    rpc.fetchFieldState.mockResolvedValue(field({ crop5: null, wet: 50 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000 + HARVESTER_REFETCH_MS - 1); });
    expect(rpc.fetchFieldState).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(rpc.fetchFieldState).toHaveBeenCalledTimes(1);
    expect(canvas.plotChanged).toHaveBeenCalledWith(5);
    expect(toast).toHaveBeenCalledWith("🚜 Máy gặt gặt xong thửa 5: 50 kg nếp (lúa ướt).");
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(rpc.fetchFieldState).toHaveBeenCalledTimes(1);
  });

  it("digs khoai with its own animation and line, then toasts the picking", async () => {
    rpc.fetchFarmCatalog.mockResolvedValue(BEDS);
    rpc.fetchFieldState.mockResolvedValue(field({ crop5: KHOAI5 }));
    const { result, canvas, toast } = setup();
    await flush();
    rpc.fieldAction.mockResolvedValueOnce(answer(field({ crop5: KHOAI5 })));
    await act(async () => { await result.current.act({ kind: "work", plot: 5, work: "harvest" }); });
    expect(canvas.farmAnim).toHaveBeenLastCalledWith(FARM_ANIM.dig);
    expect(result.current.work).toMatchObject({ plot: 5, work: "harvest", text: "🧺 Đang đào khoai thửa 5…" });
    rpc.fieldAction.mockResolvedValueOnce(answer(field({ crop5: null }), { picking: { upland: "khoai", kg: 180, k: 1, pickings: 1, done: true } }));
    await act(async () => { await vi.advanceTimersByTimeAsync(WORK_MS); });
    expect(rpc.fieldAction).toHaveBeenLastCalledWith("r", "tok", { kind: "harvest", plot: 5, quality: 1 });
    expect(toast).toHaveBeenCalledWith("🧺 Thu hoạch 180 kg khoai lang — đem bán cho cô Út nhé!");
  });

  it("plays each instant action's animation (§12), and none for the harvester", async () => {
    rpc.fetchFarmCatalog.mockResolvedValue(BEDS);
    const { result, canvas, toast } = setup();
    await flush();
    rpc.fieldAction.mockResolvedValue(answer(field()));
    const cases: Array<[Parameters<typeof result.current.act>[0], number]> = [
      [{ kind: "prepare_beds", plot: 5 }, FARM_ANIM.prepare],
      [{ kind: "tend", plot: 5, act: "lat_day" }, FARM_ANIM.prepare],
      [{ kind: "plant", plot: 5, item: "seed_khoai" }, FARM_ANIM.transplant],
      [{ kind: "plant", plot: 5, item: "seed_bap" }, FARM_ANIM.fertilize],
    ];
    for (const [a, anim] of cases) {
      await act(async () => { await result.current.act(a); });
      expect(canvas.farmAnim).toHaveBeenLastCalledWith(anim);
    }
    canvas.farmAnim.mockClear();
    await act(async () => { await result.current.act({ kind: "rent_harvester", plot: 5 }, "🚜 Máy gặt đang vào thửa 5 — 30 giây nữa xong."); });
    expect(canvas.farmAnim).not.toHaveBeenCalled();
    expect(canvas.plotChanged).toHaveBeenLastCalledWith(5);
    expect(toast).toHaveBeenLastCalledWith("🚜 Máy gặt đang vào thửa 5 — 30 giây nữa xong.");
  });

  it("loads the sprayer and sells hoa màu, with their toasts", async () => {
    rpc.fetchFarmCatalog.mockResolvedValue(BEDS);
    const { result, toast } = setup();
    await flush();
    rpc.loadSprayer.mockResolvedValueOnce({ serverNow: iso(0), mine: parseFarmMine({ items: {}, coins: 1000, gift_claimed: true, tank: { item: "spray_insect", charges: 3 } }) });
    await act(async () => { expect(await result.current.loadSprayer("spray_insect")).toBe(true); });
    expect(rpc.loadSprayer).toHaveBeenCalledWith("tok", "spray_insect");
    expect(toast).toHaveBeenCalledWith("🧴 Đã nạp thuốc trừ sâu vào bình phun — 3 lần xịt.");
    rpc.sellProduce.mockResolvedValueOnce({ serverNow: iso(0), mine: parseFarmMine({ items: {}, coins: 48_700, gift_claimed: true }) });
    await act(async () => { expect(await result.current.sellProduce("khoai", 180)).toBe(true); });
    expect(rpc.sellProduce).toHaveBeenCalledWith("tok", "khoai", 180);
    expect(toast).toHaveBeenCalledWith("💰 Bán 180 kg khoai lang được 47.700 xu.");
  });
});
