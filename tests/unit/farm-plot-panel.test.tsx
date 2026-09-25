import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import FarmTasksPanel, { FarmTasksButton } from "@/components/game/farm/FarmTasks";
import Handbook from "@/components/game/farm/Handbook";
import PlotPanel from "@/components/game/farm/PlotPanel";
import { farmItemFromRow, varietyFromRow, type FarmCatalog } from "@/lib/game/farm/catalog";
import { parseFieldState, type FieldState } from "@/lib/game/farm/state";

afterEach(cleanup);

const NOW = Date.parse("2026-09-25T10:00:00Z");
const iso = (h: number) => new Date(NOW + h * 3_600_000).toISOString();
const ME = { id: "me", name: "Me" };
const LAN = { id: "lan", name: "Lan" };
const item = (id: string, kind: string, name: string, over: Record<string, unknown> = {}) => farmItemFromRow({
  id, kind, name, price: 50, sort_order: 0, variety: null, fert: null, pest_target: null, capacity: null, ...over,
});
const nep = varietyFromRow({ id: "nep", name: "Nếp", scale: 1, base_kg: 75, price_per_kg: 18, blast_mult: 1, sort_order: 20 });
const CATALOG: FarmCatalog = {
  varieties: [nep],
  items: [
    item("seed_nep", "seed", "Giống nếp", { variety: "nep" }),
    item("fert_manure", "fertilizer", "Phân chuồng hoai", { fert: "manure" }),
    item("fert_urea", "fertilizer", "Phân urê", { fert: "urea" }),
    item("fert_npk", "fertilizer", "Phân NPK", { fert: "npk" }),
    item("spray_hopper", "pesticide", "Thuốc trừ rầy", { pest_target: "hopper" }),
  ],
};
const bare = (no: number, kind: "private" | "village", over: Record<string, unknown> = {}) => ({
  no, kind, owner: null, sale_price: null, sublease_price: null, farmer: null, lease: null, offers: 0, crop: null, ...over,
});
/** Plot 5: my nếp, transplanted 8 h ago, shallow water, planthoppers; 6: Lan's with snails; 7: free; 2: mine, bare. */
const STATE: FieldState = parseFieldState({
  server_now: iso(0),
  plots: [
    bare(1, "private"),
    bare(2, "private", { owner: ME, farmer: ME }),
    bare(5, "village", {
      farmer: ME, lease: { source: "village", until: iso(80), price: 250 },
      crop: {
        variety: "nep", phase: "tillering", prepared_at: iso(-20), soak_at: iso(-20), sow_at: iso(-17), transplant_at: iso(-8),
        water: 2, water_set_at: iso(-8), pests: [{ kind: "hopper", since: iso(-1), treated_at: null }], excess_n: false, ripe: false,
        rotted_at: null,
        log: { water: [{ t: iso(-20), l: 3 }, { t: iso(-8), l: 2 }], fert: [], spray: [], picks: [], q_transplant: 1 },
      },
    }),
    bare(6, "village", {
      farmer: LAN, lease: { source: "village", until: iso(50), price: 250 },
      crop: {
        variety: "nep", phase: "tillering", prepared_at: iso(-20), soak_at: iso(-20), sow_at: iso(-17), transplant_at: iso(-8),
        water: 3, water_set_at: iso(-8), pests: [{ kind: "snail", since: iso(-2), treated_at: null }], excess_n: false, ripe: false, rotted_at: null,
      },
    }),
    bare(7, "village"),
  ],
  drying: [],
  mine: {
    items: { spray_hopper: 1, fert_urea: 1, fert_manure: 1, seed_nep: 1 }, rice: {}, coins: 1000, gift_claimed: true, owned_plot: 2,
    farming: [2, 5], my_offers: [], incoming_offers: [],
  },
})!;

function renderPlot(no: number, state: FieldState = STATE) {
  const onAct = vi.fn(), onOpenHandbook = vi.fn();
  render(<PlotPanel no={no} state={state} catalog={CATALOG} failed={false} me="me" busy={false} now={NOW} onAct={onAct}
    onOpenHandbook={onOpenHandbook} onReload={() => {}} onClose={() => {}} />);
  return { onAct, onOpenHandbook };
}

