import { describe, it, expect } from "vitest";
import {
  dueTasks, fertAdvice, harvesterOn, lower, plotActions, plotPrompt, tendAdvice, upFertAdvice, uplandOf, type PlotAction,
} from "@/lib/game/farm/actions";
import {
  farmItemFromRow, LEASE_ROUND_MS, uplandFromRow, varietyFromRow, type FarmCatalog, type UplandCropRow,
} from "@/lib/game/farm/catalog";
import { HOUR_MS, type CropModel } from "@/lib/game/farm/crop";
import type { CropView, FarmMine, PestView, PlotView } from "@/lib/game/farm/state";
import type { UplandModel } from "@/lib/game/farm/upland";
import fixtures from "@/tests/fixtures/upland-cases.json";

const t0 = Date.parse("2026-09-25T00:00:00Z");
const at = (h: number) => t0 + h * HOUR_MS;
const nep = varietyFromRow({ id: "nep", name: "Nếp", scale: 1, base_kg: 75, price_per_kg: 18, blast_mult: 1, sort_order: 20 });
const item = (id: string, kind: string, name: string, over: Record<string, unknown> = {}) => farmItemFromRow({
  id, kind, name, price: 50, sort_order: 0, variety: null, fert: null, pest_target: null, capacity: null, ...over,
});
const CATALOG: FarmCatalog = {
  varieties: [nep],
  uplands: [],
  items: [
    item("seed_nep", "seed", "Giống nếp", { variety: "nep" }),
    item("fert_manure", "fertilizer", "Phân chuồng hoai", { fert: "manure" }),
    item("fert_urea", "fertilizer", "Phân urê", { fert: "urea" }),
    item("spray_hopper", "pesticide", "Thuốc trừ rầy", { pest_target: "hopper" }),
    item("tool_sickle", "tool", "Liềm"),
  ],
};
const ME = { id: "me", name: "Me" };
const mine = (items: Record<string, number>): FarmMine => ({ items, rice: {}, coins: 0, giftClaimed: true, produce: {}, tank: null });
const ALL = mine({ seed_nep: 1, fert_manure: 1, fert_urea: 2, spray_hopper: 1 });
const SICKLE = mine({ ...ALL.items, tool_sickle: 1 });

/** A crop on plot 5 farmed by me: soaked at 0 h, flooded (3) at 0 h, plus whatever `over` sets. */
const crop = (over: Partial<CropView> = {}, water: Array<[number, number]> = [[0, 3]], fert: Array<[number, string]> = []): CropView => ({
  kind: "rice", variety: "nep", upland: null, phase: "prepared", preparedAt: at(0), soakAt: at(0), sowAt: null, transplantAt: null,
  plantAt: null, water: 0, waterSetAt: null, pests: [], excessN: false, ripe: false, rottedAt: null, picking: null, pickings: 1, parts: 0,
  harvester: null,
  log: {
    water: water.map(([h, l]) => ({ t: at(h), l })), fert: fert.map(([h, i]) => ({ t: at(h), item: i })), spray: [], picks: [],
    qTransplant: 1, work: [], harvests: [], harvestedKg: 0,
  },
  ...over,
});
const plot = (c: CropView | null, over: Partial<PlotView> = {}): PlotView => ({
  no: 5, kind: "village", owner: null, salePrice: null, subleasePrice: null, farmer: ME,
  lease: { source: "village", until: at(96), price: 250 }, offers: 0, crop: c, ...over,
});
const find = (list: PlotAction[], key: string) => list.find((a) => a.key === key);
const keys = (list: PlotAction[]) => list.map((a) => a.key);

