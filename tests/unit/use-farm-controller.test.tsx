import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { GameCanvasHandle } from "@/components/game/GameCanvas";
import {
  critterFromRow, farmItemFromRow, PART_WAIT_MS, PART_WINDOW_MS, uplandFromRow, varietyFromRow, type UplandCropRow,
} from "@/lib/game/farm/catalog";
import { BED_BAR_MS, CRAB_FINISH_WAIT_MS, TRANSPLANT_WAIT_MS } from "@/lib/game/farm/gather";
import { CRAB_GAVE_UP, GATHER_LIMIT_TEXT, GIFT_TEXT, NOT_OPEN, NOT_OPEN_153 } from "@/lib/game/farm/messages";
import { ratAt } from "@/lib/game/farm/rats";
import { parseFarmMine, parseFieldState, type FieldState } from "@/lib/game/farm/state";
import { getMap } from "@/lib/game/maps/registry";
import type { Interactable, MapId } from "@/lib/game/maps/types";
import { FARM_ANIM } from "@/lib/game/net/protocol";
import fixtures from "@/tests/fixtures/upland-cases.json";

const rpc = vi.hoisted(() => ({
  fetchFieldState: vi.fn(), fetchFarmCatalog: vi.fn(), fieldAction: vi.fn(), sellRice: vi.fn(), buyFarmItem: vi.fn(),
  claimFarmGift: vi.fn(), loadSprayer: vi.fn(), sellProduce: vi.fn(), crabStart: vi.fn(), crabFinish: vi.fn(), pickSnailBed: vi.fn(),
  sellCritters: vi.fn(), slingStart: vi.fn(), slingShoot: vi.fn(), dogHunt: vi.fn(), sellRats: vi.fn(),
}));
vi.mock("@/lib/game/farm/rpc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/game/farm/rpc")>()),
  ...rpc,
}));

import {
  CLAIM_SLOW_MS, DOG_HUNT_EVERY_MS, HARVESTER_REFETCH_MS, ROUND_FA_MS, ROUND_LIMIT_MS, SLING_FA_MS, useFarmController, WORK_MS,
} from "@/hooks/useFarmController";
import { FP_GATHER_MS } from "@/hooks/useField";

const NOW = Date.parse("2026-09-25T10:00:00Z");
const iso = (h: number) => new Date(NOW + h * 3_600_000).toISOString();
const ME = { id: "me", name: "Me" };
const LAN = { id: "lan", name: "Lan" };
const nep = varietyFromRow({ id: "nep", name: "Nếp", scale: 1, base_kg: 75, price_per_kg: 18, blast_mult: 1, sort_order: 20 });
const CATALOG = {
  varieties: [nep],
  uplands: [],
  critters: [],
  items: [
    farmItemFromRow({ id: "spray_hopper", kind: "pesticide", name: "Thuốc trừ rầy", price: 80, sort_order: 20, variety: null, fert: null, pest_target: "hopper", capacity: null }),
    farmItemFromRow({ id: "tool_sickle", kind: "tool", name: "Liềm", price: 1500, sort_order: 10, variety: null, fert: null, pest_target: null, capacity: null }),
  ],
};

/** Plot 5: my ripe nếp, drained, with brown planthoppers (I have a sickle); plot 6: Lan's; plot 1: for sale. `mine` adds
 *  to my part of the answer. */
const field = (over: {
  coins?: number; giftClaimed?: boolean; crop5?: Record<string, unknown> | null; wet?: number; mine?: Record<string, unknown>;
} = {}): FieldState => parseFieldState({
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
    gift_claimed: over.giftClaimed ?? true, owned_plot: null, farming: [5], my_offers: [], incoming_offers: [], ...over.mine,
  },
})!;

