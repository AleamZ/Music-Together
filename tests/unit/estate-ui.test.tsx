import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { EstateState, Listing } from "@/lib/game/housing/estate";

const rpc = vi.hoisted(() => ({ estateState: vi.fn(), estateList: vi.fn(), estateCancel: vi.fn(), estateBuy: vi.fn() }));
vi.mock("@/lib/game/housing/estate", async (orig) => ({ ...(await orig<object>()), ...rpc }));
import EstateModal from "@/components/game/housing/EstateModal";
import { getMap } from "@/lib/game/maps/registry";
import { findPath } from "@/lib/game/pathfinding";
import { isBlockedAt } from "@/lib/game/movement";

beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });

const DAY = 86_400_000;
const listing = (over: Partial<Listing> = {}): Listing => ({
  id: 7, kind: "lot", no: 4, price: 60000, withFurniture: false, appraisal: 48000, items: 0, tenants: 1, sellerName: "Bảy",
  mine: false, listedMs: 0, expiresMs: 10 * DAY, grid: "x", roof: "ngoi", ...over,
});
const state = (over: Partial<EstateState> = {}): EstateState => ({ listings: [], own: null, cooldownMs: null, sales: [], serverNowMs: 0, ...over });

const open = async (props: Partial<Parameters<typeof EstateModal>[0]> = {}) => {
  const onChanged = vi.fn();
  await act(async () => {
    render(<EstateModal token="t" coins={100000} hasHome={false} onChanged={onChanged} onClose={() => {}} {...props} />);
  });
  return onChanged;
};

describe("EstateModal", () => {
  it("buys a listed house after confirming; the shell reloads", async () => {
    rpc.estateState.mockResolvedValue(state({ listings: [listing()] }));
    rpc.estateBuy.mockResolvedValue(state({ coins: 40000 }));
    const onChanged = await open();
    expect(screen.getByText(/Lô đất 4 · có nhà/)).toBeTruthy();
    expect(screen.getByText(/1 phòng đang cho thuê/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Mua ngay/ }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Đồng ý mua" })); });
    expect(rpc.estateBuy).toHaveBeenCalledWith("t", 7, 60000);
    expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ coins: 40000 }));
  });

  it("one home: buying is off when I live somewhere, or cannot pay", async () => {
    rpc.estateState.mockResolvedValue(state({ listings: [listing()] }));
    await open({ hasHome: true });
    expect((screen.getByRole("button", { name: /Mua ngay/ }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    await open({ coins: 100 });
    expect((screen.getByRole("button", { name: /Mua ngay/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("lists my flat inside the band, with the furniture", async () => {
    rpc.estateState.mockResolvedValue(state({ own: { kind: "apt", no: 2, bare: 25000, full: 26200, items: 1, listed: false } }));
    rpc.estateList.mockResolvedValue(state());
    await open();
    fireEvent.click(screen.getByRole("tab", { name: /Rao bán nhà tôi/ }));
    const input = screen.getByLabelText("Giá bán");
    fireEvent.change(input, { target: { value: "90000" } });
    expect((screen.getByRole("button", { name: /Đăng tin/ }) as HTMLButtonElement).disabled).toBe(true);   // > 3 × 26 200
    fireEvent.change(input, { target: { value: "30000" } });
    expect(screen.getByText(/Bạn nhận 28[.,]500/)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Đăng tin/ })); });
    expect(rpc.estateList).toHaveBeenCalledWith("t", "apt", 30000, true);
  });

  it("my listing can be taken down; a cooldown is shown", async () => {
    rpc.estateState.mockResolvedValue(state({ listings: [listing({ mine: true })], own: { kind: "lot", no: 4, bare: 48000, full: 48000, items: 0, listed: true } }));
    rpc.estateCancel.mockResolvedValue(state({ own: { kind: "lot", no: 4, bare: 48000, full: 48000, items: 0, listed: false }, cooldownMs: DAY }));
    await open();
    fireEvent.click(screen.getByRole("tab", { name: /Rao bán nhà tôi/ }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Gỡ tin rao" })); });
    expect(rpc.estateCancel).toHaveBeenCalledWith("t");
    expect(screen.getByText(/rao lại sau/)).toBeTruthy();
  });

  it("shows the history, filtered per property, and the refusal text", async () => {
    rpc.estateState.mockResolvedValue(state({
      listings: [listing()],
      sales: [
        { id: 1, kind: "apt", no: 2, price: 30000, withFurniture: true, sellerName: "A", buyerName: "B", soldMs: 0, flagged: false },
        { id: 2, kind: "lot", no: 4, price: 50000, withFurniture: false, sellerName: "C", buyerName: "D", soldMs: 0, flagged: false },
      ],
    }));
    rpc.estateBuy.mockRejectedValue({ message: "suspicious trade" });
    await open();
    fireEvent.click(screen.getByRole("button", { name: /Mua ngay/ }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Đồng ý mua" })); });
    expect(screen.getByRole("alert").textContent).toMatch(/7 ngày/);
    fireEvent.click(screen.getByRole("tab", { name: /Lịch sử/ }));
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "lot:4" } });
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText(/C → D/)).toBeTruthy();
  });
});

describe("the office on Khu nhà", () => {
  it("has a reachable door and anh Tư inside the building", () => {
    const khu = getMap("khu_nha");
    const door = khu.interactables.find((i) => i.id === "estate")!;
    expect(door.kind).toBe("estate");
    expect(isBlockedAt(khu, door.use.x, door.use.y)).toBe(false);
    expect(findPath(khu, khu.spawn, door.use)).not.toBeNull();
    const tu = khu.npcs.find((n) => n.id === "anh_tu_moi_gioi")!;
    expect(isBlockedAt(khu, tu.spot.x, tu.spot.y)).toBe(true);
  });
});
