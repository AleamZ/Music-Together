import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import FarmOverlays from "@/components/game/farm/FarmOverlays";
import type { FarmController } from "@/hooks/useFarmController";
import { farmItemFromRow, varietyFromRow } from "@/lib/game/farm/catalog";
import { NOT_OPEN } from "@/lib/game/farm/messages";
import { parseFieldState } from "@/lib/game/farm/state";

afterEach(cleanup);

const NOW = Date.parse("2026-09-25T10:00:00Z");
const CATALOG = {
  varieties: [varietyFromRow({ id: "nep", name: "Nếp", scale: 1, base_kg: 75, price_per_kg: 18, blast_mult: 1, sort_order: 20 })],
  uplands: [],
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
    claimGift: vi.fn(), plotChanged: vi.fn(),
  },
  now: NOW, tasks: [], urgent: 0, panel: null, openPanel: vi.fn(), closePanel: vi.fn(), busy: false, work: null, cancelWork: vi.fn(),
  act: vi.fn().mockResolvedValue(true), buy: vi.fn().mockResolvedValue(true), sell: vi.fn().mockResolvedValue(true), interact: vi.fn(),
  promptText: vi.fn(),
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
    const farm = controller({ work: { plot: 5, work: "harvest", startedAt: 1 } });
    render(<FarmOverlays farm={farm} me="me" onField />);
    expect(screen.getByText("🌾 Đang gặt thửa 5…")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Huỷ/ }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(farm.cancelWork).toHaveBeenCalledTimes(2);
  });

  it("keeps working on an Esc typed into a text field", () => {
    const farm = controller({ work: { plot: 5, work: "transplant", startedAt: 1 } });
    render(<><input aria-label="Chat" /><FarmOverlays farm={farm} me="me" onField /></>);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Chat" }), { key: "Escape" });
    expect(farm.cancelWork).not.toHaveBeenCalled();
  });

  it("keeps working on an Esc that closes another panel", () => {
    const farm = controller({ work: { plot: 5, work: "harvest", startedAt: 1 } });
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
});
