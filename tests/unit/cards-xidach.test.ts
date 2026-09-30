import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { cardsOf } from "@/lib/game/cards/deck";
import { parseCardState } from "@/lib/game/cards/state";
import {
  xidachCap,
  xidachEval,
  xidachPoints,
  xidachCompare,
  xidachSettle,
  type XidachMoneyLine,
} from "@/lib/game/cards/xidach";

describe("Xì Dách Việt Nam (Vietnamese Blackjack)", () => {
  it("recognizes Xì Bàng (AA) in initial 2 cards", () => {
    const hand = xidachEval(cardsOf(["AS", "AH"]));
    expect(hand.kind).toBe("xi_bang");
    expect(hand.points).toBe(21);
    expect(hand.canStand).toBe(true);
  });

  it("recognizes Xì Dách (A + 10/J/Q/K) in initial 2 cards", () => {
    for (const ten of ["10S", "JD", "QC", "KH"]) {
      const hand = xidachEval(cardsOf(["AS", ten]));
      expect(hand.kind).toBe("xi_dach");
      expect(hand.points).toBe(21);
      expect(hand.canStand).toBe(true);
    }
  });

  it("calculates optimal points for Aces with 2 cards", () => {
    // A + 9 = 20 points (not 10)
    expect(xidachPoints(cardsOf(["AS", "9D"]))).toBe(20);
    // A + 8 = 19 points
    expect(xidachPoints(cardsOf(["AD", "8S"]))).toBe(19);
    // A + 5 = 16 points (can stand)
    const handA5 = xidachEval(cardsOf(["AC", "5H"]));
    expect(handA5.points).toBe(16);
    expect(handA5.canStand).toBe(true);
  });

  it("calculates optimal points for Aces with 3 or more cards", () => {
    // A + 2 + 3 = 16 (A=11)
    expect(xidachPoints(cardsOf(["AS", "2H", "3D"]))).toBe(16);
    // A + 8 + 8 = 17 (A=1, not 27)
    expect(xidachPoints(cardsOf(["AS", "8H", "8D"]))).toBe(17);
    // A + A + 9 = 21 (11 + 1 + 9 = 21)
    const hand2A9 = xidachEval(cardsOf(["AS", "AH", "9D"]));
    expect(hand2A9.points).toBe(21);
    expect(hand2A9.kind).toBe("du_tuoi");
    // A + A + A + 8 = 21 (1 + 1 + 11 + 8 = 21)
    expect(xidachPoints(cardsOf(["AS", "AH", "AD", "8C"]))).toBe(21);
  });

  it("recognizes Ngũ Linh (5 cards with points <= 21)", () => {
    // 5 cards totaling 15 points
    const hand = xidachEval(cardsOf(["2S", "3D", "4C", "2H", "4S"]));
    expect(hand.count).toBe(5);
    expect(hand.points).toBe(15);
    expect(hand.kind).toBe("ngu_linh");
    expect(hand.canStand).toBe(true);
  });

  it("detects Quắc (Bù / Bust when points > 21)", () => {
    const hand = xidachEval(cardsOf(["10S", "9D", "5C"])); // 10 + 9 + 5 = 24
    expect(hand.points).toBe(24);
    expect(hand.kind).toBe("quac");
    expect(hand.canStand).toBe(false);
  });

  it("enforces minimum stand points: >= 16 for players", () => {
    // 15 points: under 16 -> cannot stand
    const hand15 = xidachEval(cardsOf(["10S", "5D"]));
    expect(hand15.points).toBe(15);
    expect(hand15.canStand).toBe(false);

    // 16 points: can stand
    const hand16 = xidachEval(cardsOf(["10S", "6D"]));
    expect(hand16.points).toBe(16);
    expect(hand16.canStand).toBe(true);
  });

  it("compares hands correctly according to Vietnamese Xì Dách hierarchy", () => {
    const xiBang = xidachEval(cardsOf(["AS", "AH"]));
    const xiDach = xidachEval(cardsOf(["AS", "KD"]));
    const nguLinh15 = xidachEval(cardsOf(["2S", "3D", "4C", "2H", "4S"]));
    const nguLinh18 = xidachEval(cardsOf(["2S", "3D", "4C", "5H", "4S"]));
    const p21 = xidachEval(cardsOf(["10S", "5D", "6C"])); // 21 points
    const p19 = xidachEval(cardsOf(["10S", "9D"])); // 19 points
    const quac = xidachEval(cardsOf(["10S", "9D", "5C"])); // 24 points

    // Xi Bang > Xi Dach > Ngu Linh > 21 points > 19 points > Quac
    expect(xidachCompare(xiBang, xiDach)).toBe(1);
    expect(xidachCompare(xiDach, xiBang)).toBe(-1);
    expect(xidachCompare(xiDach, nguLinh15)).toBe(1);
    expect(xidachCompare(nguLinh15, p21)).toBe(1);
    expect(xidachCompare(p21, p19)).toBe(1);
    expect(xidachCompare(p19, quac)).toBe(1);

    // Two Ngũ Linh: fewer points wins!
    expect(xidachCompare(nguLinh15, nguLinh18)).toBe(1); // 15 points beats 18 points
    expect(xidachCompare(nguLinh18, nguLinh15)).toBe(-1);

    // Two Quắc: tie (0)
    expect(xidachCompare(quac, quac)).toBe(0);
  });

  it("settles round money with proper multipliers between dealer and players", () => {
    // Dealer has 18 points
    const dealerCards = cardsOf(["10S", "8D"]);
    // Seat 1: Xi Bang (wins 2x)
    const s1Cards = cardsOf(["AS", "AH"]);
    // Seat 2: 17 points (loses 1x)
    const s2Cards = cardsOf(["10C", "7H"]);
    // Seat 3: 18 points (ties)
    const s3Cards = cardsOf(["10H", "8S"]);
    // Seat 4: Quac (loses 1x)
    const s4Cards = cardsOf(["10D", "8C", "5H"]);

    const settlement = xidachSettle({
      dealer: 0,
      stake: 1000,
      order: [0, 1, 2, 3, 4],
      left: [],
      hands: {
        0: dealerCards,
        1: s1Cards,
        2: s2Cards,
        3: s3Cards,
        4: s4Cards,
      },
    });

    // Seat 1 gets +2000 (Xi Bang 2x)
    expect(settlement.net[1]).toBe(2000);
    // Seat 2 loses -1000
    expect(settlement.net[2]).toBe(-1000);
    // Seat 3 tied (0 or undefined)
    expect(settlement.net[3] ?? 0).toBe(0);
    // Seat 4 loses -1000
    expect(settlement.net[4]).toBe(-1000);
    // Dealer net: -2000 + 1000 + 1000 = 0
    expect(settlement.net[0]).toBe(0);
  });
});