describe("PlotPanel", () => {
  it("shows my crop's status and estimate, and the jobs with their hints", () => {
    const { onAct, onOpenHandbook } = renderPlot(5);
    expect(screen.getByText((_, el) => el?.tagName === "LI" && el.textContent === "🌱 Nếp · Đẻ nhánh — giai đoạn sau: còn 10 giờ")).toBeInTheDocument();
    expect(screen.getByText((_, el) => el?.tagName === "LI" && el.textContent === "💧 Nước: Nông · cần Nông")).toBeInTheDocument();
    expect(screen.getByText("❗ Rầy nâu — Thuốc trừ rầy")).toBeInTheDocument();
    expect(screen.getByText(/^⚖️ Ước tính: ~\d+ kg/)).toBeInTheDocument();
    expect(screen.getByText("Trị rầy nâu.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Xịt thuốc trừ rầy" }));
    expect(onAct).toHaveBeenLastCalledWith({ kind: "spray", plot: 5, item: "spray_hopper" }, "Đã xịt thuốc trừ rầy.");
    expect(screen.getByText("Đúng lúc bón thúc đẻ nhánh.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Bơm nước (lên Sâu)" }));
    expect(onAct).toHaveBeenLastCalledWith({ kind: "water", plot: 5, delta: 1 }, undefined);
    // manure after transplanting is wasted: asked first
    fireEvent.click(screen.getByRole("button", { name: "Bón phân chuồng hoai" }));
    expect(screen.getByText("⚠️ Đã cấy — bón lót bây giờ là phí.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Vẫn làm" }));
    expect(onAct).toHaveBeenLastCalledWith({ kind: "fertilize", plot: 5, item: "fert_manure" }, "Đã bón phân chuồng hoai.");
    fireEvent.click(screen.getByRole("button", { name: "📖 Sổ tay: Sâu bệnh" }));
    expect(onOpenHandbook).toHaveBeenCalledWith("pests");
  });

  it("lets a neighbour only pick the snails, with no estimate", () => {
    const { onAct } = renderPlot(6);
    expect(screen.getByText("Đất làng · người làm: Lan (thuê — còn 2 ngày 2 giờ)")).toBeInTheDocument();
    expect(screen.queryByText(/Ước tính/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Bắt ốc bươu vàng" }));
    expect(onAct).toHaveBeenLastCalledWith({ kind: "pick_snails", plot: 6 }, "Đã bắt ốc bươu vàng.");
    expect(screen.queryByRole("button", { name: /Bơm nước/ })).toBeNull();
  });

  it("offers a free plot's land and my own plot's land actions", () => {
    const { onAct } = renderPlot(7);
    expect(screen.getByText("Ruộng còn gốc rạ — chưa làm đất.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Thuê · 250 xu" })).toBeDisabled();
    expect(screen.getByText("Bạn đang canh tác 2 thửa rồi.")).toBeInTheDocument();
    cleanup();
    renderPlot(2);
    expect(screen.getByRole("button", { name: "Làm đất" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Rao bán" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bán lại cho làng · 2.000 xu" })).toBeEnabled();
    expect(onAct).not.toHaveBeenCalled();
  });

  it("keeps an item's capitals in the toast", () => {
    const { onAct } = renderPlot(5, { ...STATE, mine: { ...STATE.mine, items: { fert_npk: 1 } } });
    // NPK at 8 h after transplanting is on time: no warning, straight to the toast
    fireEvent.click(screen.getByRole("button", { name: "Bón phân NPK" }));
    expect(onAct).toHaveBeenLastCalledWith({ kind: "fertilize", plot: 5, item: "fert_npk" }, "Đã bón phân NPK.");
  });
});

describe("Handbook", () => {
  it("opens at the tab asked for and switches tabs", () => {
    render(<Handbook varieties={[nep]} initial="pests" onClose={() => {}} />);
    expect(screen.getByRole("tab", { name: "Sâu bệnh" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Sâu cuốn lá: lá cuộn trắng. Xịt thuốc trừ sâu.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Quy trình" }));
    expect(screen.getByText(/^Nếp: cấy khi mạ 8–14 giờ tuổi/)).toBeInTheDocument();
    cleanup();
    render(<Handbook varieties={[nep]} initial="nope" onClose={() => {}} />);
    expect(screen.getByRole("tab", { name: "Quy trình" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("FarmTasks", () => {
  it("counts the urgent tasks on the HUD button", () => {
    const onClick = vi.fn();
    render(<FarmTasksButton urgent={2} onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: "🌾 Việc đồng áng (2 việc gấp)" }));
    expect(onClick).toHaveBeenCalled();
    cleanup();
    render(<FarmTasksButton urgent={0} onClick={onClick} />);
    expect(screen.getByRole("button", { name: "🌾 Việc đồng áng" })).toBeInTheDocument();
  });
  it("lists the tasks, urgent first as given, or says there is nothing to do", () => {
    const onOpenHandbook = vi.fn();
    render(<FarmTasksPanel farming tasks={[{ plot: 5, text: "Thửa 5 · Rầy nâu! Xịt thuốc trừ rầy", urgent: true }, { plot: 5, text: "Thửa 5 · Gặt — còn 3 giờ", urgent: false }]}
      onOpenHandbook={onOpenHandbook} onClose={() => {}} />);
    expect(screen.getByText("❗ Thửa 5 · Rầy nâu! Xịt thuốc trừ rầy")).toBeInTheDocument();
    expect(screen.getByText("• Thửa 5 · Gặt — còn 3 giờ")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "📖 Sổ tay nhà nông" }));
    expect(onOpenHandbook).toHaveBeenCalled();
    cleanup();
    render(<FarmTasksPanel farming={false} tasks={[]} onOpenHandbook={() => {}} onClose={() => {}} />);
    expect(screen.getByText("Bạn chưa có ruộng — ghé chú Tám ở Hợp tác xã thuê một thửa nhé.")).toBeInTheDocument();
  });
});