// --- beds: the three crops of the shared fixtures (khoai lang, bắp, ớt)
const ROWS = (fixtures as unknown as { crops: UplandCropRow[] }).crops;
const U = Object.fromEntries(ROWS.map((r) => [r.id, uplandFromRow(r)]));
const BEDS: FarmCatalog = {
  varieties: [nep],
  uplands: ROWS.map(uplandFromRow),
  items: [
    ...CATALOG.items,
    item("seed_khoai", "seed", "Dây khoai giống", { upland: "khoai" }),
    item("seed_ot", "seed", "Hạt ớt giống", { upland: "ot" }),
    item("fert_potash", "fertilizer", "Phân kali", { fert: "potash" }),
    item("spray_insect", "pesticide", "Thuốc trừ sâu", { pest_target: "insect" }),
  ],
};
const BEDMINE = mine({ seed_khoai: 1, seed_ot: 1, fert_manure: 1, fert_urea: 1, fert_potash: 1, spray_insect: 1 });
/** Beds on plot 5, Ẩm from 0 h: `upland` planted at 0 h unless `over` says otherwise. */
const bed = (upland: string | null, over: Partial<CropView> = {}, water: Array<[number, number]> = [[0, 1]],
  fert: Array<[number, string]> = [], work: Array<[number, string]> = [], harvests: Array<[number, number, number]> = []): CropView => ({
  ...crop({ kind: "upland", variety: null, upland, soakAt: null, plantAt: upland === null ? null : at(0), pickings: 0 }),
  log: {
    water: water.map(([h, l]) => ({ t: at(h), l })), fert: fert.map(([h, i]) => ({ t: at(h), item: i })), spray: [], picks: [],
    qTransplant: 1, work: work.map(([h, act]) => ({ t: at(h), act })), harvests: harvests.map(([h, k, kg]) => ({ t: at(h), k, kg })),
    harvestedKg: 0,
  },
  ...over,
});

