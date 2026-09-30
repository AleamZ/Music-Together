import { rankOf, type Card } from "./deck";

/**
 * Xì Dách Việt Nam (Vietnamese Blackjack):
 * - Bộ 52 lá tiêu chuẩn.
 * - Điểm: 2–10 theo số; J, Q, K là 10; A linh hoạt tính 1, 10 hoặc 11 để đạt tổng điểm tối ưu <= 21.
 * - Thứ tự mạnh yếu:
 *   1. Xì Bàng (2 lá Át: A-A) - Thắng x2
 *   2. Xì Dách (1 Át + 1 lá 10/J/Q/K ở 2 lá đầu) - Thắng x1
 *   3. Ngũ Linh (5 lá tổng <= 21) - Thắng x2 (cùng Ngũ Linh thì ít điểm hơn thắng)
 *   4. Đủ tuổi (16 <= điểm <= 21; cái từ 15 điểm)
 *   5. Quắc (Bù / Bust: tổng điểm > 21)
 */

export type XidachKind = "xi_bang" | "xi_dach" | "ngu_linh" | "du_tuoi" | "quac";

export interface XidachHand {
  kind: XidachKind;
  /** Final calculated score (best <= 21, or minimal bust > 21) */
  points: number;
  /** Number of cards held */
  count: number;
  /** Is eligible to stand (>= 16 for player, >= 15 for dealer) */
  canStand: boolean;
}

/** Check if card is an Ace */
export function isAce(c: Card): boolean {
  return rankOf(c) === 11;
}

/** Check if card is a 10-point face card (10, J, Q, K) */
export function isTenCard(c: Card): boolean {
  const r = rankOf(c);
  return r === 7 || r === 8 || r === 9 || r === 10;
}

/** Base point value of a non-Ace card */
export function xidachBasePoint(c: Card): number {
  const r = rankOf(c);
  if (r === 11) return 1; // Ace base value is 1
  if (r === 12) return 2; // "2" card
  if (r >= 7 && r <= 10) return 10; // 10, J, Q, K
  return r + 3; // 3..9
}

/**
 * Calculate the best possible point total for a hand.
 * Returns the highest score <= 21, or the lowest score > 21 if all combinations bust.
 */
export function xidachPoints(cards: readonly Card[]): number {
  if (cards.length === 0) return 0;

  let baseSum = 0;
  let aceCount = 0;

  for (const c of cards) {
    if (isAce(c)) {
      aceCount++;
      baseSum += 1; // Count each Ace initially as 1
    } else {
      baseSum += xidachBasePoint(c);
    }
  }

  if (aceCount === 0) {
    return baseSum;
  }

  // Generate all valid point totals with Ace values (1, 10, 11)
  // In VN Xì Dách, an Ace can add +0 (as 1), +9 (as 10), or +10 (as 11).
  const possibleTotals = new Set<number>([baseSum]);

  for (let i = 0; i < aceCount; i++) {
    const currentList = Array.from(possibleTotals);
    for (const total of currentList) {
      // Ace as 10 (+9 from base 1)
      possibleTotals.add(total + 9);
      // Ace as 11 (+10 from base 1)
      possibleTotals.add(total + 10);
    }
  }

  const sorted = Array.from(possibleTotals).sort((a, b) => a - b);
  const under21 = sorted.filter((p) => p <= 21);

  if (under21.length > 0) {
    return Math.max(...under21);
  }
  return sorted[0]; // Minimal bust score
}

/**
 * Evaluate a hand according to Vietnamese Xì Dách rules.
 */
