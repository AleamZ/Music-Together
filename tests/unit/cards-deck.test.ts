import { describe, it, expect } from "vitest";
import {
  cardAria, cardCode, cardLabel, cardsOf, isCard, isCardGame, isRed, parseCard, rankOf, sortCards, suitOf,
} from "@/lib/game/cards/deck";

describe("cards (spec §6.4)", () => {
  it("encodes rank and suit: 3♠ = 0, 2♥ = 51", () => {
    expect([rankOf(0), suitOf(0), rankOf(51), suitOf(51)]).toEqual([0, 0, 12, 3]);
    expect(parseCard("3S")).toBe(0);
    expect(parseCard("2H")).toBe(51);
    expect(parseCard("10D")).toBe(7 * 4 + 2);
    expect(parseCard("10♦")).toBe(parseCard("10D"));
    expect([parseCard("1S"), parseCard("10X"), parseCard(""), parseCard("S")]).toEqual([null, null, null, null]);
  });

  it("labels a card for the eye and for the screen reader", () => {
    const c = parseCard("10H")!;
    expect(cardLabel(c)).toBe("10♥");
    expect(cardAria(c)).toBe("10 cơ");
    expect(cardAria(parseCard("AS")!)).toBe("A bích");
    expect(cardAria(parseCard("2C")!)).toBe("2 chuồn");
    expect(cardAria(parseCard("JD")!)).toBe("J rô");
    expect(cardCode(c)).toBe("10H");
    expect([isRed(parseCard("5D")!), isRed(parseCard("5H")!), isRed(parseCard("5S")!), isRed(parseCard("5C")!)])
      .toEqual([true, true, false, false]);
  });

  it("sorts in Tiến lên order and checks cards and games", () => {
    expect(sortCards(cardsOf(["2S", "3H", "3S", "AH"])).map(cardCode)).toEqual(["3S", "3H", "AH", "2S"]);
    expect(() => cardsOf(["3S", "ZZ"])).toThrow();
    expect([isCard(0), isCard(51), isCard(52), isCard(-1), isCard(1.5), isCard("3")]).toEqual([true, true, false, false, false, false]);
    expect([isCardGame("tienlen"), isCardGame("cao"), isCardGame("poker"), isCardGame("liêng")]).toEqual([true, true, true, false]);
  });
});
