import { describe, it, expect } from "vitest";
import { caoCompare, caoEval, caoKey, caoName, caoSettle } from "@/lib/game/cards/cao";
import { cardsOf, parseCard } from "@/lib/game/cards/deck";
import {
  pkAmountOk, pkBuyInRange, pkCompare, pkEval, pkHandName, pkLegal, pkPots, pkPresets, pkTopUpRange, type PkSeatPut,
} from "@/lib/game/cards/poker";
import fixtures from "@/tests/fixtures/card-cases.json";

type Codes = string[];
const FX = fixtures as unknown as {
  cao: {
    eval: Array<{ cards: Codes; expect: { kind: string; points: number; rank?: number; top: string } }>;
    cmp: Array<{ a: Codes; b: Codes; expect: number }>;
    settle: Array<{ name: string; dealer: number; order: number[]; left: number[]; hands: Record<string, Codes>;
                    expect: { lines: Array<[number, number, string]>; net: Record<string, number> } }>;
  };
  poker: {
    eval: Array<{ cards: Codes; expect: number[] }>;
    cmp: Array<{ a: Codes; b: Codes; expect: number }>;
    pots: Array<{ name: string; players: Record<string, PkSeatPut>; keys?: Record<string, number[]>; button: number; expect: unknown }>;
  };
};
const keyed = <T,>(o: Record<string, T>): Record<number, T> => Object.fromEntries(Object.entries(o).map(([k, v]) => [Number(k), v]));
const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

/** The pots' invariant (§9.2): while a seat is live, the pots hold every chip put in, each for live seats only, and a
 *  pot's shares add up to it; with no live seat there is no pot. */
function potsKeepEveryChip(players: Record<number, PkSeatPut>, keys: Record<number, number[]> | null, button: number, what: string) {
  const pots = pkPots({ players, keys, button });
  const seats = Object.keys(players).map(Number);
  const live = seats.filter((s) => !players[s].fold);
  if (live.length === 0) {
    expect(pots, what).toEqual([]);
    return;
  }
  expect(sum(pots.map((p) => p.xu)), what).toBe(sum(seats.map((s) => players[s].put)));
  for (const p of pots) {
    expect(p.xu > 0 && p.seats.length > 0 && p.seats.every((s) => live.includes(s)), what).toBe(true);
    if (p.winners) {
      expect(p.winners.every((s) => p.seats.includes(s)), what).toBe(true);
      expect(sum(Object.values(p.shares ?? {})), what).toBe(p.xu);
    }
  }
}

