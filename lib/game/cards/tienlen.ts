import { rankOf, sortCards, suitOf, type Card } from "./deck";

// Tiến lên miền Nam on the client (spec §7): the combinations, beating and cutting, the values, thối, tới trắng and the
// money of a game, the same arithmetic in the same order as 0017 section B (_tl_combo … _tl_money), so the hints and the
// rules book agree with the server (tests/fixtures/card-cases.json pins both sides). Amounts are in half-stakes (h):
// 2 h = 1 S. Pure.

export type TlType = "single" | "pair" | "triple" | "quad" | "straight" | "pairs";

/** A combination: `key` = the highest card; `len` = the cards of a sảnh, the pairs of a đôi thông, else the card count. */
export interface TlCombo { type: TlType; len: number; key: Card; cards: Card[] }

export type TlTrang = "sanh_rong" | "nam_doi_thong" | "tu_quy_heo" | "sau_doi";
export type TlOut = "done" | "cong" | "forfeit";
export type TlWhy = "bet" | "ba" | "chat" | "thoi" | "cong" | "trang" | "forfeit";

/** The rank of the 2s (heo). */
const HEO = 12;

/** A combination of these cards (§7.1), or null. */
export function tlCombo(cards: readonly Card[]): TlCombo | null {
  const n = cards.length;
  if (n === 0 || cards.some((c) => !Number.isInteger(c) || c < 0 || c > 51) || new Set(cards).size !== n) return null;
  const c = sortCards(cards);
  const r = c.map(rankOf);
  let type: TlType | null = null;
  let len = n;
  if (r[0] === r[n - 1] && n <= 4) {
    type = n === 1 ? "single" : n === 2 ? "pair" : n === 3 ? "triple" : "quad";
  } else if (n >= 3 && r[n - 1] < HEO && r.every((x, k) => x === r[0] + k)) {
    type = "straight";
  } else if (n >= 6 && n % 2 === 0 && r[n - 1] < HEO
             && Array.from({ length: n / 2 }, (_, k) => k).every((k) => r[2 * k] === r[0] + k && r[2 * k + 1] === r[0] + k)) {
    type = "pairs";
    len = n / 2;
  }
  return type === null ? null : { type, len, key: c[n - 1], cards: c };
}

const isHeo = (x: TlCombo): boolean => (x.type === "single" || x.type === "pair") && rankOf(x.key) === HEO;
/** A bomb (hàng): a tứ quý or a đôi thông. */
export const isBomb = (x: TlCombo): boolean => x.type === "quad" || x.type === "pairs";

/** Does x beat top (§7.2)? */
export function tlBeats(top: TlCombo, x: TlCombo): boolean {
  if (x.type === top.type && (x.type !== "straight" && x.type !== "pairs" || x.len === top.len) && x.key > top.key) return true;
  const heoRank = rankOf(top.key) === HEO;
  if (top.type === "single" && heoRank) return x.type === "quad" || (x.type === "pairs" && (x.len === 3 || x.len === 4));
  if (top.type === "pair" && heoRank) return x.type === "quad" || (x.type === "pairs" && x.len === 4);
  if (top.type === "pairs" && top.len === 3) return x.type === "quad" || (x.type === "pairs" && x.len === 4);
  if (top.type === "quad") return x.type === "pairs" && x.len === 4;
  return false;
}

/** Is playing x over top a cut (chặt): a bomb over a heo combination or another bomb (§7.2)? */
export function tlIsCut(top: TlCombo, x: TlCombo): boolean {
  return isBomb(x) && (isBomb(top) || isHeo(top));
}

/** What cutting a combination is worth, in half-stakes: 2♠/2♣ 1, 2♦/2♥ 2, a pair of 2s the sum, 3 đôi thông 3, tứ quý 4,
 *  4 đôi thông 6; anything else 0. */
export function tlValue(x: TlCombo): number {
  if (isHeo(x)) return x.cards.reduce((h, c) => h + (suitOf(c) >= 2 ? 2 : 1), 0);
  if (x.type === "pairs" && x.len === 3) return 3;
  if (x.type === "quad") return 4;
  if (x.type === "pairs" && x.len >= 4) return 6;
  return 0;
}

/** Thối (§7.4, R12) in half-stakes: each 2 (black 1, red 2), each tứ quý below 2 (4), then over the other ranks below 2
 *  each maximal run of ≥ 3 consecutive ranks holding ≥ 2 cards (3 ranks 3, 4 or more 6). */
