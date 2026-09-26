import { describe, it, expect } from "vitest";
import { farmItemFromRow, uplandFromRow, varietyFromRow, type UplandCropRow } from "@/lib/game/farm/catalog";
import { HOUR_MS } from "@/lib/game/farm/crop";
import { HANDBOOK_TABS, handbookPage, handbookTabFor, handbookTabs, uplandHandbook } from "@/lib/game/farm/handbook";
import type { CropView } from "@/lib/game/farm/state";
import fixtures from "@/tests/fixtures/upland-cases.json";

const short = varietyFromRow({ id: "short", name: "Lúa ngắn ngày", scale: 0.9, base_kg: 90, price_per_kg: 12, blast_mult: 1, sort_order: 10 });
const nep = varietyFromRow({ id: "nep", name: "Nếp", scale: 1, base_kg: 75, price_per_kg: 18, blast_mult: 1, sort_order: 20 });
const thom = varietyFromRow({ id: "thom", name: "Lúa thơm", scale: 1.15, base_kg: 60, price_per_kg: 26, blast_mult: 1.3, sort_order: 30 });
const t0 = Date.parse("2026-09-25T00:00:00Z");
const at = (h: number) => t0 + h * HOUR_MS;

describe("handbook", () => {
  it("has the six tabs of spec §8.9, each with something to read", () => {
    expect(HANDBOOK_TABS.map(([, label]) => label)).toEqual(["Quy trình", "Phân bón", "Sâu bệnh", "Nước", "Giống lúa", "Mẹo"]);
    for (const [tab] of HANDBOOK_TABS) {
      const page = handbookPage(tab, [nep, thom]);
      expect(page.length, tab).toBeGreaterThan(0);
      for (const sec of page) expect(sec.lines.length, `${tab}: ${sec.title}`).toBeGreaterThan(0);
    }
  });
  it("gives the 11 steps and the hour marks per variety, each inside its window", () => {
    const [steps, marks] = handbookPage("process", [short, nep, thom]);
    expect(steps.lines).toHaveLength(11);
    // A window's start rounds up and its end or deadline rounds down, so acting at a printed hour is never early or
    // late. The model's windows (crop.ts): ngắn ngày (s = 0.9) mạ 7.2–12.6 h, bón thúc 1.8–9, phơi ruộng 12.6–16.2
    // (checked at 16.2), đón đòng 16.2–21.6, chín 43.2; thơm (s = 1.15) mạ 9.2–16.1, bón thúc 2.3–11.5, phơi ruộng
    // 16.1–20.7, đón đòng 20.7–27.6, chín 55.2.
    expect(marks.lines).toEqual([
      "Lúa ngắn ngày: cấy khi mạ 8–12 giờ tuổi · bón thúc 2–9 giờ sau cấy · phơi ruộng 13–16 · đón đòng 17–21 · rút nước từ 36 · chín 44 giờ sau cấy (~52 giờ từ lúc ngâm).",
      "Nếp: cấy khi mạ 8–14 giờ tuổi · bón thúc 2–10 giờ sau cấy · phơi ruộng 14–18 · đón đòng 18–24 · rút nước từ 40 · chín 48 giờ sau cấy (~58 giờ từ lúc ngâm).",
      "Lúa thơm: cấy khi mạ 10–16 giờ tuổi · bón thúc 3–11 giờ sau cấy · phơi ruộng 17–20 · đón đòng 21–27 · rút nước từ 46 · chín 56 giờ sau cấy (~66 giờ từ lúc ngâm).",
    ]);
    expect(handbookPage("varieties", [thom])[0].lines).toEqual(["Lúa thơm: chín ~66 giờ · 60 kg mỗi thửa · 26 xu/kg lúa khô · dễ bị đạo ôn"]);
  });
  it("keeps the thousands separator in the price per kg", () => {
    const dear = varietyFromRow({ id: "thom", name: "Lúa thơm", scale: 1.15, base_kg: 60, price_per_kg: 1350, blast_mult: 1.3, sort_order: 30 });
    expect(handbookPage("varieties", [dear])[0].lines).toEqual(["Lúa thơm: chín ~66 giờ · 60 kg mỗi thửa · 1.350 xu/kg lúa khô · dễ bị đạo ôn"]);
  });
  it("links the plot panel to what matters now", () => {
    const crop = (over: Partial<CropView>): CropView => ({
      kind: "rice", variety: "nep", upland: null, phase: "prepared", preparedAt: at(0), soakAt: at(0), sowAt: at(3), transplantAt: at(12),
      plantAt: null, water: 2, waterSetAt: at(12), pests: [], excessN: false, ripe: false, rottedAt: null, picking: null, pickings: 1,
      parts: 0, harvester: null, log: null, ...over,
    });
    expect(handbookTabFor(null, null, at(0))).toBe("process");
    expect(handbookTabFor(crop({ transplantAt: null }), nep, at(5))).toBe("process");
    expect(handbookTabFor(crop({}), nep, at(16))).toBe("fertilizer");
    expect(handbookTabFor(crop({ pests: [{ kind: "hopper", since: at(15), treatedAt: null }] }), nep, at(16))).toBe("pests");
    expect(handbookTabFor(crop({}), nep, at(12 + 45))).toBe("process");
    // v15.2: ripe or partly cut rice opens Nông cụ; beds open their crop's tab
    expect(handbookTabFor(crop({}), nep, at(12 + 49))).toBe("tools");
    expect(handbookTabFor(crop({ parts: 2 }), nep, at(12 + 47))).toBe("tools");
    // a partly cut plot takes no spray (R8): its pests do not send it to Sâu bệnh
    expect(handbookTabFor(crop({ parts: 2, pests: [{ kind: "hopper", since: at(12 + 46), treatedAt: null }] }), nep, at(12 + 49))).toBe("tools");
    expect(handbookTabFor(crop({ kind: "upland", variety: null, upland: "ot" }), null, at(20))).toBe("ot");
    expect(handbookTabFor(crop({ kind: "upland", variety: null, upland: null }), null, at(20))).toBe("process");
  });
});