/** A small seeded generator (mulberry32): the random hands are the same on every run. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("the shared Cào fixtures (the SQL smoke replays the same cases)", () => {
  it("hand values", () => {
    for (const k of FX.cao.eval) {
      const h = caoEval(cardsOf(k.cards));
      expect({ kind: h.kind, points: h.points, rank: h.rank, top: h.top }, k.cards.join(" "))
        .toEqual({ kind: k.expect.kind, points: k.expect.points, rank: k.expect.rank ?? null, top: caoKey(parseCard(k.expect.top)!) });
    }
  });
  it("comparisons, both ways", () => {
    for (const k of FX.cao.cmp) {
      const a = caoEval(cardsOf(k.a)), b = caoEval(cardsOf(k.b));
      expect(caoCompare(a, b), `${k.a.join(" ")} vs ${k.b.join(" ")}`).toBe(k.expect);
      expect(caoCompare(b, a)).toBe(-k.expect);
    }
  });
  for (const k of FX.cao.settle) {
    it(`settle: ${k.name}`, () => {
      const r = caoSettle({
        dealer: k.dealer, order: k.order, left: k.left,
        hands: keyed(Object.fromEntries(Object.entries(k.hands).map(([s, cs]) => [s, cardsOf(cs)]))),
      });
      expect(r.lines.map((l) => [l.from, l.to, l.why])).toEqual(k.expect.lines);
      expect(r.net).toEqual(keyed(k.expect.net));
    });
  }
  it("names a hand", () => {
    expect(caoName(caoEval(cardsOf(["4D", "4C", "4S"])))).toBe("Sáp 4");
    expect(caoName(caoEval(cardsOf(["KS", "KH", "KD"])))).toBe("Sáp K");
    expect(caoName(caoEval(cardsOf(["JS", "QH", "KC"])))).toBe("Ba tây");
    expect(caoName(caoEval(cardsOf(["7H", "10C", "AD"])))).toBe("8 nút");
    expect(caoName(caoEval(cardsOf(["10S", "JD", "QC"])))).toBe("Bù");
  });
});

describe("the shared poker fixtures (the SQL smoke replays the same cases)", () => {
  it("the evaluator", () => {
    for (const k of FX.poker.eval) expect(pkEval(cardsOf(k.cards)), k.cards.join(" ")).toEqual(k.expect);
  });
  it("comparisons", () => {
    for (const k of FX.poker.cmp) {
      expect(pkCompare(pkEval(cardsOf(k.a)), pkEval(cardsOf(k.b))), `${k.a.join(" ")} vs ${k.b.join(" ")}`).toBe(k.expect);
    }
  });
  for (const k of FX.poker.pots) {
    it(`pots: ${k.name}`, () => {
      expect(pkPots({ players: keyed(k.players), keys: k.keys ? keyed(k.keys) : null, button: k.button })).toEqual(k.expect);
    });
  }
  it("while a seat is live, the pots hold every chip put in", () => {
    for (const k of FX.poker.pots) potsKeepEveryChip(keyed(k.players), k.keys ? keyed(k.keys) : null, k.button, k.name);
  });
  it("names a hand", () => {
    expect(pkHandName([1, 13, 9, 7, 4])).toBe("Đôi K");
    expect(pkHandName([2, 14, 8, 5])).toBe("Thú A và 8");
    expect(pkHandName([4, 5])).toBe("Sảnh 5");
    expect(pkHandName([6, 13, 4])).toBe("Cù lũ K 4");
    expect(pkHandName([0, 14, 12, 9, 7, 5])).toBe("Mậu thầu A");
    expect(pkHandName(pkEval(cardsOf(["KS", "KD"])))).toBe("Đôi K");
  });
});

describe("pkPots keeps every chip (§9.2)", () => {
  it("2 000 random hands: while a seat is live, the pots hold every chip put in", () => {
    const r = seeded(16);
    const pick = (n: number) => Math.floor(r() * n);
    let nothingLive = 0;
    for (let n = 0; n < 2000; n++) {
      const seats = [1, 2, 3, 4, 5, 6].filter(() => r() < 0.6);
      if (seats.length === 0) continue;
      // a seat puts nothing about a third of the time, so every live seat has put nothing in many hands
      const players: Record<number, PkSeatPut> = Object.fromEntries(seats.map((s) => [s, {
        put: r() < 0.35 ? 0 : 1 + pick(5000), fold: r() < 0.4, allin: r() < 0.3,
      }]));
      const live = seats.filter((s) => !players[s].fold);
      if (live.length > 0 && live.every((s) => players[s].put === 0) && seats.some((s) => players[s].put > 0)) nothingLive += 1;
      const keys = r() < 0.5 ? Object.fromEntries(seats.map((s) => [s, [pick(3), 2 + pick(3)]])) : null;
      potsKeepEveryChip(players, keys, seats[pick(seats.length)], JSON.stringify({ players, keys }));
    }
    expect(nothingLive).toBeGreaterThan(50);
  });
});

describe("pkLegal: what the player to act may do (§9.1)", () => {
  it("the big blind's option preflop: check, or raise from 2 BB", () => {
    const o = pkLegal({ cur: 1000, raise: 1000, bet: 1000, acted: null, chips: 99_000, stake: 1000 });
    expect(o).toMatchObject({ canCheck: true, canCall: false, canBet: false, canRaise: true, min: 2000, max: 100_000, canAllin: true });
  });
  it("facing a bet: call it, or raise by at least the bet", () => {
    const o = pkLegal({ cur: 4000, raise: 4000, bet: 0, acted: null, chips: 10_000, stake: 1000 });
    expect(o).toMatchObject({ canCheck: false, canCall: true, callTo: 4000, callCost: 4000, canRaise: true, min: 8000, max: 10_000 });
    expect([pkAmountOk(o, 7999), pkAmountOk(o, 8000), pkAmountOk(o, 10_000), pkAmountOk(o, 10_001)]).toEqual([false, true, true, false]);
  });
  it("a short all-in does not re-open raising for a player who already acted (TDA 47)", () => {
    const o = pkLegal({ cur: 5000, raise: 4000, bet: 4000, acted: 4000, chips: 50_000, stake: 1000 });
    expect(o).toMatchObject({ canCall: true, callTo: 5000, callCost: 1000, canRaise: false, canAllin: false, min: 0, max: 0 });
    expect(pkAmountOk(o, 9000)).toBe(false);
  });
  it("a short stack calls all-in for less and cannot raise", () => {
    const o = pkLegal({ cur: 5000, raise: 5000, bet: 0, acted: null, chips: 3000, stake: 1000 });
    expect(o).toMatchObject({ canCall: true, callTo: 3000, callCost: 3000, canRaise: false, canAllin: true });
  });
  it("a bet: at least the big blind, less only all-in; the presets stay within the bounds", () => {
    const o = pkLegal({ cur: 0, raise: 1000, bet: 0, acted: null, chips: 20_000, stake: 1000 });
    expect(o).toMatchObject({ canCheck: true, canBet: true, canRaise: false, min: 1000, max: 20_000 });
    expect(pkPresets(o, { cur: 0, raise: 1000, bet: 0, acted: null, chips: 20_000, stake: 1000 }, 9000)).toEqual({ min: 1000, half: 4500, pot: 9000 });
    expect(pkPresets(o, { cur: 0, raise: 1000, bet: 0, acted: null, chips: 20_000, stake: 1000 }, 90_000)).toEqual({ min: 1000, half: 20_000, pot: 20_000 });
    const short = pkLegal({ cur: 0, raise: 1000, bet: 0, acted: null, chips: 500, stake: 1000 });
    expect(short).toMatchObject({ canBet: true, min: 500, max: 500 });
    const raise = { cur: 2000, raise: 1000, bet: 0, acted: null, chips: 50_000, stake: 1000 };
    expect(pkPresets(pkLegal(raise), raise, 3500)).toEqual({ min: 3000, half: 4750, pot: 7500 });
  });
  it("buy-in and top-up bounds", () => {
    expect(pkBuyInRange(1000, 500_000)).toEqual({ min: 50_000, max: 200_000 });
    expect(pkBuyInRange(1000, 80_000)).toEqual({ min: 50_000, max: 80_000 });
    expect(pkBuyInRange(1000, 49_999)).toBeNull();
    expect(pkTopUpRange(1000, 150_000, 1_000_000)).toEqual({ min: 1, max: 50_000 });
    expect(pkTopUpRange(1000, 200_000, 1_000_000)).toBeNull();
    expect(pkTopUpRange(100, 0, 700)).toEqual({ min: 1, max: 700 });
  });
});
