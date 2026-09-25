import { describe, it, expect } from "vitest";
import { dueTasks, fertAdvice, plotActions, type PlotAction } from "@/lib/game/farm/actions";
import { farmItemFromRow, varietyFromRow, type FarmCatalog } from "@/lib/game/farm/catalog";
import { HOUR_MS, type CropModel } from "@/lib/game/farm/crop";
import type { CropView, FarmMine, PestView, PlotView } from "@/lib/game/farm/state";

const t0 = Date.parse("2026-09-25T00:00:00Z");
const at = (h: number) => t0 + h * HOUR_MS;
const nep = varietyFromRow({ id: "nep", name: "Nếp", scale: 1, base_kg: 75, price_per_kg: 18, blast_mult: 1, sort_order: 20 });
const item = (id: string, kind: string, name: string, over: Record<string, unknown> = {}) => farmItemFromRow({
  id, kind, name, price: 50, sort_order: 0, variety: null, fert: null, pest_target: null, capacity: null, ...over,
});
const CATALOG: FarmCatalog = {
  varieties: [nep],
  items: [
    item("seed_nep", "seed", "Giống nếp", { variety: "nep" }),
    item("fert_manure", "fertilizer", "Phân chuồng hoai", { fert: "manure" }),
    item("fert_urea", "fertilizer", "Phân urê", { fert: "urea" }),
    item("spray_hopper", "pesticide", "Thuốc trừ rầy", { pest_target: "hopper" }),
  ],
};
const ME = { id: "me", name: "Me" };
const mine = (items: Record<string, number>): FarmMine => ({ items, rice: {}, coins: 0, giftClaimed: true });
const ALL = mine({ seed_nep: 1, fert_manure: 1, fert_urea: 2, spray_hopper: 1 });

/** A crop on plot 5 farmed by me: soaked at 0 h, flooded (3) at 0 h, plus whatever `over` sets. */
const crop = (over: Partial<CropView> = {}, water: Array<[number, number]> = [[0, 3]], fert: Array<[number, string]> = []): CropView => ({
  variety: "nep", phase: "prepared", preparedAt: at(0), soakAt: at(0), sowAt: null, transplantAt: null, water: 0, waterSetAt: null,
  pests: [], excessN: false, ripe: false, rottedAt: null,
  log: { water: water.map(([h, l]) => ({ t: at(h), l })), fert: fert.map(([h, i]) => ({ t: at(h), item: i })), spray: [], picks: [], qTransplant: 1 },
  ...over,
});
const plot = (c: CropView | null, over: Partial<PlotView> = {}): PlotView => ({
  no: 5, kind: "village", owner: null, salePrice: null, subleasePrice: null, farmer: ME,
  lease: { source: "village", until: at(96), price: 250 }, offers: 0, crop: c, ...over,
});
const find = (list: PlotAction[], key: string) => list.find((a) => a.key === key);
const keys = (list: PlotAction[]) => list.map((a) => a.key);

describe("plotActions", () => {
  it("offers làm đất and soaking on a bare plot", () => {
    expect(keys(plotActions(plot(null), "me", null, CATALOG, ALL, at(0)))).toEqual(["prepare", "soak:seed_nep"]);
    const noSeed = plotActions(plot(null), "me", null, CATALOG, mine({}), at(0));
    expect(find(noSeed, "soak")).toMatchObject({ enabled: false, why: "Chưa có giống — ghé tiệm anh Hai." });
  });
  it("lets a neighbour only pick the snails", () => {
    const snail: PestView = { kind: "snail", since: at(16), treatedAt: null };
    const p = plot(crop({ transplantAt: at(12), sowAt: at(3), pests: [snail], log: null }), { farmer: { id: "lan", name: "Lan" } });
    expect(plotActions(p, "me", nep, CATALOG, ALL, at(20))).toEqual([
      { key: "pick", label: "Bắt ốc bươu vàng", run: { kind: "pick_snails", plot: 5 }, enabled: true },
    ]);
  });
  it("sows sprouted seed on a moist bed only", () => {
    const flooded = plotActions(plot(crop()), "me", nep, CATALOG, ALL, at(3));
    expect(find(flooded, "sow")).toMatchObject({ enabled: false, why: "Cần mực nước Ẩm (đang Sâu)." });
    const moist = plotActions(plot(crop({}, [[0, 3], [2.75, 1]])), "me", nep, CATALOG, ALL, at(3));
    expect(find(moist, "sow")).toMatchObject({ enabled: true, run: { kind: "sow", plot: 5 } });
    expect(find(plotActions(plot(crop()), "me", nep, CATALOG, ALL, at(1)), "sow")?.why).toBe("Hạt đang ngâm — nứt nanh sau 1 giờ.");
  });
  it("transplants seedlings old enough in shallow water, as a work action", () => {
    const seedlings = (water: Array<[number, number]>) => plot(crop({ sowAt: at(3) }, water));
    expect(find(plotActions(seedlings([[0, 1]]), "me", nep, CATALOG, ALL, at(6)), "transplant")?.why)
      .toBe("Mạ chưa đủ tuổi — cấy được sau 5 giờ.");
    expect(find(plotActions(seedlings([[0, 1]]), "me", nep, CATALOG, ALL, at(11)), "transplant")?.why)
      .toBe("Cần mực nước Nông (đang Ẩm).");
    expect(find(plotActions(seedlings([[0, 1], [11, 2]]), "me", nep, CATALOG, ALL, at(11)), "transplant"))
      .toMatchObject({ enabled: true, run: { kind: "work", plot: 5, work: "transplant" } });
  });
  it("harvests ripe rice in a drained plot", () => {
    const ripe = (water: Array<[number, number]>) => plot(crop({ sowAt: at(3), transplantAt: at(12) }, water));
    expect(find(plotActions(ripe([[0, 3], [50, 1]]), "me", nep, CATALOG, ALL, at(55)), "harvest")?.why).toBe("Lúa chưa chín — gặt được sau 5 giờ.");
    expect(find(plotActions(ripe([[0, 3], [55, 3]]), "me", nep, CATALOG, ALL, at(61)), "harvest")?.why).toBe("Rút nước trước khi gặt (đang Sâu).");
    expect(find(plotActions(ripe([[0, 3], [55, 1]]), "me", nep, CATALOG, ALL, at(61)), "harvest")?.enabled).toBe(true);
  });
  it("says which fertilizer and spray help, and warns about the rest", () => {
    const list = plotActions(plot(crop({ sowAt: at(3), transplantAt: at(12) })), "me", nep, CATALOG, ALL, at(17));
    expect(find(list, "fert:fert_urea")).toMatchObject({ enabled: true, hint: "Đúng lúc bón thúc đẻ nhánh." });
    expect(find(list, "fert:fert_manure")?.warn).toBe("Đã cấy — bón lót bây giờ là phí.");
    expect(find(list, "spray:spray_hopper")?.warn).toBe("Không có sâu bệnh nào trị bằng thuốc này — xịt là phí.");
    const hopper: PestView = { kind: "hopper", since: at(16), treatedAt: null };
    const sick = plotActions(plot(crop({ sowAt: at(3), transplantAt: at(12), pests: [hopper] })), "me", nep, CATALOG, ALL, at(17));
    expect(find(sick, "spray:spray_hopper")?.hint).toBe("Trị rầy nâu.");
    expect(keys(sick)).toEqual(["water_up", "water_down", "fert:fert_manure", "fert:fert_urea", "spray:spray_hopper", "abandon"]);
  });
});

