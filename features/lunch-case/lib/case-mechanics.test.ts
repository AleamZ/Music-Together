import { describe, expect, it } from "vitest";
import { createSpinProfile } from "./case-mechanics";
import { emptyProfile, personalFoods, personalSelector, validateProfile } from "./personal-pool";
import { foods } from "./foods";

describe("lunch case mechanics", () => {
  it("normal motion keeps the deliberate case-opening pace", () => {
    expect(createSpinProfile(() => 0.5, false)).toEqual({ durationMs: 8500, tiles: 35, friction: 3 });
  });
  it("reduced motion stays readable", () => {
    expect(createSpinProfile(() => 0.5, true)).toEqual({ durationMs: 4500, tiles: 12, friction: 3 });
  });
});

describe("personal pool", () => {
  const all = foods.map((f) => f.image);
  it("rejects an empty pool and unknown dishes", () => {
    expect(() => validateProfile({ disabled: all, custom: [], revision: 0 })).toThrow();
    expect(() => validateProfile({ disabled: [999], custom: [], revision: 0 })).toThrow();
  });
  it("selects the only custom dish", () => {
    const p = validateProfile({ disabled: all, custom: [{ id: crypto.randomUUID(), name: "Solo", price: 85, veg: true }], revision: 0 });
    const items = personalFoods(p);
    expect(items).toHaveLength(1);
    const s = personalSelector(items, 50)!;
    expect(s.expectedPrice).toBe(85);
    expect(s.choose(items).name).toBe("Solo");
    expect(personalSelector([], 50)).toBeNull();
  });
  it("hits the target mean price across the catalog", () => {
    const catalog = personalFoods(emptyProfile());
    for (const target of [30, 50, 100, 180]) expect(Math.abs(personalSelector(catalog, target)!.expectedPrice - target)).toBeLessThan(1e-8);
  });
});
