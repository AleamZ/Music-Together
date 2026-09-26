import { describe, it, expect } from "vitest";
import {
  boxRow, critterFromRow, describeFarmItem, FARM_KINDS, farmItemFromRow, harvesterPrice, producePrice, ricePrice, ripeAfterHours, uplandFromRow,
  uplandHours, varietyFromRow, type FarmItemRow, type UplandCropRow, type VarietyRow,
} from "@/lib/game/farm/catalog";
import fixtures from "@/tests/fixtures/upland-cases.json";

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
      id: "fert_npk", kind: "fertilizer", name: "Phân NPK", price: 90, sortOrder: 0, variety: null, upland: null, fert: "npk",
      pestTarget: null, capacity: null,
    });
    expect(farmItemFromRow(item({ id: "seed_ot", upland: "ot" })).upland).toBe("ot");
    expect(farmItemFromRow(item({ id: "tool_sickle", kind: "tool" })).kind).toBe("tool");
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
    expect(d({ kind: "pesticide", pest_target: "insect" })).toBe("Trị sâu cuốn lá, sùng khoai, sâu keo, bọ trĩ");
    expect(d({ kind: "pesticide", pest_target: "hopper" })).toBe("Trị rầy nâu");
    expect(d({ kind: "pesticide", pest_target: "fungus" })).toBe("Trị đạo ôn lá, đạo ôn cổ bông, thán thư");
    expect(d({ kind: "critter_box", capacity: 15 })).toBe("Đựng thêm 15 con cua, ốc (tay cầm được 3 con)");
  });
  it("keeps the thousands separator in the price per kg", () => {
    const dear = [varietyFromRow({ ...VARIETY_ROWS[2], price_per_kg: 1350 })];
    expect(describeFarmItem(farmItemFromRow(item({ kind: "seed", variety: "thom" })), dear))
      .toBe("Chín sau ~66 giờ · 60 kg/thửa · 1.350 xu/kg lúa khô");
  });
});

describe("hoa-màu crops and tools (v15.2 §8.2, §9)", () => {
  const UPLANDS = (fixtures as unknown as { crops: UplandCropRow[] }).crops.map(uplandFromRow);
  const [khoai, bap, ot] = UPLANDS;
  it("reads the config rows", () => {
    expect(UPLANDS.map((u) => [u.id, u.method, u.harvestAnim, u.pickings])).toEqual([
      ["khoai", "cutting", "dig", [100]], ["bap", "direct", "pick", [100]], ["ot", "nursery", "pick", [40, 35, 25]],
    ]);
    expect(ot).toMatchObject({
      name: "Ớt", plantLabel: "Ươm hạt ớt", transplantLabel: "Trồng cây ớt con", harvestLabel: "Hái ớt", baseKg: 60, pricePerKg: 1590,
      nurseryReadyH: 10, nurseryOldH: 18, ripeWater: [0, 1], ripeWindowH: 8, overRate: 0.03, lostAfterH: 24, pickGapH: 12, rotFromH: null,
    });
    expect(ot.stages[1]).toEqual({ id: "grow", name: "Phát triển thân lá", untilH: 22, water: [1, 2] });
    expect(khoai.cares[1]).toEqual({
      id: "lat_day", kind: "act", name: "Lật dây", items: [], halfItems: [], fromH: 24, toH: 32, halfFromH: 32, halfToH: 40,
      penHalf: 0.05, penMissing: 0.1,
    });
    expect(ot.pests[1]).toEqual({
      slot: 2, kind: "anthracnose", name: "Thán thư", fromH: 40, toH: 64, chance: 0.4, dryMult: 1, wetMult: 2, remedy: "spray_fungus",
    });
    expect([khoai.rotFromH, khoai.rotRate, khoai.rotCap]).toEqual([22, 0.03, 0.5]);
  });
  it("counts each picking's ripe hour from P", () => {
    expect([uplandHours(khoai, 1), uplandHours(bap, 1), uplandHours(ot, 1), uplandHours(ot, 2), uplandHours(ot, 3)])
      .toEqual([48, 60, 46, 58, 70]);
  });
  it("describes the seeds from their crop, and the tools", () => {
    const d = (over: Partial<FarmItemRow>) => describeFarmItem(farmItemFromRow(item(over)), VARIETIES, UPLANDS);
    expect(d({ upland: "khoai" })).toBe("Trồng dây · chín ~48 giờ · 200 kg/thửa · 265 xu/kg");
    expect(d({ upland: "bap" })).toBe("Gieo thẳng · chín ~60 giờ · 150 kg/thửa · 460 xu/kg");
    expect(d({ upland: "ot" })).toBe("Ươm 10 giờ rồi trồng · lứa đầu ~46 giờ, 3 lứa · 60 kg/thửa · 1.590 xu/kg");
    expect(d({ id: "tool_sickle", kind: "tool" })).toBe("Gặt lúa tay, 6 phần — mua một lần");
    expect(d({ id: "tool_sprayer", kind: "tool" })).toBe("Nạp 1 chai thuốc được 3 lần xịt — mua một lần");
  });
  it("prices the harvester per part left, and hoa màu by the kg", () => {
    expect([0, 2, 5].map(harvesterPrice)).toEqual([3000, 2000, 500]);
    expect(producePrice(180, khoai)).toBe(47_700);
  });
});