export function tlThoi(cards: readonly Card[]): number {
  const n = new Array<number>(13).fill(0);
  let h = 0;
  for (const c of cards) {
    n[rankOf(c)] += 1;
    if (rankOf(c) === HEO) h += suitOf(c) >= 2 ? 2 : 1;
  }
  for (let r = 0; r < HEO; r++) {
    if (n[r] === 4) {
      h += 4;
      n[r] = 0;
    }
  }
  let run = 0;
  for (let r = 0; r <= HEO; r++) {
    if (r < HEO && n[r] >= 2) {
      run += 1;
    } else {
      h += run === 3 ? 3 : run >= 4 ? 6 : 0;
      run = 0;
    }
  }
  return h;
}

/** Tới trắng (§7.4, R10): the best pattern of a dealt hand, or null. */
export function tlTrang(cards: readonly Card[]): TlTrang | null {
  const n = new Array<number>(13).fill(0);
  for (const c of cards) n[rankOf(c)] += 1;
  if (n.slice(0, HEO).every((x) => x >= 1)) return "sanh_rong";
  for (let r = 0; r + 4 < HEO; r++) {
    if ([0, 1, 2, 3, 4].every((k) => n[r + k] >= 2)) return "nam_doi_thong";
  }
  if (n[HEO] === 4) return "tu_quy_heo";
  if (n.reduce((a, x) => a + Math.floor(x / 2), 0) >= 6) return "sau_doi";
  return null;
}

/** The strength of a tới trắng pattern: the highest wins (R10). */
export function tlTrangRank(p: TlTrang | null): number {
  return p === "sanh_rong" ? 4 : p === "nam_doi_thong" ? 3 : p === "tu_quy_heo" ? 2 : p === "sau_doi" ? 1 : 0;
}

// ------------------------------------------------------------------ money (§7.5)

export interface TlPlayer { played: boolean; out: TlOut | null; place: number | null; paid: number; settled: boolean }
export interface TlChain { h: number; victim: number; cutter: number; void: boolean }
export interface TlLine { from: number; to: number; h: number; paid: number; why: TlWhy }

/** What the money of a game reads and writes of the table's pub. */
export interface TlMoney {
  order: readonly number[];
  players: Readonly<Record<number, TlPlayer>>;
  chain: TlChain | null;
  lines: readonly TlLine[];
}

/** The money events (0017 _tl_money). A cut's top names the cards it cut. */
export type TlEvent =
  | { k: "cut"; seat: number; top: { seat: number; cards: readonly Card[]; done: boolean } }
  | { k: "close" }
  | { k: "out"; seat: number }
  | { k: "forfeit"; seats: readonly number[] }
  | { k: "leave"; seat: number }
  | { k: "trang"; seat: number }
  | { k: "end" };

/** The seats of `order` after `seat` in turn order (ascending, wrapping round), `seat` itself left out. */
export function seatsAfter(order: readonly number[], seat: number | null): number[] {
  if (seat === null) return [];
  const rest = order.filter((s) => s !== seat);
  return [...rest.filter((s) => s > seat).sort((a, b) => a - b), ...rest.filter((s) => s < seat).sort((a, b) => a - b)];
}

/** One line within the payer's cap of 20 h (R14): dropped when it pays nothing, when either side is settled, or when the
 *  recipient is one of `gone` (seats leaving together). */
function pay(m: TlMoney, from: number, to: number, h: number, why: TlWhy, gone: readonly number[] = []): TlMoney {
  const payer = m.players[from];
  if (h <= 0 || from === to || gone.includes(to) || (payer?.settled ?? true) || (m.players[to]?.settled ?? true)) return m;
  const x = Math.min(h, 20 - payer.paid);
  if (x <= 0) return m;
  return {
    ...m,
    players: { ...m.players, [from]: { ...payer, paid: payer.paid + x } },
    lines: [...m.lines, { from, to, h, paid: x, why }],
  };
}

function setPlayer(m: TlMoney, seat: number, patch: Partial<TlPlayer>): TlMoney {
  return { ...m, players: { ...m.players, [seat]: { ...m.players[seat], ...patch } } };
}

const placedCount = (m: TlMoney): number => Object.values(m.players).filter((p) => p.place !== null).length;

/** The money of a game, one event at a time: the next state (0017 _tl_money, the same steps in the same order). `hands`
 *  holds the cards each seat holds now, for thối. */
