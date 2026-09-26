import { describe, it, expect } from "vitest";
import { varietyFromRow } from "@/lib/game/farm/catalog";
import {
  acceptRefusal, buyListedRefusal, buyPlotRefusal, farmingCount, harvesterRefusal, listRefusal, offerRefusal, reasonText, rentRefusal,
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
  items: {}, rice: {}, coins, giftClaimed: true, produce: {}, tank: null, critters: {}, critterCap: 3, gather: { readyAt: {}, leftToday: 200, dayResetsAt: null },
  ownedPlot: null, farming: [], myOffers: [], incomingOffers: [],
});
const ctx = (plots: PlotView[], coins = 1_000_000): LandCtx => ({ me: "me", plots, mine: mine(coins) });

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
    expect(rentRefusal(free, ctx([free], 9_999))).toBe("not enough coins");
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
    expect(buyPlotRefusal(p2, ctx([p2], 799_999))).toBe("not enough coins");
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
    expect(offerRefusal(theirs, ctx([theirs]), 5_000_001)).toBe("invalid price");
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
    expect(subleaseRefusal(mineBare, ctx([]), 100_001)).toBe("invalid price");
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

describe("the co-op's harvester", () => {
  const H = 3_600_000;
  const t0 = Date.parse("2026-09-25T00:00:00Z");
  const at = (h: number) => t0 + h * H;
  const nep = varietyFromRow({ id: "nep", name: "Nếp", scale: 1, base_kg: 75, price_per_kg: 18, blast_mult: 1, sort_order: 20 });
  /** My nếp on plot 5, transplanted at 12 h (ripe 60–72 h), drained at 55 h. */
  const rice = (over: Partial<CropView> = {}, water: Array<[number, number]> = [[0, 3], [55, 1]]): CropView => ({
    kind: "rice", variety: "nep", upland: null, phase: "ripe", preparedAt: at(0), soakAt: at(0), sowAt: at(3), transplantAt: at(12),
    plantAt: null, water: 1, waterSetAt: null, pests: [], excessN: false, ripe: true, rottedAt: null, picking: null, pickings: 1, parts: 0,
    harvester: null,
    log: {
      water: water.map(([h, l]) => ({ t: at(h), l })), fert: [], spray: [], picks: [], qTransplant: 1, work: [], harvests: [], harvestedKg: 0,
    },
    ...over,
  });
  const mineRice = (c: CropView | null, until = at(96)) => plot(5, { farmer: ME, lease: { source: "village", until, price: 250 }, crop: c });
  const now = at(61);

  it("rents for a ripe, drained rice plot of mine, 500 xu a part left, with 30 s left on the lease", () => {
    expect(harvesterRefusal(mineRice(rice()), ctx([]), nep, now)).toBeNull();
    expect(harvesterRefusal(mineRice(rice()), ctx([], 2999), nep, now)).toBe("not enough coins");
    expect(harvesterRefusal(mineRice(rice({ parts: 2 })), ctx([], 2000), nep, now)).toBeNull();
    expect(harvesterRefusal(mineRice(rice({ parts: 2 })), ctx([], 1999), nep, now)).toBe("not enough coins");
    expect(harvesterRefusal(mineRice(rice(), now + 30_000), ctx([]), nep, now)).toBeNull();
    expect(harvesterRefusal(mineRice(rice(), now + 29_999), ctx([]), nep, now)).toBe("lease ends");
  });
  it("refuses in the server's order", () => {
    expect(harvesterRefusal({ ...mineRice(rice()), farmer: LAN }, ctx([]), nep, now)).toBe("not your plot");
    expect(harvesterRefusal(mineRice(null), ctx([]), nep, now)).toBe("not prepared");
    const running = rice({ harvester: { startedAt: now - 5_000, endsAt: now + 25_000 } });
    expect(harvesterRefusal(mineRice(running), ctx([], 0), nep, now)).toBe("harvester busy");
    expect(harvesterRefusal(mineRice(rice({ kind: "upland", variety: null, upland: "khoai" })), ctx([]), nep, now)).toBe("wrong crop");
    expect(harvesterRefusal(mineRice(rice()), ctx([]), nep, at(55))).toBe("wrong phase");
    expect(harvesterRefusal(mineRice(rice({ parts: 6 })), ctx([]), nep, now)).toBe("wrong phase");
    expect(harvesterRefusal(mineRice(rice({}, [[0, 3], [55, 2]])), ctx([], 0), nep, now)).toBe("need water");
    expect(reasonText("harvester busy")).toBe("Máy gặt đang gặt thửa này.");
    expect(reasonText("lease ends")).toBe("Không kịp gặt xong trước khi hết hạn thuê.");
  });
});
