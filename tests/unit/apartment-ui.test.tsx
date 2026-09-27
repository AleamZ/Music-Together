import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { AptList, Fridge, Layout } from "@/lib/game/housing/apartment";

const rpc = vi.hoisted(() => ({
  aptRent: vi.fn(), aptBuy: vi.fn(), aptEnter: vi.fn(), aptKnock: vi.fn(), aptAdmit: vi.fn(), aptMoveOut: vi.fn(), aptSetVisibility: vi.fn(),
  furnitureBuy: vi.fn(), fridgeState: vi.fn(), fishToFridge: vi.fn(), fishToBag: vi.fn(),
}));
vi.mock("@/lib/game/housing/apartment", async (orig) => ({ ...(await orig<object>()), ...rpc }));
import ApartmentModal from "@/components/game/housing/ApartmentModal";
import FridgePanel from "@/components/game/housing/FridgePanel";
import FurnitureShopModal from "@/components/game/housing/FurnitureShopModal";
import { parsePos } from "@/lib/game/housing/interior-net";

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); });

const list = (over: Partial<AptList> = {}): AptList => ({
  units: Array.from({ length: 12 }, (_, i) => ({ no: i + 1, status: "free" as const, ownerName: null, visibility: "private" as const, mine: false })),
  mine: null, storage: [], knocks: [], serverNowMs: 0, ...over,
});
const layout: Layout = { no: 4, ownerId: "o", ownerName: "An", canEdit: false, visibility: "open", wall: null, floor: null, items: [] };

describe("ApartmentModal", () => {
  it("rents a free flat; buying needs the coins", async () => {
    const onState = vi.fn();
    rpc.aptRent.mockResolvedValue(list());
    render(<ApartmentModal token="t" roomId="r" state={list()} coins={2000} onState={onState} onEnter={() => {}} onClose={() => {}} />);
    const unit = within(screen.getByTestId("apt-unit-7"));
    expect((unit.getByRole("button", { name: "Mua" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { fireEvent.click(unit.getByRole("button", { name: "Thuê" })); });
    expect(rpc.aptRent).toHaveBeenCalledWith("t", 7);
    expect(onState).toHaveBeenCalled();
  });

  it("shows my home, its knocks and lets a knocker in", async () => {
    rpc.aptAdmit.mockResolvedValue(list());
    const s = list({
      mine: { no: 2, tenure: "rent", paidUntilMs: 3 * 86400_000, graceUntilMs: 10 * 86400_000, visibility: "private", wall: null, floor: null },
      knocks: [{ accountId: "k", name: "Bình", atMs: 0 }],
    });
    s.units[1] = { no: 2, status: "rent", ownerName: "Tôi", visibility: "private", mine: true };
    render(<ApartmentModal token="t" roomId="r" state={s} coins={0} onState={() => {}} onEnter={() => {}} onClose={() => {}} />);
    expect(screen.getByTestId("apt-mine").textContent).toContain("Căn 2");
    expect(screen.getByTestId("apt-mine").textContent).toContain("3 ngày");
    // one home: the other flats cannot be rented
    expect((within(screen.getByTestId("apt-unit-5")).getByRole("button", { name: "Thuê" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Mở cửa" })); });
    expect(rpc.aptAdmit).toHaveBeenCalledWith("t", "k", true);
  });

  it("a locked door offers a knock; once the owner opens, I go in", async () => {
    vi.useFakeTimers();
    const onEnter = vi.fn();
    const s = list();
    s.units[3] = { no: 4, status: "own", ownerName: "An", visibility: "private", mine: false };
    rpc.aptEnter.mockRejectedValueOnce(new Error("no access")).mockResolvedValueOnce(layout);
    rpc.aptKnock.mockResolvedValue(true);
    render(<ApartmentModal token="t" roomId="r" state={s} coins={0} onState={() => {}} onEnter={onEnter} onClose={() => {}} />);
    const unit = within(screen.getByTestId("apt-unit-4"));
    await act(async () => { fireEvent.click(unit.getByRole("button", { name: "Vào" })); });
    expect(screen.getByRole("alert").textContent).toContain("gõ cửa");
    await act(async () => { fireEvent.click(unit.getByRole("button", { name: "✊ Gõ cửa" })); });
    expect(rpc.aptKnock).toHaveBeenCalledWith("t", "r", 4);
    expect(screen.getByText(/chờ chủ nhà mở/)).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(onEnter).toHaveBeenCalledWith(layout);
  });
});

describe("FurnitureShopModal", () => {
  it("lists a tab's items and buys one into storage", async () => {
    const onState = vi.fn();
    rpc.furnitureBuy.mockResolvedValue(list({ storage: [{ id: 1, item: "tv" }], coins: 100 }));
    render(<FurnitureShopModal token="t" coins={5000} storage={[]} onState={onState} onClose={() => {}} />);
    expect(screen.getByTestId("furniture-list").textContent).toContain("Giường gỗ");
    fireEvent.click(screen.getByRole("tab", { name: "📺 Điện máy" }));
    const items = screen.getByTestId("furniture-list");
    expect(items.textContent).toContain("Tủ lạnh lớn");
    expect((within(items).getByRole("button", { name: /Mua · 6\.000 xu/ }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { fireEvent.click(within(items).getByRole("button", { name: /Mua · 3\.000 xu/ })); });
    expect(rpc.furnitureBuy).toHaveBeenCalledWith("t", "tv");
    expect(onState).toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("Tivi");
  });
});

describe("FridgePanel", () => {
  it("moves a fish from the bag to the fridge and back", async () => {
    const f0: Fridge = { cap: 20, bag: 1, bagCap: 5, fish: [] };
    const f1: Fridge = { cap: 20, bag: 0, bagCap: 5, fish: [{ id: "a", speciesId: "ca_ro", weightG: 400, price: 30 }] };
    rpc.fridgeState.mockResolvedValue(f0);
    rpc.fishToFridge.mockResolvedValue(f1);
    rpc.fishToBag.mockResolvedValue(f0);
    const onBag = vi.fn();
    render(<FridgePanel token="t" bag={[{ id: "a", speciesId: "ca_ro", weightG: 400, price: 30, caughtAt: "" }]} speciesName={() => "Cá rô"}
      onBagChanged={onBag} onClose={() => {}} />);
    await act(async () => {});
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Cất tủ →" })); });
    expect(rpc.fishToFridge).toHaveBeenCalledWith("t", "a");
    expect(screen.getByTestId("fridge-fish").textContent).toContain("Cá rô");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "← Lấy ra" })); });
    expect(rpc.fishToBag).toHaveBeenCalledWith("t", "a");
    expect(onBag).toHaveBeenCalledTimes(2);
  });
});

describe("interior positions", () => {
  it("keep only sane positions", () => {
    expect(parsePos({ id: "a", x: 10, y: 20, f: "up", m: true })).toEqual({ id: "a", x: 10, y: 20, f: "up", m: true });
    expect(parsePos({ id: "a", x: 9999, y: 20, f: "up" })).toBeNull();
    expect(parsePos({ id: "a", x: 1, y: 2, f: "diag" })).toBeNull();
    expect(parsePos(null)).toBeNull();
  });
});
