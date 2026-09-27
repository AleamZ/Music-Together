import { describe, it, expect } from "vitest";
import { sellBackPrice, travelErrorMessage } from "@/lib/game/travel/rpc";
import { VEHICLES } from "@/lib/game/travel/vehicles";

describe("sellBackPrice", () => {
  it("is half the price: 2.500, 15.000, 75.000", () => {
    expect(VEHICLES.map((v) => sellBackPrice(v.price))).toEqual([2500, 15000, 75000]);
  });
});

describe("travelErrorMessage", () => {
  it("maps each server refusal to Vietnamese", () => {
    expect(travelErrorMessage("already owned")).toContain("đã có");
    expect(travelErrorMessage("insufficient funds")).toContain("xu");
    expect(travelErrorMessage("unknown vehicle")).toContain("xe");
    expect(travelErrorMessage("not owned")).toBe("Bạn không có xe này để bán.");
    expect(travelErrorMessage("boom")).toBe("Không mua được, thử lại nhé.");
  });
});
