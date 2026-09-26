import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import BagPanel from "@/components/game/fishing/BagPanel";
import FarmShopPanel from "@/components/game/farm/FarmShopPanel";
import PlotPanel from "@/components/game/farm/PlotPanel";
import RatChip from "@/components/game/farm/RatChip";
import RiceDepotPanel from "@/components/game/farm/RiceDepotPanel";
import Stepper from "@/components/game/farm/Stepper";
import { farmItemFromRow, varietyFromRow } from "@/lib/game/farm/catalog";
import { parseFarmMine, parseFieldState } from "@/lib/game/farm/state";
import type { FishingCatalog } from "@/lib/game/fishing/catalog";
import { parseFishingState } from "@/lib/game/fishing/state";

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const NOW = Date.parse("2026-09-26T10:00:00Z");
const iso = (h: number) => new Date(NOW + h * 3_600_000).toISOString();
const item = (id: string, kind: string, name: string, price: number, sort: number) =>
  farmItemFromRow({ id, kind, name, price, sort_order: sort, variety: null, fert: null, pest_target: null, capacity: null });
const SLING = item("tool_sling", "tool", "Ná", 3000, 30);
const PELLET = item("ammo_pellet", "ammo", "Đạn đất", 10, 10);
const FOOD = item("food_dog", "pet_food", "Thức ăn chó", 150, 20);
const nep = varietyFromRow({ id: "nep", name: "Nếp", scale: 1, base_kg: 75, price_per_kg: 18, blast_mult: 1, sort_order: 20 });
const CATALOG = { varieties: [nep], uplands: [], critters: [], items: [SLING, PELLET, FOOD] };
const mine = (over: Record<string, unknown> = {}) => parseFarmMine({ items: {}, rice: {}, coins: 5000, gift_claimed: true, ...over })!;

