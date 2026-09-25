import { describe, it, expect } from "vitest";
import {
  describeItem, formatWeight, formatXu, RARITY_COLOR, RARITY_NAME, shopItemFromRow, speciesFromRow, type ShopItem,
} from "@/lib/game/fishing/catalog";

const item = (over: Partial<ShopItem>): ShopItem => ({
  id: "x", kind: "rod", name: "x", price: 1, starter: false, sortOrder: 0, zonePct: null, weightK: null, rareMult: 1,
  windowMs: null, biteMinMs: null, biteMaxMs: null, showsRarity: false, multHiem: 1, multQuy: 1, multLegend: 1, capacity: null,
  ...over,
});

describe("formatWeight", () => {
  it("shows grams under 1 kg and tenths of a kg above, rounded half up (same rule as SQL _weight_text)", () => {
    expect(formatWeight(350)).toBe("350 g");
    expect(formatWeight(999)).toBe("999 g");
    expect(formatWeight(1000)).toBe("1,0 kg");
    expect(formatWeight(1150)).toBe("1,2 kg");
    expect(formatWeight(3150)).toBe("3,2 kg");
    expect(formatWeight(12_000)).toBe("12,0 kg");
    expect(formatWeight(39_960)).toBe("40,0 kg");
  });
});

describe("formatXu", () => {
  it("groups thousands the Vietnamese way", () => {
    expect(formatXu(0)).toBe("0 xu");
    expect(formatXu(1230)).toBe("1.230 xu");
    expect(formatXu(1_500_000)).toBe("1.500.000 xu");
  });
});

describe("rarity names and colours", () => {
  it("covers the five rarities", () => {
    expect(Object.values(RARITY_NAME)).toEqual(["Thường", "Khá", "Hiếm", "Quý", "Huyền thoại"]);
    expect(Object.keys(RARITY_COLOR)).toEqual(["1", "2", "3", "4", "5"]);
  });
});

describe("describeItem", () => {
  it("describes rods", () => {
    expect(describeItem(item({ kind: "rod", zonePct: 25, weightK: 2 }))).toBe("Vùng giữ cá 25%");
    expect(describeItem(item({ kind: "rod", zonePct: 30, weightK: 1.5 }))).toBe("Vùng giữ cá 30% · cá nặng hơn");
    // real (float4) columns arrive with noise: 1.2 → 1.2000000476837158
    expect(describeItem(item({ kind: "rod", zonePct: 36, weightK: 1.5, rareMult: 1.2000000476837158 })))
      .toBe("Vùng giữ cá 36% · cá nặng hơn · cá hiếm +20%");
  });
  it("describes bobbers", () => {
    expect(describeItem(item({ kind: "bobber", windowMs: 1500, biteMaxMs: 10000 }))).toBe("Giật cần trong 1,5 giây");
    expect(describeItem(item({ kind: "bobber", windowMs: 2000, biteMaxMs: 10000, showsRarity: true })))
      .toBe("Giật cần trong 2 giây · báo độ hiếm");
    expect(describeItem(item({ kind: "bobber", windowMs: 2500, biteMaxMs: 7000, showsRarity: true })))
      .toBe("Giật cần trong 2,5 giây · cá cắn nhanh hơn · báo độ hiếm");
  });
  it("describes bait, the bait box and buckets", () => {
    expect(describeItem(item({ kind: "bait" }))).toBe("Mồi thường — đào ở bãi trùn");
    expect(describeItem(item({ kind: "bait", multHiem: 1.5, multQuy: 1.5, multLegend: 1.5 }))).toBe("Cá hiếm trở lên ×1,5");
    expect(describeItem(item({ kind: "bait", multHiem: 2, multQuy: 2, multLegend: 3 }))).toBe("Cá hiếm ×2, huyền thoại ×3");
    expect(describeItem(item({ kind: "bait_box", capacity: 60 }))).toBe("Chứa 60 mồi");
    expect(describeItem(item({ kind: "bucket", capacity: 5 }))).toBe("Đựng 5 con cá");
  });
});

describe("row mapping", () => {
  it("camelCases species rows and keeps an unknown rarity safe", () => {
    expect(speciesFromRow({ id: "ca_ro", name: "Cá rô đồng", rarity: 1, min_g: 50, max_g: 300, price_per_kg: 45, difficulty: 15, sort_order: 10 }))
      .toEqual({ id: "ca_ro", name: "Cá rô đồng", rarity: 1, minG: 50, maxG: 300, pricePerKg: 45, difficulty: 15, sortOrder: 10 });
    expect(speciesFromRow({ id: "x", name: "x", rarity: 9, min_g: 1, max_g: 1, price_per_kg: 1, difficulty: 1, sort_order: 0 }).rarity).toBe(1);
  });
  it("camelCases shop rows", () => {
    expect(shopItemFromRow({
      id: "bobber_lamp", kind: "bobber", name: "Phao đèn", price: 800, starter: false, sort_order: 30, zone_pct: null,
      weight_k: null, rare_mult: 1, window_ms: 2500, bite_min_ms: 2000, bite_max_ms: 7000, shows_rarity: true,
      mult_hiem: 1, mult_quy: 1, mult_legend: 1, capacity: null,
    })).toMatchObject({ id: "bobber_lamp", kind: "bobber", price: 800, windowMs: 2500, biteMinMs: 2000, biteMaxMs: 7000, showsRarity: true });
  });
});
