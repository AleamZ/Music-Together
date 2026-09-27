import { describe, it, expect } from "vitest";
import { MENU, fishDiscountPct, mealPrice } from "@/lib/game/market/menu";

describe("market menu", () => {
  it("has 7 foods and 5 drinks with unique ids; only fish dishes are foods", () => {
    expect(MENU.filter((m) => m.kind === "food")).toHaveLength(7);
    expect(MENU.filter((m) => m.kind === "drink")).toHaveLength(5);
    expect(new Set(MENU.map((m) => m.id)).size).toBe(MENU.length);
    expect(MENU.filter((m) => m.fishDish).map((m) => m.id)).toEqual(["ca_kho_to", "canh_chua", "ca_chien"]);
    for (const m of MENU) { expect(m.price).toBeGreaterThan(0); expect(m.hunger + m.thirst).toBeGreaterThan(0); }
  });
  it("discount grows with rarity and weight, bounded 20..80", () => {
    expect(fishDiscountPct(1, 100)).toBe(20);
    expect(fishDiscountPct(2, 500)).toBe(34);
    expect(fishDiscountPct(3, 2600)).toBe(54);
    expect(fishDiscountPct(5, 99999)).toBe(80);
    expect(fishDiscountPct(0, 0)).toBe(20);
  });
  it("prices: full without a fish, discounted with one, never for non-fish dishes", () => {
    const kho = MENU.find((m) => m.id === "ca_kho_to")!;
    const pho = MENU.find((m) => m.id === "pho_bo")!;
    expect(mealPrice(kho, null)).toBe(600);
    expect(mealPrice(kho, { rarity: 2, weightG: 500 })).toBe(600 - Math.floor(600 * 34 / 100));
    expect(mealPrice(pho, { rarity: 5, weightG: 9000 })).toBe(400);
  });
});
