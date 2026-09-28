import { describe, expect, it } from "vitest";
import {
  EXAMS, MARTIAL, TUITION, UNIFORM_IDS, beltOf, examFor, isUniform, martialById, promotionText, uniformStyle, unlockSlotOf,
} from "@/lib/game/fight/dojo";
import { STYLE_KEYS, movesMaskForRank } from "@/lib/game/fight/styles";
import { STYLE_SPECIALS } from "@/lib/game/fight/moves";

describe("the dojo's styles, belts and exams (spec §v20.2)", () => {
  it("has the seven learnable styles in engine order, each with a master, a uniform and a kata", () => {
    expect(MARTIAL.map((m) => m.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(MARTIAL.map((m) => m.key)).toEqual(STYLE_KEYS.slice(1));
    expect(MARTIAL.map((m) => m.master)).toEqual([
      "võ sư Hùng", "thầy Somchai", "sensei Kenji", "sư phụ Min-jun", "HLV Tony Tâm", "sensei Mai", "sư phụ Diệp Thanh",
    ]);
    expect(UNIFORM_IDS).toEqual(["vp_vovinam", "vp_muaythai", "vp_karate", "vp_taekwondo", "vp_boxing", "vp_judo", "vp_vinhxuan"]);
    expect(MARTIAL.map((m) => m.kata)).toEqual(["Thập tự quyền", "Wai Kru", "Heian", "Taegeuk", "Shadow boxing", "Nage-no-kata", "Tiểu niệm đầu"]);
    for (const m of MARTIAL) expect(m.masterLook.outfit).toBe(m.uniform);
  });

  it("has five belts per style (7 × 5), named per the spec", () => {
    for (const m of MARTIAL) {
      expect(m.belts.map((b) => b.rank)).toEqual([0, 1, 2, 3, 4]);
      for (const b of m.belts) expect(b.color).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(martialById(1)!.belts.map((b) => b.name)).toEqual(["Tự vệ", "Lam đai", "Hoàng đai", "Hồng đai", "Bạch đai"]);
    expect(martialById(5)!.belts.map((b) => b.name)).toEqual(["Tân binh", "Nghiệp dư", "Bán chuyên", "Chuyên nghiệp", "Nhà vô địch"]);
    expect(martialById(7)!.belts.map((b) => b.name)).toEqual(["Sơ cấp", "Trung cấp", "Cao cấp", "Truyền nhân", "Sư phụ"]);
    expect(beltOf(3, 4).name).toBe("Đai đen");
    expect(promotionText(1, 2)).toBe("Lên Hoàng đai!");
  });

  it("prices: tuition 2 000, exams 1 000 / 2 500 / 5 000 / 10 000 — a full course 20 500 xu and 7 days", () => {
    expect(TUITION).toBe(2000);
    expect(EXAMS.map((e) => e.fee)).toEqual([1000, 2500, 5000, 10000]);
    expect(TUITION + EXAMS.reduce((s, e) => s + e.fee, 0)).toBe(20500);
    expect(EXAMS.reduce((s, e) => s + e.minHours, 0)).toBe(170);            // ≥ 7 days (168 h)
    expect(EXAMS.map((e) => [e.cooldownMin, e.notes, e.tpb, e.passPct, e.botLevel])).toEqual([
      [30, 18, 40, 60, 1], [120, 24, 36, 65, 2], [360, 30, 32, 70, 3], [1440, 36, 28, 75, 4],
    ]);
    expect(examFor(0)).toBeNull();
    expect(examFor(5)).toBeNull();
  });

  it("unlocks: rank 0 has S1, each rank adds the next special, rank 4 the Tuyệt kỹ", () => {
    expect([0, 1, 2, 3, 4].map(movesMaskForRank)).toEqual([1, 3, 7, 15, 31]);
    expect([1, 2, 3, 4].map(unlockSlotOf)).toEqual([2, 3, 4, 5]);
    for (const m of MARTIAL) expect(STYLE_SPECIALS[m.id].map((s) => s.slot)).toEqual([1, 2, 3, 4, 5]);
  });

  it("maps a worn uniform to its style", () => {
    expect(uniformStyle("vp_judo")?.id).toBe(6);
    expect(uniformStyle("fm_kimono")).toBeNull();
    expect(uniformStyle(null)).toBeNull();
    expect(isUniform("vp_karate")).toBe(true);
    expect(isUniform("top_tee_red")).toBe(false);
  });
});
