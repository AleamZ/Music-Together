import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { FISH_DISCOUNT_MAX_X, MENU, fishDiscountPct, fishDiscountXu, mealPrice } from "@/lib/game/market/menu";

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
    expect(mealPrice(kho, { rarity: 2, weightG: 500, price: 1000 })).toBe(600 - Math.floor(600 * 34 / 100));
    expect(mealPrice(pho, { rarity: 5, weightG: 9000, price: 1000 })).toBe(400);
    expect(fishDiscountXu(pho, { rarity: 5, weightG: 9000, price: 1000 })).toBe(0);
  });
  it("econ v2 (0105): the xu off is at most 3 × the fish's price", () => {
    const kho = MENU.find((m) => m.id === "ca_kho_to")!;
    const canh = MENU.find((m) => m.id === "canh_chua")!;
    expect(FISH_DISCOUNT_MAX_X).toBe(3);
    expect(fishDiscountXu(kho, { rarity: 1, weightG: 400, price: 5 })).toBe(15);            // 21 % = 126, capped at 15
    expect(mealPrice(kho, { rarity: 1, weightG: 400, price: 5 })).toBe(585);
    expect(fishDiscountXu(canh, { rarity: 3, weightG: 2600, price: 30 })).toBe(90);        // 54 % = 270, capped at 90
    expect(fishDiscountXu(kho, { rarity: 5, weightG: 50000, price: 600 })).toBe(480);      // 80 % binds: 480 < 1 800
    const sql = readFileSync("supabase/migrations/0105_econ_sinks.sql", "utf8");
    expect(sql).toContain(`v_price := m.price - least((m.price * v_pct) / 100, ${FISH_DISCOUNT_MAX_X} * coalesce(v_fish_price, 0));`);
  });
});