describe("fertAdvice", () => {
  const c = (fert: Array<[number, string]>): CropModel => ({
    soakAt: at(0), sowAt: at(3), transplantAt: at(12), qTransplant: 1, water: [{ t: at(0), l: 3 }],
    fert: fert.map(([h, i]) => ({ t: at(h), item: i })),
  });
  it("follows the top-dress windows and warns about excess nitrogen", () => {
    expect(fertAdvice(c([]), nep, "fert_urea", at(13)).text).toBe("Hơi sớm — chỉ được nửa công (đúng lúc sau 1 giờ).");
    expect(fertAdvice(c([[17, "fert_urea"]]), nep, "fert_urea", at(18))).toEqual({ ok: false, text: "Đã bón đạm đợt này — bón nữa sẽ dư đạm!" });
    expect(fertAdvice(c([[17, "fert_urea"]]), nep, "fert_potash", at(18)).text).toBe("Đã bón thúc đẻ nhánh đủ — bón thêm là phí.");
    expect(fertAdvice(c([]), nep, "fert_potash", at(32))).toEqual({ ok: true, text: "Đúng lúc bón đón đòng." });
    expect(fertAdvice(c([]), nep, "fert_urea", at(32)).text).toBe("Urê lúc làm đòng gây dư đạm!");
    expect(fertAdvice(c([]), nep, "fert_npk", at(45)).text).toBe("Bón đạm lúc này gây dư đạm!");
    expect(fertAdvice({ ...c([]), transplantAt: null }, nep, "fert_manure", at(2))).toEqual({ ok: true, text: "Bón lót trước khi cấy." });
  });
});

describe("dueTasks", () => {
  it("lists what is due on my plots, urgent first", () => {
    const hopper: PestView = { kind: "hopper", since: at(16), treatedAt: null };
    const plots = [
      plot(null, { no: 6 }),
      plot(crop({ sowAt: at(3), transplantAt: at(12), pests: [hopper] }, [[0, 3], [12, 2]], [[1, "fert_manure"], [1, "fert_phosphate"]])),
      plot(null, { no: 7, farmer: { id: "lan", name: "Lan" } }),
    ];
    expect(dueTasks(plots, "me", [nep], at(17))).toEqual([
      { plot: 5, text: "Thửa 5 · Bón thúc đẻ nhánh — còn 5 giờ", urgent: true },
      { plot: 5, text: "Thửa 5 · Rầy nâu! Xịt thuốc trừ rầy", urgent: true },
      { plot: 6, text: "Thửa 6 · Làm đất, ngâm giống", urgent: false },
    ]);
  });
  it("warns about the water, the lease and the harvest", () => {
    const p = plot(crop({ sowAt: at(3), transplantAt: at(12) }, [[0, 3], [12, 2]]), { lease: { source: "village", until: at(26), price: 250 } });
    expect(dueTasks([p], "me", [nep], at(24)).map((t) => t.text)).toEqual([
      "Thửa 5 · Hết hạn thuê sau 2 giờ",
      "Thửa 5 · Bơm nước (đang Ẩm, cần Nông)",
    ]);
    const ripe = plot(crop({ sowAt: at(3), transplantAt: at(12) }, [[0, 3], [52, 1]]));
    expect(dueTasks([ripe], "me", [nep], at(70))).toEqual([{ plot: 5, text: "Thửa 5 · Gặt — còn 2 giờ", urgent: true }]);
  });
});
