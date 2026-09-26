import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import CoopPanel from "@/components/game/farm/CoopPanel";
import DryingPanel from "@/components/game/farm/DryingPanel";
import FarmShopPanel from "@/components/game/farm/FarmShopPanel";
import RiceDepotPanel from "@/components/game/farm/RiceDepotPanel";
import {
  critterFromRow, farmItemFromRow, uplandFromRow, varietyFromRow, type FarmCatalog, type UplandCropRow,
} from "@/lib/game/farm/catalog";
import { parseFieldState, type FieldState } from "@/lib/game/farm/state";
import fixtures from "@/tests/fixtures/upland-cases.json";

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
  uplands: [],
  critters: [],
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
    expect(screen.getByText("🌾 Giống lúa")).toBeInTheDocument();
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
    render(<RiceDepotPanel mine={STATE.mine} catalog={CATALOG} failed={false} busy={false} onSell={onSell} onSellProduce={noop} onReload={noop}
      onClose={noop} />);
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
  it("has nothing to buy without rice or hoa màu", () => {
    render(<RiceDepotPanel mine={{ ...STATE.mine, rice: {} }} catalog={CATALOG} failed={false} busy={false} onSell={noop} onSellProduce={noop}
      onReload={noop} onClose={noop} />);
    expect(screen.queryByRole("button", { name: /Bán/ })).toBeNull();
    expect(screen.getByText("“Chưa có lúa hay hoa màu hả con? Thu hoạch xong mang qua, cô trả giá cao!”")).toBeInTheDocument();
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
  it("waits while 2 of the batches are mine", () => {
    const two = { ...STATE, drying: [1, 2].map((slot) => ({ slot, owner: ME, variety: "nep", kg: 10, readyAt: NOW + 3_600_000 })) };
    render(<DryingPanel state={two} catalog={CATALOG} failed={false} me="me" busy={false} now={NOW} onAct={noop} onReload={noop} onClose={noop} />);
    expect(screen.getAllByText("Trống")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Phơi lúa" })).toBeDisabled();
    expect(screen.getByText("Bạn đang phơi 2 mẻ rồi — thu lúa trước nhé.")).toBeInTheDocument();
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
    expect(within(free).getByRole("button", { name: "Thuê · 10.000 xu" })).toBeDisabled();
    expect(within(free).getByText("Bạn đang canh tác 2 thửa rồi.")).toBeInTheDocument();
    cleanup();
    const relaxed = { ...STATE, plots: STATE.plots.map((p) => (p.no === 6 ? { ...p, farmer: null, lease: null } : p)) };
    const act2 = renderCoop({ ...relaxed, mine: { ...relaxed.mine, coins: 10_000 } });
    fireEvent.click(within(line("Thửa 7 · Trống")).getByRole("button", { name: "Thuê · 10.000 xu" }));
    expect(act2).toHaveBeenCalledWith({ kind: "rent", plot: 7 }, "Đã thuê thửa 7 trong 4 ngày.");
    expect(onAct).not.toHaveBeenCalled();
  });

  it("lists the private plots and who owns them", () => {
    renderCoop();
    tab("Đất tư");
    expect(within(line("Thửa 1 · làng bán")).getByRole("button", { name: "Mua · 800.000 xu" })).toBeDisabled();
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
    fireEvent.click(screen.getByRole("button", { name: "Vẫn làm" }));
    expect(onAct).toHaveBeenLastCalledWith({ kind: "offer", plot: 4, price: 6000 }, "Đã gửi đề nghị mua thửa 4 giá 6.000 xu.");
  });

  /** I own no land here, so I may offer for An's plot 3 and Lan's plot 4. */
  const MARKET = { ...STATE, plots: STATE.plots.map((p) => (p.no === 2 ? { ...p, owner: null, farmer: null } : p)) };

  it("asks before sending an offer, naming the plot and the price", () => {
    const onAct = renderCoop(MARKET);
    tab("Chợ đất");
    fireEvent.click(screen.getByRole("button", { name: "Thửa 3 (An)" }));
    fireEvent.change(screen.getByLabelText("Giá"), { target: { value: "7500" } });
    fireEvent.click(screen.getByRole("button", { name: "Gửi đề nghị" }));
    expect(screen.getByText("⚠️ Trả giá thửa 3 với 7.500 xu?")).toBeInTheDocument();
    expect(onAct).not.toHaveBeenCalled();
    // a new price drops the open question: the next one names it
    fireEvent.change(screen.getByLabelText("Giá"), { target: { value: "8000" } });
    expect(screen.queryByText(/Trả giá thửa/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Gửi đề nghị" }));
    expect(screen.getByText("⚠️ Trả giá thửa 3 với 8.000 xu?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Vẫn làm" }));
    expect(onAct).toHaveBeenCalledWith({ kind: "offer", plot: 3, price: 8000 }, "Đã gửi đề nghị mua thửa 3 giá 8.000 xu.");
  });

  it("clears the typed price when another plot is chosen", () => {
    renderCoop(MARKET);
    tab("Chợ đất");
    fireEvent.click(screen.getByRole("button", { name: "Thửa 3 (An)" }));
    fireEvent.change(screen.getByLabelText("Giá"), { target: { value: "7500" } });
    fireEvent.click(screen.getByRole("button", { name: "Thửa 3 (An)" }));
    expect(screen.getByLabelText("Giá")).toHaveValue(7500);
    fireEvent.click(screen.getByRole("button", { name: "Thửa 4 (Lan)" }));
    expect(screen.getByLabelText("Giá")).toHaveValue(null);
  });

  it("forgets the chosen plot when it leaves the market, without picking another", () => {
    const onAct = vi.fn();
    const view = (state: FieldState) => (
      <CoopPanel state={state} failed={false} me="me" busy={false} now={NOW} onAct={onAct} onReload={noop} onClose={noop} />
    );
    const { rerender } = render(view(MARKET));
    tab("Chợ đất");
    // nothing is chosen at first
    expect(screen.getByRole("button", { name: "Thửa 3 (An)" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "Thửa 4 (Lan)" }));
    fireEvent.change(screen.getByLabelText("Giá"), { target: { value: "6000" } });
    // Lan sells plot 4 back to the village
    rerender(view({ ...MARKET, plots: MARKET.plots.map((p) => (p.no === 4 ? { ...p, owner: null, farmer: null } : p)) }));
    expect(screen.queryByRole("button", { name: "Thửa 4 (Lan)" })).toBeNull();
    expect(screen.getByRole("button", { name: "Thửa 3 (An)" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByLabelText("Giá")).toHaveValue(null);
    expect(screen.getByRole("button", { name: "Gửi đề nghị" })).toBeDisabled();
    // even when a plot of that number comes back to the market, it is not chosen again
    rerender(view(MARKET));
    expect(screen.getByRole("button", { name: "Thửa 4 (Lan)" })).toHaveAttribute("aria-pressed", "false");
    expect(onAct).not.toHaveBeenCalled();
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
    fireEvent.change(screen.getByLabelText("Cho thuê một vụ"), { target: { value: "100001" } });
    expect(screen.getByRole("button", { name: "Cho thuê" })).toBeDisabled();
    expect(screen.getByText("Số không hợp lệ.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Bán lại cho làng · 400.000 xu" }));
    expect(screen.getByText("⚠️ Làng chỉ trả 400.000 xu (một nửa giá) — bán lại thửa 2?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Vẫn làm" }));
    expect(onAct).toHaveBeenLastCalledWith({ kind: "sell_back", plot: 2 }, "Đã bán lại thửa 2 cho làng — nhận 400.000 xu.");
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

describe("v15.2: the shop's tools, cô Út's hoa màu and chú Tám's harvester", () => {
  const khoai = uplandFromRow((fixtures as unknown as { crops: UplandCropRow[] }).crops.find((r) => r.id === "khoai")!);
  const BEDS: FarmCatalog = {
    ...CATALOG, uplands: [khoai],
    items: [
      ...CATALOG.items, item("seed_khoai", "seed", "Dây khoai giống", 800, { upland: "khoai" }), item("tool_sickle", "tool", "Liềm", 1500),
      item("tool_sprayer", "tool", "Bình phun", 5000),
    ],
  };

  it("sorts the shop into five sections, and sells a tool once, without a stepper", () => {
    const onBuy = vi.fn();
    render(<FarmShopPanel mine={{ ...STATE.mine, coins: 3000, items: { tool_sprayer: 1 } }} catalog={BEDS} failed={false} busy={false}
      onBuy={onBuy} onReload={noop} onClose={noop} />);
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(
      ["🌾 Giống lúa", "🥔 Giống hoa màu", "🧺 Phân bón", "🧴 Thuốc", "🛠️ Nông cụ"]);
    expect(within(screen.getByText("Dây khoai giống").closest("li")!).getByText("Trồng dây · chín ~48 giờ · 200 kg/thửa · 265 xu/kg")).toBeInTheDocument();
    const sickle = screen.getByText("Liềm").closest("li")!;
    expect(within(sickle).queryByRole("group")).toBeNull();
    expect(within(sickle).getByText("Gặt lúa tay, 6 phần — mua một lần")).toBeInTheDocument();
    fireEvent.click(within(sickle).getByRole("button", { name: "Mua · 1.500 xu" }));
    expect(onBuy).toHaveBeenCalledWith("tool_sickle", 1);
    expect(within(screen.getByText("Bình phun").closest("li")!).getByRole("button", { name: "✓ Đã có" })).toBeDisabled();
    cleanup();
    render(<FarmShopPanel mine={{ ...STATE.mine, coins: 1000, items: {} }} catalog={BEDS} failed={false} busy={false} onBuy={onBuy}
      onReload={noop} onClose={noop} />);
    expect(within(screen.getByText("Liềm").closest("li")!).getByRole("button", { name: "Không đủ xu" })).toBeDisabled();
  });

  it("buys hoa màu fresh, some or all", () => {
    const onSellProduce = vi.fn();
    render(<RiceDepotPanel mine={{ ...STATE.mine, rice: {}, produce: { khoai: 180 } }} catalog={BEDS} failed={false} busy={false} onSell={noop}
      onSellProduce={onSellProduce} onReload={noop} onClose={noop} />);
    expect(screen.getByText("“Hoa màu bán tươi, khỏi phơi — cô lấy hết!”")).toBeInTheDocument();
    const row = screen.getByText("Khoai lang · 180 kg").closest("li")!;
    expect(within(row).getByText("265 xu/kg · bán tươi")).toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button", { name: "Bán · 2.650 xu" }));
    expect(onSellProduce).toHaveBeenLastCalledWith("khoai", 10);
    fireEvent.click(within(row).getByRole("button", { name: "Bán hết · 47.700 xu" }));
    expect(onSellProduce).toHaveBeenLastCalledWith("khoai", 180);
  });

  /** Plot 6, rented by me, with `crop`; plot 7 free. */
  const riceState = (crop: Record<string, unknown> | null, coins = 10_000): FieldState => parseFieldState({
    server_now: iso(0),
    plots: [bare(6, "village", { farmer: ME, lease: lease(5), crop }), bare(7, "village")],
    drying: [],
    mine: { items: {}, rice: {}, coins, gift_claimed: true, owned_plot: null, farming: [6], my_offers: [], incoming_offers: [] },
  })!;
  /** Nếp transplanted 62 h ago: overripe for 2 h; drained; 2 parts cut. */
  const OVERRIPE = {
    variety: "nep", phase: "overripe", prepared_at: iso(-80), soak_at: iso(-79), sow_at: iso(-76), transplant_at: iso(-62), water: 1,
    water_set_at: iso(-3), pests: [], excess_n: false, ripe: true, rotted_at: null, parts: 2,
    log: { water: [{ t: iso(-80), l: 3 }, { t: iso(-3), l: 1 }], fert: [], spray: [], picks: [], q_transplant: 1, harvested_kg: 25 },
  };
  const coop = (state: FieldState) => {
    const onAct = vi.fn();
    render(<CoopPanel state={state} catalog={CATALOG} failed={false} me="me" busy={false} now={NOW} onAct={onAct} onReload={noop} onClose={noop} />);
    return onAct;
  };

  it("opens on Máy gặt when my rice is ripe, and rents the harvester after asking", () => {
    const onAct = coop(riceState(OVERRIPE));
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Đất làng", "Đất tư", "Chợ đất", "Máy gặt", "Của tôi"]);
    expect(screen.getByRole("tab", { name: "Máy gặt" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("“Máy gặt của hợp tác xã: 500 xu mỗi phần, cả thửa 3.000 xu, 30 giây là xong, khỏi cầm liềm. Nhớ rút nước trước nghen!”"))
      .toBeInTheDocument();
    const row = screen.getByText("Thửa 6 · Nếp · Chín quá 2 giờ · đã gặt 2/6 phần").closest("li")!;
    fireEvent.click(within(row).getByRole("button", { name: "Thuê máy gặt · 4 phần · 2.000 xu" }));
    expect(screen.getByText("⚠️ Thuê máy gặt cho thửa 6, 4 phần còn lại, giá 2.000 xu? Không huỷ được.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Vẫn làm" }));
    expect(onAct).toHaveBeenCalledWith({ kind: "rent_harvester", plot: 6 }, "🚜 Máy gặt đang vào thửa 6 — 30 giây nữa xong.");
  });

  it("says why the harvester cannot come, and counts a running one down", () => {
    coop(riceState(OVERRIPE, 1000));
    expect(within(screen.getByText(/^Thửa 6 · Nếp/).closest("li")!).getByRole("button", { name: /^Thuê máy gặt/ })).toBeDisabled();
    expect(screen.getByText("Không đủ xu.")).toBeInTheDocument();
    cleanup();
    coop(riceState({ ...OVERRIPE, water: 2, log: { ...OVERRIPE.log, water: [{ t: iso(-80), l: 3 }, { t: iso(-1), l: 2 }] } }));
    expect(screen.getByText("Mực nước chưa đúng — xem Sổ tay.")).toBeInTheDocument();
    cleanup();
    coop(riceState({ ...OVERRIPE, harvester: { started_at: iso(0), ends_at: new Date(NOW + 25_000).toISOString() } }));
    expect(screen.getByText("🚜 Máy gặt đang gặt — còn 25 giây")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Thuê máy gặt/ })).toBeNull();
  });

  it("opens on Đất làng otherwise, and says so when I farm no rice here", () => {
    coop(riceState(null));
    expect(screen.getByRole("tab", { name: "Đất làng" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: "Máy gặt" }));
    expect(screen.getByText("Bạn chưa làm ruộng lúa nào trong phòng này.")).toBeInTheDocument();
  });
});

describe("v15.3: anh Hai's containers and cô Út's cua & ốc", () => {
  const KINDS = [
    critterFromRow({ id: "cua_dong", name: "Cua đồng", grp: "crab", base_price: 12, sort_order: 10 }),
    critterFromRow({ id: "cua_gach", name: "Cua gạch", grp: "crab", base_price: 45, sort_order: 20 }),
    critterFromRow({ id: "oc_dong", name: "Ốc đồng", grp: "snail", base_price: 8, sort_order: 30 }),
    critterFromRow({ id: "oc_buou_vang", name: "Ốc bươu vàng", grp: "snail", base_price: 2, sort_order: 40 }),
  ];
  const GATHERING: FarmCatalog = {
    ...CATALOG, critters: KINDS,
    items: [
      ...CATALOG.items, item("tool_sickle", "tool", "Liềm", 1500),
      item("box_bucket", "critter_box", "Xô nhựa", 1500, { sort_order: 10, capacity: 15 }),
      item("box_basket", "critter_box", "Giỏ tre", 6000, { sort_order: 20, capacity: 30 }),
    ],
  };
  const shop = (coins: number, items: Record<string, number>, onBuy = vi.fn()) => {
    render(<FarmShopPanel mine={{ ...STATE.mine, coins, items }} catalog={GATHERING} failed={false} busy={false} onBuy={onBuy}
      onReload={noop} onClose={noop} />);
    return onBuy;
  };
  const row = (name: string) => screen.getByText(name).closest("li")!;

  it("sells the containers once each, after Nông cụ, and no smaller one than mine", () => {
    const onBuy = shop(10_000, {});
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(
      ["🌾 Giống lúa", "🧺 Phân bón", "🧴 Thuốc", "🛠\uFE0F Nông cụ", "🪣 Đồ đựng cua ốc"]);
    expect(within(row("Xô nhựa")).queryByRole("group")).toBeNull();
    expect(within(row("Xô nhựa")).getByText("Đựng thêm 15 con cua, ốc (tay cầm được 3 con)")).toBeInTheDocument();
    fireEvent.click(within(row("Xô nhựa")).getByRole("button", { name: "Mua · 1.500 xu" }));
    expect(onBuy).toHaveBeenCalledWith("box_bucket", 1);
    cleanup();
    shop(10_000, { box_basket: 1 });
    expect(within(row("Giỏ tre")).getByRole("button", { name: "✓ Đã có" })).toBeDisabled();
    expect(within(row("Xô nhựa")).getByRole("button", { name: "Đã có giỏ tre lớn hơn" })).toBeDisabled();
    cleanup();
    shop(10_000, { box_bucket: 1 });
    expect(within(row("Giỏ tre")).getByRole("button", { name: "Mua · 6.000 xu" })).toBeEnabled();
    cleanup();
    shop(1000, {});
    expect(within(row("Xô nhựa")).getByRole("button", { name: "Không đủ xu" })).toBeDisabled();
  });

  it("buys cua & ốc at the prices fixed at the catch, a kind or all, under today's prices", () => {
    const onSell = vi.fn();
    const mine = { ...STATE.mine, rice: {}, critters: { cua_dong: { n: 5, xu: 130 }, oc_buou_vang: { n: 1, xu: 4 } } };
    render(<RiceDepotPanel mine={mine} catalog={GATHERING} failed={false} busy={false} onSell={noop} onSellProduce={noop} onReload={noop}
      onClose={noop} critters={{ prices: { mult: 2.24, endsAt: null }, onSell }} />);
    expect(screen.getByRole("heading", { name: "🦀 Cua & ốc" })).toBeInTheDocument();
    expect(screen.getByText("Giá hôm nay ×2,24: cua đồng 26 · cua gạch 100 · ốc đồng 17 · ốc bươu vàng 4 xu/con")).toBeInTheDocument();
    fireEvent.click(within(row("Cua đồng × 5 · 130 xu")).getByRole("button", { name: "Bán 5 con · 130 xu" }));
    expect(onSell).toHaveBeenLastCalledWith("cua_dong");
    fireEvent.click(within(row("Ốc bươu vàng × 1 · 4 xu")).getByRole("button", { name: "Bán 1 con · 4 xu" }));
    expect(onSell).toHaveBeenLastCalledWith("oc_buou_vang");
    fireEvent.click(screen.getByRole("button", { name: "Bán hết cua ốc · 134 xu" }));
    expect(onSell).toHaveBeenLastCalledWith(null);
    expect(screen.getByText("Giá chốt lúc bắt được; bán sau vẫn giữ giá đó.")).toBeInTheDocument();
    expect(screen.queryByText(/Chưa có lúa/)).toBeNull();
  });

  it("names cua & ốc among what cô Út takes once 0018 is in, and shows its prices with nothing held", () => {
    render(<RiceDepotPanel mine={{ ...STATE.mine, rice: {} }} catalog={GATHERING} failed={false} busy={false} onSell={noop}
      onSellProduce={noop} onReload={noop} onClose={noop} critters={{ prices: { mult: 1, endsAt: null }, onSell: noop }} />);
    expect(screen.getByText("“Chưa có lúa, hoa màu hay cua ốc hả con? Có hàng mang qua, cô trả giá cao!”")).toBeInTheDocument();
    expect(screen.getByText("Giá hôm nay ×1,00: cua đồng 12 · cua gạch 45 · ốc đồng 8 · ốc bươu vàng 2 xu/con")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Bán/ })).toBeNull();
    cleanup();
    render(<RiceDepotPanel mine={{ ...STATE.mine, rice: {} }} catalog={CATALOG} failed={false} busy={false} onSell={noop}
      onSellProduce={noop} onReload={noop} onClose={noop} />);
    expect(screen.getByText("“Chưa có lúa hay hoa màu hả con? Thu hoạch xong mang qua, cô trả giá cao!”")).toBeInTheDocument();
    expect(screen.queryByText("🦀 Cua & ốc")).toBeNull();
  });
});