export function tlMoney(m0: TlMoney, ev: TlEvent, hands: Readonly<Record<number, readonly Card[]>>): TlMoney {
  let m = m0;
  const ord = m.order;
  const ch = m.chain;
  const held = (s: number): readonly Card[] => hands[s] ?? [];
  switch (ev.k) {
    case "cut": {
      const top = tlCombo(ev.top.cards);
      return {
        ...m,
        chain: { h: (ch?.h ?? 0) + (top ? tlValue(top) : 0), victim: ev.top.seat, cutter: ev.seat, void: ev.top.done },
      };
    }
    case "close":
      if (ch && !ch.void) m = pay(m, ch.victim, ch.cutter, ch.h, "chat");
      return { ...m, chain: null };
    case "out": {
      const s = ev.seat;
      const placed = placedCount(m);
      m = setPlayer(m, s, { out: "done", place: placed + 1 });
      if (placed === 0) {
        for (const p of seatsAfter(ord, s)) {
          if (m.players[p]?.out === null && !m.players[p].played) {
            m = setPlayer(m, p, { out: "cong" });
            m = pay(m, p, s, 4 + tlThoi(held(p)), "cong");
          }
        }
      }
      return m;
    }
    case "forfeit": {
      const f = [...ev.seats].sort((a, b) => a - b);
      for (const s of f) m = setPlayer(m, s, { out: "forfeit" });
      for (const s of f) {
        const c = m.chain;
        if (c && c.victim === s) {
          if (!c.void) m = pay(m, s, c.cutter, c.h, "chat", f);
          m = { ...m, chain: null };
        } else if (c && c.cutter === s) {
          m = { ...m, chain: null };
        }
        const r = seatsAfter(ord, s).filter((q) => m.players[q]?.out === null);
        for (const p of r) m = pay(m, s, p, 2, "forfeit", f);
        if (r.length > 0) m = pay(m, s, r[0], tlThoi(held(s)), "thoi", f);
      }
      for (const s of f) m = setPlayer(m, s, { settled: true });
      return m;
    }
    case "leave":
      return setPlayer(m, ev.seat, { settled: true });
    case "trang":
      for (const p of seatsAfter(ord, ev.seat)) m = pay(m, p, ev.seat, 4, "trang");
      return m;
    case "end": {
      if (ch && !ch.void) m = pay(m, ch.victim, ch.cutter, ch.h, "chat");
      m = { ...m, chain: null };
      let placed = placedCount(m);
      const holder = [...ord].sort((a, b) => a - b).find((q) => m.players[q]?.out === null) ?? null;
      if (holder !== null) {
        placed += 1;
        m = setPlayer(m, holder, { place: placed });
      }
      const nhat = ord.find((q) => m.players[q]?.place === 1) ?? null;
      for (const p of seatsAfter(ord, nhat).filter((q) => m.players[q]?.out === "cong")) {
        placed += 1;
        m = setPlayer(m, p, { place: placed });
      }
      const pl = ord.filter((q) => m.players[q]?.place !== null && m.players[q]?.place !== undefined)
        .sort((a, b) => (m.players[a].place ?? 0) - (m.players[b].place ?? 0));
      const n = pl.length;
      const cong = (s: number): boolean => m.players[s].out === "cong";
      if (n === 4) {
        if (!cong(pl[3])) m = pay(m, pl[3], pl[0], 2, "bet");
        if (!cong(pl[2])) m = pay(m, pl[2], pl[1], 1, "ba");
      } else if (n >= 2 && !cong(pl[n - 1])) {
        m = pay(m, pl[n - 1], pl[0], 2, "bet");
      }
      const hp = holder === null ? null : m.players[holder].place;
      if (holder !== null && hp !== null && hp > 1) m = pay(m, holder, pl[hp - 2], tlThoi(held(holder)), "thoi");
      return m;
    }
  }
}

/** Each seat's result of the lines: what it received minus what it paid (in half-stakes). */
export function tlNet(order: readonly number[], lines: readonly TlLine[]): Record<number, number> {
  const net: Record<number, number> = {};
  for (const s of order) net[s] = 0;
  for (const l of lines) {
    net[l.from] = (net[l.from] ?? 0) - l.paid;
    net[l.to] = (net[l.to] ?? 0) + l.paid;
  }
  return net;
}

/** A whole game's money from its events (every seat dealt 13, none settled at the start): what the rules book's examples
 *  and the fixtures fold. */
export interface TlGame {
  order: readonly number[];
  /** The seats that have played a card by the time of the first go-out (the others become cóng). */
  played: readonly number[];
  hands: Readonly<Record<number, readonly Card[]>>;
  events: readonly TlEvent[];
}

