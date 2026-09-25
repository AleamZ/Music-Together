import { describe, it, expect } from "vitest";
import { varietyFromRow } from "@/lib/game/farm/catalog";
import { HOUR_MS } from "@/lib/game/farm/crop";
import { HANDBOOK_TABS, handbookPage, handbookTabFor } from "@/lib/game/farm/handbook";
import type { CropView } from "@/lib/game/farm/state";

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
      variety: "nep", phase: "prepared", preparedAt: at(0), soakAt: at(0), sowAt: at(3), transplantAt: at(12), water: 2, waterSetAt: at(12),
      pests: [], excessN: false, ripe: false, rottedAt: null, log: null, ...over,
    });
    expect(handbookTabFor(null, null, at(0))).toBe("process");
    expect(handbookTabFor(crop({ transplantAt: null }), nep, at(5))).toBe("process");
    expect(handbookTabFor(crop({}), nep, at(16))).toBe("fertilizer");
    expect(handbookTabFor(crop({ pests: [{ kind: "hopper", since: at(15), treatedAt: null }] }), nep, at(16))).toBe("pests");
    expect(handbookTabFor(crop({}), nep, at(12 + 45))).toBe("process");
  });
});