// Kinh tế v2 (0106 _xd_cap): a seat never loses more than its escrow. The fixture was generated by an independent Python
// reference; tests/sql/econ-p2p-smoke.sql checks the SQL against the same file.
interface CapCase {
  name: string;
  lines: Array<XidachMoneyLine & { why: string }>;
  escrow: Record<string, number>;
  expect: { net: Record<string, number>; capped: number[]; burned: number };
}
const CAP_CASES: CapCase[] = JSON.parse(readFileSync("tests/fixtures/xidach-cap-cases.json", "utf8"));

describe("Xì Dách: the escrow cap (Kinh tế v2)", () => {
  it("matches every fixture case (the SQL checks the same file)", () => {
    expect(CAP_CASES.length).toBe(49);
    for (const c of CAP_CASES) {
      const r = xidachCap(c.lines, c.escrow as unknown as Record<number, number>);
      expect(r, c.name).toEqual(c.expect);
    }
  });

  it("never lets a seat end below 0 and never creates xu", () => {
    for (const c of CAP_CASES) {
      const r = xidachCap(c.lines, c.escrow as unknown as Record<number, number>);
      let sum = 0;
      for (const [seat, n] of Object.entries(r.net)) {
        expect((c.escrow[seat] ?? 0) + n, `${c.name} seat ${seat}`).toBeGreaterThanOrEqual(0);
        sum += n;
      }
      expect(sum + r.burned, c.name).toBe(0);
      expect(r.burned).toBeGreaterThanOrEqual(0);
    }
  });

  it("three alts who bust past 28 at an 8-seat table lose their hold and create nothing", () => {
    const S = 10_000;
    const lines = [2, 3, 4].flatMap((s) => [1, 2, 3, 4, 5, 6, 7, 8].filter((o) => o !== s).map((o) => ({ from: s, to: o, xu: S })));
    const escrow: Record<number, number> = { 1: 14 * S, 2: 2 * S, 3: 2 * S, 4: 2 * S, 5: 2 * S, 6: 2 * S, 7: 2 * S, 8: 2 * S };
    const r = xidachCap(lines, escrow);
    expect(r.capped).toEqual([2, 3, 4]);
    expect(r.burned).toBe(0);
    expect([r.net[2], r.net[3], r.net[4]]).toEqual([-2 * S, -2 * S, -2 * S]);
    expect([r.net[1], r.net[5], r.net[8]]).toEqual([12_000, 12_000, 12_000]);
  });

  it("a plain hand is paid in full", () => {
    const r = xidachCap([{ from: 1, to: 2, xu: 2000 }, { from: 3, to: 1, xu: 1000 }], { 1: 4000, 2: 2000, 3: 2000 });
    expect(r).toEqual({ net: { 1: -1000, 2: 2000, 3: -1000 }, capped: [], burned: 0 });
  });

  it("parses the capped seats and the burn of the last hand", () => {
    const s = parseCardState({
      game: "xidach", server_now: "2026-09-30T00:00:00Z", max: 8, v: 1, seq: 1, hand_no: 3, phase: "result", stake: 1000,
      turn: null, deadline: null, seats: [], pub: null,
      last: { hand_no: 3, dealer: 1, cancelled: false, hands: {}, lines: [], net: { 1: 666, 2: -2000 }, capped: [2], burned: 2 },
    });
    expect(s?.game).toBe("xidach");
    if (s?.game !== "xidach") return;
    expect(s.last?.capped).toEqual([2]);
    expect(s.last?.burned).toBe(2);
    const old = parseCardState({
      game: "xidach", server_now: "2026-09-30T00:00:00Z", max: 8, v: 1, seq: 1, hand_no: 3, phase: "result", stake: 1000,
      turn: null, deadline: null, seats: [], pub: null, last: { hand_no: 3, dealer: 1, cancelled: false, hands: {}, lines: [], net: {} },
    });
    if (old?.game !== "xidach") throw new Error("parse");
    expect(old.last?.capped).toEqual([]);
    expect(old.last?.burned).toBe(0);
  });
});
