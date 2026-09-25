import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import CoopPanel from "@/components/game/farm/CoopPanel";
import DryingPanel from "@/components/game/farm/DryingPanel";
import FarmShopPanel from "@/components/game/farm/FarmShopPanel";
import RiceDepotPanel from "@/components/game/farm/RiceDepotPanel";
import { farmItemFromRow, varietyFromRow, type FarmCatalog } from "@/lib/game/farm/catalog";
import { parseFieldState, type FieldState } from "@/lib/game/farm/state";

afterEach(cleanup);

const NOW = Date.parse("2026-09-25T10:00:00Z");
const iso = (h: number) => new Date(NOW + h * 3_600_000).toISOString();
const ME = { id: "me", name: "Me" };
const LAN = { id: "lan", name: "Lan" };
const AN = { id: "an", name: "An" };
const item = (id: string, kind: string, name: string, price: number, over: Record<string, unknown> = {}) => farmItemFromRow({
  id, kind, name, price, sort_order: 0, variety: null, fert: null, pest_target: null, capacity: null, ...over,
});
const CATALOG: FarmCatalog = {
  varieties: [
    varietyFromRow({ id: "short", name: "Lúa ngắn ngày", scale: 0.9, base_kg: 90, price_per_kg: 12, blast_mult: 1, sort_order: 10 }),
    varietyFromRow({ id: "nep", name: "Nếp", scale: 1, base_kg: 75, price_per_kg: 18, blast_mult: 1, sort_order: 20 }),
  ],
  items: [
    item("seed_nep", "seed", "Giống nếp", 90, { variety: "nep" }),
    item("fert_urea", "fertilizer", "Phân urê", 60, { fert: "urea" }),
    item("spray_hopper", "pesticide", "Thuốc trừ rầy", 80, { pest_target: "hopper" }),
  ],
};
const bare = (no: number, kind: "private" | "village", over: Record<string, unknown> = {}) => ({
  no, kind, owner: null, sale_price: null, sublease_price: null, farmer: null, lease: null, offers: 0, crop: null, ...over,
});
const lease = (h: number) => ({ source: "village", until: iso(h), price: 250 });

/** Plot 1 for sale by the village; 2 mine (bare); 3 An's, listed and subleased; 4 Lan's; 5 Lan rents; 6 I rent; 7–10 free. */
const STATE: FieldState = parseFieldState({
  server_now: iso(0),
  plots: [
    bare(1, "private"),
    bare(2, "private", { owner: ME, farmer: ME }),
    bare(3, "private", { owner: AN, farmer: AN, sale_price: 8000, sublease_price: 300 }),
    bare(4, "private", { owner: LAN, farmer: LAN }),
    bare(5, "village", { farmer: LAN, lease: lease(30) }),
    bare(6, "village", { farmer: ME, lease: lease(5) }),
    bare(7, "village"), bare(8, "village"), bare(9, "village"), bare(10, "village"),
  ],
  drying: [
    { slot: 1, owner: ME, variety: "nep", kg: 40, ready_at: iso(-1) },
    { slot: 3, owner: LAN, variety: "short", kg: 60, ready_at: iso(2) },
  ],
  mine: {
    items: { fert_urea: 98 }, rice: { nep: { wet: 30, dry: 50 } }, coins: 1000, gift_claimed: true, owned_plot: 2, farming: [2, 6],
    my_offers: [{ id: "o1", plot: 4, price: 5000, expires_at: iso(20) }],
    incoming_offers: [{ id: "o2", plot: 2, buyer: LAN, price: 9000, expires_at: iso(10) }],
  },
})!;
const noop = () => {};

