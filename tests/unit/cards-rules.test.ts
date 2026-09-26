import { describe, it, expect } from "vitest";
import { cardsOf } from "@/lib/game/cards/deck";
import { pkEval } from "@/lib/game/cards/poker";
import { POKER_RANK_EXAMPLES, RULES_HEADER, RULES_TABS, ruleLine, rulesPage, ruleText } from "@/lib/game/cards/rules";

const TITLES = {
  tienlen: ["Mục tiêu", "Thứ tự bài", "Các bộ", "Lượt chơi", "Luật đặc biệt", "Tính tiền"],
  cao: ["Mục tiêu", "Tính điểm", "Bài đặc biệt", "So bằng", "Lượt chơi", "Tính tiền"],
  poker: ["Mục tiêu", "Thứ tự tay bài", "Lượt chơi", "Luật cược", "Tiền"],
} as const;

describe("📜 Sổ luật (spec §14)", () => {
  it("has a tab per game with its sections, under the play-money header", () => {
    expect(RULES_TABS.map((t) => t.label)).toEqual(["Tiến lên", "Cào", "Poker"]);
    for (const { game } of RULES_TABS) {
      const page = rulesPage(game);
      expect(page.header).toBe(RULES_HEADER);
      expect(page.sections.map((s) => s.title)).toEqual(TITLES[game]);
      for (const s of page.sections) expect(s.lines.length, `${game} ${s.title}`).toBeGreaterThan(0);
    }
    expect(RULES_HEADER[1]).toBe("Xu không mua được bằng tiền thật và không đổi ra tiền thật. Mua bán xu hay tài khoản bằng tiền thật bị cấm.");
  });

  it("shows card groups as cards", () => {
    expect(ruleLine("Đôi [9♠ 9♥] thắng")).toEqual(["Đôi ", { cards: cardsOf(["9S", "9H"]) }, " thắng"]);
    expect(ruleText(ruleLine("Rác [7♦]"))).toBe("Rác [7♦]");
    const combos = rulesPage("tienlen").sections[2];
    expect(combos.lines.flat().filter((s) => typeof s !== "string")).toHaveLength(8);
  });

  it("computes the money examples with the engine's rules: the nets sum to 0 and scale with the stake", () => {
    for (const { game } of RULES_TABS) {
      for (const stake of [100, 1000, 10000]) {
        const examples = rulesPage(game, stake).sections.flatMap((s) => s.examples);
        expect(examples.length, game).toBeGreaterThan(0);
        for (const e of examples) expect(e.net.reduce((a, n) => a + n.xu, 0), `${game} ${e.title}`).toBe(0);
      }
    }
    const tl = rulesPage("tienlen", 1000).sections[5].examples;
    expect(tl.map((e) => e.net.map((n) => n.xu))).toEqual([
      [1000, -2000, 2500, -1500], [5000, 500, -500, -5000], [-2000, -2000, 6000, -2000], [1000, 2000, 0, -3000],
    ]);
    expect(rulesPage("tienlen", 100).sections[5].examples[0].net.map((n) => n.xu)).toEqual([100, -200, 250, -150]);
    expect(rulesPage("cao", 1000).sections[5].examples[0].net).toEqual([
      { who: "A", xu: 1000 }, { who: "B", xu: -2000 }, { who: "C", xu: 1000 }, { who: "D", xu: 1000 }, { who: "E", xu: -1000 },
    ]);
    expect(rulesPage("poker", 1000).sections[4].examples[0].net).toEqual([
      { who: "A", xu: 2000 }, { who: "B", xu: 16000 }, { who: "C", xu: -18000 },
    ]);
    expect(ruleText(rulesPage("poker", 1000).sections[4].examples[0].lines[3])).toBe("Pot chính 24.000 (A, B, C); pot phụ 20.000 (A, C).");
  });

  it("gives every poker hand rank a matching example, strongest first", () => {
    const cats = POKER_RANK_EXAMPLES.map((r) => pkEval(cardsOf(r.cards))[0]);
    expect(cats).toEqual([8, 7, 6, 5, 4, 3, 2, 1, 0]);
  });
});
