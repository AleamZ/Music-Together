import { describe, expect, it } from "vitest";
import {
  describeFarmItem, farmItemFromRow, hoursText, ripeAfterHours, uplandFromRow, uplandHours, varietyFromRow, type UplandCropRow,
  type VarietyRow,
} from "@/lib/game/farm/catalog";
import { cropPhase, type CropModel } from "@/lib/game/farm/crop";
import { handbookPage, uplandHandbook } from "@/lib/game/farm/handbook";
import catalog from "@/tests/fixtures/farm-catalog-0120.json";

// 0120: one crop cycle fits in a real day. tests/fixtures/farm-catalog-0120.json is the catalog the migration leaves
// (tests/sql/farm-one-day-smoke.sql checks the database against the same file).
const FX = catalog as unknown as { varieties: VarietyRow[]; uplands: UplandCropRow[] };
const varieties = FX.varieties.map(varietyFromRow);
const uplands = FX.uplands.map(uplandFromRow);
const H = 3_600_000;
const v = (id: string) => varieties.find((x) => x.id === id)!;
const u = (id: string) => uplands.find((x) => x.id === id)!;
const item = (over: Record<string, unknown>) => farmItemFromRow({
  id: "x", kind: "seed", name: "x", price: 1, sort_order: 0, variety: null, fert: null, pest_target: null, capacity: null, ...over,
});

describe("0120: a crop in a day", () => {
  it("every crop is ready within 24 h of its first action, khoai in 8", () => {
    // rice: soak 2 h, the latest transplant without a penalty (14·s), ripe 48·s after it
    for (const x of varieties) expect(2 + 62 * x.scale, x.id).toBeLessThanOrEqual(24);
    for (const x of uplands) expect((x.nurseryReadyH ?? 0) + uplandHours(x, x.pickings.length), x.id).toBeLessThanOrEqual(24);
    expect(uplandHours(u("khoai"), 1)).toBe(8);
    expect(varieties.map((x) => ripeAfterHours(x))).toEqual([12, 16, 20]);
    expect(uplands.map((x) => (x.nurseryReadyH ?? 0) + uplandHours(x, x.pickings.length))).toEqual([8, 15, 24]);
  });
  it("keeps the real-time windows: ripe 8–12 h, lost after 24–48 h", () => {
    expect(uplands.map((x) => [x.ripeWindowH, x.lostAfterH])).toEqual([[12, 48], [12, 48], [8, 24]]);
  });
  it("runs a nếp season through its phases in 16 h", () => {
    const c: CropModel = { soakAt: 0, sowAt: 2 * H, transplantAt: 5.5 * H, qTransplant: 1, water: [], fert: [] };
    const at = (h: number) => cropPhase(c, v("nep"), 5.5 * H + h * H);
    expect([0, 4.5, 7.5, 10, 12, 23.9, 24.1].map(at)).toEqual(["tillering", "panicle", "heading", "ripening", "ripe", "ripe", "overripe"]);
  });
  it("prints the shop lines and the handbook in quarter hours", () => {
    expect(describeFarmItem(item({ variety: "nep" }), varieties)).toBe("Chín sau ~16 giờ · 27 kg/thửa · 950 xu/kg lúa khô");
    expect(describeFarmItem(item({ upland: "khoai" }), varieties, uplands)).toBe("Trồng dây · chín ~8 giờ · 43 kg/thửa · 265 xu/kg");
    expect(describeFarmItem(item({ upland: "ot" }), varieties, uplands))
      .toBe("Ươm 3 giờ rồi trồng · lứa đầu ~13,75 giờ, 3 lứa · 23 kg/thửa · 1.590 xu/kg");
    const marks = handbookPage("process", varieties)[1].lines;
    expect(marks[1]).toBe("Nếp: cấy khi mạ 2–3,5 giờ tuổi · bón thúc 0,5–2,5 giờ sau cấy · phơi ruộng 3,5–4,5 · đón đòng 4,5–6 · "
      + "rút nước từ 10 · chín 12 giờ sau cấy (~16 giờ từ lúc ngâm).");
    const [how] = uplandHandbook(u("ot"), []);
    expect(how.title).toBe("Cách trồng ớt (~24 giờ, hái 3 lứa)");
    expect(how.lines[2]).toContain("khi cây 3–9 giờ tuổi");
  });
  it("prints every care window inside the model's window", () => {
    for (const x of uplands) {
      const lines = uplandHandbook(x, [])[0].lines;
      x.cares.forEach((c, i) => {
        const [, from, to] = /([\d,]+)–([\d,]+) giờ sau trồng/.exec(lines[3 + i])!.map((s) => Number(s.replace(",", ".")));
        expect(from >= c.fromH && to <= c.toH && from <= to, `${x.id} ${c.id}`).toBe(true);
      });
    }
  });
  it("rounds hours to a quarter: up for a start, down for an end", () => {
    expect([hoursText(1.44, "up"), hoursText(2.52, "down"), hoursText(2, "up"), hoursText(2, "down"), hoursText(13.8)])
      .toEqual(["1,5", "2,5", "2", "2", "13,75"]);
  });
});