export function xidachEval(cards: readonly Card[]): XidachHand {
  const count = cards.length;
  if (count === 0) {
    return { kind: "quac", points: 0, count: 0, canStand: false };
  }

  // 2 cards initial hand check
  if (count === 2) {
    const [c1, c2] = cards;
    if (isAce(c1) && isAce(c2)) {
      return { kind: "xi_bang", points: 21, count: 2, canStand: true };
    }
    if ((isAce(c1) && isTenCard(c2)) || (isAce(c2) && isTenCard(c1))) {
      return { kind: "xi_dach", points: 21, count: 2, canStand: true };
    }
  }

  const points = xidachPoints(cards);

  // 5 cards check (Ngũ Linh)
  if (count === 5 && points <= 21) {
    return { kind: "ngu_linh", points, count: 5, canStand: true };
  }

  // Bust check
  if (points > 21) {
    return { kind: "quac", points, count, canStand: false };
  }

  // Regular point hand
  return {
    kind: "du_tuoi",
    points,
    count,
    canStand: points >= 16,
  };
}

/** Numeric class weight for ranking comparison */
export function xidachClassWeight(kind: XidachKind): number {
  switch (kind) {
    case "xi_bang":
      return 5;
    case "xi_dach":
      return 4;
    case "ngu_linh":
      return 3;
    case "du_tuoi":
      return 2;
    case "quac":
      return 1;
  }
}

/**
 * Compare player's hand vs dealer's hand.
 * Returns:
 *   1  if player wins
 *  -1  if dealer wins
 *   0  if tie (hòa)
 */
export function xidachCompare(player: XidachHand, dealer: XidachHand): number {
  const pw = xidachClassWeight(player.kind);
  const dw = xidachClassWeight(dealer.kind);

  if (pw !== dw) {
    return Math.sign(pw - dw);
  }

  // Same class tie-breaking:
  if (player.kind === "xi_bang" || player.kind === "xi_dach") {
    return 0; // Both have Xi Bang or Xi Dach -> Tie
  }

  if (player.kind === "ngu_linh") {
    // In Ngũ Linh, the hand with FEWER points wins!
    if (player.points !== dealer.points) {
      return Math.sign(dealer.points - player.points);
    }
    return 0;
  }

  if (player.kind === "du_tuoi") {
    // Higher points wins
    return Math.sign(player.points - dealer.points);
  }

  // Both are Quắc (> 21) -> In VN Xì Dách, both bust is a tie
  return 0;
}

export interface XidachLine {
  from: number;
  to: number;
  xu: number;
  why: "win" | "xi_bang" | "ngu_linh" | "left";
}

/**
 * Settle a round of Xì Dách between Dealer and Players.
 * Multipliers:
 * - Xi Bang / Ngu Linh: 2x stake
 * - Normal win: 1x stake
 */
export function xidachSettle(p: {
  dealer: number;
  stake: number;
  order: readonly number[];
  left: readonly number[];
  hands: Readonly<Record<number, readonly Card[]>>;
}): { lines: XidachLine[]; net: Record<number, number> } {
  const dh = xidachEval(p.hands[p.dealer] ?? []);
  const lines: XidachLine[] = [];
  const net: Record<number, number> = {};

  const addNet = (seat: number, amount: number) => {
    net[seat] = (net[seat] ?? 0) + amount;
  };

  for (const s of p.order) {
    if (s === p.dealer) continue;

    if (p.left.includes(s)) {
      // Left table during live hand: forfeits stake to dealer
      lines.push({ from: s, to: p.dealer, xu: p.stake, why: "left" });
      addNet(s, -p.stake);
      addNet(p.dealer, p.stake);
      continue;
    }

    const ph = xidachEval(p.hands[s] ?? []);
    const cmp = xidachCompare(ph, dh);

    if (cmp === 0) {
      // Tie -> no money exchanged
      continue;
    }

    // Determine multiplier
    let mult = 1;
    let why: "win" | "xi_bang" | "ngu_linh" = "win";

    if (cmp > 0) {
      // Player won
      if (ph.kind === "xi_bang") {
        mult = 2;
        why = "xi_bang";
      } else if (ph.kind === "ngu_linh") {
        mult = 2;
        why = "ngu_linh";
      }
      const amount = p.stake * mult;
      lines.push({ from: p.dealer, to: s, xu: amount, why });
      addNet(s, amount);
      addNet(p.dealer, -amount);
    } else {
      // Dealer won
      if (dh.kind === "xi_bang") {
        mult = 2;
        why = "xi_bang";
      } else if (dh.kind === "ngu_linh") {
        mult = 2;
        why = "ngu_linh";
      }
      const amount = p.stake * mult;
      lines.push({ from: s, to: p.dealer, xu: amount, why });
      addNet(s, -amount);
      addNet(p.dealer, amount);
    }
  }

  return { lines, net };
}