describe("plotActions", () => {
  it("offers làm đất as a paddy or as beds, and soaking, on a bare plot", () => {
    const list = plotActions(plot(null), "me", null, CATALOG, ALL, at(0));
    expect(keys(list)).toEqual(["prepare", "prepare_beds", "soak:seed_nep"]);
    expect(find(list, "prepare")).toMatchObject({ label: "Làm ruộng lúa", hint: "Cày bừa, cho nước ngập ruộng — để cấy lúa." });
    expect(find(list, "prepare_beds")).toMatchObject({
      label: "Lên luống trồng màu", run: { kind: "prepare_beds", plot: 5 }, enabled: true, hint: "Đắp luống cao, đất Ẩm — trồng khoai, bắp, ớt.",
    });
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
  it("cuts ripe rice in a drained plot with a sickle, a round at a time", () => {
    const ripe = (water: Array<[number, number]>, over: Partial<CropView> = {}) => plot(crop({ sowAt: at(3), transplantAt: at(12), ...over }, water));
    expect(find(plotActions(ripe([[0, 3], [50, 1]]), "me", nep, CATALOG, SICKLE, at(55)), "round")?.why).toBe("Lúa chưa chín — gặt được sau 5 giờ.");
    expect(find(plotActions(ripe([[0, 3], [55, 3]]), "me", nep, CATALOG, SICKLE, at(61)), "round")?.why).toBe("Rút nước trước khi gặt (đang Sâu).");
    expect(find(plotActions(ripe([[0, 3], [55, 1]]), "me", nep, CATALOG, ALL, at(61)), "round")?.why).toBe("Chưa có liềm — mua ở tiệm anh Hai.");
    expect(find(plotActions(ripe([[0, 3], [55, 1]]), "me", nep, CATALOG, SICKLE, at(61)), "round")).toMatchObject({
      label: "Gặt bằng liềm", run: { kind: "round", plot: 5 }, enabled: true, hint: "Mỗi phần là một lượt 8 bó — đạt 4 điểm là xong phần.",
    });
    // a partly cut plot takes only the next round and Bỏ vụ; nobody picks its snails (R8)
    const snail: PestView = { kind: "snail", since: at(20), treatedAt: null };
    const cut = ripe([[0, 3], [55, 1]], { parts: 2, pests: [snail] });
    const list = plotActions(cut, "me", nep, CATALOG, SICKLE, at(61));
    expect(keys(list)).toEqual(["round", "abandon"]);
    expect(find(list, "round")).toMatchObject({ label: "Gặt tiếp (phần 3/6)", enabled: true });
    expect(find(list, "abandon")?.warn).toBe("Bỏ vụ là mất phần lúa chưa gặt.");
    expect(plotActions({ ...cut, farmer: { id: "lan", name: "Lan" } }, "me", nep, CATALOG, SICKLE, at(61))).toEqual([]);
    // a running harvester takes every button
    const running = ripe([[0, 3], [55, 1]], { harvester: { startedAt: at(61), endsAt: at(61) + 30_000 } });
    expect(plotActions(running, "me", nep, CATALOG, SICKLE, at(61))).toEqual([]);
  });
  it("keeps a round out of the lease's last 25 s, as begin_work does (R11)", () => {
    const ripe = (left: number, over: Partial<CropView> = {}) => plot(crop({ sowAt: at(3), transplantAt: at(12), ...over }, [[0, 3], [55, 1]]),
      { lease: { source: "village", until: at(61) + left, price: 250 } });
    const round = (p: PlotView) => find(plotActions(p, "me", nep, CATALOG, SICKLE, at(61)), "round");
    expect(LEASE_ROUND_MS).toBe(25_000);
    expect(round(ripe(24_999))).toMatchObject({ enabled: false, why: "Sắp hết hạn thuê — không kịp gặt phần này." });
    expect(round(ripe(25_000))).toMatchObject({ enabled: true, why: undefined });
    expect(round(ripe(24_000, { parts: 2 }))).toMatchObject({
      label: "Gặt tiếp (phần 3/6)", enabled: false, why: "Sắp hết hạn thuê — không kịp gặt phần này.",
    });
    // a plot of my own has no lease to end
    expect(round({ ...ripe(0), lease: null })).toMatchObject({ enabled: true });
  });
  it("waits for 0016 to cut rice: a catalog with no tools has no sickle to sell and no harvest_part", () => {
    const ripe = (water: Array<[number, number]>) => plot(crop({ sowAt: at(3), transplantAt: at(12) }, water));
    const before0016: FarmCatalog = { ...CATALOG, items: CATALOG.items.filter((i) => i.kind !== "tool") };
    const why = (p: PlotView, h: number) => find(plotActions(p, "me", nep, before0016, ALL, at(h)), "round")?.why;
    expect(why(ripe([[0, 3], [55, 1]]), 61)).toBe("Nông cụ và hoa màu chưa mở — chủ phòng cần chạy migration 0016.");
    expect(why(ripe([[0, 3], [50, 1]]), 55)).toBe("Nông cụ và hoa màu chưa mở — chủ phòng cần chạy migration 0016.");
    expect(plotPrompt(ripe([[0, 3], [55, 1]]), "me", nep, before0016, SICKLE, at(61))).toBe("Xem thửa 5");
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
  it("stops pumping and draining at 6 water changes in an hour or 60 in the log, as the server does", () => {
    const water = (list: PlotAction[]) => [find(list, "water_up"), find(list, "water_down")].map((a) => [a?.enabled, a?.why]);
    // six entries after 10.5 h
    const busy = plot(crop({}, [[0, 3], [10.625, 2], [10.75, 1], [10.875, 2], [11, 1], [11.25, 2], [11.5, 1]]));
    expect(water(plotActions(busy, "me", nep, CATALOG, ALL, at(11.5)))).toEqual([[false, "Từ từ thôi…"], [false, "Từ từ thôi…"]]);
    // an hour after the oldest of them, five are left
    expect(water(plotActions(busy, "me", nep, CATALOG, ALL, at(11.625)))).toEqual([[true, undefined], [true, undefined]]);
    const full = plot(crop({ sowAt: at(3), transplantAt: at(12) }, Array.from({ length: 60 }, (_, i): [number, number] => [i, 2])));
    expect(water(plotActions(full, "me", nep, CATALOG, ALL, at(70)))).toEqual([[false, "Từ từ thôi…"], [false, "Từ từ thôi…"]]);
    const room = plot(crop({ sowAt: at(3), transplantAt: at(12) }, Array.from({ length: 59 }, (_, i): [number, number] => [i, 2])));
    expect(water(plotActions(room, "me", nep, CATALOG, ALL, at(70)))).toEqual([[true, undefined], [true, undefined]]);
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
    expect(dueTasks(plots, "me", CATALOG, ALL, at(17))).toEqual([
      { plot: 5, text: "Thửa 5 · Bón thúc đẻ nhánh — còn 5 giờ", urgent: true },
      { plot: 5, text: "Thửa 5 · Rầy nâu! Xịt thuốc trừ rầy", urgent: true },
      { plot: 6, text: "Thửa 6 · Làm đất (ruộng lúa hoặc lên luống)", urgent: false },
    ]);
  });
  it("warns about the water, the lease and the harvest", () => {
    const p = plot(crop({ sowAt: at(3), transplantAt: at(12) }, [[0, 3], [12, 2]]), { lease: { source: "village", until: at(26), price: 250 } });
    expect(dueTasks([p], "me", CATALOG, ALL, at(24)).map((t) => t.text)).toEqual([
      "Thửa 5 · Hết hạn thuê sau 2 giờ",
      "Thửa 5 · Bơm nước (đang Ẩm, cần Nông)",
    ]);
    const ripe = plot(crop({ sowAt: at(3), transplantAt: at(12) }, [[0, 3], [52, 1]]));
    expect(dueTasks([ripe], "me", CATALOG, SICKLE, at(70))).toEqual([{ plot: 5, text: "Thửa 5 · Gặt — còn 2 giờ", urgent: true }]);
  });
  it("asks for a sickle from heading on, and follows a cut plot and a running harvester", () => {
    const rice = (water: Array<[number, number]>, over: Partial<CropView> = {}) => plot(crop({ sowAt: at(3), transplantAt: at(12), ...over }, water));
    const tasks = (p: PlotView, h: number, m = ALL) => dueTasks([p], "me", CATALOG, m, at(h)).map((t) => [t.text, t.urgent]);
    expect(tasks(rice([[0, 3], [44, 3]]), 45)).toEqual([["Thửa 5 · Chưa có liềm — mua ở tiệm anh Hai hoặc thuê máy gặt", false]]);
    expect(tasks(rice([[0, 3], [44, 3]]), 45, SICKLE)).toEqual([]);
    expect(tasks(rice([[0, 3], [52, 1]]), 61)).toEqual([
      ["Thửa 5 · Chưa có liềm — mua ở tiệm anh Hai hoặc thuê máy gặt", true], ["Thửa 5 · Gặt — còn 11 giờ", false],
    ]);
    expect(tasks(rice([[0, 3], [52, 1]], { parts: 2 }), 61)).toEqual([["Thửa 5 · Gặt tiếp — đã gặt 2/6 phần", false]]);
    expect(tasks(rice([[0, 3], [52, 1]], { parts: 2 }), 73)).toEqual([["Thửa 5 · Gặt tiếp — đã gặt 2/6 phần", true]]);
    const running = rice([[0, 3], [52, 1]], { harvester: { startedAt: at(61), endsAt: at(61) + 30_000 } });
    expect(dueTasks([running], "me", CATALOG, ALL, at(61) + 5_000)).toEqual([
      { plot: 5, text: "Thửa 5 · Máy gặt đang gặt — còn 25 giây", urgent: false },
    ]);
  });
  it("follows the beds: planting, the ớt nursery, the hand jobs, the pickings, the water and the pests", () => {
    const tasks = (c: CropView, h: number) => dueTasks([plot(c)], "me", BEDS, BEDMINE, at(h)).map((t) => [t.text.replace("Thửa 5 · ", ""), t.urgent]);
    // bare beds: bón lót before planting, as on a paddy (on beds before P, the nursery included)
    expect(tasks(bed(null), 1)).toEqual([["Bón lót (phân chuồng, phân lân)", false], ["Trồng hoa màu", false]]);
    expect(tasks(bed(null, {}, [[0, 1]], [[0.5, "fert_manure"]]), 1)).toEqual([["Bón lót (phân chuồng, phân lân)", false], ["Trồng hoa màu", false]]);
    expect(tasks(bed(null, {}, [[0, 1]], [[0.5, "fert_manure"], [0.5, "fert_phosphate"]]), 1)).toEqual([["Trồng hoa màu", false]]);
    // ớt sown at 0 h: its seedlings go out from 10 h and are old from 18 h
    const nursery = (fert: Array<[number, string]> = []) => bed("ot", { sowAt: at(0), plantAt: null }, [[0, 1], [12, 1]], fert);
    expect(tasks(nursery(), 5)).toEqual([["Bón lót (phân chuồng, phân lân)", false], ["Cây ớt con đang lớn — trồng được sau 5 giờ", false]]);
    const based = nursery([[1, "fert_manure"], [1, "fert_phosphate"]]);
    expect(tasks(based, 11)).toEqual([["Trồng cây ớt con", false]]);
    expect(tasks(based, 19)).toEqual([["Trồng cây ớt con", true]]);
    // khoai planted at 0 h: bón thúc nuôi củ 16–26 h, lật dây 24–32 h, rot from 22 h, ripe at 48 h for 12 h
    expect(tasks(bed("khoai", {}, [[0, 0]]), 3)).toEqual([["Tưới nước (đang Khô, cần Ẩm)", true]]);
    expect(tasks(bed("khoai", {}, [[0, 1], [24, 1]]), 25)).toEqual([["Bón thúc nuôi củ — còn 1 giờ", true], ["Lật dây — còn 7 giờ", true]]);
    const tended = (water: Array<[number, number]>) => bed("khoai", {}, water, [[20, "fert_potash"]], [[25, "lat_day"]]);
    expect(tasks(tended([[0, 1], [24, 1]]), 26)).toEqual([]);
    expect(tasks(bed("khoai", {}, [[0, 1], [22, 2]]), 23)).toEqual([
      ["Bón thúc nuôi củ — còn 3 giờ", true], ["Tháo nước ngay — khoai lang đang thối củ!", true],
    ]);
    expect(tasks(tended([[0, 1], [48, 1]]), 50)).toEqual([["Đào khoai — còn 10 giờ", false]]);
    expect(tasks(tended([[0, 1], [48, 1]]), 58)).toEqual([["Đào khoai — còn 2 giờ", true]]);
    expect(tasks(tended([[0, 1], [48, 1]]), 61)).toEqual([["Đào khoai ngay — đang hư!", true]]);
    const weevil: PestView = { kind: "weevil", since: at(30), treatedAt: null };
    expect(tasks({ ...tended([[0, 1], [24, 1]]), pests: [weevil] }, 31)).toEqual([["Sùng khoai! Xịt thuốc trừ sâu", true]]);
    // ớt set out at 12 h and picked once at 59 h: the next picking is ripe at 70 h
    const ot = bed("ot", { sowAt: at(0), plantAt: at(12) }, [[0, 1], [59, 1]], [], [], [[59, 1, 24]]);
    expect(tasks(ot, 60)).toEqual([["Bón nuôi trái — còn 8 giờ", true], ["Hái ớt lứa 2 — chín sau 10 giờ", false]]);
  });
  it("says a pest once per plot, however many of its waves are on it", () => {
    // bắp's two armyworm waves, both untreated at 30 h (Đẫm since 24 h: the water suits the knee stage)
    const armyworm = (h: number): PestView => ({ kind: "armyworm", since: at(h), treatedAt: null });
    const bap = plot(bed("bap", { pests: [armyworm(12), armyworm(29)] }, [[0, 1], [24, 2]]));
    const list = dueTasks([bap], "me", BEDS, BEDMINE, at(30));
    expect(list).toEqual([{ plot: 5, text: "Thửa 5 · Sâu keo mùa thu! Xịt thuốc trừ sâu", urgent: true }]);
    expect(list.filter((t) => t.urgent)).toHaveLength(1);
  });
});

describe("plotActions on beds", () => {
  it("plants each hoa-màu seed I hold on moist beds, or says there is none", () => {
    const list = plotActions(plot(bed(null)), "me", null, BEDS, BEDMINE, at(1));
    expect(keys(list)).toEqual([
      "plant:seed_khoai", "plant:seed_ot", "water_up", "water_down", "fert:fert_manure", "fert:fert_urea", "fert:fert_potash",
      "spray:spray_insect", "abandon",
    ]);
    expect(find(list, "plant:seed_khoai")).toMatchObject({ label: "Trồng dây khoai", run: { kind: "plant", plot: 5, item: "seed_khoai" }, enabled: true });
    expect(find(list, "plant:seed_ot")?.label).toBe("Ươm hạt ớt");
    expect([find(list, "water_up")?.label, find(list, "water_down")?.label]).toEqual(["Tưới nước (lên Đẫm)", "Tháo nước (xuống Khô)"]);
    expect(find(list, "fert:fert_manure")?.hint).toBe("Bón lót trước khi trồng.");
    expect(find(list, "fert:fert_urea")?.warn).toBe("Chưa trồng — bón thúc bây giờ là phí.");
    expect(find(list, "abandon")?.warn).toBe("Bỏ vụ là mất hết hoa màu trên thửa này.");
    const dry = plotActions(plot(bed(null, {}, [[0, 0]])), "me", null, BEDS, BEDMINE, at(1));
    expect(find(dry, "plant:seed_khoai")).toMatchObject({ enabled: false, why: "Cần đất Ẩm (đang Khô)." });
    expect(find(dry, "water_down")).toMatchObject({ enabled: false, why: "Luống đã khô." });
    expect(find(plotActions(plot(bed(null, {}, [[0, 3]])), "me", null, BEDS, BEDMINE, at(1)), "water_up")?.label).toBe("Tưới thêm (giữ Ngập)");
    expect(find(plotActions(plot(bed(null)), "me", null, BEDS, mine({}), at(1)), "plant")).toMatchObject({
      label: "Trồng hoa màu", enabled: false, why: "Chưa có giống hoa màu — ghé tiệm anh Hai.",
    });
  });
  it("sets out the ớt seedlings once old enough, on moist beds", () => {
    const nursery = (water: Array<[number, number]>) => plot(bed("ot", { sowAt: at(0), plantAt: null }, water));
    expect(find(plotActions(nursery([[0, 1]]), "me", null, BEDS, BEDMINE, at(6)), "set_out")).toMatchObject({
      label: "Trồng cây ớt con", enabled: false, why: "Cây con chưa đủ tuổi — trồng được sau 4 giờ.",
    });
    expect(find(plotActions(nursery([[0, 1], [10, 2]]), "me", null, BEDS, BEDMINE, at(11)), "set_out")?.why).toBe("Cần đất Ẩm (đang Đẫm).");
    expect(find(plotActions(nursery([[0, 1]]), "me", null, BEDS, BEDMINE, at(11)), "set_out")).toMatchObject({
      enabled: true, run: { kind: "work", plot: 5, work: "transplant" },
    });
  });
  it("advises the hand jobs by their windows, and stops at 20 of them", () => {
    const khoai = (work: Array<[number, string]> = []) => plot(bed("khoai", {}, [[0, 1]], [], work));
    const lat = (p: PlotView, h: number) => find(plotActions(p, "me", null, BEDS, BEDMINE, at(h)), "tend:lat_day");
    expect(lat(khoai(), 20)).toMatchObject({
      label: "Lật dây", run: { kind: "tend", plot: 5, act: "lat_day" }, enabled: true, warn: "Chưa tới lúc — lật dây lúc 24–32 giờ sau trồng.",
    });
    expect(lat(khoai(), 25)).toMatchObject({ enabled: true, hint: "Đúng lúc lật dây." });
    expect(lat(khoai([[25, "lat_day"]]), 26)).toMatchObject({ enabled: false, why: "Đã lật dây rồi." });
    expect(lat(khoai(), 33)).toMatchObject({ enabled: true, warn: "Trễ rồi — chỉ được nửa công." });
    expect(lat(khoai(), 41)).toMatchObject({ enabled: true, warn: "Quá muộn — làm bây giờ là phí công." });
    expect(lat(khoai(Array.from({ length: 20 }, (_, i): [number, string] => [i, "lat_day"])), 25)).toMatchObject({ enabled: false, why: "Từ từ thôi…" });
    const bap = uplandModel0({ plantAt: at(0) });
    expect(tendAdvice(bap, U.bap.cares.find((c) => c.id === "vun_goc")!, at(20))).toEqual({ done: false, ok: true, text: "Đúng lúc vun gốc." });
  });
  it("warns before watering khoai into rot, and picks only ripe and drained", () => {
    const k = (water: Array<[number, number]>) => plot(bed("khoai", {}, water));
    expect(find(plotActions(k([[0, 1], [22, 1]]), "me", null, BEDS, BEDMINE, at(23)), "water_up")?.warn).toBe("Đất Đẫm làm thối củ khoai lang!");
    expect(find(plotActions(k([[0, 1], [12, 1]]), "me", null, BEDS, BEDMINE, at(20)), "water_up")?.warn).toBeUndefined();
    const pick = (p: PlotView, h: number) => find(plotActions(p, "me", null, BEDS, BEDMINE, at(h)), "picking");
    expect(pick(k([[0, 1]]), 40)).toMatchObject({ label: "Đào khoai", enabled: false, why: "Chưa chín — đào khoai được sau 8 giờ." });
    expect(pick(k([[0, 1], [49, 2]]), 50)?.why).toBe("Tháo bớt nước trước khi đào khoai (đang Đẫm).");
    expect(pick(k([[0, 1], [48, 1]]), 50)).toMatchObject({ enabled: true, run: { kind: "work", plot: 5, work: "harvest" } });
    const ot = plot(bed("ot", { sowAt: at(0), plantAt: at(12) }, [[0, 1], [48, 1]], [], [], [[59, 1, 24]]));
    expect(pick(ot, 60)).toMatchObject({ label: "Hái ớt (lứa 2/3)", enabled: false, why: "Chưa chín — hái ớt được sau 10 giờ." });
  });
  it("sprays from the sprayer's tank first, and says the charges left", () => {
    const weevil: PestView = { kind: "weevil", since: at(30), treatedAt: null };
    const sick = plot(bed("khoai", { pests: [weevil] }));
    const spray = (m: FarmMine) => find(plotActions(sick, "me", null, BEDS, m, at(31)), "spray:spray_insect");
    expect(spray({ ...mine({}), tank: { item: "spray_insect", charges: 2 } })).toMatchObject({
      label: "Xịt thuốc trừ sâu (bình phun)", run: { kind: "spray", plot: 5, item: "spray_insect" }, hint: "Trị sùng khoai. Bình còn 2 lần.",
    });
    expect(spray(BEDMINE)).toMatchObject({ label: "Xịt thuốc trừ sâu", hint: "Trị sùng khoai." });
    expect(spray({ ...BEDMINE, tank: { item: null, charges: 0 } })?.label).toBe("Xịt thuốc trừ sâu");
    expect(spray({ ...mine({}), tank: { item: null, charges: 0 } })).toBeUndefined();
  });
  it("finds the crop on the beds and a running harvester, and lower-cases a name's first letter", () => {
    expect(uplandOf(bed("khoai"), BEDS)?.name).toBe("Khoai lang");
    expect(uplandOf(bed(null), BEDS)).toBeNull();
    expect(uplandOf(crop(), BEDS)).toBeNull();
    expect([harvesterOn(crop({ harvester: { startedAt: 0, endsAt: 1 } })), harvesterOn(crop()), harvesterOn(null)]).toEqual([true, false, false]);
    expect(lower("Phân NPK")).toBe("phân NPK");
  });
});

/** A hoa-màu model: Ẩm from 0 h, nothing done. */
function uplandModel0(over: Partial<UplandModel> = {}): UplandModel {
  return { sowAt: null, plantAt: null, water: [{ t: at(0), l: 1 }], fert: [], work: [], spray: [], harvests: [], ...over };
}

describe("upFertAdvice", () => {
  const NAME: Record<string, string> = {
    fert_manure: "Phân chuồng hoai", fert_phosphate: "Phân lân", fert_urea: "Phân urê", fert_potash: "Phân kali", fert_npk: "Phân NPK",
  };
  const advice = (fert: Array<[number, string]>, item: string, h: number, plant: number | null = 0) => upFertAdvice(
    uplandModel0({ plantAt: plant === null ? null : at(plant), fert: fert.map(([t, i]) => ({ t: at(t), item: i })) }), U.khoai, item, NAME[item], at(h),
  );
  it("before planting: the base fertilizers, once each", () => {
    expect(advice([], "fert_manure", 1, null)).toEqual({ ok: true, text: "Bón lót trước khi trồng." });
    expect(advice([[1, "fert_manure"]], "fert_manure", 2, null)).toEqual({ ok: false, text: "Đã bón lót loại này — bón thêm là phí." });
    expect(advice([], "fert_urea", 1, null)).toEqual({ ok: false, text: "Chưa trồng — bón thúc bây giờ là phí." });
    expect(advice([], "fert_phosphate", 1, 5)).toEqual({ ok: true, text: "Bón lót trước khi trồng." });
  });
  it("after planting: the care windows, the half items and excess nitrogen", () => {
    expect(advice([], "fert_manure", 1)).toEqual({ ok: false, text: "Đã trồng — bón lót bây giờ là phí." });
    expect(advice([], "fert_potash", 20)).toEqual({ ok: true, text: "Đúng lúc bón thúc nuôi củ." });
    expect(advice([], "fert_potash", 10)).toEqual({ ok: false, text: "Hơi sớm — chỉ được nửa công (đúng lúc sau 6 giờ)." });
    expect(advice([], "fert_potash", 30)).toEqual({ ok: false, text: "Trễ rồi — chỉ được nửa công." });
    expect(advice([], "fert_urea", 20)).toEqual({ ok: false, text: "Phân urê lúc này chỉ được nửa công." });
    expect(advice([[20, "fert_npk"]], "fert_npk", 21)).toEqual({ ok: false, text: "Đã bón đạm đợt này — bón nữa sẽ dư đạm!" });
    expect(advice([], "fert_urea", 40)).toEqual({ ok: false, text: "Bón đạm lúc này gây dư đạm!" });
    expect(advice([], "fert_potash", 40)).toEqual({ ok: false, text: "Lúc này bón là phí." });
    expect(advice([[20, "fert_potash"]], "fert_potash", 22)).toEqual({ ok: false, text: "Lúc này bón là phí." });
  });
});

describe("plotPrompt", () => {
  const prompt = (p: PlotView, h: number) => plotPrompt(p, "me", nep, CATALOG, ALL, at(h));
  it("names my next job on a plot I farm", () => {
    expect(prompt(plot(null), 0)).toBe("Làm đất thửa 5");
    expect(prompt(plot(crop({ soakAt: null, variety: null })), 0)).toBe("Ngâm giống thửa 5");
    expect(prompt(plot(crop({}, [[0, 3], [2.75, 1]])), 3)).toBe("Gieo mạ thửa 5");
    expect(prompt(plot(crop({ sowAt: at(3), transplantAt: at(12) })), 20)).toBe("Xem thửa 5");
  });
  it("says whose plot it is otherwise", () => {
    const lan = { id: "lan", name: "Lan" };
    expect(prompt(plot(null, { farmer: lan }), 0)).toBe("Xem thửa 5 (của Lan)");
    expect(prompt(plot(null, { farmer: null, lease: null }), 0)).toBe("Xem thửa 5 (đất trống)");
    expect(prompt(plot(null, { no: 2, kind: "private", farmer: null, lease: null }), 0)).toBe("Xem thửa 2 (đất bán)");
    expect(prompt(plot(null, { no: 2, kind: "private", owner: lan, farmer: null, lease: null }), 0)).toBe("Xem thửa 2 (của Lan)");
  });
});

describe("plotPrompt, v15.2", () => {
  it("names the rounds and the bed jobs by their buttons", () => {
    const ripe = (over: Partial<CropView> = {}) => plot(crop({ sowAt: at(3), transplantAt: at(12), ...over }, [[0, 3], [55, 1]]));
    expect(plotPrompt(ripe(), "me", nep, CATALOG, SICKLE, at(61))).toBe("Gặt bằng liềm thửa 5");
    expect(plotPrompt(ripe({ parts: 2 }), "me", nep, CATALOG, SICKLE, at(61))).toBe("Gặt tiếp thửa 5");
    expect(plotPrompt(ripe({ harvester: { startedAt: at(61), endsAt: at(61) + 30_000 } }), "me", nep, CATALOG, SICKLE, at(61))).toBe("Xem thửa 5");
    expect(plotPrompt(plot(bed(null)), "me", null, BEDS, BEDMINE, at(1))).toBe("Trồng dây khoai thửa 5");
    expect(plotPrompt(plot(bed("khoai", {}, [[0, 1], [48, 1]])), "me", null, BEDS, BEDMINE, at(50))).toBe("Đào khoai thửa 5");
    expect(plotPrompt(plot(bed("ot", { sowAt: at(0), plantAt: at(12) }, [[0, 1], [57, 1]])), "me", null, BEDS, BEDMINE, at(58))).toBe("Hái ớt thửa 5");
    expect(plotPrompt(plot(bed("ot", { sowAt: at(0), plantAt: null })), "me", null, BEDS, BEDMINE, at(11))).toBe("Trồng cây ớt con thửa 5");
  });
});
