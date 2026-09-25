import { describe, it, expect } from "vitest";
import {
  acceptRefusal, buyListedRefusal, buyPlotRefusal, farmingCount, listRefusal, offerRefusal, reasonText, rentRefusal,
  rentSubleaseRefusal, sellBackRefusal, subleaseRefusal, type LandCtx,
} from "@/lib/game/farm/land";
import type { CropView, FieldMine, PlotView } from "@/lib/game/farm/state";

const ME = { id: "me", name: "Me" };
const LAN = { id: "lan", name: "Lan" };
const plot = (no: number, over: Partial<PlotView> = {}): PlotView => ({
  no, kind: no <= 4 ? "private" : "village", owner: null, salePrice: null, subleasePrice: null, farmer: null, lease: null,
  offers: 0, crop: null, ...over,
});
const CROP = { phase: "prepared" } as CropView;
const LEASE = { source: "village" as const, until: 1e15, price: 250 };
const mine = (coins: number): FieldMine => ({
  items: {}, rice: {}, coins, giftClaimed: true, ownedPlot: null, farming: [], myOffers: [], incomingOffers: [],
});
const ctx = (plots: PlotView[], coins = 10_000): LandCtx => ({ me: "me", plots, mine: mine(coins) });

describe("farming and renting", () => {
  it("counts the plots I farm", () => {
    expect(farmingCount(ctx([plot(1, { owner: ME, farmer: ME }), plot(5, { farmer: ME, lease: LEASE }), plot(2, { owner: ME, farmer: LAN })]))).toBe(2);
  });
  it("rents free village plots within the limit and the coins", () => {
    const free = plot(5);
    expect(rentRefusal(free, ctx([free]))).toBeNull();
    expect(rentRefusal(plot(6, { lease: LEASE, farmer: LAN }), ctx([]))).toBe("plot taken");
    const two = [plot(7, { farmer: ME, lease: LEASE }), plot(8, { farmer: ME, lease: LEASE })];
    expect(rentRefusal(free, ctx([free, ...two]))).toBe("farm limit");
    expect(rentRefusal(free, ctx([free], 249))).toBe("not enough coins");
    expect(reasonText("farm limit")).toBe("Bạn đang canh tác 2 thửa rồi.");
  });
});

describe("buying land", () => {
  it("from the village: one private plot, within the limit", () => {
    const p2 = plot(2);
    expect(buyPlotRefusal(p2, ctx([p2]))).toBeNull();
    expect(buyPlotRefusal(plot(3, { owner: LAN, farmer: LAN }), ctx([]))).toBe("not for sale");
    expect(buyPlotRefusal(plot(2, { lease: LEASE }), ctx([]))).toBe("leased");
    expect(buyPlotRefusal(p2, ctx([p2, plot(1, { owner: ME, farmer: LAN, lease: LEASE })]))).toBe("already own land");
    expect(buyPlotRefusal(p2, ctx([p2], 3999))).toBe("not enough coins");
  });
  it("a listing, at its price", () => {
    const listed = plot(3, { owner: LAN, farmer: LAN, salePrice: 9000 });
    expect(buyListedRefusal(listed, ctx([listed]))).toBeNull();
    expect(buyListedRefusal(listed, ctx([listed], 8999))).toBe("not enough coins");
    expect(buyListedRefusal(plot(3, { owner: ME, salePrice: 9000 }), ctx([]))).toBe("invalid plot");
    expect(buyListedRefusal(plot(3, { owner: LAN }), ctx([]))).toBe("not for sale");
    expect(buyListedRefusal({ ...listed, crop: CROP }, ctx([]))).toBe("crop exists");
  });
  it("offers: to an owner, at a sane price, if I own no land here", () => {
    const theirs = plot(3, { owner: LAN, farmer: LAN });
    expect(offerRefusal(theirs, ctx([theirs]), 5000)).toBeNull();
    expect(offerRefusal(theirs, ctx([theirs]), 0)).toBe("invalid price");
    expect(offerRefusal(theirs, ctx([theirs]), 1_000_001)).toBe("invalid price");
    expect(offerRefusal(plot(2), ctx([]), 5000)).toBe("not for sale");
    expect(offerRefusal(theirs, ctx([theirs, plot(1, { owner: ME, farmer: ME })]), 5000)).toBe("already own land");
  });
  it("a sublease, at its price", () => {
    const sub = plot(1, { owner: LAN, farmer: LAN, subleasePrice: 300 });
    expect(rentSubleaseRefusal(sub, ctx([sub]))).toBeNull();
    expect(rentSubleaseRefusal({ ...sub, lease: LEASE }, ctx([]))).toBe("plot taken");
  });
});

describe("the owner's land actions", () => {
  const mineBare = plot(1, { owner: ME, farmer: ME });
  it("lists and subleases a bare, unleased plot", () => {
    expect(listRefusal(mineBare, ctx([mineBare]), 5000)).toBeNull();
    expect(listRefusal({ ...mineBare, crop: CROP }, ctx([]), 5000)).toBe("crop exists");
    expect(listRefusal({ ...mineBare, crop: CROP }, ctx([]), null)).toBeNull();
    expect(subleaseRefusal(mineBare, ctx([]), 5001)).toBe("invalid price");
    expect(subleaseRefusal({ ...mineBare, lease: LEASE, farmer: LAN }, ctx([]), 300)).toBe("leased");
    expect(listRefusal(plot(2, { owner: LAN }), ctx([]), 5000)).toBe("not your plot");
  });
  it("sells back unless farming a crop on it; a renter's crop does not matter", () => {
    expect(sellBackRefusal(mineBare, ctx([]))).toBeNull();
    expect(sellBackRefusal({ ...mineBare, crop: CROP }, ctx([]))).toBe("crop exists");
    expect(sellBackRefusal({ ...mineBare, crop: CROP, farmer: LAN, lease: LEASE }, ctx([]))).toBeNull();
  });
  it("accepts an offer on a bare, unleased plot", () => {
    const offer = { id: "o", plot: 1, price: 5000, expiresAt: 0, buyer: LAN };
    expect(acceptRefusal(offer, ctx([mineBare]))).toBeNull();
    expect(acceptRefusal(offer, ctx([{ ...mineBare, crop: CROP }]))).toBe("crop exists");
    expect(acceptRefusal({ ...offer, plot: 2 }, ctx([mineBare]))).toBe("not your plot");
  });
});
