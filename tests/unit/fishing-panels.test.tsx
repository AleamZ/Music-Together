import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import BagPanel from "@/components/game/fishing/BagPanel";
import DepotPanel from "@/components/game/fishing/DepotPanel";
import RecordsPanel from "@/components/game/fishing/RecordsPanel";
import ShopPanel from "@/components/game/fishing/ShopPanel";
import { shopItemFromRow, speciesFromRow, type FishingCatalog, type ShopItemRow } from "@/lib/game/fishing/catalog";
import type { FishingBoard } from "@/lib/game/fishing/rpc";
import { parseFishingState } from "@/lib/game/fishing/state";

afterEach(cleanup);

const row = (id: string, kind: string, name: string, price: number | null, over: Partial<ShopItemRow> = {}): ShopItemRow => ({
  id, kind, name, price, starter: price === null && kind !== "bait", sort_order: 0, zone_pct: null, weight_k: null, rare_mult: 1,
  window_ms: null, bite_min_ms: null, bite_max_ms: null, shows_rarity: false, mult_hiem: 1, mult_quy: 1, mult_legend: 1, capacity: null,
  ...over,
});
const CATALOG: FishingCatalog = {
  species: [
    speciesFromRow({ id: "ca_ro", name: "Cá rô đồng", rarity: 1, min_g: 50, max_g: 300, price_per_kg: 45, difficulty: 15, sort_order: 10 }),
    speciesFromRow({ id: "ca_loc", name: "Cá lóc", rarity: 2, min_g: 300, max_g: 2500, price_per_kg: 60, difficulty: 38, sort_order: 40 }),
  ],
  items: [
    row("rod_wood", "rod", "Cần gỗ", null, { zone_pct: 25, weight_k: 2, sort_order: 10 }),
    row("rod_bamboo", "rod", "Cần tre", 300, { zone_pct: 30, weight_k: 1.5, sort_order: 20 }),
    row("bobber_feather", "bobber", "Phao lông gà", null, { window_ms: 1500, bite_max_ms: 10000, sort_order: 10 }),
    row("bobber_foam", "bobber", "Phao xốp", 150, { window_ms: 2000, bite_max_ms: 10000, shows_rarity: true, sort_order: 20 }),
    row("bait_worm", "bait", "Trùn đất", null, { sort_order: 10 }),
    row("bait_shrimp", "bait", "Mồi tép", 5, { mult_hiem: 1.5, mult_quy: 1.5, mult_legend: 1.5, sort_order: 20 }),
    row("bait_box", "bait_box", "Hộp mồi", 250, { capacity: 60 }),
    row("bucket_small", "bucket", "Xô nhỏ", 200, { capacity: 5, sort_order: 10 }),
    row("bucket_large", "bucket", "Xô lớn", 800, { capacity: 15, sort_order: 20 }),
  ].map(shopItemFromRow),
};
const STATE = parseFishingState({
  coins: 120,
  loadout: { rod: "rod_wood", bobber: "bobber_feather", bait: "bait_worm" },
  owned: ["rod_bamboo", "bucket_small"],
  bait: { bait_worm: 3, bait_shrimp: 2 },
  bait_cap: 20,
  fish: [
    { id: "f1", species_id: "ca_loc", weight_g: 1200, price: 72, caught_at: "2026-09-24T10:00:00Z" },
    { id: "f2", species_id: "ca_ro", weight_g: 110, price: 5, caught_at: "2026-09-24T10:05:00Z" },
  ],
  fish_cap: 6,
})!;

describe("BagPanel", () => {
  it("lists the hand fish, the bucket, the gear and the baits, and changes the loadout", () => {
    const onEquip = vi.fn(), onRelease = vi.fn();
    render(<BagPanel state={STATE} catalog={CATALOG} busy={false} onEquip={onEquip} onRelease={onRelease} onClose={() => {}} />);
    expect(screen.getByText("Cá (2/6)")).toBeInTheDocument();
    const hand = screen.getByText("Trên tay").nextElementSibling as HTMLElement;
    expect(within(hand).getByText("Cá lóc")).toBeInTheDocument();
    const bucket = screen.getByText("Trong xô").nextElementSibling as HTMLElement;
    fireEvent.click(within(bucket).getByRole("button", { name: "Thả" }));
    expect(onRelease).toHaveBeenCalledWith("f2");
    fireEvent.click(within(screen.getByText("Cần tre").closest("li")!).getByRole("button", { name: "Dùng" }));
    expect(onEquip).toHaveBeenCalledWith({ rod: "rod_bamboo", bobber: "bobber_feather", bait: "bait_worm" });
    expect(screen.queryByText("Phao xốp")).toBeNull(); // not owned
    expect(screen.getByText("Mồi tép × 2")).toBeInTheDocument();
    expect(screen.getByText("Xô nhỏ · đựng 5 con")).toBeInTheDocument();
    expect(screen.getAllByText("✓ Đang dùng")).toHaveLength(3);
  });
});

