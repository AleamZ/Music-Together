import { rankOf, suitOf, type Card } from "./deck";

// Cào ba cây, "cào cái" (spec §8), on the client: the hand values, the comparison and the dealer's settlement, the same
// arithmetic as 0017 (_cao_key, _cao_eval, _cao_cmp, _cao_settle; tests/fixtures/card-cases.json pins both sides). Pure.

export type CaoKind = "sap" | "ba_tay" | "nut";

/** A hand: its class, its nút (the total mod 10), a sáp's rank (A 1 … K 13) and the key of its top card. */
export interface CaoHand { kind: CaoKind; points: number; rank: number | null; top: number }

/** The Cào rank of a card: A 1, 2–10 their number, J 11, Q 12, K 13. */
export function caoRank(c: Card): number {
  const r = rankOf(c);
  return r === 11 ? 1 : r === 12 ? 2 : r + 3;
}

/** A card's key for the tie-break (§8.1): cao_rank × 4 + cao_suit, with ♠ 0, ♣ 1, ♥ 2, ♦ 3. */
export function caoKey(c: Card): number {
  const s = suitOf(c);
  return caoRank(c) * 4 + (s === 2 ? 3 : s === 3 ? 2 : s);
}

export function caoEval(cards: readonly Card[]): CaoHand {
  const ranks = new Set(cards.map(rankOf));
  const sap = ranks.size === 1;
  const baTay = cards.every((c) => rankOf(c) >= 8 && rankOf(c) <= 10);
  return {
    kind: sap ? "sap" : baTay ? "ba_tay" : "nut",
    points: cards.reduce((a, c) => a + Math.min(caoRank(c), 10), 0) % 10,
    rank: sap ? Math.min(...cards.map(caoRank)) : null,
    top: Math.max(...cards.map(caoKey)),
  };
}

const classOf = (h: Pick<CaoHand, "kind">): number => (h.kind === "sap" ? 2 : h.kind === "ba_tay" ? 1 : 0);

/** 1 when a wins, −1 when b wins (R18, R19): sáp > ba tây > nút; two sáp by rank; ba tây, and equal nút, by the top card. */
export function caoCompare(a: CaoHand, b: CaoHand): number {
  const ca = classOf(a), cb = classOf(b);
  if (ca !== cb) return Math.sign(ca - cb);
  if (ca === 2) return Math.sign((a.rank ?? 0) - (b.rank ?? 0));
  if (ca === 0 && a.points !== b.points) return Math.sign(a.points - b.points);
  return Math.sign(a.top - b.top);
}

export interface CaoLine { from: number; to: number; why: "cao" | "left" }

/** A hand's money in units of S (§8.3): each player still in the hand wins or loses 1 against the dealer, and a player
 *  who left lost 1 to the dealer. */
export function caoSettle(p: { dealer: number; order: readonly number[]; left: readonly number[]; hands: Readonly<Record<number, readonly Card[]>> }):
  { lines: CaoLine[]; net: Record<number, number> } {
  const dh = caoEval(p.hands[p.dealer] ?? []);
  const lines: CaoLine[] = [];
  for (const s of p.order) {
    if (s === p.dealer) continue;
    if (p.left.includes(s)) lines.push({ from: s, to: p.dealer, why: "left" });
    else if (caoCompare(caoEval(p.hands[s] ?? []), dh) > 0) lines.push({ from: p.dealer, to: s, why: "cao" });
    else lines.push({ from: s, to: p.dealer, why: "cao" });
  }
  const net: Record<number, number> = {};
  for (const q of p.order) {
    net[q] = lines.reduce((a, l) => a + (l.to === q ? 1 : l.from === q ? -1 : 0), 0);
  }
  return { lines, net };
}

const CAO_RANK_NAMES = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

/** "Sáp K", "Ba tây", "7 nút" or "Bù". */
export function caoName(h: Pick<CaoHand, "kind" | "points" | "rank">): string {
  if (h.kind === "sap") return `Sáp ${CAO_RANK_NAMES[h.rank ?? 0] ?? ""}`.trim();
  if (h.kind === "ba_tay") return "Ba tây";
  return h.points === 0 ? "Bù" : `${h.points} nút`;
}
