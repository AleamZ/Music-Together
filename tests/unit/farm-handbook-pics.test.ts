import { afterEach, describe, expect, it, vi } from "vitest";
import { critterFromRow, farmItemFromRow, TOOL_SLING, uplandFromRow, varietyFromRow, type UplandCropRow } from "@/lib/game/farm/catalog";
import { handbookPage, handbookTabs } from "@/lib/game/farm/handbook";
import {
  HANDBOOK_VIEW_KEY, handbookCards, loadHandbookView, saveHandbookView, stepCaption, stepChips, stepScene,
} from "@/lib/game/farm/handbook-pics";
import { FARM_ANIM } from "@/lib/game/net/protocol";
import fixtures from "@/tests/fixtures/upland-cases.json";

const nep = varietyFromRow({ id: "nep", name: "Nếp", scale: 1, base_kg: 75, price_per_kg: 18, blast_mult: 1, sort_order: 20 });
const thom = varietyFromRow({ id: "thom", name: "Lúa thơm", scale: 1.15, base_kg: 60, price_per_kg: 26, blast_mult: 1.3, sort_order: 30 });
const UPLANDS = (fixtures as unknown as { crops: UplandCropRow[] }).crops.map(uplandFromRow);
const ITEMS = [
  ["fert_urea", "Phân urê", "fertilizer"], ["fert_npk", "Phân NPK", "fertilizer"], ["spray_insect", "Thuốc trừ sâu", "fertilizer"],
  [TOOL_SLING, "Ná", "tool"], ["box_bucket", "Xô nhựa", "critter_box"], ["box_basket", "Giỏ tre", "critter_box"],
].map(([id, name, kind]) => farmItemFromRow({ id, kind, name, price: 1, sort_order: 0, variety: null, fert: null, pest_target: null, capacity: 10 }));
const KINDS = [
  critterFromRow({ id: "cua_dong", name: "Cua đồng", grp: "crab", base_price: 12, sort_order: 10 }),
  critterFromRow({ id: "oc_dong", name: "Ốc đồng", grp: "snail", base_price: 8, sort_order: 30 }),
];
const UP_IDS = new Set(UPLANDS.map((u) => u.id));

describe("handbook picture cards", () => {
  const tabs = handbookTabs(UPLANDS, KINDS, ITEMS);
  it("covers every tab the text has, including Cua & ốc and Chuột, chó & ná", () => {
    expect(tabs.map(([id]) => id)).toEqual(expect.arrayContaining(["process", "tools", "critters", "rats", "khoai", "bap", "ot"]));
  });
  it("has a picture card for every text line of every tab, in order, captions taken from the line", () => {
    for (const [tab] of tabs) {
      const page = handbookPage(tab, [nep, thom], UPLANDS, ITEMS, KINDS);
      const cards = handbookCards(tab, page, UP_IDS);
      expect(cards.map((c) => c.title), tab).toEqual(page.map((s) => s.title));
      cards.forEach((sec, i) => {
        expect(sec.cards, `${tab}: ${sec.title}`).toHaveLength(page[i].lines.length);
        sec.cards.forEach((card, j) => {
          const line = page[i].lines[j].replace(/^\d+\.\s*/, "");
          expect(line.startsWith(card.caption.replace(/…$/, "")), `${tab}: ${card.caption}`).toBe(true);
          const words = card.caption.replace(/…$/, "").split(/\s+/).length;
          expect(words).toBeGreaterThan(0);
          expect(words).toBeLessThanOrEqual(8);
          for (const chip of card.chips) expect(page[i].lines[j]).toContain(chip.replace(/^[−≤]/, ""));
        });
      });
    }
  });
  it("numbers the rice steps 1–11 with arrows between them", () => {
    const [steps] = handbookCards("process", handbookPage("process", [nep]), UP_IDS);
    expect(steps.flow).toBe(true);
    expect(steps.cards.map((c) => c.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(steps.cards.map((c) => c.caption).slice(0, 4)).toEqual(["Làm đất", "Bón lót", "Ngâm ủ giống", "Gieo mạ"]);
  });
  it("chips the time windows and the penalties", () => {
    expect(stepChips("Bón thúc: 16–26 giờ sau trồng. Sai lúc mất 10%; bỏ trống mất 20%.")).toEqual(["16–26 giờ", "−10%", "−20%"]);
    expect(stepChips("Ná 3.000 xu, mua một lần.")).toEqual(["3.000 xu"]);
    expect(stepCaption("4. Gieo mạ: trong 6 giờ sau khi nứt nanh")).toBe("Gieo mạ");
  });
  it("picks the scene by the step's words", () => {
    expect(stepScene("7. Bón thúc đẻ nhánh: urê hoặc NPK", "process", false)).toMatchObject({ anim: FARM_ANIM.fertilize, icons: ["fert_npk"] });
    expect(stepScene("Sâu cuốn lá: lá cuộn trắng. Xịt thuốc trừ sâu.", "pests", false).anim).toBe(FARM_ANIM.spray);
    expect(stepScene("Ná 3.000 xu", "rats", false)).toMatchObject({ anim: FARM_ANIM.aim, extra: "rat" });
    expect(stepScene("Đào khoai: chín 48 giờ sau trồng", "khoai", true)).toMatchObject({ anim: FARM_ANIM.dig, icons: ["produce_khoai"] });
  });
});

describe("handbook view choice", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("remembers Chữ / Hình in localStorage", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
    expect(loadHandbookView()).toBe("text");
    saveHandbookView("pics");
    expect(store.get(HANDBOOK_VIEW_KEY)).toBe("pics");
    expect(loadHandbookView()).toBe("pics");
    saveHandbookView("text");
    expect(loadHandbookView()).toBe("text");
  });
  it("falls back to text when storage throws", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
    expect(loadHandbookView()).toBe("text");
    expect(() => saveHandbookView("pics")).not.toThrow();
  });
});
