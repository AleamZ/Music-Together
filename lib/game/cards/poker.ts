import { rankOf, suitOf, type Card } from "./deck";

// Texas Hold'em no-limit (spec §9) on the client: the evaluator, the pots, what the player to act may do, and the buy-in
// bounds — the same arithmetic as 0017 (_pk_rank, _pk_straight, _pk_eval, _pk_pots, _pk_do_act, card_sit, _pk_topup;
// tests/fixtures/card-cases.json pins the evaluator and the pots). Pure.

/** A card's poker rank: 2 … 14 (A = 14). */
export function pkRank(c: Card): number {
  return rankOf(c) === 12 ? 2 : rankOf(c) + 3;
}

/** The top of the best straight among these ranks (the ace also plays low: A-2-3-4-5 tops at 5), or null. */
function straightTop(ranks: readonly number[]): number | null {
  const have = new Set(ranks);
  if (have.has(14)) have.add(1);
  for (let t = 14; t >= 5; t--) {
    if ([0, 1, 2, 3, 4].every((k) => have.has(t - k))) return t;
  }
  return null;
}

const desc = (a: number, b: number) => b - a;

/** The best hand in up to 7 cards (§9.1) as a key compared lexicographically: [8, top] straight flush · [7, quad, kicker]
 *  · [6, trips, pair] · [5, the flush suit's top five] · [4, top] straight · [3, trips, k1, k2] · [2, high, low, kicker] ·
 *  [1, pair, k1, k2, k3] · [0, the top five]. Suits never break ties. */
export function pkEval(cards: readonly Card[]): number[] {
  const rs = cards.map(pkRank).sort(desc);
  const bySuit = [0, 1, 2, 3].map((s) => cards.filter((c) => suitOf(c) === s));
  const flush = bySuit.find((cs) => cs.length >= 5) ?? null;
  const fr = flush ? flush.map(pkRank).sort(desc) : [];
  if (flush) {
    const t = straightTop(fr);
    if (t !== null) return [8, t];
  }
  const count = new Map<number, number>();
  for (const r of rs) count.set(r, (count.get(r) ?? 0) + 1);
  const withCount = (n: number) => [...count].filter(([, k]) => k === n).map(([r]) => r).sort(desc);
  const quad = withCount(4)[0];
  if (quad !== undefined) return [7, quad, ...rs.filter((r) => r !== quad).slice(0, 1)];
  const tr = withCount(3);
  const pr = withCount(2);
  if (tr.length >= 2) return [6, tr[0], tr[1]];
  if (tr.length === 1 && pr.length >= 1) return [6, tr[0], pr[0]];
  if (flush) return [5, ...fr.slice(0, 5)];
  const t = straightTop(rs);
  if (t !== null) return [4, t];
  if (tr.length === 1) return [3, tr[0], ...rs.filter((r) => r !== tr[0]).slice(0, 2)];
  if (pr.length >= 2) return [2, pr[0], pr[1], ...rs.filter((r) => r !== pr[0] && r !== pr[1]).slice(0, 1)];
  if (pr.length === 1) return [1, pr[0], ...rs.filter((r) => r !== pr[0]).slice(0, 3)];
  return [0, ...rs.slice(0, 5)];
}

/** Compare two keys as Postgres compares integer arrays: element by element, a shorter prefix first. */
export function pkCompare(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return Math.sign(a[i] - b[i]);
  }
  return Math.sign(a.length - b.length);
}

const RANK = (r: number): string => (r === 14 || r === 1 ? "A" : r === 13 ? "K" : r === 12 ? "Q" : r === 11 ? "J" : String(r));

/** The Vietnamese name of a key: "Đôi K", "Thú A và 8", "Sảnh 9" … */
export function pkHandName(key: readonly number[]): string {
  const [cat, a, b] = key;
  switch (cat) {
    case 8: return a === 14 ? "Thùng phá sảnh A (royal flush)" : `Thùng phá sảnh ${RANK(a)}`;
    case 7: return `Tứ quý ${RANK(a)}`;
    case 6: return `Cù lũ ${RANK(a)} ${RANK(b)}`;
    case 5: return `Thùng ${RANK(a)}`;
    case 4: return `Sảnh ${RANK(a)}`;
    case 3: return `Sám ${RANK(a)}`;
    case 2: return `Thú ${RANK(a)} và ${RANK(b)}`;
    case 1: return `Đôi ${RANK(a)}`;
    default: return a === undefined ? "Mậu thầu" : `Mậu thầu ${RANK(a)}`;
  }
}

export interface PkSeatPut { put: number; fold?: boolean; allin?: boolean }
export interface PkPot { xu: number; seats: number[]; winners?: number[]; shares?: Record<number, number> }

/** The pots of a hand (§9.2): a level at each live all-in total and at the highest live total; each pot goes to the live
 *  seats that reach its level, and the top pot also takes every folded chip above the highest live total — when no live
 *  seat has put anything, those chips are the one pot, for the live seats. So while a seat is live the pots hold every
 *  chip put in. With the live hands' keys (or one eligible seat) each pot gets its winners; its odd xu go one at a time
 *  to the winners in seat order starting left of the button (TDA 20). */