/** The canvas, its world on the field (a test may move it on with `mapId.mockReturnValue`). */
const handle = () => ({
  setPlots: vi.fn(), farmAnim: vi.fn(), plotChanged: vi.fn(), plant: vi.fn(), setGatherSpots: vi.fn(), mapId: vi.fn(() => "field"),
  setRats: vi.fn(),
}) as unknown as GameCanvasHandle
  & Record<"setPlots" | "farmAnim" | "plotChanged" | "plant" | "setGatherSpots" | "mapId" | "setRats", ReturnType<typeof vi.fn>>;
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
    await act(async () => { await result.current.act({ kind: "work", plot: 5, work: "harvest" }); });
    act(() => result.current.cancelWork());
    expect(canvas.farmAnim).toHaveBeenLastCalledWith(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(WORK_MS); });
    expect(rpc.fieldAction).toHaveBeenCalledTimes(1);
    expect(result.current.work).toBeNull();
  });

  it("drops a picking's begin_work answer that lands once the canvas shows another map", async () => {
    const { result, canvas } = setup();
    await flush();
    let answer: (v: unknown) => void = () => {};
    rpc.fieldAction.mockImplementationOnce(() => new Promise((res) => { answer = res; }));
    let started: Promise<unknown> = Promise.resolve();
    act(() => { started = result.current.act({ kind: "work", plot: 5, work: "harvest" }); });
    // the world has switched maps before the answer lands
    canvas.mapId.mockReturnValue("pond");
    await act(async () => {
      answer({ state: field(), harvest: null });
      await started;
    });
    expect(canvas.plant).not.toHaveBeenCalled();
    expect(result.current.work).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(WORK_MS); });
    expect(rpc.fieldAction).toHaveBeenCalledTimes(1);
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
    await act(async () => { expect(await result.current.act({ kind: "round", plot: 5, game: "harvest" })).toBe(true); });
    expect(rpc.fieldAction).toHaveBeenLastCalledWith("r", "tok", { kind: "begin_work", plot: 5, work: "harvest" });
    const use = spot("plot_5");
    expect(canvas.plant).toHaveBeenCalledWith(use.use, use.face);
    expect(result.current.round).toMatchObject({ game: "harvest", plot: 5, part: 1, phase: "playing", score: null });
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
    await act(async () => { await result.current.act({ kind: "round", plot: 5, game: "harvest" }); });
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
    await act(async () => { await result.current.act({ kind: "round", plot: 5, game: "harvest" }); });
    act(() => result.current.closeRound());
    expect(result.current.round).toBeNull();
    expect(canvas.farmAnim).toHaveBeenLastCalledWith(FARM_ANIM.stop);
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(rpc.fieldAction).toHaveBeenCalledTimes(1);
    // the lease ran out mid-round: the claim finds the plot gone
    await act(async () => { await result.current.act({ kind: "round", plot: 5, game: "harvest" }); });
    act(() => result.current.endRound(true, 5));
    rpc.fieldAction.mockRejectedValueOnce({ message: "not your plot" });
    await act(async () => { await vi.advanceTimersByTimeAsync(PART_WAIT_MS); });
    expect(result.current.round).toMatchObject({ phase: "refused", message: "Hết hạn thuê — phần lúa chưa gặt đã mất." });
    expect(toast).not.toHaveBeenCalled();
  });

  it("sends Thử lại's begin_work only once the lost round's report has landed", async () => {
    const { result } = setup();
    await flush();
    rpc.fieldAction.mockResolvedValueOnce(answer(field()));
    await act(async () => { await result.current.act({ kind: "round", plot: 5, game: "harvest" }); });
    let report!: (a: unknown) => void;
    rpc.fieldAction.mockReturnValueOnce(new Promise((resolve) => { report = resolve; }));
    act(() => result.current.endRound(false, 2));
    expect(rpc.fieldAction).toHaveBeenLastCalledWith("r", "tok", { kind: "harvest_part", plot: 5, success: false });
    // the report clears the server's record: a begin_work that overtook it would lose its own record to it
    rpc.fieldAction.mockResolvedValueOnce(answer(field()));
    await act(async () => { result.current.nextRound(); await vi.advanceTimersByTimeAsync(1000); });
    expect(rpc.fieldAction).toHaveBeenCalledTimes(2);
    expect(result.current.round).toMatchObject({ phase: "lost" });
    await act(async () => { report(answer(field())); await vi.advanceTimersByTimeAsync(0); });
    expect(rpc.fieldAction).toHaveBeenCalledTimes(3);
    expect(rpc.fieldAction).toHaveBeenLastCalledWith("r", "tok", { kind: "begin_work", plot: 5, work: "harvest" });
    expect(result.current.round).toMatchObject({ phase: "playing" });
  });

  it("keeps the round closed when Esc comes while Thử lại's begin_work is on its way", async () => {
    const { result, canvas } = setup();
    await flush();
    rpc.fieldAction.mockResolvedValue(answer(field()));
    await act(async () => { await result.current.act({ kind: "round", plot: 5, game: "harvest" }); });
    act(() => result.current.endRound(false, 2));
    await flush();
    let begun!: (a: unknown) => void;
    rpc.fieldAction.mockReturnValueOnce(new Promise((resolve) => { begun = resolve; }));
    act(() => result.current.nextRound());
    await flush();
    expect(rpc.fieldAction).toHaveBeenLastCalledWith("r", "tok", { kind: "begin_work", plot: 5, work: "harvest" });
    act(() => result.current.closeRound());
    const sent = fa(canvas, FARM_ANIM.harvest);
    await act(async () => { begun(answer(field())); await vi.advanceTimersByTimeAsync(ROUND_FA_MS * 3); });
    expect(result.current.round).toBeNull();
    expect(fa(canvas, FARM_ANIM.harvest)).toBe(sent);
  });

  it("ends a round left idle before the server's window closes, and stops its fa 2", async () => {
    const { result, canvas } = setup();
    await flush();
    rpc.fieldAction.mockResolvedValueOnce(answer(field()));
    await act(async () => { await result.current.act({ kind: "round", plot: 5, game: "harvest" }); });
    expect(ROUND_LIMIT_MS).toBeLessThan(PART_WINDOW_MS);
    await act(async () => { await vi.advanceTimersByTimeAsync(ROUND_LIMIT_MS - 1); });
    expect(result.current.round).toMatchObject({ phase: "playing" });
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(result.current.round).toMatchObject({ phase: "refused", message: "Lượt gặt đã quá lâu — bắt đầu lại nhé." });
    expect(canvas.farmAnim).toHaveBeenLastCalledWith(FARM_ANIM.stop);
    const sent = fa(canvas, FARM_ANIM.harvest);
    await act(async () => { await vi.advanceTimersByTimeAsync(ROUND_FA_MS * 5); });
    expect(fa(canvas, FARM_ANIM.harvest)).toBe(sent);
    expect(rpc.fieldAction).toHaveBeenCalledTimes(1);
  });

  it("lets a slow claim be left after 15 s; its late answer still lands, silently", async () => {
    const { result, canvas, toast } = setup();
    await flush();
    rpc.fieldAction.mockResolvedValueOnce(answer(field()));
    await act(async () => { await result.current.act({ kind: "round", plot: 5, game: "harvest" }); });
    act(() => result.current.endRound(true, 6));
    let claim!: (a: unknown) => void;
    rpc.fieldAction.mockReturnValueOnce(new Promise((resolve) => { claim = resolve; }));
    await act(async () => { await vi.advanceTimersByTimeAsync(PART_WAIT_MS); });
    expect(rpc.fieldAction).toHaveBeenLastCalledWith("r", "tok", { kind: "harvest_part", plot: 5, success: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(CLAIM_SLOW_MS - 1); });
    expect(result.current.round).toMatchObject({ phase: "waiting", slow: false });
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(result.current.round).toMatchObject({ phase: "waiting", slow: true });
    act(() => result.current.closeRound());
    expect(result.current.round).toBeNull();
    await act(async () => { claim(answer(field({ wet: 12 }), { harvestPart: part(1, 12) })); await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.round).toBeNull();
    expect(result.current.data.state?.mine.rice.nep.wet).toBe(12);
    expect(canvas.plotChanged).toHaveBeenCalledWith(5);
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

  it("toasts a harvester's end from whichever fetch brings it, one landing before its own refetch included", async () => {
    const ends = new Date(Date.parse(iso(0)) + 10_000).toISOString();
    rpc.fetchFieldState.mockResolvedValue(field({ crop5: { harvester: { started_at: iso(0), ends_at: ends } } }));
    const { result, canvas, toast } = setup();
    await flush();
    rpc.fetchFieldState.mockClear();
    rpc.fetchFieldState.mockResolvedValue(field({ crop5: null, wet: 50 }));
    // someone's fp right at the end: its refetch lands at +10.4 s, before mine at +11 s
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    act(() => result.current.data.plotChanged());
    await act(async () => { await vi.advanceTimersByTimeAsync(FP_GATHER_MS); });
    expect(rpc.fetchFieldState).toHaveBeenCalledTimes(1);
    expect(canvas.plotChanged).toHaveBeenCalledWith(5);
    expect(toast).toHaveBeenCalledWith("🚜 Máy gặt gặt xong thửa 5: 50 kg nếp (lúa ướt).");
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(rpc.fetchFieldState).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledTimes(1);
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

describe("useFarmController, v15.3 transplant rounds", () => {
  const answer = (s: FieldState) => ({ state: s, harvest: null, harvestPart: null, picking: null });
  const fa = (canvas: ReturnType<typeof handle>, a: number) => canvas.farmAnim.mock.calls.filter(([x]) => x === a).length;
  /** Plot 5 as an ớt nursery, sown 12 h ago. */
  const OT5 = {
    kind: "upland", upland: "ot", variety: null, phase: "nursery", soak_at: null, sow_at: iso(-12), transplant_at: null, plant_at: null,
    pests: [], picking: null, pickings: 3,
    log: { water: [{ t: iso(-12), l: 1 }], fert: [], spray: [], picks: [], q_transplant: 1, work: [], harvests: [] },
  };

  it("plays a transplant round: begin_work, fa 1 every 2 s, and transplant with quality 1 no earlier than 9 s after the answer", async () => {
    const { result, canvas } = setup();
    await flush();
    rpc.fieldAction.mockResolvedValueOnce(answer(field()));
    await act(async () => { expect(await result.current.act({ kind: "round", plot: 5, game: "transplant" })).toBe(true); });
    expect(rpc.fieldAction).toHaveBeenLastCalledWith("r", "tok", { kind: "begin_work", plot: 5, work: "transplant" });
    const use = spot("plot_5");
    expect(canvas.plant).toHaveBeenCalledWith(use.use, use.face);
    expect(result.current.round).toMatchObject({ game: "transplant", plot: 5, ot: false, phase: "playing", score: null });
    expect(fa(canvas, FARM_ANIM.transplant)).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(ROUND_FA_MS * 2); });
    expect(fa(canvas, FARM_ANIM.transplant)).toBe(3);
    // passed at 5 s: fa 0, then "Đang cắm nốt hàng mạ…" until 9 s after the begin_work answer
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    act(() => result.current.endRound(true, 8.5));
    expect(canvas.farmAnim).toHaveBeenLastCalledWith(FARM_ANIM.stop);
    expect(result.current.round).toMatchObject({ phase: "waiting", score: 8.5 });
    rpc.fieldAction.mockResolvedValueOnce(answer(field()));
    await act(async () => { await vi.advanceTimersByTimeAsync(TRANSPLANT_WAIT_MS - 5000 - 1); });
    expect(rpc.fieldAction).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(rpc.fieldAction).toHaveBeenLastCalledWith("r", "tok", { kind: "transplant", plot: 5, quality: 1 });
    expect(result.current.round).toMatchObject({ phase: "won", result: null });
    expect(canvas.plotChanged).toHaveBeenCalledWith(5);
    expect(fa(canvas, FARM_ANIM.transplant)).toBe(3);
  });

  it("sends nothing for a failed round, and Thử lại begins a new one", async () => {
    const { result } = setup();
    await flush();
    rpc.fieldAction.mockResolvedValue(answer(field()));
    await act(async () => { await result.current.act({ kind: "round", plot: 5, game: "transplant" }); });
    act(() => result.current.endRound(false, 5.5));
    expect(result.current.round).toMatchObject({ phase: "lost", score: 5.5 });
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(rpc.fieldAction).toHaveBeenCalledTimes(1);
    await act(async () => { result.current.nextRound(); await vi.advanceTimersByTimeAsync(0); });
    expect(rpc.fieldAction).toHaveBeenCalledTimes(2);
    expect(rpc.fieldAction).toHaveBeenLastCalledWith("r", "tok", { kind: "begin_work", plot: 5, work: "transplant" });
    expect(result.current.round).toMatchObject({ game: "transplant", phase: "playing", score: null });
  });

  it("ends a transplant round left idle before the server's window closes, in its own words", async () => {
    const { result, canvas } = setup();
    await flush();
    rpc.fieldAction.mockResolvedValueOnce(answer(field()));
    await act(async () => { await result.current.act({ kind: "round", plot: 5, game: "transplant" }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(ROUND_LIMIT_MS); });
    expect(result.current.round).toMatchObject({ game: "transplant", phase: "refused", message: "Lượt cấy đã quá lâu — bắt đầu lại nhé." });
    expect(canvas.farmAnim).toHaveBeenLastCalledWith(FARM_ANIM.stop);
    const sent = fa(canvas, FARM_ANIM.transplant);
    await act(async () => { await vi.advanceTimersByTimeAsync(ROUND_FA_MS * 5); });
    expect(fa(canvas, FARM_ANIM.transplant)).toBe(sent);
    expect(rpc.fieldAction).toHaveBeenCalledTimes(1);
  });

  it("knows an ớt round, and shows a refused transplant in its own words", async () => {
    rpc.fetchFieldState.mockResolvedValue(field({ crop5: OT5 }));
    const { result, toast } = setup();
    await flush();
    rpc.fieldAction.mockResolvedValueOnce(answer(field({ crop5: OT5 })));
    await act(async () => { await result.current.act({ kind: "round", plot: 5, game: "transplant" }); });
    expect(result.current.round).toMatchObject({ game: "transplant", plot: 5, ot: true, phase: "playing" });
    act(() => result.current.endRound(true, 7));
    rpc.fieldAction.mockRejectedValueOnce({ message: "work expired" });
    await act(async () => { await vi.advanceTimersByTimeAsync(TRANSPLANT_WAIT_MS); });
    expect(result.current.round).toMatchObject({ phase: "refused", message: "Lượt cấy đã quá lâu — bắt đầu lại nhé." });
    expect(toast).not.toHaveBeenCalled();
  });

  it("reads a begin_work refusal for a transplant in the transplant's words", async () => {
    const { result, toast } = setup();
    await flush();
    rpc.fieldAction.mockRejectedValueOnce({ message: "lease ending" });
    await act(async () => { expect(await result.current.act({ kind: "round", plot: 5, game: "transplant" })).toBe(false); });
    expect(toast).toHaveBeenCalledWith("Sắp hết hạn thuê — không kịp cấy.");
    expect(result.current.round).toBeNull();
    rpc.fieldAction.mockRejectedValueOnce({ message: "lease ending" });
    await act(async () => { await result.current.act({ kind: "round", plot: 5, game: "harvest" }); });
    expect(toast).toHaveBeenLastCalledWith("Sắp hết hạn thuê — không kịp gặt phần này.");
  });
});

describe("useFarmController, v15.3 crab holes", () => {
  const CRITTERS = [
    critterFromRow({ id: "cua_dong", name: "Cua đồng", grp: "crab", base_price: 12, sort_order: 10 }),
    critterFromRow({ id: "cua_gach", name: "Cua gạch", grp: "crab", base_price: 45, sort_order: 20 }),
  ];
  const BUCKET = farmItemFromRow({
    id: "box_bucket", kind: "critter_box", name: "Xô nhựa", price: 1500, sort_order: 10, variety: null, fert: null, pest_target: null, capacity: 15,
  });
  const GATHERING = { ...CATALOG, critters: CRITTERS, items: [...CATALOG.items, BUCKET] };
  const fa = (canvas: ReturnType<typeof handle>, a: number) => canvas.farmAnim.mock.calls.filter(([x]) => x === a).length;
  const visit = (hole: number) => ({ serverNow: iso(0), mine: field().mine, visit: { id: `v${hole}`, hole, startedAt: NOW } });
  const caught = (kinds: Array<[string, number]>, escaped = 0) => ({
    serverNow: iso(0), mine: field().mine,
    crab: { caught: kinds.map(([kind, price]) => ({ kind, price })), escaped, hits: kinds.length + escaped },
  });
  /** Opens a visit to hole `hole` at a ready hole. */
  async function start(result: { current: ReturnType<typeof useFarmController> }, hole: number) {
    rpc.crabStart.mockResolvedValueOnce(visit(hole));
    await act(async () => {
      expect(result.current.interact(spot(`crab_${hole}`))).toBe(true);
      await vi.advanceTimersByTimeAsync(0);
    });
  }
  beforeEach(() => {
    rpc.fetchFarmCatalog.mockResolvedValue(GATHERING);
  });

  it("starts a visit at a ready hole: crab_start with its spot, the avatar at the hole, fa 6 every 2 s", async () => {
    const { result, canvas } = setup();
    await flush();
    await start(result, 3);
    expect(rpc.crabStart).toHaveBeenCalledWith("r", "tok", 3);
    expect(canvas.plant).toHaveBeenCalledWith(spot("crab_3").use, spot("crab_3").face);
    expect(result.current.crab).toMatchObject({ hole: 3, visit: { id: "v3", hole: 3 }, phase: "playing", hits: null });
    expect(fa(canvas, FARM_ANIM.crab)).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(ROUND_FA_MS * 2); });
    expect(fa(canvas, FARM_ANIM.crab)).toBe(3);
  });

  it("sends a catch no earlier than 4 s after crab_start's answer, and shows what it brought", async () => {
    const { result, canvas, toast } = setup();
    await flush();
    await start(result, 3);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    act(() => result.current.endCrab(2));
    expect(canvas.farmAnim).toHaveBeenLastCalledWith(FARM_ANIM.stop);
    expect(result.current.crab).toMatchObject({ phase: "waiting", hits: 2 });
    rpc.crabFinish.mockResolvedValueOnce(caught([["cua_gach", 100], ["cua_dong", 26]]));
    await act(async () => { await vi.advanceTimersByTimeAsync(CRAB_FINISH_WAIT_MS - 2000 - 1); });
    expect(rpc.crabFinish).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(rpc.crabFinish).toHaveBeenCalledWith("r", "tok", "v3", 2);
    expect(result.current.crab).toMatchObject({ phase: "done", message: "🦀 Bắt được 2 con: 1 cua đồng, 1 cua gạch!" });
    act(() => result.current.closeCrab());
    expect(result.current.crab).toBeNull();
    expect(toast).not.toHaveBeenCalled();
  });

  it("sends hits 0 at once", async () => {
    const { result } = setup();
    await flush();
    await start(result, 1);
    rpc.crabFinish.mockResolvedValueOnce(caught([]));
    await act(async () => {
      result.current.endCrab(0);
      await Promise.resolve();
    });
    expect(rpc.crabFinish).toHaveBeenCalledWith("r", "tok", "v1", 0);
    await flush();
    expect(result.current.crab).toMatchObject({ phase: "done", hits: 0, message: "🦀 Cua chui hết vào hang rồi — 20 phút nữa quay lại nhé." });
  });

  it("Dừng before a try ends sends nothing; during the wait the catch is still sent, and toasted (R8)", async () => {
    const { result, canvas, toast } = setup();
    await flush();
    await start(result, 2);
    act(() => result.current.closeCrab());
    expect(result.current.crab).toBeNull();
    expect(toast).toHaveBeenCalledWith(CRAB_GAVE_UP);
    expect(canvas.farmAnim).toHaveBeenLastCalledWith(FARM_ANIM.stop);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(rpc.crabFinish).not.toHaveBeenCalled();

    await start(result, 4);
    act(() => result.current.endCrab(1));
    act(() => result.current.closeCrab());
    expect(result.current.crab).toBeNull();
    expect(toast).toHaveBeenCalledTimes(1);
    rpc.crabFinish.mockResolvedValueOnce(caught([["cua_dong", 26]]));
    await act(async () => { await vi.advanceTimersByTimeAsync(CRAB_FINISH_WAIT_MS); });
    expect(rpc.crabFinish).toHaveBeenCalledWith("r", "tok", "v4", 1);
    expect(toast).toHaveBeenLastCalledWith("🦀 Bắt được 1 con: 1 cua đồng!");
    expect(result.current.crab).toBeNull();
  });

  it("shows a refused finish in the crab's words", async () => {
    const { result, toast } = setup();
    await flush();
    await start(result, 5);
    act(() => result.current.endCrab(3));
    rpc.crabFinish.mockRejectedValueOnce({ message: "visit expired" });
    await act(async () => { await vi.advanceTimersByTimeAsync(CRAB_FINISH_WAIT_MS); });
    expect(result.current.crab).toMatchObject({ phase: "refused", message: "Lâu quá, cua chui mất rồi — lát nữa quay lại nhé." });
    act(() => result.current.closeCrab());
    await start(result, 6);
    act(() => result.current.endCrab(1));
    rpc.crabFinish.mockRejectedValueOnce({ message: "too fast" });
    await act(async () => { await vi.advanceTimersByTimeAsync(CRAB_FINISH_WAIT_MS); });
    expect(result.current.crab).toMatchObject({ phase: "refused", message: "Chưa bắt xong — thử lại sau vài giây." });
    expect(toast).not.toHaveBeenCalled();
  });

  it("says why a hole cannot be visited: before 0018, the day's limit, full hands or container, a cooling hole", async () => {
    rpc.fetchFarmCatalog.mockResolvedValue(CATALOG);
    const before = setup();
    await flush();
    act(() => { expect(before.result.current.interact(spot("crab_1"))).toBe(true); });
    expect(before.toast).toHaveBeenLastCalledWith(NOT_OPEN_153);
    rpc.fetchFarmCatalog.mockResolvedValue(GATHERING);
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ gather: { ready_at: {}, left_today: 0, day_resets_at: iso(5) } }, GATHER_LIMIT_TEXT],
      [{ critters: { cua_dong: { n: 3, xu: 36 } }, critter_cap: 3 }, "Tay đầy rồi — ra vựa cô Út bán hoặc sắm xô ở tiệm anh Hai."],
      [{ items: { box_bucket: 1 }, critters: { cua_dong: { n: 18, xu: 216 } }, critter_cap: 18 }, "Xô nhựa đầy rồi — ra vựa cô Út bán bớt nhé."],
      [{ gather: { ready_at: { crab1: new Date(NOW + 12 * 60_000).toISOString() }, left_today: 150 } }, "Cua chưa ra — quay lại sau 12 phút."],
    ];
    for (const [mine, text] of cases) {
      rpc.fetchFieldState.mockResolvedValue(field({ mine }));
      const s = setup();
      await flush();
      act(() => { s.result.current.interact(spot("crab_1")); });
      expect(s.toast).toHaveBeenLastCalledWith(text);
    }
    expect(rpc.crabStart).not.toHaveBeenCalled();
  });

  it("names the container held in a critters-full refusal the state did not foresee: the largest one, as the capacity counts it", async () => {
    const BASKET = farmItemFromRow({
      id: "box_basket", kind: "critter_box", name: "Giỏ tre", price: 6000, sort_order: 20, variety: null, fert: null, pest_target: null, capacity: 30,
    });
    rpc.fetchFarmCatalog.mockResolvedValue({ ...GATHERING, items: [...GATHERING.items, BASKET] });
    rpc.fetchFieldState.mockResolvedValue(field({ mine: { items: { box_bucket: 1, box_basket: 1 }, critter_cap: 33 } }));
    const { result, toast } = setup();
    await flush();
    // another tab filled the basket meanwhile: the prompt still says ready, and the server refuses the hole, then a bed
    rpc.crabStart.mockRejectedValueOnce({ code: "22023", message: "critters full" });
    await act(async () => {
      result.current.interact(spot("crab_1"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(toast).toHaveBeenLastCalledWith("Giỏ tre đầy rồi — ra vựa cô Út bán bớt nhé.");
    expect(result.current.crab).toBeNull();
    rpc.pickSnailBed.mockRejectedValueOnce({ code: "22023", message: "critters full" });
    act(() => { result.current.interact(spot("bed_1")); });
    await act(async () => { await vi.advanceTimersByTimeAsync(BED_BAR_MS); });
    expect(rpc.pickSnailBed).toHaveBeenCalledWith("r", "tok", 1);
    expect(toast).toHaveBeenLastCalledWith("Giỏ tre đầy rồi — ra vựa cô Út bán bớt nhé.");
  });

  it("says NOT_OPEN_153 when crab_start is missing, and leaves the field open", async () => {
    const { result, toast } = setup();
    await flush();
    rpc.crabStart.mockRejectedValueOnce({ code: "PGRST202", message: "Could not find the function public.crab_start" });
    await act(async () => {
      result.current.interact(spot("crab_2"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(toast).toHaveBeenCalledWith(NOT_OPEN_153);
    expect(result.current.data.notOpen).toBe(false);
    expect(result.current.crab).toBeNull();
  });

  it("drops a crab_start answer that comes back after I left the field", async () => {
    const canvas = handle();
    const view = renderHook(({ mapId }: { mapId: MapId }) => useFarmController({
      token: "tok", roomId: "r", accountId: "me", mapId, canvas: () => canvas, toast: vi.fn(), onCoinsChanged: () => {},
    }), { initialProps: { mapId: "field" as MapId } });
    await flush();
    let started!: (a: unknown) => void;
    rpc.crabStart.mockReturnValueOnce(new Promise((resolve) => { started = resolve; }));
    act(() => { view.result.current.interact(spot("crab_3")); });
    expect(rpc.crabStart).toHaveBeenCalledWith("r", "tok", 3);
    view.rerender({ mapId: "pond" });
    await flush();
    await act(async () => { started(visit(3)); await vi.advanceTimersByTimeAsync(ROUND_FA_MS * 2); });
    expect(view.result.current.crab).toBeNull();
    expect(fa(canvas, FARM_ANIM.crab)).toBe(0);
  });

  /** A transplant round's begin_work and a crab visit's crab_start, both on their way; the promises resolve them. */
  async function bothOnTheirWay(result: { current: ReturnType<typeof useFarmController> }) {
    let begun!: (a: unknown) => void;
    rpc.fieldAction.mockReturnValueOnce(new Promise((resolve) => { begun = resolve; }));
    let started!: (a: unknown) => void;
    rpc.crabStart.mockReturnValueOnce(new Promise((resolve) => { started = resolve; }));
    await act(async () => {
      void result.current.act({ kind: "round", plot: 5, game: "transplant" });
      result.current.interact(spot("crab_3"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(rpc.fieldAction).toHaveBeenLastCalledWith("r", "tok", { kind: "begin_work", plot: 5, work: "transplant" });
    expect(rpc.crabStart).toHaveBeenCalledWith("r", "tok", 3);
    return () => {
      begun({ state: field(), harvest: null, harvestPart: null, picking: null, snails: null });
      started(visit(3));
    };
  }

  it("drops a begin_work or crab_start answer that lands after I left the field, before the task that closes the overlays", async () => {
    const canvas = handle();
    const view = renderHook(({ mapId }: { mapId: MapId }) => useFarmController({
      token: "tok", roomId: "r", accountId: "me", mapId, canvas: () => canvas, toast: vi.fn(), onCoinsChanged: () => {},
    }), { initialProps: { mapId: "field" as MapId } });
    await flush();
    const land = await bothOnTheirWay(view.result);
    // the map has changed, and the canvas has not switched worlds yet; no timer runs, so the deferred close waits
    view.rerender({ mapId: "pond" });
    await act(async () => {
      land();
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });
    expect(canvas.plant).not.toHaveBeenCalled();
    expect(view.result.current.round).toBeNull();
    expect(view.result.current.crab).toBeNull();
    expect(fa(canvas, FARM_ANIM.transplant) + fa(canvas, FARM_ANIM.crab)).toBe(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(ROUND_FA_MS * 2); });
    expect(view.result.current.round).toBeNull();
    expect(view.result.current.crab).toBeNull();
    expect(fa(canvas, FARM_ANIM.transplant) + fa(canvas, FARM_ANIM.crab)).toBe(0);
  });

  it("drops a begin_work or crab_start answer that lands once the canvas shows another map, checked as it lands", async () => {
    const { result, canvas } = setup();
    await flush();
    const land = await bothOnTheirWay(result);
    // the world has switched maps before this hook has rendered the new one
    canvas.mapId.mockReturnValue("pond");
    await act(async () => {
      land();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(canvas.plant).not.toHaveBeenCalled();
    expect(result.current.round).toBeNull();
    expect(result.current.crab).toBeNull();
    expect(fa(canvas, FARM_ANIM.transplant) + fa(canvas, FARM_ANIM.crab)).toBe(0);
  });
});

describe("useFarmController, v15.3 snail beds, pest snails, prompts and cues", () => {
  const CRITTERS = [
    critterFromRow({ id: "cua_dong", name: "Cua đồng", grp: "crab", base_price: 12, sort_order: 10 }),
    critterFromRow({ id: "oc_dong", name: "Ốc đồng", grp: "snail", base_price: 8, sort_order: 30 }),
    critterFromRow({ id: "oc_buou_vang", name: "Ốc bươu vàng", grp: "snail", base_price: 2, sort_order: 40 }),
  ];
  const BUCKET = farmItemFromRow({
    id: "box_bucket", kind: "critter_box", name: "Xô nhựa", price: 1500, sort_order: 10, variety: null, fert: null, pest_target: null, capacity: 15,
  });
  const GATHERING = { ...CATALOG, critters: CRITTERS, items: [...CATALOG.items, BUCKET] };
  const fa = (canvas: ReturnType<typeof handle>, a: number) => canvas.farmAnim.mock.calls.filter(([x]) => x === a).length;
  const snails = (kinds: string[], escaped = 0) => ({
    serverNow: iso(0), mine: field().mine, snails: { caught: kinds.map((kind) => ({ kind, price: kind === "oc_dong" ? 17 : 4 })), escaped },
  });
  const inMin = (m: number) => new Date(NOW + m * 60_000).toISOString();
  beforeEach(() => {
    rpc.fetchFarmCatalog.mockResolvedValue(GATHERING);
  });

  it("mò ốc at a ready bed: a 3 s bar with fa 7 at its start and at 2 s, then pick_snail_bed and what it gave", async () => {
    const { result, canvas, toast } = setup();
    await flush();
    act(() => { expect(result.current.interact(spot("bed_2"))).toBe(true); });
    expect(canvas.plant).toHaveBeenCalledWith(spot("bed_2").use, spot("bed_2").face);
    expect(result.current.bed).toMatchObject({ bed: 2, text: "🐌 Đang mò ốc bãi 2…" });
    expect(result.current.work).toBeNull();
    expect(fa(canvas, FARM_ANIM.snails)).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(fa(canvas, FARM_ANIM.snails)).toBe(2);
    rpc.pickSnailBed.mockResolvedValueOnce(snails(["oc_buou_vang", "oc_dong"]));
    await act(async () => { await vi.advanceTimersByTimeAsync(BED_BAR_MS - 2000 - 1); });
    expect(rpc.pickSnailBed).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(rpc.pickSnailBed).toHaveBeenCalledWith("r", "tok", 2);
    expect(canvas.farmAnim).toHaveBeenLastCalledWith(FARM_ANIM.stop);
    expect(result.current.bed).toBeNull();
    expect(toast).toHaveBeenCalledWith("🐌 Mò được 2 con ốc: 1 ốc đồng, 1 ốc bươu vàng.");
  });

  it("cancels the bar before anything is sent when I move, or on Huỷ", async () => {
    const { result, canvas } = setup();
    await flush();
    act(() => { result.current.interact(spot("bed_1")); });
    act(() => result.current.moved());
    expect(result.current.bed).toBeNull();
    expect(canvas.farmAnim).toHaveBeenLastCalledWith(FARM_ANIM.stop);
    act(() => { result.current.interact(spot("bed_3")); });
    act(() => result.current.cancelBed());
    expect(result.current.bed).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(BED_BAR_MS * 2); });
    expect(rpc.pickSnailBed).not.toHaveBeenCalled();
    // moving with no bar running changes nothing
    act(() => result.current.moved());
    expect(result.current.bed).toBeNull();
  });

  it("says why a bed cannot be picked, and a refused pick as its toast", async () => {
    rpc.fetchFieldState.mockResolvedValue(field({ mine: { gather: { ready_at: { bed4: inMin(7) }, left_today: 100 } } }));
    const { result, toast } = setup();
    await flush();
    act(() => { result.current.interact(spot("bed_4")); });
    expect(toast).toHaveBeenLastCalledWith("Bãi này vừa mò rồi — quay lại sau 7 phút.");
    expect(result.current.bed).toBeNull();
    act(() => { result.current.interact(spot("bed_2")); });
    rpc.pickSnailBed.mockRejectedValueOnce({ message: "bed empty", details: "300" });
    await act(async () => { await vi.advanceTimersByTimeAsync(BED_BAR_MS); });
    expect(toast).toHaveBeenLastCalledWith("Bãi này vừa mò rồi — quay lại sau 5 phút.");
  });

  it("toasts what a pest-snail pick kept for the picker, or v15.2's line before 0018", async () => {
    rpc.fetchFieldState.mockResolvedValue(field({ mine: { items: { box_bucket: 1 } } }));
    const { result, toast } = setup();
    await flush();
    const answer = (s: unknown) => ({
      state: field({ mine: { items: { box_bucket: 1 } } }), harvest: null, harvestPart: null, picking: null, snails: s,
    });
    rpc.fieldAction.mockResolvedValueOnce(answer({ caught: [{ kind: "oc_buou_vang", price: 4 }, { kind: "oc_buou_vang", price: 4 }], escaped: 1 }));
    await act(async () => { await result.current.act({ kind: "pick_snails", plot: 6 }, "Đã bắt ốc bươu vàng."); });
    expect(toast).toHaveBeenLastCalledWith("🐌 Bắt ốc thửa 6: được 2 con, thả 1 con xuống mương vì xô nhựa đầy.");
    rpc.fieldAction.mockResolvedValueOnce(answer(null));
    await act(async () => { await result.current.act({ kind: "pick_snails", plot: 6 }, "Đã bắt ốc bươu vàng."); });
    expect(toast).toHaveBeenLastCalledWith("Đã bắt ốc bươu vàng.");
  });

  it("names a hole's or a bed's state in its prompt, on the server's clock", async () => {
    rpc.fetchFieldState.mockResolvedValue(field({ mine: { gather: { ready_at: { crab1: inMin(12), bed2: inMin(7) }, left_today: 150 } } }));
    const { result } = setup();
    await flush();
    expect(result.current.promptText(spot("crab_1"))).toBe("Hang 1 · cua chưa ra (còn 12 phút)");
    expect(result.current.promptText(spot("bed_2"))).toBe("Bãi 2 · còn 7 phút");
    expect(result.current.promptText(spot("crab_3"))).toBe("Bắt cua hang 3");
    expect(result.current.promptText(spot("bed_1"))).toBe("Mò ốc bãi 1");
    rpc.fetchFieldState.mockResolvedValue(field({ mine: { critters: { cua_dong: { n: 3, xu: 36 } }, critter_cap: 3 } }));
    const full = setup();
    await flush();
    expect(full.result.current.promptText(spot("crab_3"))).toBe("Hang 3 · tay đầy — bán ở vựa cô Út");
  });

  it("sells cua & ốc to cô Út, a kind or all, and toasts what she paid", async () => {
    const onCoinsChanged = vi.fn();
    const { result, toast } = setup({ onCoinsChanged });
    await flush();
    rpc.sellCritters.mockResolvedValueOnce({
      serverNow: iso(0), mine: parseFarmMine({ items: {}, rice: {}, coins: 1230, gift_claimed: true }), sold: { n: 6, xu: 230 },
    });
    await act(async () => { expect(await result.current.sellCritters(null)).toBe(true); });
    expect(rpc.sellCritters).toHaveBeenCalledWith("tok", null);
    expect(toast).toHaveBeenCalledWith("💰 Bán 6 con cua ốc được 230 xu.");
    expect(onCoinsChanged).toHaveBeenCalledTimes(1);
    rpc.sellCritters.mockRejectedValueOnce({ message: "no critters" });
    await act(async () => { expect(await result.current.sellCritters("cua_dong")).toBe(false); });
    expect(toast).toHaveBeenLastCalledWith("Không có cua ốc để bán.");
  });

  it("draws the ready cue on each hole and bed open and not cooling for me, none before 0018", async () => {
    rpc.fetchFieldState.mockResolvedValue(field({ mine: { gather: { ready_at: { crab1: inMin(12), bed2: inMin(-1) }, left_today: 150 } } }));
    const { canvas } = setup();
    await flush();
    const spots = canvas.setGatherSpots.mock.calls.at(-1)![0] as Array<{ id: string; ready: boolean }>;
    expect(spots.map((s) => s.id).sort()).toEqual([
      "bed_1", "bed_2", "bed_3", "bed_4", "crab_1", "crab_2", "crab_3", "crab_4", "crab_5", "crab_6",
    ]);
    expect(spots.filter((s) => !s.ready).map((s) => s.id)).toEqual(["crab_1"]);
    rpc.fetchFarmCatalog.mockResolvedValue(CATALOG);
    const before = setup();
    await flush();
    const none = before.canvas.setGatherSpots.mock.calls.at(-1)![0] as Array<{ ready: boolean }>;
    expect(none.some((s) => s.ready)).toBe(false);
  });
});

describe("useFarmController, the clock while a harvester runs", () => {
  it("ticks every second, so the tasks count the harvester down", async () => {
    const ends = new Date(Date.parse(iso(0)) + 10_000).toISOString();
    rpc.fetchFieldState.mockResolvedValue(field({ crop5: { harvester: { started_at: iso(0), ends_at: ends } } }));
    const { result } = setup();
    await flush();
    expect(result.current.tasks.map((t) => t.text)).toContain("Thửa 5 · Máy gặt đang gặt — còn 10 giây");
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(result.current.tasks.map((t) => t.text)).toContain("Thửa 5 · Máy gặt đang gặt — còn 9 giây");
  });
});

describe("useFarmController, v17 the ná", () => {
  const RAT = { id: 7, plot: 6, since: iso(0), seed: 3 };
  /** The field with rat 7 on Lan's plot 6 (and `live` more), my pellets and my ná. */
  const ratField = (over: { items?: Record<string, number>; live?: unknown[]; recent?: unknown[] } = {}): FieldState => {
    const f = field({ mine: { items: over.items ?? { tool_sling: 1, ammo_pellet: 12 } } });
    return parseFieldState({
      server_now: iso(0),
      plots: [
        { no: 5, kind: "village", owner: null, sale_price: null, sublease_price: null, farmer: ME, lease: null, offers: 0, crop: null },
        { no: 6, kind: "village", owner: null, sale_price: null, sublease_price: null, farmer: LAN, lease: null, offers: 0, crop: null },
      ],
      drying: [],
      mine: { items: f.mine.items, rice: {}, coins: 1000, gift_claimed: true, owned_plot: null, farming: [], my_offers: [], incoming_offers: [] },
      rats: { next_at: iso(1), price: 150, live: over.live ?? [RAT], recent: over.recent ?? [], plots: {} },
    })!;
  };
  const ratSpot = (id = 7): Interactable => ({
    id: `rat_${id}`, kind: "rat", rat: id, prompt: "", use: { x: 0, y: 0 }, rect: { x: 0, y: 0, w: 1, h: 1 },
  }) as unknown as Interactable;
  const fa = (canvas: ReturnType<typeof handle>, a: number) => canvas.farmAnim.mock.calls.filter(([x]) => x === a).length;
  const aim = () => ({ state: ratField(), aim: { rat: 7, startedAt: NOW } });
  async function open(result: { current: ReturnType<typeof useFarmController> }) {
    rpc.slingStart.mockResolvedValueOnce(aim());
    await act(async () => {
      expect(result.current.interact(ratSpot())).toBe(true);
      await vi.advanceTimersByTimeAsync(0);
    });
  }
  beforeEach(() => {
    rpc.fetchFieldState.mockResolvedValue(ratField());
  });

  it("puts the rats on the canvas, and names the gear in the prompt", async () => {
    const { result, canvas } = setup();
    await flush();
    expect(canvas.setRats).toHaveBeenLastCalledWith(expect.objectContaining({ live: [expect.objectContaining({ id: 7 })] }));
    expect(result.current.promptText(ratSpot())).toBe("Bắn chuột");
    rpc.fetchFieldState.mockResolvedValue(ratField({ items: { tool_sling: 1 } }));
    await act(async () => { await result.current.data.reload(); });
    expect(result.current.promptText(ratSpot())).toBe("Chuột đồng (hết đạn)");
    rpc.fetchFieldState.mockResolvedValue(ratField({ items: {} }));
    await act(async () => { await result.current.data.reload(); });
    expect(result.current.promptText(ratSpot())).toBe("Chuột đồng (cần ná)");
  });

  it("says what gear is missing on E and calls nothing", async () => {
    rpc.fetchFieldState.mockResolvedValue(ratField({ items: { ammo_pellet: 5 } }));
    const { result, toast } = setup();
    await flush();
    act(() => { result.current.interact(ratSpot()); });
    expect(toast).toHaveBeenCalledWith("Chưa có ná — mua ở tiệm anh Hai.");
    expect(rpc.slingStart).not.toHaveBeenCalled();
  });

  it("aims with sling_start and opens the game, with fa 12 every 2 s", async () => {
    const { result, canvas } = setup();
    await flush();
    await open(result);
    expect(rpc.slingStart).toHaveBeenCalledWith("r", "tok", 7);
    expect(result.current.sling).toMatchObject({ rat: 7, plot: 6, answers: 0, phase: "playing" });
    expect(fa(canvas, FARM_ANIM.aim)).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(SLING_FA_MS * 3); });
    expect(fa(canvas, FARM_ANIM.aim)).toBe(4);
    act(() => result.current.closeSling());
    expect(result.current.sling).toBeNull();
    expect(canvas.farmAnim).toHaveBeenLastCalledWith(FARM_ANIM.stop);
    await act(async () => { await vi.advanceTimersByTimeAsync(SLING_FA_MS * 2); });
    expect(fa(canvas, FARM_ANIM.aim)).toBe(4);
  });

  it("drops a sling_start answer that lands after the game was closed or the field left", async () => {
    const { result, canvas } = setup();
    await flush();
    let answer: (v: unknown) => void = () => {};
    rpc.slingStart.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    act(() => { result.current.interact(ratSpot()); });
    canvas.mapId.mockReturnValue("lobby");
    await act(async () => { answer(aim()); await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.sling).toBeNull();
    expect(fa(canvas, FARM_ANIM.aim)).toBe(0);
  });

  it("counts a miss as an answer, ends on a hit with its price and sends fp for the plot", async () => {
    const { result, canvas } = setup();
    await flush();
    await open(result);
    rpc.slingShoot.mockResolvedValueOnce({ state: ratField(), shot: { hit: false, price: null, pellets: 11 } });
    await act(async () => { await result.current.slingShot(false); });
    expect(rpc.slingShoot).toHaveBeenCalledWith("r", "tok", 7, false);
    expect(result.current.sling).toMatchObject({ answers: 1, phase: "playing" });
    expect(canvas.plotChanged).not.toHaveBeenCalled();
    rpc.slingShoot.mockResolvedValueOnce({ state: ratField({ live: [] }), shot: { hit: true, price: 336, pellets: 10 } });
    await act(async () => { await result.current.slingShot(true); });
    expect(result.current.sling).toMatchObject({
      phase: "done", message: "🎯 Trúng! Bắt được chuột đồng — 336 xu, đem bán ở vựa cô Út.",
    });
    expect(canvas.plotChanged).toHaveBeenCalledWith(6);
    expect(canvas.farmAnim).toHaveBeenLastCalledWith(FARM_ANIM.stop);
  });

  it("ends when the last pellet is spent, and on a refusal: rat gone asks the overlay to name the catcher", async () => {
    const { result } = setup();
    await flush();
    await open(result);
    rpc.slingShoot.mockResolvedValueOnce({ state: ratField(), shot: { hit: false, price: null, pellets: 0 } });
    await act(async () => { await result.current.slingShot(false); });
    expect(result.current.sling).toMatchObject({ phase: "refused", message: "Hết đạn đất — mua ở tiệm anh Hai.", gone: false });
    act(() => result.current.closeSling());
    await open(result);
    rpc.slingShoot.mockRejectedValueOnce({ message: "rat gone" });
    await act(async () => { await result.current.slingShot(true); });
    expect(result.current.sling).toMatchObject({ phase: "refused", gone: true });
    act(() => result.current.closeSling());
    await open(result);
    rpc.slingShoot.mockRejectedValueOnce({ message: "rat limit", details: "600" });
    await act(async () => { await result.current.slingShot(true); });
    expect(result.current.sling).toMatchObject({ phase: "refused", message: "Bạn bắt đủ 6 con chuột trong giờ này rồi — nghỉ 10 phút nhé.", gone: false });
  });

  it("re-aims with a new sling_start, which counts an answer", async () => {
    const { result } = setup();
    await flush();
    await open(result);
    rpc.slingStart.mockResolvedValueOnce(aim());
    await act(async () => { await result.current.slingReaim(); });
    expect(rpc.slingStart).toHaveBeenCalledTimes(2);
    expect(result.current.sling).toMatchObject({ answers: 1, phase: "playing" });
  });

  it("toasts a rat out on a plot I farm, once per rat", async () => {
    rpc.fetchFieldState.mockResolvedValue(ratField({ live: [RAT, { id: 8, plot: 5, since: iso(0), seed: 4 }] }));
    const { result, toast } = setup();
    await flush();
    expect(vi.mocked(toast).mock.calls).toEqual([["🐀 Chuột mò ra phá thửa 5 của bạn!"]]);
    await act(async () => { await result.current.data.reload(); });
    expect(toast).toHaveBeenCalledTimes(1);
  });
});

describe("useFarmController, v17 the dog's auto-hunt", () => {
  const RAT = { id: 9, plot: 6, since: iso(-0.1), seed: 5 };
  const DOG = (over: Record<string, unknown> = {}) => ({
    name: "Mực", coat: "muc", adopted_at: iso(-48), fed_until: iso(10), next_hunt_at: null, catches: 2, ...over,
  });
  const huntField = (over: { dog?: Record<string, unknown> | null; caps?: Record<string, unknown>; live?: unknown[] } = {}): FieldState =>
    parseFieldState({
      server_now: iso(0),
      plots: [
        { no: 6, kind: "village", owner: null, sale_price: null, sublease_price: null, farmer: LAN, lease: null, offers: 0, crop: null },
      ],
      drying: [],
      mine: {
        items: {}, rice: {}, coins: 1000, gift_claimed: true, owned_plot: null, farming: [], my_offers: [], incoming_offers: [],
        dog: over.dog === undefined ? DOG() : over.dog, rat_caps: over.caps ?? { hour_left: 6, hour_resets_at: null, day_left: 24 },
      },
      rats: { next_at: iso(1), price: 150, live: over.live ?? [RAT], recent: [], plots: {} },
    })!;
  /** The canvas with my feet on the rat (or `far` px from it), my last input `idleMs` ago. */
  function hunter(opts: { far?: number; idleMs?: number } = {}) {
    const canvas = handle() as ReturnType<typeof handle> & Record<"localPos" | "lastInputAt" | "dogPounce" | "dogRecall", ReturnType<typeof vi.fn>>;
    Object.assign(canvas, {
      localPos: vi.fn(() => {
        const p = ratAt({ ...RAT, since: Date.parse(RAT.since) }, Date.now());
        return p ? { x: p.x + (opts.far ?? 0), y: p.y } : null;
      }),
      lastInputAt: vi.fn(() => Date.now() - (opts.idleMs ?? 0)),
      dogPounce: vi.fn(() => true), dogRecall: vi.fn(),
    });
    const toast = vi.fn();
    const view = renderHook(() => useFarmController({
      token: "tok", roomId: "r", accountId: "me", mapId: "field", canvas: () => canvas, toast, onCoinsChanged: () => {},
    }));
    return { canvas, toast, ...view };
  }
  const tick = () => act(async () => { await vi.advanceTimersByTimeAsync(DOG_HUNT_EVERY_MS); });

  it("pounces at a rat within 96 px: the dog runs at the call, then fp for the plot and a toast", async () => {
    rpc.fetchFieldState.mockResolvedValue(huntField());
    rpc.dogHunt.mockResolvedValueOnce({ state: huntField({ live: [], dog: DOG({ next_hunt_at: iso(0.1) }) }), price: 169 });
    const { canvas, toast } = hunter();
    await flush();
    await tick();
    expect(canvas.dogPounce).toHaveBeenCalledWith(9);
    expect(rpc.dogHunt).toHaveBeenCalledWith("r", "tok", 9);
    expect(canvas.plotChanged).toHaveBeenCalledWith(6);
    expect(toast).toHaveBeenCalledWith("🐕 Mực vồ được một con chuột! Đem bán cho cô Út nhé.");
    // resting now: no second call
    await tick();
    expect(rpc.dogHunt).toHaveBeenCalledTimes(1);
  });

  it("calls the dog back on a refusal, says nothing, and waits 10 s", async () => {
    rpc.fetchFieldState.mockResolvedValue(huntField());
    rpc.dogHunt.mockRejectedValue({ message: "rat gone" });
    const { canvas, toast } = hunter();
    await flush();
    await tick();
    expect(canvas.dogRecall).toHaveBeenCalledTimes(1);
    expect(toast).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
    expect(rpc.dogHunt).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(rpc.dogHunt).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["no dog", { dog: null }, {}],
    ["a hungry dog", { dog: DOG({ fed_until: iso(-1) }) }, {}],
    ["a resting dog", { dog: DOG({ next_hunt_at: iso(0.05) }) }, {}],
    ["no room in this hour's cap", { caps: { hour_left: 0, hour_resets_at: iso(0.5), day_left: 20 } }, {}],
    ["no room in the day's cap", { caps: { hour_left: 6, hour_resets_at: null, day_left: 0 } }, {}],
    ["a rat farther than 96 px", {}, { far: 100 }],
    ["no input for 3 minutes", {}, { idleMs: 3 * 60_000 + 1000 }],
  ] as const)("waits with %s", async (_why, field, opts) => {
    rpc.fetchFieldState.mockResolvedValue(huntField(field as Parameters<typeof huntField>[0]));
    hunter(opts);
    await flush();
    await tick();
    await tick();
    expect(rpc.dogHunt).not.toHaveBeenCalled();
  });

  it("hunts again once this hour's window has passed", async () => {
    rpc.fetchFieldState.mockResolvedValue(huntField({ caps: { hour_left: 0, hour_resets_at: iso(-0.01), day_left: 20 } }));
    rpc.dogHunt.mockResolvedValueOnce({ state: huntField({ live: [] }), price: 169 });
    hunter();
    await flush();
    await tick();
    expect(rpc.dogHunt).toHaveBeenCalledTimes(1);
  });

  it("waits while the SlingGame is open", async () => {
    const f = huntField();
    const withSling = { ...f, mine: { ...f.mine, items: { tool_sling: 1, ammo_pellet: 3 } } };
    rpc.fetchFieldState.mockResolvedValue(withSling);
    const { result } = hunter();
    await flush();
    rpc.slingStart.mockResolvedValueOnce({ state: withSling, aim: { rat: 9, startedAt: NOW } });
    await act(async () => {
      result.current.interact({ id: "rat_9", kind: "rat", rat: 9 } as unknown as Interactable);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.sling).not.toBeNull();
    await tick();
    expect(rpc.dogHunt).not.toHaveBeenCalled();
  });
});

describe("useFarmController, v17 cô Út buys the rats", () => {
  it("sells the bag and toasts what she paid", async () => {
    const { result, toast } = setup();
    await flush();
    rpc.sellRats.mockResolvedValueOnce({ serverNow: NOW, mine: parseFarmMine({ coins: 1486 })!, sold: { count: 3, xu: 486 } });
    await act(async () => { expect(await result.current.sellRats()).toBe(true); });
    expect(toast).toHaveBeenCalledWith("💰 Bán 3 con chuột được 486 xu.");
  });

  it("lists a rat on my plot among the due tasks", async () => {
    const f = field();
    rpc.fetchFieldState.mockResolvedValue({ ...f, rats: { nextAt: NOW + 3_600_000, price: 150, live: [{ id: 1, plot: 5, since: NOW, seed: 1 }], recent: [], plots: {} } });
    const { result } = setup();
    await flush();
    expect(result.current.tasks[0]).toEqual({ plot: 5, text: "Thửa 5 · 🐀 Chuột đang phá (1 con) — bắn ná, dẫn chó tới hoặc thu hoạch cho xong", urgent: true });
  });
});
