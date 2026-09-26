import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import FarmOverlays from "@/components/game/farm/FarmOverlays";
import type { FarmController, FarmRound } from "@/hooks/useFarmController";
import { critterFromRow, farmItemFromRow, varietyFromRow } from "@/lib/game/farm/catalog";
import { NOT_OPEN } from "@/lib/game/farm/messages";
import { parseFieldState } from "@/lib/game/farm/state";

afterEach(cleanup);

const NOW = Date.parse("2026-09-25T10:00:00Z");
const CATALOG = {
  varieties: [varietyFromRow({ id: "nep", name: "Nếp", scale: 1, base_kg: 75, price_per_kg: 18, blast_mult: 1, sort_order: 20 })],
  uplands: [],
  critters: [],
  items: [farmItemFromRow({ id: "fert_urea", kind: "fertilizer", name: "Phân urê", price: 60, sort_order: 30, variety: null, fert: "urea", pest_target: null, capacity: null })],
};
const STATE = parseFieldState({
  server_now: new Date(NOW).toISOString(),
  plots: [{ no: 5, kind: "village", owner: null, sale_price: null, sublease_price: null, farmer: null, lease: null, offers: 0, crop: null }],
  drying: [],
  mine: { items: {}, rice: {}, coins: 10_000, gift_claimed: true, owned_plot: null, farming: [], my_offers: [], incoming_offers: [] },
})!;

const controller = (over: Partial<FarmController> = {}): FarmController => ({
  data: {
    state: STATE, catalog: CATALOG, failed: false, notOpen: false, reload: vi.fn(), run: vi.fn(), sellRice: vi.fn(), buyItem: vi.fn(),
    claimGift: vi.fn(), plotChanged: vi.fn(), loadSprayer: vi.fn(), sellProduce: vi.fn(), crabStart: vi.fn(), crabFinish: vi.fn(),
    pickSnailBed: vi.fn(), sellCritters: vi.fn(),
    slingStart: vi.fn(), slingShoot: vi.fn(), dogHunt: vi.fn(), sellRats: vi.fn(),
  },
  now: NOW, tasks: [], urgent: 0, panel: null, openPanel: vi.fn(), closePanel: vi.fn(), busy: false, work: null, cancelWork: vi.fn(),
  round: null, endRound: vi.fn(), nextRound: vi.fn(), closeRound: vi.fn(), crab: null, endCrab: vi.fn(), closeCrab: vi.fn(),
  bed: null, cancelBed: vi.fn(), moved: vi.fn(),
  act: vi.fn().mockResolvedValue(true), buy: vi.fn().mockResolvedValue(true), sell: vi.fn().mockResolvedValue(true),
  loadSprayer: vi.fn().mockResolvedValue(true), sellProduce: vi.fn().mockResolvedValue(true), sellCritters: vi.fn().mockResolvedValue(true),
  interact: vi.fn(), promptText: vi.fn(),
  ...over,
});

