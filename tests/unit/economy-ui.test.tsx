import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EconState, Listing, Trade, TradeState } from "@/lib/game/economy/model";

const rpc = vi.hoisted(() => ({
  econState: vi.fn(), marketList: vi.fn(), marketCancel: vi.fn(), marketBuy: vi.fn(), auctionCreate: vi.fn(), auctionBid: vi.fn(),
  auctionCancel: vi.fn(), shopRent: vi.fn(), shopStock: vi.fn(), shopBuy: vi.fn(), tradeState: vi.fn(), tradeOpen: vi.fn(),
  tradeOffer: vi.fn(), tradeConfirm: vi.fn(), tradeCancel: vi.fn(),
}));
vi.mock("@/lib/game/economy/rpc", () => rpc);
import PlayerMarketModal from "@/components/game/economy/PlayerMarketModal";
import StallModal from "@/components/game/economy/StallModal";
import TradeWindow from "@/components/game/economy/TradeWindow";

const state = (over: Partial<EconState> = {}): EconState => ({
  coins: 5000, assets: [], listings: [], mine: [], auctions: [], stalls: [], serverNowMs: 0, ...over,
});
const listing = (over: Partial<Listing> = {}): Listing => ({
  kind: "fish", ref: "f1", qty: 1, value: 400, name: "Cá rô 0.8 kg", rarity: 1, reserved: 0, id: 7, price: 600, fee: 12,
  status: "open", stall: null, sellerName: "An", mine: false, createdMs: 0, expiresMs: 3_600_000, ...over,
});

beforeEach(() => { for (const f of Object.values(rpc)) f.mockReset(); });
afterEach(() => cleanup());