describe("Stepper's by (v17 §12.4)", () => {
  it("moves by `by`, inside [min, max]", () => {
    const onChange = vi.fn();
    const { rerender } = render(<Stepper value={10} max={35} by={10} label="Số lượng" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Thêm" }));
    expect(onChange).toHaveBeenLastCalledWith(20);
    fireEvent.click(screen.getByRole("button", { name: "Bớt" }));
    expect(onChange).toHaveBeenLastCalledWith(1);
    rerender(<Stepper value={30} max={35} by={10} label="Số lượng" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Thêm" }));
    expect(onChange).toHaveBeenLastCalledWith(35);
  });
});

describe("FarmShopPanel, v17 (§12.4)", () => {
  const show = (m = mine()) => {
    const onBuy = vi.fn();
    render(<FarmShopPanel mine={m} catalog={CATALOG} failed={false} busy={false} onBuy={onBuy} onReload={vi.fn()} onClose={vi.fn()} />);
    return onBuy;
  };

  it("sells the ná once, under Nông cụ", () => {
    const onBuy = show();
    fireEvent.click(screen.getByRole("button", { name: "Mua · 3.000 xu" }));
    expect(onBuy).toHaveBeenCalledWith("tool_sling", 1);
    cleanup();
    show(mine({ items: { tool_sling: 1 } }));
    expect(screen.getByRole("button", { name: "✓ Đã có" })).toBeDisabled();
  });

  it("sells pellets by 10 up to 99 held, and dog food by the bịch", () => {
    const onBuy = show(mine({ items: { ammo_pellet: 75 } }));
    expect(screen.getByRole("heading", { name: "🐾 Đạn & thức ăn chó" })).toBeInTheDocument();
    expect(screen.getByText(/10 xu\/viên · có 75/)).toBeInTheDocument();
    expect(screen.getByText(/150 xu\/bịch · no 24 giờ · có 0/)).toBeInTheDocument();
    const pellets = screen.getByRole("group", { name: "Số lượng Đạn đất" });
    fireEvent.click(pellets.querySelector("button[aria-label='Thêm']")!);
    fireEvent.click(pellets.querySelector("button[aria-label='Thêm']")!);
    // 99 − 75 = 24 at most
    fireEvent.click(screen.getByRole("button", { name: "Mua 24 viên · 240 xu" }));
    expect(onBuy).toHaveBeenCalledWith("ammo_pellet", 24);
    fireEvent.click(screen.getByRole("button", { name: "Mua 1 · 150 xu" }));
    expect(onBuy).toHaveBeenCalledWith("food_dog", 1);
  });

  it("starts pellets at 10, or at what the coins pay for", () => {
    show(mine({ coins: 70 }));
    expect(screen.getByRole("button", { name: "Mua 7 viên · 70 xu" })).toBeInTheDocument();
    cleanup();
    show();
    expect(screen.getByRole("button", { name: "Mua 10 viên · 100 xu" })).toBeInTheDocument();
  });
});

describe("RiceDepotPanel, v17 (§12.4)", () => {
  const show = (m = mine(), rats: { price: number; onSell: () => void } | null = { price: 336, onSell: vi.fn() }) =>
    render(<RiceDepotPanel mine={m} catalog={CATALOG} failed={false} busy={false} onSell={vi.fn()} onSellProduce={vi.fn()}
      onReload={vi.fn()} onClose={vi.fn()} critters={{ prices: null, onSell: vi.fn() }} rats={rats} />);

  it("sells the whole rat bag at its fixed prices, with today's price under it", () => {
    const onSell = vi.fn();
    show(mine({ rats: { count: 3, value: 486 } }), { price: 336, onSell });
    expect(screen.getByText("🐀 Chuột đồng · 3 con")).toBeInTheDocument();
    expect(screen.getByText("486 xu (giá chốt lúc bắt)")).toBeInTheDocument();
    expect(screen.getByText("Giá chuột bây giờ: 336 xu một con")).toBeInTheDocument();
    expect(screen.getByText("“Chuột đồng béo vậy, cô lấy hết — đem nướng lu là ngon số một!”")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Bán hết · 486 xu" }));
    expect(onSell).toHaveBeenCalled();
  });

  it("adds rats to the empty text, and has no rat row before 0019", () => {
    show();
    expect(screen.getByText("“Chưa có lúa, hoa màu, cua ốc hay chuột hả con? Có hàng mang qua, cô trả giá cao!”")).toBeInTheDocument();
    cleanup();
    show(mine({ rats: { count: 3, value: 486 } }), null);
    expect(screen.queryByText(/Chuột đồng/)).toBeNull();
    expect(screen.getByText("“Chưa có lúa, hoa màu hay cua ốc hả con? Có hàng mang qua, cô trả giá cao!”")).toBeInTheDocument();
  });
});

describe("BagPanel's Nông cụ, v17 (§12.4)", () => {
  const FISH: FishingCatalog = { items: [], species: [] };
  const STATE = parseFishingState({
    coins: 0, loadout: { rod: "rod_wood", bobber: "bobber_feather", bait: "bait_worm" }, owned: [], bait: {}, bait_cap: 20, fish: [], fish_cap: 6,
  })!;
  const show = (m: ReturnType<typeof mine>, items = CATALOG.items) => render(
    <BagPanel state={STATE} catalog={FISH} busy={false} onEquip={vi.fn()} onRelease={vi.fn()} onClose={vi.fn()}
      farm={{ mine: m, items, critters: [], now: NOW, busy: false, onLoad: vi.fn() }} />,
  );

  it("names the ná and its pellets, or where to buy it, and the dog food held", () => {
    show(mine({ items: { tool_sling: 1, ammo_pellet: 12, food_dog: 3 } }));
    expect(screen.getByText("Ná — còn 12 viên đạn đất")).toBeInTheDocument();
    expect(screen.getByText("Thức ăn chó — 3 bịch")).toBeInTheDocument();
    cleanup();
    show(mine());
    expect(screen.getByText("Chưa có ná — tiệm anh Hai bán 3.000 xu")).toBeInTheDocument();
    expect(screen.queryByText(/Thức ăn chó/)).toBeNull();
    cleanup();
    show(mine(), []);
    expect(screen.queryByText(/ná/)).toBeNull();
  });
});

describe("PlotPanel, v17 (§12.1)", () => {
  const field = (rats: Record<string, unknown>) => parseFieldState({
    server_now: iso(0),
    plots: [{
      no: 6, kind: "village", owner: null, sale_price: null, sublease_price: null, farmer: null, lease: null, offers: 0,
      crop: {
        variety: "nep", phase: "ripe", prepared_at: iso(-64), soak_at: iso(-63), sow_at: iso(-60), transplant_at: iso(-50), water: 1,
        water_set_at: iso(-3), pests: [], excess_n: false, ripe: true, rotted_at: null,
        log: { water: [], fert: [], spray: [], picks: [], q_transplant: 1 },
      },
    }],
    drying: [],
    mine: { items: {}, rice: {}, coins: 1, gift_claimed: true },
    rats: { next_at: iso(1), price: 150, live: [], recent: [], plots: {}, ...rats },
  });
  const show = (rats: Record<string, unknown>) => {
    const onOpenHandbook = vi.fn();
    render(<PlotPanel no={6} state={field(rats)} catalog={CATALOG} failed={false} me="me" busy={false} now={NOW} onAct={vi.fn()}
      onOpenHandbook={onOpenHandbook} onReload={vi.fn()} onClose={vi.fn()} />);
    return onOpenHandbook;
  };

  it("says how many rats eat and what they took, and links the rats' tab", () => {
    const onOpenHandbook = show({
      live: [{ id: 1, plot: 6, since: iso(-2), seed: 1 }, { id: 2, plot: 6, since: iso(-1), seed: 2 }],
      plots: { 6: [{ r: 1, from: iso(-2), to: null }, { r: 2, from: iso(-1), to: null }] },
    });
    expect(screen.getByText("🐀 2 con chuột đang ăn · đã mất ~6% (tối đa 10%)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "📖 Sổ tay: Chuột, chó & ná" }));
    expect(onOpenHandbook).toHaveBeenCalledWith("rats");
  });

  it("says under 1% for a short visit, and nothing without rats", () => {
    show({ plots: { 6: [{ r: 1, from: iso(-0.2), to: iso(-0.1) }] } });
    expect(screen.getByText("🐀 0 con chuột đang ăn · đã mất dưới 1% (tối đa 10%)")).toBeInTheDocument();
    cleanup();
    show({});
    expect(screen.queryByText(/con chuột đang ăn/)).toBeNull();
  });
});

describe("RatChip (v17 §12.1)", () => {
  it("counts the live rats and opens the handbook; nothing without rats", () => {
    const onOpen = vi.fn();
    const { rerender } = render(<RatChip live={2} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: "Mùa chuột: 2 con chuột đang phá đồng — mở Sổ tay" }));
    expect(screen.getByText("🐀 Mùa chuột · 2 con")).toBeInTheDocument();
    expect(onOpen).toHaveBeenCalled();
    rerender(<RatChip live={0} onOpen={onOpen} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