describe("FarmOverlays", () => {
  it("shows the not-open banner on the field only", () => {
    const farm = controller({ data: { ...controller().data, notOpen: true } });
    const { rerender } = render(<FarmOverlays farm={farm} me="me" onField />);
    expect(screen.getByText(NOT_OPEN)).toBeInTheDocument();
    rerender(<FarmOverlays farm={farm} me="me" onField={false} />);
    expect(screen.queryByText(NOT_OPEN)).toBeNull();
  });

  it("shows the work progress, cancelled by its button or Esc", () => {
    const farm = controller({ work: { plot: 5, work: "harvest", startedAt: 1, text: "🧺 Đang hái ớt thửa 5…" } });
    render(<FarmOverlays farm={farm} me="me" onField />);
    expect(screen.getByText("🧺 Đang hái ớt thửa 5…")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Huỷ/ }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(farm.cancelWork).toHaveBeenCalledTimes(2);
  });

  it("shows a snail bed's bar, cancelled by its button or Esc (v15.3 §7.3)", () => {
    const farm = controller({ bed: { bed: 2, startedAt: 1, text: "🐌 Đang mò ốc bãi 2…" } });
    render(<FarmOverlays farm={farm} me="me" onField />);
    expect(screen.getByText("🐌 Đang mò ốc bãi 2…")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Huỷ/ }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(farm.cancelBed).toHaveBeenCalledTimes(2);
  });

  it("keeps working on an Esc typed into a text field", () => {
    const farm = controller({ work: { plot: 5, work: "harvest", startedAt: 1, text: "🧺 Đang đào khoai thửa 5…" } });
    render(<><input aria-label="Chat" /><FarmOverlays farm={farm} me="me" onField /></>);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Chat" }), { key: "Escape" });
    expect(farm.cancelWork).not.toHaveBeenCalled();
  });

  it("keeps working on an Esc that closes another panel", () => {
    const farm = controller({ work: { plot: 5, work: "harvest", startedAt: 1, text: "🧺 Đang hái ớt thửa 5…" } });
    const { rerender } = render(<FarmOverlays farm={farm} me="me" onField panelOpen />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(farm.cancelWork).not.toHaveBeenCalled();
    // the field's own panel: 🌾 Việc đồng áng stays live in the HUD while the work runs
    const tasks = controller({ work: farm.work, panel: { kind: "tasks" }, cancelWork: farm.cancelWork });
    rerender(<FarmOverlays farm={tasks} me="me" onField />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(tasks.closePanel).toHaveBeenCalledTimes(1);
    expect(farm.cancelWork).not.toHaveBeenCalled();
  });

  it("opens the panel the controller names and wires its actions", () => {
    const coop = controller({ panel: { kind: "coop" } });
    const { rerender } = render(<FarmOverlays farm={coop} me="me" onField />);
    fireEvent.click(within(screen.getByRole("dialog", { name: "🏛️ Hợp tác xã · chú Tám" })).getByRole("button", { name: "Thuê · 10.000 xu" }));
    expect(coop.act).toHaveBeenCalledWith({ kind: "rent", plot: 5 }, "Đã thuê thửa 5 trong 4 ngày.");

    const plot = controller({ panel: { kind: "plot", plot: 5 } });
    rerender(<FarmOverlays farm={plot} me="me" onField />);
    fireEvent.click(screen.getByRole("button", { name: "📖 Sổ tay: Quy trình" }));
    expect(plot.openPanel).toHaveBeenCalledWith({ kind: "handbook", tab: "process" });

    const shop = controller({ panel: { kind: "shop" } });
    rerender(<FarmOverlays farm={shop} me="me" onField />);
    fireEvent.click(screen.getByRole("button", { name: "Mua 1 · 60 xu" }));
    expect(shop.buy).toHaveBeenCalledWith("fert_urea", 1);

    const tasks = controller({ panel: { kind: "tasks" } });
    rerender(<FarmOverlays farm={tasks} me="me" onField />);
    expect(screen.getByText("Bạn chưa có ruộng — ghé chú Tám ở Hợp tác xã thuê một thửa nhé.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "📖 Sổ tay nhà nông" }));
    expect(tasks.openPanel).toHaveBeenCalledWith({ kind: "handbook", tab: null });

    rerender(<FarmOverlays farm={controller({ panel: { kind: "handbook", tab: "water" } })} me="me" onField />);
    expect(screen.getByRole("tab", { name: "Nước" })).toHaveAttribute("aria-selected", "true");
  });

  it("sells cua & ốc at cô Út's once 0018 has critters (v15.3 §13.4)", () => {
    const kinds = [critterFromRow({ id: "cua_dong", name: "Cua đồng", grp: "crab", base_price: 12, sort_order: 10 })];
    const state = { ...STATE, critterPrices: { mult: 1.5, endsAt: null }, mine: { ...STATE.mine, critters: { cua_dong: { n: 2, xu: 36 } } } };
    const depot = controller({ panel: { kind: "depot" }, data: { ...controller().data, state, catalog: { ...CATALOG, critters: kinds } } });
    const { rerender } = render(<FarmOverlays farm={depot} me="me" onField />);
    expect(screen.getByText("Giá hôm nay ×1,50: cua đồng 18 xu/con")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Bán hết cua ốc · 36 xu" }));
    expect(depot.sellCritters).toHaveBeenCalledWith(null);
    // before 0018: no critter kinds, no section
    rerender(<FarmOverlays farm={controller({ panel: { kind: "depot" } })} me="me" onField />);
    expect(screen.queryByText("🦀 Cua & ốc")).toBeNull();
  });
});

describe("FarmOverlays, a round", () => {
  const round = (over: Partial<FarmRound> = {}): FarmRound => ({
    game: "harvest", plot: 5, part: 2, ot: false, seed: 7, begunAt: 1, phase: "playing", score: null, result: null, message: null,
    slow: false, ...over,
  });

  it("opens HarvestGame for the round, with the harvest's variety for its last line", () => {
    const farm = controller({ round: round({ phase: "won", result: { variety: "nep", kg: 13, parts: 6, total: 75, done: true } }) });
    render(<FarmOverlays farm={farm} me="me" onField />);
    expect(screen.getByRole("dialog", { name: "Gặt thửa 5" })).toBeInTheDocument();
    expect(screen.getByText("🌾 Gặt xong thửa 5: tổng 75 kg nếp (lúa ướt) — đem phơi rồi bán cho cô Út nhé!")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Đóng" }));
    expect(farm.closeRound).toHaveBeenCalledTimes(1);
  });

  it("opens CrabGame for a crab visit (v15.3 §13.2)", () => {
    const farm = controller({
      crab: { hole: 4, visit: { id: "v", hole: 4, startedAt: 1 }, seed: 1, begunAt: 1, phase: "done", hits: 1, message: "🦀 Bắt được 1 con: 1 cua đồng!" },
    });
    render(<FarmOverlays farm={farm} me="me" onField />);
    expect(screen.getByRole("dialog", { name: "Bắt cua hang 4" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Đóng" }));
    expect(farm.closeCrab).toHaveBeenCalledTimes(1);
  });

  it("opens TransplantGame for a transplant round (v15.3 §13.3)", () => {
    const farm = controller({ round: round({ game: "transplant", part: 0, phase: "won", score: 8 }) });
    render(<FarmOverlays farm={farm} me="me" onField />);
    expect(screen.getByRole("dialog", { name: "Cấy lúa thửa 5" })).toBeInTheDocument();
    expect(screen.getByText("✅ Cấy xong thửa 5 — giữ nước Nông, bón thúc đúng lúc nhé!")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Đóng" }));
    expect(farm.closeRound).toHaveBeenCalledTimes(1);
  });
});