export function tlSettle(g: TlGame): { lines: TlLine[]; places: Record<number, number>; out: Record<number, TlOut>; net: Record<number, number> } {
  let m: TlMoney = {
    order: g.order, chain: null, lines: [],
    players: Object.fromEntries(g.order.map((s) => [s, { played: g.played.includes(s), out: null, place: null, paid: 0, settled: false }])),
  };
  for (const ev of g.events) m = tlMoney(m, ev, g.hands);
  const places: Record<number, number> = {};
  const out: Record<number, TlOut> = {};
  for (const s of g.order) {
    const p = m.players[s];
    if (p.place !== null) places[s] = p.place;
    if (p.out !== null) out[s] = p.out;
  }
  return { lines: [...m.lines], places, out, net: tlNet(g.order, m.lines) };
}

// ------------------------------------------------------------------ hints (§13.2)

/** Every combination type, weakest first, for sorting hints. */
const TYPE_ORDER: readonly TlType[] = ["single", "pair", "triple", "straight", "pairs", "quad"];

/** The candidate combinations of a hand, one per (type, length, key): the other cards are the lowest that fit, so each
 *  key a player could play appears once. */
export function tlCandidates(hand: readonly Card[]): TlCombo[] {
  const byRank: Card[][] = Array.from({ length: 13 }, () => []);
  for (const c of sortCards(hand)) byRank[rankOf(c)].push(c);
  const out: TlCombo[] = [];
  const push = (cards: Card[]) => {
    const x = tlCombo(cards);
    if (x) out.push(x);
  };
  for (let r = 0; r < 13; r++) {
    const cs = byRank[r];
    for (let k = 0; k < cs.length; k++) {
      push([cs[k]]);
      if (k >= 1) push([cs[0], cs[k]]);
      if (k >= 2) push([cs[0], cs[1], cs[k]]);
    }
    if (cs.length === 4) push(cs);
  }
  // sảnh: ranks lo … hi (no 2), the lowest card of each rank but the top one, whose every card gives a key
  for (let lo = 0; lo < HEO; lo++) {
    for (let hi = lo + 2; hi < HEO; hi++) {
      if (byRank.slice(lo, hi + 1).some((cs) => cs.length === 0)) break;
      const base = byRank.slice(lo, hi).map((cs) => cs[0]);
      for (const top of byRank[hi]) push([...base, top]);
    }
  }
  // đôi thông: the two lowest cards of each rank but the top one, whose pairs give each key once
  for (let lo = 0; lo < HEO; lo++) {
    for (let hi = lo + 2; hi < HEO; hi++) {
      if (byRank.slice(lo, hi + 1).some((cs) => cs.length < 2)) break;
      const base = byRank.slice(lo, hi).flatMap((cs) => cs.slice(0, 2));
      const top = byRank[hi];
      for (let k = 1; k < top.length; k++) push([...base, top[0], top[k]]);
    }
  }
  return out;
}

const hintOrder = (a: TlCombo, b: TlCombo): number =>
  Number(isBomb(a)) - Number(isBomb(b)) || a.key - b.key || TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type)
  || a.cards.length - b.cards.length;

/** The plays this hand may make on its turn (§7.3): with nothing on the table any combination (a first game's lead
 *  includes `must`), else those that beat the top. Weakest first, bombs last — the order of 💡 Gợi ý. */
export function tlLegalPlays(hand: readonly Card[], top: TlCombo | null, must: Card | null): TlCombo[] {
  const all = tlCandidates(hand);
  const ok = top === null
    ? all.filter((x) => must === null || x.cards.includes(must))
    : all.filter((x) => tlBeats(top, x));
  return ok.sort(hintOrder);
}

/** The 4 đôi thông of this hand that beat the top: what 💣 Chặt! may play out of turn (R9). */
export function tlSlams(hand: readonly Card[], top: TlCombo | null): TlCombo[] {
  if (top === null) return [];
  return tlCandidates(hand).filter((x) => x.type === "pairs" && x.len === 4 && tlBeats(top, x)).sort(hintOrder);
}

/** "Xếp bài" (§13.2): by rank, or grouped by combination — tứ quý, sám cô, đôi, then the rest, each ascending. */
export function tlArrange(hand: readonly Card[], mode: "rank" | "group"): Card[] {
  const sorted = sortCards(hand);
  if (mode === "rank") return sorted;
  const count = new Map<number, number>();
  for (const c of sorted) count.set(rankOf(c), (count.get(rankOf(c)) ?? 0) + 1);
  return [...sorted].sort((a, b) => (count.get(rankOf(b)) ?? 0) - (count.get(rankOf(a)) ?? 0) || a - b);
}
