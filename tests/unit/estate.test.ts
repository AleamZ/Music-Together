import { describe, expect, it } from "vitest";
import {
  appraise, BUILD_APPRAISE_PERCENT, estateErrorMessage, ESTATE_FEE_PERCENT, priceBand, parseEstateState, saleShare,
} from "@/lib/game/housing/estate";
import { APT_BUY } from "@/lib/game/housing/apartment";
import { LAND_PRICE } from "@/lib/game/housing/house";

describe("v19.4 estate rules", () => {
  it("appraises a flat, bare land and a house, with or without the furniture", () => {
    expect(appraise("apt", 0, [])).toBe(APT_BUY);
    expect(appraise("apt", 0, ["bed_go", "tv"])).toBe(APT_BUY + 1200 + 3000);
    expect(appraise("lot", 0, [])).toBe(LAND_PRICE);
    expect(appraise("lot", 1000, [])).toBe(LAND_PRICE + (1000 * BUILD_APPRAISE_PERCENT) / 100);
    expect(appraise("lot", 1001, ["nope"])).toBe(LAND_PRICE + Math.floor((1001 * BUILD_APPRAISE_PERCENT) / 100));
  });
  it("bands the price 0.5×–3× (rounded up at the floor)", () => {
    expect(priceBand(25000)).toEqual({ min: 12500, max: 75000 });
    expect(priceBand(40801)).toEqual({ min: 20401, max: 122403 });
  });
  it("splits the sale 95 / 5", () => {
    expect(ESTATE_FEE_PERCENT).toBe(5);
    expect(saleShare(30001)).toEqual({ seller: 28500, fee: 1501 });
  });
  it("parses the office's state and drops junk", () => {
    const s = parseEstateState({
      server_now_ms: 1000, cooldown_ms: 5000, coins: 7,
      listings: [
        { id: 3, kind: "lot", no: 2, price: 50000, with_furniture: true, appraisal: 45000, items: 4, tenants: 1, seller_name: "An",
          mine: false, listed_ms: 1, expires_ms: 99, grid: null, roof: "tole" },
        { id: "x", kind: "lot" }, { id: 4, kind: "villa", no: 1, price: 1 },
      ],
      own: { kind: "apt", no: 5, bare: 25000, full: 26200, items: 1, listed: false },
      sales: [{ id: 1, kind: "apt", no: 5, price: 30000, with_furniture: false, seller_name: "A", buyer_name: null, sold_ms: 9, flagged: true }],
    });
    expect(s).not.toBeNull();
    expect(s!.listings).toHaveLength(1);
    expect(s!.listings[0]).toMatchObject({ id: 3, kind: "lot", no: 2, withFurniture: true, tenants: 1, sellerName: "An", roof: "tole" });
    expect(s!.own).toEqual({ kind: "apt", no: 5, bare: 25000, full: 26200, items: 1, listed: false });
    expect(s!.sales[0]).toMatchObject({ kind: "apt", no: 5, buyerName: null, flagged: true });
    expect(s!.cooldownMs).toBe(5000);
    expect(s!.coins).toBe(7);
    expect(parseEstateState({})).toBeNull();
  });
  it("says why in Vietnamese", () => {
    expect(estateErrorMessage("suspicious trade")).toMatch(/7 ngày/);
    expect(estateErrorMessage("already have a home")).toMatch(/một nhà/);
    expect(estateErrorMessage("zzz")).toBe("Có lỗi, thử lại sau nhé.");
  });
});