describe("critters and containers (v15.3 §7.1, §9)", () => {
  it("reads the critter_kinds rows", () => {
    expect(critterFromRow({ id: "cua_gach", name: "Cua gạch", grp: "crab", base_price: 45, sort_order: 20 }))
      .toEqual({ id: "cua_gach", name: "Cua gạch", group: "crab", basePrice: 45, sortOrder: 20 });
    expect(critterFromRow({ id: "oc_dong", name: "Ốc đồng", grp: "snail", base_price: 8, sort_order: 30 }).group).toBe("snail");
  });
  it("describes the two containers", () => {
    const d = (capacity: number) => describeFarmItem(farmItemFromRow(item({ kind: "critter_box", capacity })), VARIETIES);
    expect(d(15)).toBe("Đựng thêm 15 con cua, ốc (tay cầm được 3 con)");
    expect(d(30)).toBe("Đựng thêm 30 con cua, ốc (tay cầm được 3 con)");
  });
  it("sells a container once, and not one no larger than the one held (R16)", () => {
    const bucket = farmItemFromRow(item({ id: "box_bucket", kind: "critter_box", name: "Xô nhựa", capacity: 15 }));
    const basket = farmItemFromRow(item({ id: "box_basket", kind: "critter_box", name: "Giỏ tre", capacity: 30 }));
    const all = [bucket, basket];
    expect([boxRow(bucket, {}, all), boxRow(basket, {}, all)]).toEqual([{ state: "buy" }, { state: "buy" }]);
    expect([boxRow(bucket, { box_bucket: 1 }, all), boxRow(basket, { box_bucket: 1 }, all)]).toEqual([{ state: "owned" }, { state: "buy" }]);
    expect([boxRow(bucket, { box_basket: 1 }, all), boxRow(basket, { box_basket: 1 }, all)])
      .toEqual([{ state: "bigger", name: "Giỏ tre" }, { state: "owned" }]);
    expect(boxRow(bucket, { box_bucket: 1, box_basket: 1 }, all)).toEqual({ state: "owned" });
  });
});

describe("the slingshot, its pellets, the dog food and rat food (v17 §8, D4)", () => {
  it("sells the ná, the pellets and the dog food", () => {
    expect(FARM_KINDS).toEqual(["seed", "fertilizer", "pesticide", "critter_box", "tool", "ammo", "pet_food"]);
    expect(farmItemFromRow(item({ id: "ammo_pellet", kind: "ammo", name: "Đạn đất", price: 10 })).kind).toBe("ammo");
    expect(farmItemFromRow(item({ id: "food_dog", kind: "pet_food", name: "Thức ăn chó", price: 150 })).kind).toBe("pet_food");
    const d = (over: Partial<FarmItemRow>) => describeFarmItem(farmItemFromRow(item(over)), VARIETIES);
    expect(d({ id: "tool_sling", kind: "tool", price: 3000 })).toBe("Bắn chuột đồng — mua một lần");
    expect(d({ id: "ammo_pellet", kind: "ammo", price: 10 })).toBe("Đạn cho ná · 10 viên 100 xu");
    expect(d({ id: "food_dog", kind: "pet_food", price: 150 })).toBe("Cho chó ăn · no 24 giờ");
  });
  it("reads upland_crops.rat_food: khoai and bắp, not ớt; none before 0019", () => {
    const rows = (fixtures as unknown as { crops: UplandCropRow[] }).crops;
    expect(rows.map(uplandFromRow).map((u) => [u.id, u.ratFood])).toEqual([["khoai", true], ["bap", true], ["ot", false]]);
    expect(uplandFromRow({ ...rows[0], rat_food: undefined }).ratFood).toBe(false);
  });
});
