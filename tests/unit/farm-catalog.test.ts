import { describe, it, expect } from "vitest";
import {
  describeFarmItem, farmItemFromRow, ricePrice, ripeAfterHours, varietyFromRow, type FarmItemRow, type VarietyRow,
} from "@/lib/game/farm/catalog";

const VARIETY_ROWS: VarietyRow[] = [
  { id: "short", name: "Lúa ngắn ngày", scale: 0.9, base_kg: 90, price_per_kg: 12, blast_mult: 1, sort_order: 10 },
  { id: "nep", name: "Nếp", scale: 1, base_kg: 75, price_per_kg: 18, blast_mult: 1, sort_order: 20 },
  { id: "thom", name: "Lúa thơm", scale: 1.15, base_kg: 60, price_per_kg: 26, blast_mult: 1.3, sort_order: 30 },
];
const VARIETIES = VARIETY_ROWS.map(varietyFromRow);
const item = (over: Partial<FarmItemRow>): FarmItemRow => ({
  id: "x", kind: "seed", name: "x", price: 1, sort_order: 0, variety: null, fert: null, pest_target: null, capacity: null, ...over,
});

describe("farm catalog rows", () => {
  it("maps varieties and items", () => {
    expect(VARIETIES[2]).toEqual({ id: "thom", name: "Lúa thơm", scale: 1.15, baseKg: 60, pricePerKg: 26, blastMult: 1.3, sortOrder: 30 });
    expect(farmItemFromRow(item({ id: "fert_npk", kind: "fertilizer", name: "Phân NPK", price: 90, fert: "npk" }))).toEqual({
      id: "fert_npk", kind: "fertilizer", name: "Phân NPK", price: 90, sortOrder: 0, variety: null, fert: "npk", pestTarget: null,
      capacity: null,
    });
  });
  it("drops values it does not know", () => {
    const it = farmItemFromRow(item({ kind: "rod", fert: "sand", pest_target: "mice" }));
    expect([it.kind, it.fert, it.pestTarget]).toEqual(["seed", null, null]);
  });
});

describe("ricePrice", () => {
  it("pays dry rice in full and wet rice at 70 %, rounded down with the server's integer arithmetic", () => {
    expect(ricePrice(10, 12, true)).toBe(120);
    expect(ricePrice(5, 12, false)).toBe(42);
    // 70 × 18 × 0.7 is 881.99… in floating point; the server computes (70 × 18 × 7) / 10 = 882
    expect(ricePrice(70, 18, false)).toBe(882);
  });
});

describe("ripeAfterHours", () => {
  it("is 2 h of soaking plus 56 h × the variety's scale (§8.1)", () => {
    expect(VARIETIES.map(ripeAfterHours)).toEqual([52, 58, 66]);
  });
});

describe("describeFarmItem", () => {
  it("says what each item is for", () => {
    const d = (over: Partial<FarmItemRow>) => describeFarmItem(farmItemFromRow(item(over)), VARIETIES);
    expect(d({ kind: "seed", variety: "nep" })).toBe("Chín sau ~58 giờ · 75 kg/thửa · 18 xu/kg lúa khô");
    expect(d({ kind: "fertilizer", fert: "manure" })).toBe("Bón lót — trước khi cấy");
    expect(d({ kind: "fertilizer", fert: "urea" })).toBe("Bón thúc đẻ nhánh");
    expect(d({ kind: "fertilizer", fert: "potash" })).toBe("Bón đón đòng");
    expect(d({ kind: "fertilizer", fert: "npk" })).toBe("Bón thúc đẻ nhánh hoặc đón đòng");
    expect(d({ kind: "pesticide", pest_target: "hopper" })).toBe("Trị rầy nâu");
    expect(d({ kind: "pesticide", pest_target: "fungus" })).toBe("Trị đạo ôn lá và đạo ôn cổ bông");
    expect(d({ kind: "critter_box", capacity: 15 })).toBe("Đựng 15 con cua, ốc");
  });
  it("keeps the thousands separator in the price per kg", () => {
    const dear = [varietyFromRow({ ...VARIETY_ROWS[2], price_per_kg: 1350 })];
    expect(describeFarmItem(farmItemFromRow(item({ kind: "seed", variety: "thom" })), dear))
      .toBe("Chín sau ~66 giờ · 60 kg/thửa · 1.350 xu/kg lúa khô");
  });
});
