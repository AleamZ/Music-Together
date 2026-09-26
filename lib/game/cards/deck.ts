// Cards (spec §6.4): a card is an integer c in 0–51; r = c / 4 (0–12 = 3 4 5 6 7 8 9 10 J Q K A 2) and s = c % 4 (0 ♠,
// 1 ♣, 2 ♦, 3 ♥). In Tiến lên a higher c is a stronger card; Cào and poker map r to their own orders. Pure.

export type Card = number;
export type CardGame = "tienlen" | "cao" | "poker";

export const CARD_GAMES: readonly CardGame[] = ["tienlen", "cao", "poker"];
export const RANK_NAMES: readonly string[] = ["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A", "2"];
export const SUIT_GLYPHS: readonly string[] = ["♠", "♣", "♦", "♥"];
export const SUIT_NAMES: readonly string[] = ["bích", "chuồn", "rô", "cơ"];
/** The fixtures' suit letters (tests/fixtures/card-cases.json): S ♠, C ♣, D ♦, H ♥. */
const SUIT_CODES = "SCDH";

export function isCardGame(v: unknown): v is CardGame {
  return v === "tienlen" || v === "cao" || v === "poker";
}

export function isCard(v: unknown): v is Card {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 51;
}

export const rankOf = (c: Card): number => Math.floor(c / 4);
export const suitOf = (c: Card): number => c % 4;
/** ♦ and ♥ are drawn red. */
export const isRed = (c: Card): boolean => suitOf(c) >= 2;

/** "10♥". */
export function cardLabel(c: Card): string {
  return `${RANK_NAMES[rankOf(c)]}${SUIT_GLYPHS[suitOf(c)]}`;
}

/** "10 cơ" (the card's aria label). */
export function cardAria(c: Card): string {
  return `${RANK_NAMES[rankOf(c)]} ${SUIT_NAMES[suitOf(c)]}`;
}

/** A card from its fixture code ("10H", "AS", "2D") or its label ("10♥"); null for anything else. */
export function parseCard(code: string): Card | null {
  const rank = RANK_NAMES.indexOf(code.slice(0, -1));
  const tail = code.slice(-1);
  const suit = SUIT_CODES.includes(tail) ? SUIT_CODES.indexOf(tail) : SUIT_GLYPHS.indexOf(tail);
  return rank < 0 || suit < 0 ? null : rank * 4 + suit;
}

/** Cards from codes or labels; throws on a bad one (for fixed content: the fixtures and the rules book). */
export function cardsOf(codes: readonly string[]): Card[] {
  return codes.map((code) => {
    const c = parseCard(code);
    if (c === null) throw new Error(`bad card ${code}`);
    return c;
  });
}

/** The fixture code of a card ("10H"). */
export function cardCode(c: Card): string {
  return `${RANK_NAMES[rankOf(c)]}${SUIT_CODES[suitOf(c)]}`;
}

/** Ascending in Tiến lên order: 3♠ first, 2♥ last. */
export function sortCards(cards: readonly Card[]): Card[] {
  return [...cards].sort((a, b) => a - b);
}
