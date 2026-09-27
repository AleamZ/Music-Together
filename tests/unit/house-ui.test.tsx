import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { HouseList, StreetLot } from "@/lib/game/housing/house";

const rpc = vi.hoisted(() => ({
  lotBuy: vi.fn(), lotUpkeep: vi.fn(), lotSell: vi.fn(), houseBuild: vi.fn(), houseRoomPrice: vi.fn(), houseRoomRent: vi.fn(),
  houseRoomLeave: vi.fn(), houseEnter: vi.fn(), houseSetVisibility: vi.fn(),
}));
vi.mock("@/lib/game/housing/house", async (orig) => ({ ...(await orig<object>()), ...rpc }));
import HouseBuilder from "@/components/game/housing/HouseBuilder";
import { allowedRooms, houseSpace } from "@/components/game/housing/HouseView";
import LotModal from "@/components/game/housing/LotModal";
import { HOUSE_TEMPLATES, type HouseLayout } from "@/lib/game/housing/house";
import { parsePos } from "@/lib/game/housing/interior-net";
import { getMap } from "@/lib/game/maps/registry";
import { findPath } from "@/lib/game/pathfinding";

// jsdom has no 2D canvas: the builder draws nothing here (and says nothing about it)
beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });

const DAY = 86_400_000;
const TWO = HOUSE_TEMPLATES[1].design;
const lot = (no: number, over: Partial<StreetLot> = {}): StreetLot => ({
  no, owned: false, ownerName: null, mine: false, grid: null, roof: "ngoi", visibility: "private", rooms: [], ...over,
});
const list = (over: Partial<HouseList> = {}): HouseList => ({
  lots: Array.from({ length: 8 }, (_, i) => lot(i + 1)), mine: null, tenancy: null, serverNowMs: 0, ...over,
});

describe("LotModal", () => {
  it("buys a free lot; one home per account", async () => {
    const onState = vi.fn();
    rpc.lotBuy.mockResolvedValue(list());
    const { rerender } = render(<LotModal token="t" roomId="r" lot={3} state={list()} coins={50000} hasFlat={false}
      onState={onState} onBuild={() => {}} onEnter={() => {}} onClose={() => {}} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Mua lô đất/ })); });
    expect(rpc.lotBuy).toHaveBeenCalledWith("t", 3);
    expect(onState).toHaveBeenCalled();
    rerender(<LotModal token="t" roomId="r" lot={3} state={list()} coins={50000} hasFlat onState={onState} onBuild={() => {}} onEnter={() => {}} onClose={() => {}} />);
    expect((screen.getByRole("button", { name: /Mua lô đất/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("my lot: upkeep, build, list a room, see the tenant", async () => {
    rpc.houseRoomPrice.mockResolvedValue(list());
    const onBuild = vi.fn();
    const s = list({
      mine: { no: 2, paidUntilMs: 20 * DAY, repossessMs: 80 * DAY, buildCost: 1500, visibility: "private", wall: null, floor: null,
        rooms: [{ no: 1, cells: 16, price: null, tenantName: null, untilMs: null }, { no: 2, cells: 24, price: 900, tenantName: "Bình", untilMs: 10 * DAY }] },
    });
    s.lots[1] = lot(2, { owned: true, ownerName: "Tôi", mine: true, grid: TWO, roof: "tole" });
    render(<LotModal token="t" roomId="r" lot={2} state={s} coins={9000} hasFlat={false} onState={() => {}} onBuild={onBuild} onEnter={() => {}} onClose={() => {}} />);
    const mine = screen.getByTestId("lot-mine");
    expect(mine.textContent).toContain("20 ngày");
    expect(mine.textContent).toContain("tôn xanh");
    expect(screen.getByTestId("lot-room-2").textContent).toContain("Bình");
    fireEvent.click(within(mine).getByRole("button", { name: /Sửa nhà/ }));
    expect(onBuild).toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Giá phòng 1"), { target: { value: "1200" } });
    await act(async () => { fireEvent.click(within(screen.getByTestId("lot-room-1")).getByRole("button", { name: "Cho thuê" })); });
    expect(rpc.houseRoomPrice).toHaveBeenCalledWith("t", 1, 1200);
  });

  it("someone else's lot: rent a listed room, go in", async () => {
    rpc.houseRoomRent.mockResolvedValue(list());
    const layout = { lot: 4 } as HouseLayout;
    rpc.houseEnter.mockResolvedValue(layout);
    const onEnter = vi.fn();
    const s = list();
    s.lots[3] = lot(4, { owned: true, ownerName: "An", grid: TWO, rooms: [
      { no: 1, cells: 16, price: 800, taken: false, mine: false }, { no: 2, cells: 24, price: 700, taken: true, mine: false },
    ] });
    render(<LotModal token="t" roomId="r" lot={4} state={s} coins={5000} hasFlat={false} onState={() => {}} onBuild={() => {}} onEnter={onEnter} onClose={() => {}} />);
    const rent = screen.getByTestId("lot-for-rent");
    expect(rent.textContent).toContain("Đã có người thuê");
    await act(async () => { fireEvent.click(within(rent).getByRole("button", { name: "Thuê phòng" })); });
    expect(rpc.houseRoomRent).toHaveBeenCalledWith("t", 4, 1);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "🚪 Vào nhà" })); });
    expect(rpc.houseEnter).toHaveBeenCalledWith("t", "r", 4);
    expect(onEnter).toHaveBeenCalledWith(layout);
  });
});

