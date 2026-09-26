import { describe, it, expect } from "vitest";
import { cardCode, cardsOf, type Card } from "@/lib/game/cards/deck";
import {
  tlArrange, tlBeats, tlCombo, tlIsCut, tlLegalPlays, tlSettle, tlSlams, tlThoi, tlTrang, tlValue, type TlCombo, type TlEvent,
} from "@/lib/game/cards/tienlen";
import fixtures from "@/tests/fixtures/card-cases.json";

type Codes = string[];
interface SettleCase {
  name: string; order: number[]; played: number[]; hands: Record<string, Codes>;
  events: Array<{ k: string; seat?: number; seats?: number[]; top?: { seat: number; cards: Codes; done: boolean } }>;
  expect: { lines: Array<[number, number, number, number, string]>; places: Record<string, number>; out: Record<string, string>; net: Record<string, number> };
}
const FX = fixtures.tienlen as unknown as {
  combo: Array<{ cards: Codes; expect: { type: string; len: number; key: string } | null; value?: number }>;
  beats: Array<{ top: Codes; x: Codes; expect: boolean }>;
  trang: Array<{ cards: Codes; expect: string | null }>;
  thoi: Array<{ cards: Codes; expect: number }>;
  settle: SettleCase[];
};

const combo = (codes: Codes): TlCombo => {
  const x = tlCombo(cardsOf(codes));
  if (!x) throw new Error(`no combination: ${codes.join(" ")}`);
  return x;
};
const codes = (x: { cards: Card[] }): string => x.cards.map(cardCode).join(" ");
const keyed = <T,>(o: Record<string, T>): Record<number, T> => Object.fromEntries(Object.entries(o).map(([k, v]) => [Number(k), v]));

describe("the shared Tiến lên fixtures (the SQL smoke replays the same cases)", () => {
  it("combinations and their values", () => {
    for (const k of FX.combo) {
      const got = tlCombo(cardsOf(k.cards));
      if (k.expect === null) {
        expect(got, k.cards.join(" ")).toBeNull();
      } else {
        expect(got && { type: got.type, len: got.len, key: cardCode(got.key) }, k.cards.join(" ")).toEqual(k.expect);
        expect(tlValue(got!), k.cards.join(" ")).toBe(k.value);
      }
    }
  });
  it("beating", () => {
    for (const k of FX.beats) expect(tlBeats(combo(k.top), combo(k.x)), `${k.x.join(" ")} over ${k.top.join(" ")}`).toBe(k.expect);
  });
  it("tới trắng", () => {
    for (const k of FX.trang) expect(tlTrang(cardsOf(k.cards)), k.cards.join(" ")).toBe(k.expect);
  });
  it("thối", () => {
    for (const k of FX.thoi) expect(tlThoi(cardsOf(k.cards)), k.cards.join(" ")).toBe(k.expect);
  });
  for (const k of FX.settle) {
    it(`settle: ${k.name}`, () => {
      const r = tlSettle({
        order: k.order, played: k.played,
        hands: keyed(Object.fromEntries(Object.entries(k.hands).map(([s, cs]) => [s, cardsOf(cs)]))),
        events: k.events.map((e) => (e.k === "cut" ? { ...e, top: { ...e.top!, cards: cardsOf(e.top!.cards) } } : e)) as TlEvent[],
      });
      expect(r.lines.map((l) => [l.from, l.to, l.h, l.paid, l.why])).toEqual(k.expect.lines);
      expect(r.places).toEqual(keyed(k.expect.places));
      expect(r.out).toEqual(keyed(k.expect.out));
      expect(r.net).toEqual(keyed(k.expect.net));
      expect(Object.values(r.net).reduce((a, b) => a + b, 0)).toBe(0);
    });
  }
});

describe("cutting (§7.2)", () => {
  it("is a bomb over a heo combination or another bomb, never a 2 over a 2", () => {
    expect(tlIsCut(combo(["2H"]), combo(["4S", "4D", "5C", "5H", "6S", "6D"]))).toBe(true);
    expect(tlIsCut(combo(["4S", "4D", "5C", "5H", "6S", "6D"]), combo(["8S", "8C", "8D", "8H"]))).toBe(true);
    expect(tlIsCut(combo(["2S"]), combo(["2H"]))).toBe(false);
    expect(tlIsCut(combo(["KS"]), combo(["8S", "8C", "8D", "8H"]))).toBe(false);
  });
});

describe("hints (§13.2)", () => {
  const hand = cardsOf(["3S", "3D", "4C", "5H", "5S", "6D", "9S", "9C", "9D", "KH", "AS", "2C", "2H"]);

  it("a first lead must include `must`; the weakest play comes first", () => {
    const plays = tlLegalPlays(hand, null, cardsOf(["3S"])[0]);
    expect(plays.length).toBeGreaterThan(0);
    expect(plays.every((x) => x.cards.includes(0))).toBe(true);
    expect(codes(plays[0])).toBe("3S");
    expect(plays.map(codes)).toContain("3S 4C 5S");
    expect(plays.map(codes)).toContain("3S 3D");
  });

  it("with a top, only what beats it; each key once; bombs last", () => {
    const plays = tlLegalPlays(hand, combo(["8H"]), null);
    expect(plays.map(codes)).toEqual(["9S", "9C", "9D", "KH", "AS", "2C", "2H"]);
    expect(tlLegalPlays(hand, combo(["QS", "QD"]), null).map(codes)).toEqual(["2C 2H"]);
    expect(tlLegalPlays(hand, combo(["4S", "5D", "6C"]), null).map(codes)).toEqual(["4C 5S 6D"]);
    const bombs = cardsOf(["3S", "3C", "4S", "4C", "5S", "5C", "9S", "9C", "9D", "9H", "JD", "QH", "KS"]);
    expect(tlLegalPlays(bombs, combo(["2H"]), null).map(codes)).toEqual(["3S 3C 4S 4C 5S 5C", "9S 9C 9D 9H"]);
    expect(tlLegalPlays(bombs, combo(["2S", "2H"]), null).map(codes)).toEqual(["9S 9C 9D 9H"]);
    expect(tlLegalPlays(bombs, combo(["10S"]), null).map(codes)).toEqual(["JD", "QH", "KS"]);
  });

  it("💣 Chặt! plays only a 4 đôi thông that beats the top", () => {
    const slam = cardsOf(["4S", "4D", "5C", "5H", "6S", "6D", "7C", "7H", "9S", "JD", "QH", "KS", "AC"]);
    expect(tlSlams(slam, null)).toEqual([]);
    expect(tlSlams(slam, combo(["9C"]))).toEqual([]);
    expect(tlSlams(slam, combo(["2S"])).map(codes)).toEqual(["4S 4D 5C 5H 6S 6D 7C 7H"]);
    expect(tlSlams(slam, combo(["8S", "8C", "8D", "8H"])).map(codes)).toEqual(["4S 4D 5C 5H 6S 6D 7C 7H"]);
    expect(tlSlams(hand, combo(["2S"]))).toEqual([]);
  });

  it("Xếp bài sorts by rank or groups the combinations", () => {
    expect(tlArrange(cardsOf(["9S", "3S", "9C", "2H", "9D"]), "rank").map(cardCode)).toEqual(["3S", "9S", "9C", "9D", "2H"]);
    expect(tlArrange(cardsOf(["5S", "3S", "9C", "5H", "9D", "9H"]), "group").map(cardCode)).toEqual(["9C", "9D", "9H", "5S", "5H", "3S"]);
  });
});
