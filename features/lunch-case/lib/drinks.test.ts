import { describe, expect, it } from "vitest";
import { drinks } from "./drinks";
import { personalSelector } from "./personal-pool";

describe("drink case", () => {
  it("has unique ids and English names", () => {
    expect(new Set(drinks.map((d) => d.customId)).size).toBe(drinks.length);
    expect(drinks.every((d) => d.drink && d.nameEn)).toBe(true);
  });
  it("hits each drink budget as the mean price", () => {
    for (const target of [20, 35, 50, 65]) expect(Math.abs(personalSelector(drinks, target)!.expectedPrice - target)).toBeLessThan(1e-8);
  });
});

describe("personal drink pool", () => {
  it("validates against the drink catalog and adds custom drinks", async () => {
    const { validateProfile, personalFoods } = await import("./personal-pool");
    const all = drinks.map((d) => d.image);
    expect(() => validateProfile({ disabled: [0], custom: [], revision: 0 }, drinks)).toThrow();
    const p = validateProfile({ disabled: all, custom: [{ id: crypto.randomUUID(), name: "Trà chanh giã tay", price: 25, veg: false }], revision: 0 }, drinks);
    const pool = personalFoods(p, drinks, "drink");
    expect(pool).toHaveLength(1);
    expect(pool[0]).toMatchObject({ name: "Trà chanh giã tay", drink: true, rarity: 1 });
  });
});