export function pkPots(p: { players: Readonly<Record<number, PkSeatPut>>; keys?: Readonly<Record<number, readonly number[]>> | null; button: number | null }): PkPot[] {
  const seats = Object.keys(p.players).map(Number).sort((a, b) => a - b);
  const live = seats.filter((s) => !p.players[s].fold);
  const put = (s: number) => p.players[s].put;
  if (live.length === 0) return [];
  const top = Math.max(...live.map(put));
  const levels = [...new Set([...live.filter((s) => p.players[s].allin).map(put), top])].filter((x) => x > 0).sort((a, b) => a - b);
  const pots: PkPot[] = [];
  let prev = 0;
  for (const lvl of levels) {
    const amt = seats.reduce((a, s) => a + Math.min(put(s), lvl) - Math.min(put(s), prev), 0);
    const el = live.filter((s) => put(s) >= lvl);
    if (amt > 0) {
      const last = pots[pots.length - 1];
      if (last && last.seats.length === el.length && last.seats.every((s, i) => s === el[i])) last.xu += amt;
      else pots.push({ xu: amt, seats: el });
    }
    prev = lvl;
  }
  const over = seats.reduce((a, s) => a + Math.max(put(s) - top, 0), 0);
  if (over > 0 && pots.length === 0) pots.push({ xu: over, seats: [...live] });
  else if (over > 0) pots[pots.length - 1].xu += over;
  const btn = p.button;
  const order = (s: number) => (btn === null ? s : (s - btn + 5) % 6);
  return pots.map((pot) => {
    let w: number[] | null = null;
    if (pot.seats.length === 1) {
      w = pot.seats;
    } else if (p.keys) {
      const key = (s: number) => p.keys?.[s] ?? [];
      const best = pot.seats.map(key).reduce((m, k) => (pkCompare(k, m) > 0 ? k : m));
      w = pot.seats.filter((s) => pkCompare(key(s), best) === 0);
    }
    if (w === null) return pot;
    const q = Math.floor(pot.xu / w.length), r = pot.xu % w.length;
    const ranked = [...w].sort((a, b) => order(a) - order(b));
    return { ...pot, winners: w, shares: Object.fromEntries(ranked.map((s, i) => [s, q + (i < r ? 1 : 0)])) };
  });
}

/** What the player to act sees of the hand (the parsed pub and the seat's stack). */
export interface PkSpot {
  cur: number;
  raise: number;
  /** My bet this street, the bet level I last acted at (null: not yet this street), my stack. */
  bet: number;
  acted: number | null;
  chips: number;
  /** The table's stake (the big blind). */
  stake: number;
}

/** What I may do on my turn (§9.1; 0017 _pk_do_act). Amounts are "to" levels this street. */
export interface PkOptions {
  canCheck: boolean;
  canCall: boolean;
  /** The level a call brings me to (all-in when short) and what it costs. */
  callTo: number;
  callCost: number;
  /** "Cược": nothing bet this street. "Tố lên": a bet exists and I may raise. */
  canBet: boolean;
  canRaise: boolean;
  /** The slider's bounds for a bet or a raise. */
  min: number;
  max: number;
  canAllin: boolean;
}

export function pkLegal(s: PkSpot): PkOptions {
  const stack = s.bet + s.chips;
  const may = s.acted === null || s.cur - s.acted >= s.raise;
  const canBet = s.cur === 0 && s.chips > 0;
  const canRaise = s.cur > 0 && may && stack > s.cur;
  const min = canBet ? Math.min(s.stake, stack) : canRaise ? Math.min(s.cur + s.raise, stack) : 0;
  const callTo = Math.min(s.cur, stack);
  return {
    canCheck: s.cur <= s.bet,
    canCall: s.cur > s.bet,
    callTo,
    callCost: Math.max(0, callTo - s.bet),
    canBet,
    canRaise,
    min,
    max: canBet || canRaise ? stack : 0,
    canAllin: s.chips > 0 && !(stack > s.cur && !may),
  };
}

/** Is `to` a bet or raise the server takes (not counting all-in, which is always `stack`)? */
export function pkAmountOk(o: PkOptions, to: number): boolean {
  return (o.canBet || o.canRaise) && Number.isInteger(to) && to >= o.min && to <= o.max;
}

/** The slider's presets (§13.2): the minimum, half the pot and the pot, each kept within the bounds. A pot-sized raise
 *  first calls, then raises by the pot after the call. */
export function pkPresets(o: PkOptions, s: PkSpot, pot: number): { min: number; half: number; pot: number } {
  const clamp = (x: number) => Math.max(o.min, Math.min(o.max, Math.floor(x)));
  const after = pot + Math.max(0, s.cur - s.bet);
  return {
    min: o.min,
    half: clamp(o.canBet ? pot / 2 : s.cur + after / 2),
    pot: clamp(o.canBet ? pot : s.cur + after),
  };
}

/** The buy-in slider (card_sit): 50–200 big blinds, no more than the wallet; null when the wallet cannot cover 50. */
export function pkBuyInRange(stake: number, coins: number): { min: number; max: number } | null {
  const min = 50 * stake, max = Math.min(200 * stake, coins);
  return max >= min ? { min, max } : null;
}

/** A top-up between hands (R23): up to 200 big blinds on the table, no more than the wallet; null when none fits. */
export function pkTopUpRange(stake: number, chips: number, coins: number): { min: number; max: number } | null {
  const max = Math.min(200 * stake - chips, coins);
  return max >= 1 ? { min: 1, max } : null;
}
