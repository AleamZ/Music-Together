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