describe("FarmShopPanel", () => {
  it("sells by the quantity, within my coins and the 99 cap", () => {
    const onBuy = vi.fn();
    render(<FarmShopPanel mine={STATE.mine} catalog={CATALOG} failed={false} busy={false} onBuy={onBuy} onReload={noop} onClose={noop} />);
    expect(screen.getByText("🌱 Giống lúa")).toBeInTheDocument();
    const seed = screen.getByText("Giống nếp").closest("li")!;
    expect(within(seed).getByText("Chín sau ~58 giờ · 75 kg/thửa · 18 xu/kg lúa khô")).toBeInTheDocument();
    fireEvent.click(within(seed).getByRole("button", { name: "Thêm" }));
    fireEvent.click(within(seed).getByRole("button", { name: "Thêm" }));
    fireEvent.click(within(seed).getByRole("button", { name: "Mua 3 · 270 xu" }));
    expect(onBuy).toHaveBeenCalledWith("seed_nep", 3);
    // 1000 xu buys 11 sacks of seed
    fireEvent.click(within(seed).getByRole("button", { name: "Tối đa" }));
    expect(within(seed).getByRole("button", { name: "Mua 11 · 990 xu" })).toBeInTheDocument();
    // 98 held: one more fits
    const urea = screen.getByText("Phân urê").closest("li")!;
    expect(within(urea).getByRole("button", { name: "Thêm" })).toBeDisabled();
  });
  it("says why nothing can be bought", () => {
    render(<FarmShopPanel mine={{ ...STATE.mine, coins: 50, items: { fert_urea: 99 } }} catalog={CATALOG} failed={false} busy={false} onBuy={noop} onReload={noop} onClose={noop} />);
    expect(within(screen.getByText("Phân urê").closest("li")!).getByRole("button", { name: "Đã đủ 99" })).toBeDisabled();
    expect(within(screen.getByText("Giống nếp").closest("li")!).getByRole("button", { name: "Không đủ xu" })).toBeDisabled();
  });
  it("offers a reload when the field failed", () => {
    const onReload = vi.fn();
    render(<FarmShopPanel mine={null} catalog={null} failed busy={false} onBuy={noop} onReload={onReload} onClose={noop} />);
    fireEvent.click(screen.getByRole("button", { name: "🔄 Tải lại" }));
    expect(onReload).toHaveBeenCalled();
  });
});

describe("RiceDepotPanel", () => {
  it("sells dry rice at the full price and wet rice at 70 %, some or all", () => {
    const onSell = vi.fn();
    render(<RiceDepotPanel mine={STATE.mine} catalog={CATALOG} failed={false} busy={false} onSell={onSell} onReload={noop} onClose={noop} />);
    const dry = screen.getByText("Nếp khô · 50 kg").closest("li")!;
    fireEvent.click(within(dry).getByRole("button", { name: "Bán · 180 xu" }));
    expect(onSell).toHaveBeenLastCalledWith("nep", true, 10);
    fireEvent.click(within(dry).getByRole("button", { name: "Bán hết · 900 xu" }));
    expect(onSell).toHaveBeenLastCalledWith("nep", true, 50);
    const wet = screen.getByText("Nếp ướt · 30 kg").closest("li")!;
    fireEvent.click(within(wet).getByRole("button", { name: "Bán hết · 378 xu" }));
    expect(onSell).toHaveBeenLastCalledWith("nep", false, 30);
    expect(screen.queryByText(/Lúa ngắn ngày/)).toBeNull();
  });
  it("has nothing to buy without rice", () => {
    render(<RiceDepotPanel mine={{ ...STATE.mine, rice: {} }} catalog={CATALOG} failed={false} busy={false} onSell={noop} onReload={noop} onClose={noop} />);
    expect(screen.queryByRole("button", { name: /Bán/ })).toBeNull();
  });
});