describe("HouseBuilder", () => {
  it("starts from a template, shows the rooms and the price, saves", async () => {
    rpc.houseBuild.mockResolvedValue(list());
    const onClose = vi.fn();
    render(<HouseBuilder token="t" lot={2} grid={null} roof="ngoi" coins={100000} hasTenants={false} onState={() => {}} onClose={onClose} />);
    const save = () => screen.getByRole("button", { name: /Lưu/ }) as HTMLButtonElement;
    expect(save().disabled).toBe(true);                      // nothing changed yet
    fireEvent.click(screen.getByRole("button", { name: /Nhà 2 phòng/ }));
    expect(screen.getByTestId("builder-status").textContent).toContain("2 phòng");
    expect(save().disabled).toBe(false);
    await act(async () => { fireEvent.click(save()); });
    expect(rpc.houseBuild).toHaveBeenCalledWith("t", TWO, "ngoi");
    expect(onClose).toHaveBeenCalled();
  });

  it("with tenants only the roof can change", () => {
    render(<HouseBuilder token="t" lot={2} grid={TWO} roof="ngoi" coins={0} hasTenants onState={() => {}} onClose={() => {}} />);
    expect(screen.queryByRole("button", { name: /Nhà 2 phòng/ })).toBeNull();
    expect((screen.getByRole("button", { name: /Tường/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "la" } });
    expect((screen.getByRole("button", { name: /Lưu/ }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("the house as an interior", () => {
  const layout = (over: Partial<HouseLayout>): HouseLayout => ({
    lot: 2, ownerId: "o", ownerName: "An", canEdit: false, myRoom: null, visibility: "open", grid: TWO, roof: "ngoi", wall: null, floor: null,
    rooms: [{ no: 1, price: null, tenantName: null, untilMs: null }, { no: 2, price: 900, tenantName: "Bình", untilMs: 9 }], items: [], ...over,
  });
  it("the owner furnishes the rooms nobody rents; a tenant their own; a visitor none", () => {
    expect(allowedRooms(layout({ canEdit: true }))).toEqual([1]);
    expect(allowedRooms(layout({ myRoom: 2 }))).toEqual([2]);
    expect(allowedRooms(layout({}))).toEqual([]);
    const s = houseSpace("t", "r", 2, false, true);
    expect(s.key).toBe("house:2");
    expect(s.surface).toBeNull();
    expect(s.sleep).not.toBeNull();
    expect(s.canDecorate(layout({ myRoom: 2 }))).toBe(true);
    expect(s.canDecorate(layout({}))).toBe(false);
    const bed = { id: 5, item: "bed_go", x: 3, y: 2, rot: 0 };
    expect(s.mayUse(layout({ myRoom: 2, items: [{ ...bed, mine: false }] }), bed)).toBe(false);   // room 1's bed
    expect(s.mayUse(layout({ canEdit: true, items: [{ ...bed, mine: true }] }), bed)).toBe(true);
    expect(s.mayUse(layout({ canEdit: true }), { id: 6, item: "tv", x: 8, y: 2, rot: 0 })).toBe(false);
  });
  it("positions inside a house may reach its whole lot", () => {
    expect(parsePos({ id: "a", x: 300, y: 200, f: "up" }, { w: 320, h: 224 })).not.toBeNull();
    expect(parsePos({ id: "a", x: 300, y: 200, f: "up" })).toBeNull();          // an apartment is smaller
  });
});

describe("Khu nhà's lot gates", () => {
  it("every lot has a gate reachable from the spawn", () => {
    const khu = getMap("khu_nha");
    const gates = khu.interactables.filter((i) => i.kind === "lot");
    expect(gates.map((g) => g.lot)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const g of gates) expect(findPath(khu, khu.spawn, g.use), g.id).not.toBeNull();
  });
});