/** One money line of a hand (0021's pub.lines / last.lines): `from` pays `to` `xu`. */
export interface XidachMoneyLine { from: number; to: number; xu: number }

/** What a hand's lines really pay (Kinh tế v2, 0106 _xd_cap). */
export interface XidachCap {
  /** Each seat's result: escrow + net ≥ 0 for every seat. */
  net: Record<number, number>;
  /** The seats that owed more than they had on the table, in seat order. */
  capped: number[];
  /** The floors' remainder that nobody receives: the nets sum to −burned. */
  burned: number;
}

/**
 * A seat never loses more than its escrow (0106 `_xd_cap`, verbatim arithmetic; tests/fixtures/xidach-cap-cases.json
 * pins this, the SQL and a Python reference):
 * - the lines between two seats both ways are netted into one edge;
 * - a seat that owes more than it has on the table (its escrow plus what it receives) is short. Its edges are scaled
 *   pro rata (floor) to what it has, and that is repeated until nothing changes. After 64 rounds without a fixed point,
 *   a short seat pays at most its escrow;
 * - a short seat loses everything it had on the table, and the floors' remainder is burned.
 */
export function xidachCap(lines: readonly XidachMoneyLine[], escrow: Readonly<Record<number, number>>): XidachCap {
  const seats = [...new Set([...Object.keys(escrow).map(Number), ...lines.flatMap((l) => [l.from, l.to])])].sort((a, b) => a - b);
  const esc = (s: number) => escrow[s] ?? 0;
  const edges: Array<{ from: number; to: number; amt: number }> = [];
  for (const a of seats) {
    for (const b of seats) {
      if (b <= a) continue;
      const d = lines.reduce((sum, l) => sum + (l.from === a && l.to === b ? l.xu : l.from === b && l.to === a ? -l.xu : 0), 0);
      if (d > 0) edges.push({ from: a, to: b, amt: d });
      else if (d < 0) edges.push({ from: b, to: a, amt: -d });
    }
  }
  const inOf = (s: number, pay: readonly number[]) => edges.reduce((sum, e, i) => sum + (e.to === s ? pay[i] : 0), 0);
  const owedOf = (s: number) => edges.reduce((sum, e) => sum + (e.from === s ? e.amt : 0), 0);
  let pay = edges.map((e) => e.amt);
  let changed = true;
  for (let k = 0; k < 64 && changed; k++) {
    const next = [...pay];
    changed = false;
    for (const s of seats) {
      const avail = esc(s) + inOf(s, pay), owed = owedOf(s);
      if (owed <= avail) continue;
      edges.forEach((e, i) => {
        if (e.from !== s) return;
        next[i] = Math.floor((e.amt * avail) / owed);
        if (next[i] !== pay[i]) changed = true;
      });
    }
    pay = next;
  }
  if (changed) {
    pay = edges.map((e) => {
      const owed = owedOf(e.from);
      return owed > esc(e.from) ? Math.floor((e.amt * esc(e.from)) / owed) : e.amt;
    });
  }
  const net: Record<number, number> = {};
  const capped: number[] = [];
  let burned = 0;
  for (const s of seats) {
    const got = inOf(s, pay), owed = owedOf(s);
    const paid = edges.reduce((sum, e, i) => sum + (e.from === s ? pay[i] : 0), 0);
    let charge = paid;
    if (owed > paid) {
      charge = esc(s) + got;
      capped.push(s);
      burned += esc(s) + got - paid;
    }
    net[s] = got - charge;
  }
  return { net, capped, burned };
}