describe("DepotPanel", () => {
  it("sells one fish or all of them", () => {
    const onSell = vi.fn();
    render(<DepotPanel state={STATE} catalog={CATALOG} busy={false} onSell={onSell} onClose={() => {}} />);
    fireEvent.click(within(screen.getByText("Cá rô đồng").closest("li")!).getByRole("button", { name: "Bán" }));
    expect(onSell).toHaveBeenLastCalledWith(["f2"]);
    fireEvent.click(screen.getByRole("button", { name: "Bán hết (2 con · 77 xu)" }));
    expect(onSell).toHaveBeenLastCalledWith(["f1", "f2"]);
  });
  it("has nothing to buy from an empty bucket", () => {
    render(<DepotPanel state={{ ...STATE, fish: [] }} catalog={CATALOG} busy={false} onSell={() => {}} onClose={() => {}} />);
    expect(screen.queryByRole("button", { name: /Bán hết/ })).toBeNull();
  });
});

describe("ShopPanel", () => {
  it("sells what is for sale: owned gear is marked, costly gear waits, bait comes by the handful", () => {
    const onBuy = vi.fn();
    render(<ShopPanel state={{ ...STATE, coins: 160 }} catalog={CATALOG} busy={false} onBuy={onBuy} onClose={() => {}} />);
    expect(screen.queryByText("Cần gỗ")).toBeNull(); // starter, not sold
    const tile = (name: string) => screen.getByText(name).closest("li")!;
    expect(within(tile("Cần tre")).getByRole("button", { name: "Đã có" })).toBeDisabled();
    expect(within(tile("Xô nhỏ")).getByRole("button", { name: "Đã có" })).toBeDisabled();
    expect(within(tile("Hộp mồi")).getByRole("button", { name: "Không đủ xu" })).toBeDisabled();
    fireEvent.click(within(tile("Phao xốp")).getByRole("button", { name: "Mua" }));
    expect(onBuy).toHaveBeenLastCalledWith("bobber_foam", 1);
    const shrimp = tile("Mồi tép");
    fireEvent.click(within(shrimp).getByRole("button", { name: "10" }));
    fireEvent.click(within(shrimp).getByRole("button", { name: "Mua 10 · 50 xu" }));
    expect(onBuy).toHaveBeenLastCalledWith("bait_shrimp", 10);
    expect(within(shrimp).getByRole("button", { name: "Tối đa 15" })).toBeInTheDocument();
  });
});

describe("RecordsPanel", () => {
  const BOARD: FishingBoard = {
    records: [{ speciesId: "ca_loc", username: "Dat", weightG: 2400 }], mine: [{ speciesId: "ca_ro", weightG: 210 }],
    richest: [{ username: "Dat", coins: 900 }, { username: "An", coins: 120 }], myRank: 2, myCoins: 120,
    prices: { mult: 2.24, wealth: 100000, endsAt: "2026-09-25T08:00:00+00:00", factors: { ca_ro: 1.12, ca_loc: 0.93 } },
  };
  it("shows the room records next to mine, and the richest members", async () => {
    render(<RecordsPanel catalog={CATALOG} load={async () => BOARD} onClose={() => {}} />);
    expect(await screen.findByText("Dat · 2,4 kg")).toBeInTheDocument();
    expect(screen.getByText("210 g")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Đại gia" }));
    expect(screen.getByText("Dat — 900 xu")).toBeInTheDocument();
    expect(screen.getByText("Bạn: hạng 2 · 120 xu")).toBeInTheDocument();
  });
  it("offers a retry when the board does not load", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValue(BOARD);
    render(<RecordsPanel catalog={CATALOG} load={load} onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Thử lại" }));
    expect(await screen.findByText("Dat · 2,4 kg")).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("shows the room's fish prices: the multiplier, when they change, and each species now", async () => {
    render(<RecordsPanel catalog={CATALOG} load={async () => BOARD} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "Giá cá" }));
    expect(await screen.findByText("Hệ số phòng ×2,24 · tài sản trung bình 100.000 xu · giá đổi lúc 15:00")).toBeInTheDocument();
    const [, ro, loc] = screen.getAllByRole("row");
    expect(within(ro).getByText("45 xu/kg")).toBeInTheDocument();
    expect(within(ro).getByText("113 xu/kg ▲")).toBeInTheDocument();
    expect(within(loc).getByText("60 xu/kg")).toBeInTheDocument();
    expect(within(loc).getByText("125 xu/kg ▼")).toBeInTheDocument();
    expect(screen.getByText("Giá chốt lúc câu được cá; bán sau vẫn giữ giá đó.")).toBeInTheDocument();
  });
  it("says so when the server sends no fish prices", async () => {
    render(<RecordsPanel catalog={CATALOG} load={async () => ({ ...BOARD, prices: null })} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "Giá cá" }));
    expect(await screen.findByText("Chưa có bảng giá.")).toBeInTheDocument();
  });
});