describe("v15.2 tabs (§14)", () => {
  const UPLANDS = (fixtures as unknown as { crops: UplandCropRow[] }).crops.map(uplandFromRow);
  const [khoai, bap, ot] = UPLANDS;
  const ITEMS = [
    ["fert_urea", "Phân urê"], ["fert_potash", "Phân kali"], ["fert_npk", "Phân NPK"], ["spray_insect", "Thuốc trừ sâu"],
    ["spray_fungus", "Thuốc trừ bệnh"],
  ].map(([id, name]) => farmItemFromRow({ id, kind: "fertilizer", name, price: 1, sort_order: 0, variety: null, fert: null, pest_target: null, capacity: null }));
  it("adds a tab per crop and Nông cụ, after the rice tabs", () => {
    expect(handbookTabs(UPLANDS).map(([, label]) => label)).toEqual([
      "Quy trình", "Phân bón", "Sâu bệnh", "Nước", "Giống lúa", "Mẹo", "Khoai lang", "Bắp", "Ớt", "Nông cụ",
    ]);
    expect(handbookPage("process", [nep])[0].lines[10]).toBe(
      "11. Gặt: lúa chín và đã rút nước thì gặt bằng liềm hoặc thuê máy gặt. Ruộng chia 6 phần; mỗi lượt gặt tay có 8 bó — được từ 4 điểm trở lên (chuẩn 1, được nửa điểm, lệch 0) là xong 1 phần. Lúa chín quá vẫn mất 2% mỗi giờ tới lúc cắt từng phần; để 2 ngày thì rụng hết. Gặt xong phơi 3 giờ rồi bán cô Út.");
    expect(handbookPage("pests", [nep]).flatMap((s) => s.lines)).toContain("Hoa màu có sâu bệnh riêng — xem tab từng cây.");
    expect(handbookPage("tips", [nep])[0].lines.slice(-2)).toEqual([
      "Làm đất có hai cách: làm ruộng lúa hoặc lên luống trồng màu — xen vụ lúa với vụ màu cho đỡ nhàm.",
      "Nạp thuốc trừ sâu vào bình phun là lợi nhất: nó trị sâu cuốn lá, sùng khoai, sâu keo và bọ trĩ.",
    ]);
    expect(handbookPage("tools", [nep]).map((s) => s.title)).toEqual(["Liềm và gặt lúa", "Máy gặt", "Bình phun", "Hoa màu"]);
    expect(handbookPage("ot", [nep], UPLANDS, ITEMS)).toEqual(uplandHandbook(ot, ITEMS));
    expect(handbookPage("dua", [nep], UPLANDS, ITEMS)).toEqual([]);
  });
  it("works each crop's page out of its config", () => {
    const [how, pests] = uplandHandbook(ot, ITEMS);
    expect(how.title).toBe("Cách trồng ớt (~80 giờ, hái 3 lứa)");
    expect(how.lines).toEqual([
      "1. Lên luống: đắp luống cao cho ráo nước; đất sẵn Ẩm.",
      "2. Bón lót: phân chuồng hoai và phân lân trước khi trồng. Thiếu mỗi loại mất 5%.",
      "3. Ươm hạt ớt ở góc luống khi đất Ẩm, giữ Ẩm. Trồng cây ớt con khi cây 10–18 giờ tuổi, đất Ẩm; cây già quá mất 3% mỗi giờ (tối đa 30%).",
      "4. Bón thúc bén rễ: phân urê hoặc phân NPK, 4–12 giờ sau trồng. Sai lúc hoặc sai loại được nửa công (mất 8%); bỏ trống mất 15%.",
      "5. Bón thúc ra hoa: phân NPK hoặc phân kali, 22–30 giờ sau trồng. Sai lúc hoặc sai loại được nửa công (mất 8%); bỏ trống mất 15%.",
      "6. Bón nuôi trái: phân NPK hoặc phân kali, 46–56 giờ sau trồng. Sai lúc hoặc sai loại được nửa công (mất 8%); bỏ trống mất 15%.",
      "Nước: Bén rễ Ẩm; Phát triển thân lá, Ra hoa, Đậu trái Ẩm–Đẫm; từ lúc chín Khô–Ẩm. Cứ 12 giờ nước tự rút một mức; mỗi giờ sai mức mất 1% (tối đa 20%).",
      "Hái ớt: chín 46 giờ sau trồng, rồi cứ 12 giờ một lứa (40% – 35% – 25%). Đất phải Khô–Ẩm. Chín quá 8 giờ mất 3% mỗi giờ; để thêm 24 giờ là lứa đó hư.",
    ]);
    expect(pests.lines).toEqual([
      "Bọ trĩ: hay tới 6–24 giờ sau trồng; đất Khô dễ bị gấp 1,5. Xịt thuốc trừ sâu.",
      "Thán thư: hay tới 40–64 giờ sau trồng; đất Đẫm dễ bị gấp 2. Xịt thuốc trừ bệnh.",
      "Bón đạm (urê, NPK) ngoài các đợt bón thúc, hoặc hai lần trong một đợt, là dư đạm: mất 10%, sâu bệnh dễ tới gấp rưỡi.",
      "Mẹo: ớt nhiều việc nhất mà lời nhất; tháo nước về Ẩm trước mỗi lứa hái.",
    ]);
    const [kHow, kPests] = uplandHandbook(khoai, ITEMS);
    expect(kHow.title).toBe("Cách trồng khoai lang (~48 giờ)");
    expect(kHow.lines[2]).toBe("3. Trồng dây khoai khi đất Ẩm.");
    expect(kHow.lines[4]).toBe("5. Lật dây: 24–32 giờ sau trồng; trễ tới 40 giờ được nửa công (mất 5%); không làm mất 10%.");
    expect(kHow.lines[6]).toBe("Đào khoai: chín 48 giờ sau trồng. Đất phải Khô–Ẩm. Chín quá 12 giờ mất 2% mỗi giờ; để thêm 48 giờ là cả vụ hư.");
    expect(kPests.lines[1]).toBe("Từ 22 giờ sau trồng, đất Đẫm hay Ngập là úng, thối củ: mất 3% mỗi giờ (tối đa 50%).");
    expect(uplandHandbook(bap, ITEMS)[0].lines[2]).toBe("3. Gieo hạt bắp thẳng xuống luống khi đất Ẩm — không cần ươm.");
  });
  it("prints every hour inside its window", () => {
    for (const u of UPLANDS) {
      const lines = uplandHandbook(u, ITEMS)[0].lines;
      u.cares.forEach((c, i) => {
        const [, from, to] = /(\d+)–(\d+) giờ sau trồng/.exec(lines[3 + i])!.map(Number);
        expect(from >= c.fromH && to <= c.toH && from <= to, `${u.id} ${c.id}`).toBe(true);
      });
    }
  });
});