describe("DryingPanel", () => {
  it("shows every slot, collects my dry batch and starts a new one", () => {
    const onAct = vi.fn();
    render(<DryingPanel state={STATE} catalog={CATALOG} failed={false} me="me" busy={false} now={NOW} onAct={onAct} onReload={noop} onClose={noop} />);
    expect(screen.getByText("Lúa của Lan: 60 kg lúa ngắn ngày — còn 2 giờ")).toBeInTheDocument();
    expect(screen.getAllByText("Trống")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Lấy lúa" }));
    expect(onAct).toHaveBeenLastCalledWith({ kind: "dry_collect", slot: 1 }, "Đã lấy 40 kg nếp khô.");
    fireEvent.click(screen.getByRole("button", { name: "Bớt" }));
    fireEvent.click(screen.getByRole("button", { name: "Phơi lúa" }));
    expect(onAct).toHaveBeenLastCalledWith({ kind: "dry_start", variety: "nep", kg: 29 }, "Đang phơi 29 kg nếp — 3 giờ nữa là khô.");
  });
  it("says when the yard is full", () => {
    const full = { ...STATE, drying: [1, 2, 3, 4].map((slot) => ({ slot, owner: LAN, variety: "nep", kg: 10, readyAt: NOW + 3_600_000 })) };
    render(<DryingPanel state={full} catalog={CATALOG} failed={false} me="me" busy={false} now={NOW} onAct={noop} onReload={noop} onClose={noop} />);
    expect(screen.getByRole("button", { name: "Sân phơi đã đầy" })).toBeDisabled();
  });
  it("offers a reload when the catalog failed", () => {
    const onReload = vi.fn();
    render(<DryingPanel state={STATE} catalog={null} failed me="me" busy={false} now={NOW} onAct={noop} onReload={onReload} onClose={noop} />);
    expect(screen.queryByText(/chưa có lúa ướt/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "🔄 Tải lại" }));
    expect(onReload).toHaveBeenCalled();
  });
});