describe("PlayerMarketModal", () => {
  it("browses, searches and buys at the price seen", async () => {
    rpc.econState.mockResolvedValue(state({ listings: [listing(), listing({ id: 8, name: "Khoai 5 kg", kind: "produce", ref: "khoai" })] }));
    rpc.marketBuy.mockResolvedValue(state());
    const onChanged = vi.fn();
    render(<PlayerMarketModal token="t" onChanged={onChanged} onClose={() => {}} />);
    await screen.findByTestId("econ-listing-7");
    fireEvent.change(screen.getByLabelText("Tìm"), { target: { value: "khoai" } });
    expect(screen.queryByTestId("econ-listing-7")).toBeNull();
    fireEvent.change(screen.getByLabelText("Tìm"), { target: { value: "" } });
    fireEvent.click(screen.getAllByRole("button", { name: /Mua · / })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Đồng ý mua" }));
    await waitFor(() => expect(rpc.marketBuy).toHaveBeenCalledWith("t", 7, 600));
    expect(onChanged).toHaveBeenCalled();
  });

  it("lists an asset inside the band", async () => {
    rpc.econState.mockResolvedValue(state({ assets: [{ kind: "fish", ref: "f2", qty: 1, value: 400, name: "Cá lóc", rarity: 2, reserved: 0 }] }));
    rpc.marketList.mockResolvedValue(state());
    render(<PlayerMarketModal token="t" onChanged={() => {}} onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("tab", { name: "📝 Rao bán" }));
    fireEvent.change(screen.getByLabelText("Món hàng"), { target: { value: "fish:f2" } });
    fireEvent.change(screen.getByLabelText("Giá"), { target: { value: "1300" } });
    expect(screen.getByRole("button", { name: "Chọn giá hợp lệ" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Giá"), { target: { value: "800" } });
    fireEvent.click(screen.getByRole("button", { name: /Đăng bán/ }));
    await waitFor(() => expect(rpc.marketList).toHaveBeenCalledWith("t", "fish", "f2", 1, 800));
  });

  it("bids the minimum on an auction and shows a refusal", async () => {
    rpc.econState.mockResolvedValue(state({ auctions: [{
      kind: "fish", ref: "f3", qty: 1, value: 1000, name: "Cá chép", rarity: 3, reserved: 0, id: 9, start: 1000, top: 1000, bids: 1,
      status: "open", minBid: 1050, maxBid: 5000, sellerName: "Bình", mine: false, leading: false, topName: "Chi", endsMs: 60_000,
    }] }));
    rpc.auctionBid.mockRejectedValue({ message: "bid too low" });
    render(<PlayerMarketModal token="t" onChanged={() => {}} onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("tab", { name: "🔨 Đấu giá" }));
    fireEvent.click(screen.getByRole("button", { name: /Đặt giá/ }));
    await waitFor(() => expect(rpc.auctionBid).toHaveBeenCalledWith("t", 9, 1050));
    expect(await screen.findByRole("alert")).toHaveTextContent("thấp hơn mức tối thiểu");
  });
});

describe("StallModal", () => {
  it("rents a free stall and buys from another", async () => {
    const s = state({ stalls: [
      { no: 1, mine: false, renterName: null, paidMs: null, items: [] },
      { no: 2, mine: false, renterName: "An", paidMs: 86_400_000, items: [listing({ id: 11, stall: 2 })] },
    ] });
    rpc.econState.mockResolvedValue(s);
    rpc.shopRent.mockResolvedValue(s);
    rpc.shopBuy.mockResolvedValue(state());
    render(<StallModal token="t" onChanged={() => {}} onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("tab", { name: /Sạp 1/ }));
    fireEvent.click(screen.getByRole("button", { name: /Thuê/ }));
    await waitFor(() => expect(rpc.shopRent).toHaveBeenCalledWith("t", 1, 1));
    fireEvent.click(await screen.findByRole("tab", { name: /Sạp 2/ }));
    fireEvent.click(screen.getByRole("button", { name: "Mua" }));
    await waitFor(() => expect(rpc.shopBuy).toHaveBeenCalledWith("t", 11, 600));
  });
});

describe("TradeWindow", () => {
  it("offers coins, then confirms at the revision", async () => {
    rpc.econState.mockResolvedValue(state({ coins: 1000 }));
    const t0 = { id: 4, rev: 1, opener: true, partnerId: "p", partnerName: "Bình", mine: { coins: 0, items: [] },
      theirs: { coins: 50, items: [] }, myOk: false, theirOk: false, feePct: 5, myRecv: null, theirRecv: null };
    const next: TradeState = { trade: { ...t0, rev: 2, mine: { coins: 100, items: [] } }, lastDone: null, coins: 1000, serverNowMs: 0 };
    rpc.tradeOffer.mockResolvedValue(next);
    const onState = vi.fn();
    const { rerender } = render(<TradeWindow token="t" trade={t0} onState={onState} onChanged={() => {}} />);
    fireEvent.change(screen.getByLabelText("Xu đưa"), { target: { value: "100" } });
    expect(screen.getByRole("button", { name: /Xác nhận đổi/ })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Cập nhật đề nghị" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Cập nhật đề nghị" }));
    await waitFor(() => expect(rpc.tradeOffer).toHaveBeenCalledWith("t", 4, { coins: 100, items: [] }));
    expect(onState).toHaveBeenCalledWith(next);
    rerender(<TradeWindow token="t" trade={next.trade!} onState={onState} onChanged={() => {}} />);
    rpc.tradeConfirm.mockResolvedValue(next);
    fireEvent.click(screen.getByRole("button", { name: /Xác nhận đổi/ }));
    await waitFor(() => expect(rpc.tradeConfirm).toHaveBeenCalledWith("t", 4, 2));
  });
});

describe("TradeWindow: the xu leg (Kinh tế v2)", () => {
  const trade = (over: Partial<Trade> = {}): Trade => ({
    id: 5, rev: 3, opener: true, partnerId: "p", partnerName: "Bình", mine: { coins: 1000, items: [] },
    theirs: { coins: 0, items: [] }, myOk: false, theirOk: false, feePct: 5,
    myRecv: { ok: true, left: 50_000 }, theirRecv: { ok: true, left: 50_000 }, ...over,
  });

  it("shows what the receiver gets after the 5 % burn", async () => {
    rpc.econState.mockResolvedValue(state({ coins: 5000 }));
    render(<TradeWindow token="t" trade={trade()} onState={() => {}} onChanged={() => {}} />);
    expect(screen.getByTestId("trade-xu-leg")).toHaveTextContent("Bình nhận 950");
    expect(screen.queryByRole("alert")).toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: /Xác nhận đổi/ })).toBeEnabled());
  });

  it("warns and holds the confirmation when the receiver is too new", async () => {
    rpc.econState.mockResolvedValue(state({ coins: 5000 }));
    render(<TradeWindow token="t" trade={trade({ theirRecv: { ok: false, left: 50_000 } })} onState={() => {}} onChanged={() => {}} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Bình chưa nhận xu được");
    expect(screen.getByRole("button", { name: /Xác nhận đổi/ })).toBeDisabled();
  });

  it("warns when I would pass today's allowance", async () => {
    rpc.econState.mockResolvedValue(state({ coins: 5000 }));
    render(<TradeWindow token="t" trade={trade({ mine: { coins: 0, items: [] }, theirs: { coins: 2000, items: [] },
      myRecv: { ok: true, left: 1000 } })} onState={() => {}} onChanged={() => {}} />);
    expect(screen.getByTestId("trade-xu-leg")).toHaveTextContent("Bạn nhận 1.900");
    expect(screen.getByRole("alert")).toHaveTextContent("Hôm nay bạn chỉ còn nhận được 1.000");
    expect(screen.getByRole("button", { name: /Xác nhận đổi/ })).toBeDisabled();
  });
});