describe("CoopPanel", () => {
  const renderCoop = (state = STATE) => {
    const onAct = vi.fn();
    render(<CoopPanel state={state} failed={false} me="me" busy={false} now={NOW} onAct={onAct} onReload={noop} onClose={noop} />);
    return onAct;
  };
  const tab = (name: string) => fireEvent.click(screen.getByRole("tab", { name }));
  const line = (text: string | RegExp) => screen.getByText(text).closest("li")!;

  it("rents village plots, and says why not at the farming limit", () => {
    const onAct = renderCoop();
    expect(screen.getByText((_, el) => el?.tagName === "P" && el.textContent === "Bạn có 1.000 xu · đang canh tác 2/2 thửa.")).toBeInTheDocument();
    expect(line("Thửa 5 · Lan đang thuê — còn 30 giờ")).toBeInTheDocument();
    expect(line("Thửa 6 · Bạn đang thuê — còn 5 giờ")).toBeInTheDocument();
    const free = line("Thửa 7 · Trống");
    expect(within(free).getByRole("button", { name: "Thuê · 250 xu" })).toBeDisabled();
    expect(within(free).getByText("Bạn đang canh tác 2 thửa rồi.")).toBeInTheDocument();
    cleanup();
    const relaxed = { ...STATE, plots: STATE.plots.map((p) => (p.no === 6 ? { ...p, farmer: null, lease: null } : p)) };
    const act2 = renderCoop(relaxed);
    fireEvent.click(within(line("Thửa 7 · Trống")).getByRole("button", { name: "Thuê · 250 xu" }));
    expect(act2).toHaveBeenCalledWith({ kind: "rent", plot: 7 }, "Đã thuê thửa 7 trong 4 ngày.");
    expect(onAct).not.toHaveBeenCalled();
  });

  it("lists the private plots and who owns them", () => {
    renderCoop();
    tab("Đất tư");
    expect(within(line("Thửa 1 · làng bán")).getByRole("button", { name: "Mua · 4.000 xu" })).toBeDisabled();
    expect(within(line("Thửa 1 · làng bán")).getByText("Bạn đã có đất tư trong phòng này.")).toBeInTheDocument();
    expect(screen.getByText(/Thửa 3 · của An · rao bán 8\.000 xu · cho thuê 300 xu\/vụ/)).toBeInTheDocument();
  });

  it("buys a listing after asking, rents a sublease and sends an offer", () => {
    const relaxed = { ...STATE, plots: STATE.plots.map((p) => (p.no === 2 ? { ...p, owner: null, farmer: null } : p.no === 6 ? { ...p, farmer: null, lease: null } : p)) };
    const onAct = renderCoop({ ...relaxed, mine: { ...relaxed.mine, coins: 9000 } });
    tab("Chợ đất");
    fireEvent.click(within(line("Thửa 3 của An — bán 8.000 xu")).getByRole("button", { name: "Mua" }));
    expect(onAct).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Vẫn làm" }));
    expect(onAct).toHaveBeenLastCalledWith({ kind: "buy_listed", plot: 3, expected: 8000 }, "🏡 Đã mua thửa 3.");
    fireEvent.click(within(line("Thửa 3 của An — cho thuê một vụ 300 xu")).getByRole("button", { name: "Thuê" }));
    expect(onAct).toHaveBeenLastCalledWith({ kind: "rent_sublease", plot: 3, expected: 300 }, "Đã thuê thửa 3 của An một vụ.");
    fireEvent.click(screen.getByRole("button", { name: "Thửa 4 (Lan)" }));
    fireEvent.change(screen.getByLabelText("Giá"), { target: { value: "6000" } });
    fireEvent.click(screen.getByRole("button", { name: "Gửi đề nghị" }));
    expect(onAct).toHaveBeenLastCalledWith({ kind: "offer", plot: 4, price: 6000 }, "Đã gửi đề nghị mua thửa 4 giá 6.000 xu.");
  });

  it("manages my plot and the offers", () => {
    const onAct = renderCoop();
    tab("Của tôi");
    // nothing typed yet: the buttons wait without complaining
    expect(screen.getByRole("button", { name: "Rao bán" })).toBeDisabled();
    expect(screen.queryByText("Số không hợp lệ.")).toBeNull();
    fireEvent.change(screen.getByLabelText("Rao bán"), { target: { value: "12000" } });
    fireEvent.click(screen.getByRole("button", { name: "Rao bán" }));
    expect(onAct).toHaveBeenLastCalledWith({ kind: "list", plot: 2, price: 12000 }, "Đã rao bán thửa 2 giá 12.000 xu.");
    fireEvent.change(screen.getByLabelText("Cho thuê một vụ"), { target: { value: "6000" } });
    expect(screen.getByRole("button", { name: "Cho thuê" })).toBeDisabled();
    expect(screen.getByText("Số không hợp lệ.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Bán lại cho làng · 2.000 xu" }));
    expect(screen.getByText("⚠️ Làng chỉ trả 2.000 xu (một nửa giá) — bán lại thửa 2?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Vẫn làm" }));
    expect(onAct).toHaveBeenLastCalledWith({ kind: "sell_back", plot: 2 }, "Đã bán lại thửa 2 cho làng — nhận 2.000 xu.");
    const offer = line("Lan trả 9.000 xu cho thửa 2 — còn 10 giờ");
    fireEvent.click(within(offer).getByRole("button", { name: "Từ chối" }));
    expect(onAct).toHaveBeenLastCalledWith({ kind: "decline_offer", offer: "o2" }, "Đã từ chối đề nghị.");
    fireEvent.click(within(offer).getByRole("button", { name: "Đồng ý" }));
    fireEvent.click(within(offer).getByRole("button", { name: "Vẫn làm" }));
    expect(onAct).toHaveBeenLastCalledWith({ kind: "accept_offer", offer: "o2" }, "Đã bán thửa 2 — nhận 9.000 xu.");
    fireEvent.click(within(line("Thửa 4 giá 5.000 xu — còn 20 giờ")).getByRole("button", { name: "Rút" }));
    expect(onAct).toHaveBeenLastCalledWith({ kind: "withdraw_offer", offer: "o1" }, "Đã rút đề nghị.");
  });
});
