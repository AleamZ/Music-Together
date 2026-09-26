import type { CaoKind } from "./cao";
import { isCard, isCardGame, type Card, type CardGame } from "./deck";
import { tlCombo, type TlChain, type TlCombo, type TlLine, type TlOut, type TlTrang, type TlWhy } from "./tienlen";

// The card RPCs' JSON (spec §11.3, §11.4), camelCased, with times as ms since the epoch: the lobby, a table's public
// state, the caller's hand and the answers. Defensive: anything malformed parses to null. Pure.

export type CardPhase = "idle" | "countdown" | "playing" | "result" | "deal_wait" | "peek";
const PHASES: readonly string[] = ["idle", "countdown", "playing", "result", "deal_wait", "peek"];

export interface CardSeat { seat: number; id: string; name: string; chips: number; escrow: number; leaving: boolean }

export interface TlTop extends TlCombo { seat: number; done: boolean }
export interface TlPubPlayer { id: string; n: number; played: boolean; out: TlOut | null; place: number | null; paid: number; settled: boolean }
export interface TlPub {
  first: boolean;
  /** The card a first game's lead must include, until the first play. */
  must: Card | null;
  order: number[];
  players: Record<number, TlPubPlayer>;
  top: TlTop | null;
  passed: number[];
  /** This round's plays, the last 8. */
  pile: Array<{ seat: number; cards: Card[] }>;
  chain: TlChain | null;
  /** The lines applied so far, in half-stakes. */
  lines: TlLine[];
}
export interface TlLastLine { from: number; to: number; xu: number; paid: number; why: TlWhy }
export interface TlLast {
  handNo: number;
  trang: { seat: number; pattern: TlTrang; cards: Card[] } | null;
  /** The seats in place order. */
  places: number[];
  out: Record<number, TlOut>;
  /** The cards still held at the end (forfeiters' included; the tới trắng hand alone). */
  hands: Record<number, Card[]>;
  lines: TlLastLine[];
  net: Record<number, number>;
}

export interface CaoPub { dealer: number | null; order: number[]; left: number[]; note: "no_dealer" | null }
export interface CaoLastLine { from: number; to: number; xu: number; why: "cao" | "left" }
export interface CaoLast {
  handNo: number;
  dealer: number | null;
  /** The dealer was removed: every escrow went back ("Ván huỷ"). */
  cancelled: boolean;
  hands: Record<number, { cards: Card[]; kind: CaoKind; points: number }>;
  lines: CaoLastLine[];
  net: Record<number, number>;
}

export type PkStreet = "preflop" | "flop" | "turn" | "river";
export interface PkPubPlayer {
  id: string; bet: number; put: number; fold: boolean; allin: boolean;
  /** The bet level at my last action this street (null: none yet). */
  acted: number | null;
  pending: boolean;
  last: string | null;
}
export interface PkPub {
  button: number; sb: number; bb: number; street: PkStreet; board: Card[]; cur: number; raise: number; pot: number;
  order: number[]; players: Record<number, PkPubPlayer>;
}
export interface PkLastPot { xu: number; seats: number[]; winners: number[]; hand: number[] | null }
export interface PkLast {
  handNo: number; board: Card[]; uncontested: boolean;
  /** Nobody was left in the hand: the contributions went back, and a banned or deleted account's were shared by the
   *  players still in the hand (0017 _pk_refund). */
  cancelled: boolean;
  shown: Record<number, Card[]>;
  pots: PkLastPot[];
  net: Record<number, number>;
}

interface StateBase {
  serverNow: number;
  stake: number | null;
  max: number;
  v: number;
  seq: number;
  handNo: number;
  phase: CardPhase;
  turn: number | null;
  deadline: number | null;
  seats: CardSeat[];
}
export type TlState = StateBase & { game: "tienlen"; pub: TlPub | null; last: TlLast | null };
export type CaoState = StateBase & { game: "cao"; pub: CaoPub | null; last: CaoLast | null };
export type PkState = StateBase & { game: "poker"; pub: PkPub | null; last: PkLast | null };
export type CardState = TlState | CaoState | PkState;

export interface CardHand { serverNow: number; game: CardGame; handNo: number; seat: number | null; cards: Card[] }
export interface LobbyTable { game: CardGame; stake: number | null; phase: CardPhase; max: number; seats: Array<{ seat: number; id: string; name: string }> }
export interface CardLobby { serverNow: number; tables: LobbyTable[] }
/** A write's answer: the state, my hand and my wallet after it. */
export interface CardAnswer { changed: boolean; state: CardState; hand: CardHand | null; coins: number | null }
export interface CardTick { changed: boolean; state: CardState }

// ------------------------------------------------------------------ readers (null = malformed)

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) ? v : null);
const intOrNull = (v: unknown): number | null | undefined => (v === null || v === undefined ? null : int(v) ?? undefined);
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const time = (v: unknown): number | null => {
  const t = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : null;
};
const ints = (v: unknown): number[] | null => (Array.isArray(v) && v.every((x) => int(x) !== null) ? (v as number[]) : null);
const cards = (v: unknown): Card[] | null => (Array.isArray(v) && v.every(isCard) ? (v as Card[]) : null);

/** A JSON object keyed by seat numbers, each value read by `f`; null when a key or a value is bad. */
function bySeat<T>(v: unknown, f: (x: unknown) => T | null): Record<number, T> | null {
  const o = obj(v);
  if (!o) return null;
  const out: Record<number, T> = {};
  for (const [k, x] of Object.entries(o)) {
    const s = Number(k);
    const y = f(x);
    if (!Number.isInteger(s) || y === null) return null;
    out[s] = y;
  }
  return out;
}

function list<T>(v: unknown, f: (x: unknown) => T | null): T[] | null {
  if (!Array.isArray(v)) return null;
  const out: T[] = [];
  for (const x of v) {
    const y = f(x);
    if (y === null) return null;
    out.push(y);
  }
  return out;
}

const OUTS: readonly string[] = ["done", "cong", "forfeit"];
const WHYS: readonly string[] = ["bet", "ba", "chat", "thoi", "cong", "trang", "forfeit"];
const TRANGS: readonly string[] = ["sanh_rong", "nam_doi_thong", "tu_quy_heo", "sau_doi"];
const out = (v: unknown): TlOut | null => (typeof v === "string" && OUTS.includes(v) ? (v as TlOut) : null);

function tlPlayer(v: unknown): TlPubPlayer | null {
  const o = obj(v);
  if (!o) return null;
  const id = str(o.id), n = int(o.n), played = bool(o.played), paid = int(o.paid), settled = bool(o.settled);
  const place = intOrNull(o.place);
  const o2 = o.out === null || o.out === undefined ? null : out(o.out);
  if (id === null || n === null || played === null || paid === null || settled === null || place === undefined) return null;
  if (o.out !== null && o.out !== undefined && o2 === null) return null;
  return { id, n, played, out: o2, place, paid, settled };
}

function tlTop(v: unknown): TlTop | null | undefined {
  if (v === null || v === undefined) return null;
  const o = obj(v);
  const cs = cards(o?.cards);
  const seat = int(o?.seat), done = bool(o?.done);
  const x = cs ? tlCombo(cs) : null;
  if (!o || !x || seat === null || done === null) return undefined;
  return { ...x, seat, done };
}

function tlChain(v: unknown): TlChain | null | undefined {
  if (v === null || v === undefined) return null;
  const o = obj(v);
  const h = int(o?.h), victim = int(o?.victim), cutter = int(o?.cutter), vd = bool(o?.void);
  return h === null || victim === null || cutter === null || vd === null ? undefined : { h, victim, cutter, void: vd };
}

function tlLine(v: unknown): TlLine | null {
  const o = obj(v);
  const from = int(o?.from), to = int(o?.to), h = int(o?.h), paid = int(o?.paid), why = str(o?.why);
  return from === null || to === null || h === null || paid === null || why === null || !WHYS.includes(why) ? null
    : { from, to, h, paid, why: why as TlWhy };
}

function tlPub(o: Obj): TlPub | null {
  const first = bool(o.first), order = ints(o.order), players = bySeat(o.players, tlPlayer), passed = ints(o.passed);
  const must = intOrNull(o.must);
  const top = tlTop(o.top), chain = tlChain(o.chain);
  const pile = list(o.pile, (x) => {
    const p = obj(x);
    const seat = int(p?.seat), cs = cards(p?.cards);
    return seat === null || cs === null ? null : { seat, cards: cs };
  });
  const lines = list(o.lines, tlLine);
  if (first === null || order === null || players === null || passed === null || must === undefined || (must !== null && !isCard(must))
      || top === undefined || chain === undefined || pile === null || lines === null) return null;
  return { first, must, order, players, top, passed, pile, chain, lines };
}

function tlLast(o: Obj): TlLast | null {
  const handNo = int(o.hand_no), places = ints(o.places), outs = bySeat(o.out, out), hands = bySeat(o.hands, cards);
  const net = bySeat(o.net, int);
  const lines = list(o.lines, (x) => {
    const l = obj(x);
    const from = int(l?.from), to = int(l?.to), xu = int(l?.xu), paid = int(l?.paid), why = str(l?.why);
    return from === null || to === null || xu === null || paid === null || why === null || !WHYS.includes(why) ? null
      : { from, to, xu, paid, why: why as TlWhy };
  });
  let trang: TlLast["trang"] = null;
  if (o.trang !== null && o.trang !== undefined) {
    const t = obj(o.trang);
    const seat = int(t?.seat), pattern = str(t?.pattern), cs = cards(t?.cards);
    if (seat === null || pattern === null || !TRANGS.includes(pattern) || cs === null) return null;
    trang = { seat, pattern: pattern as TlTrang, cards: cs };
  }
  if (handNo === null || places === null || outs === null || hands === null || net === null || lines === null) return null;
  return { handNo, trang, places, out: outs, hands, lines, net };
}

function caoPub(o: Obj): CaoPub | null {
  const dealer = intOrNull(o.dealer), order = ints(o.order), left = ints(o.left);
  const note = o.note === "no_dealer" ? "no_dealer" : o.note === null || o.note === undefined ? null : undefined;
  if (dealer === undefined || order === null || left === null || note === undefined) return null;
  return { dealer, order, left, note };
}

const KINDS: readonly string[] = ["sap", "ba_tay", "nut"];

function caoLast(o: Obj): CaoLast | null {
  const handNo = int(o.hand_no), dealer = intOrNull(o.dealer), cancelled = bool(o.cancelled), net = bySeat(o.net, int);
  const hands = bySeat(o.hands, (x) => {
    const h = obj(x);
    const cs = cards(h?.cards), kind = str(h?.kind), points = int(h?.points);
    return cs === null || kind === null || !KINDS.includes(kind) || points === null ? null : { cards: cs, kind: kind as CaoKind, points };
  });
  const lines = list(o.lines, (x): CaoLastLine | null => {
    const l = obj(x);
    const from = int(l?.from), to = int(l?.to), xu = int(l?.xu), why = l?.why;
    return from === null || to === null || xu === null || (why !== "cao" && why !== "left") ? null : { from, to, xu, why };
  });
  if (handNo === null || dealer === undefined || cancelled === null || net === null || hands === null || lines === null) return null;
  return { handNo, dealer, cancelled, hands, lines, net };
}

const STREETS: readonly string[] = ["preflop", "flop", "turn", "river"];

function pkPlayer(v: unknown): PkPubPlayer | null {
  const o = obj(v);
  if (!o) return null;
  const id = str(o.id), bet = int(o.bet), put = int(o.put), fold = bool(o.fold), allin = bool(o.allin), pending = bool(o.pending);
  const acted = intOrNull(o.acted);
  const last = o.last === null || o.last === undefined ? null : str(o.last);
  if (id === null || bet === null || put === null || fold === null || allin === null || pending === null || acted === undefined
      || (o.last !== null && o.last !== undefined && last === null)) return null;
  return { id, bet, put, fold, allin, acted, pending, last };
}

function pkPub(o: Obj): PkPub | null {
  const button = int(o.button), sb = int(o.sb), bb = int(o.bb), street = str(o.street), board = cards(o.board);
  const cur = int(o.cur), raise = int(o.raise), pot = int(o.pot), order = ints(o.order), players = bySeat(o.players, pkPlayer);
  if (button === null || sb === null || bb === null || street === null || !STREETS.includes(street) || board === null || cur === null
      || raise === null || pot === null || order === null || players === null) return null;
  return { button, sb, bb, street: street as PkStreet, board, cur, raise, pot, order, players };
}

function pkLast(o: Obj): PkLast | null {
  const handNo = int(o.hand_no), board = cards(o.board), uncontested = bool(o.uncontested), shown = bySeat(o.shown, cards);
  const net = bySeat(o.net, int);
  const pots = list(o.pots, (x) => {
    const p = obj(x);
    const xu = int(p?.xu), seats = ints(p?.seats), winners = p?.winners === null || p?.winners === undefined ? [] : ints(p.winners);
    const hand = p?.hand === null || p?.hand === undefined ? null : ints(p.hand);
    if (xu === null || seats === null || winners === null || (p?.hand !== null && p?.hand !== undefined && hand === null)) return null;
    return { xu, seats, winners, hand };
  });
  if (handNo === null || board === null || uncontested === null || shown === null || net === null || pots === null) return null;
  return { handNo, board, uncontested, cancelled: o.cancelled === true, shown, pots, net };
}

function seatOf(v: unknown): CardSeat | null {
  const o = obj(v);
  const seat = int(o?.seat), id = str(o?.id), name = str(o?.name), chips = int(o?.chips), escrow = int(o?.escrow), leaving = bool(o?.leaving);
  return seat === null || id === null || name === null || chips === null || escrow === null || leaving === null ? null
    : { seat, id, name, chips, escrow, leaving };
}

/** A pub or a last: an empty object or null is "none"; anything else must parse. */
function part<T>(v: unknown, f: (o: Obj) => T | null): T | null | undefined {
  if (v === null || v === undefined) return null;
  const o = obj(v);
  if (!o) return undefined;
  if (Object.keys(o).length === 0) return null;
  return f(o) ?? undefined;
}

/** card_state (§11.4). */
export function parseCardState(raw: unknown): CardState | null {
  const o = obj(raw);
  if (!o) return null;
  const serverNow = time(o.server_now), game = o.game, max = int(o.max), v = int(o.v), seq = int(o.seq), handNo = int(o.hand_no);
  const phase = str(o.phase), stake = intOrNull(o.stake), turn = intOrNull(o.turn);
  const deadline = o.deadline === null || o.deadline === undefined ? null : time(o.deadline);
  const seats = list(o.seats, seatOf);
  if (serverNow === null || !isCardGame(game) || max === null || v === null || seq === null || handNo === null || phase === null
      || !PHASES.includes(phase) || stake === undefined || turn === undefined || seats === null
      || (o.deadline !== null && o.deadline !== undefined && deadline === null)) return null;
  const base: StateBase = { serverNow, stake, max, v, seq, handNo, phase: phase as CardPhase, turn, deadline, seats };
  if (game === "tienlen") {
    const pub = part(o.pub, tlPub), last = part(o.last, tlLast);
    return pub === undefined || last === undefined ? null : { ...base, game, pub, last };
  }
  if (game === "cao") {
    const pub = part(o.pub, caoPub), last = part(o.last, caoLast);
    return pub === undefined || last === undefined ? null : { ...base, game, pub, last };
  }
  const pub = part(o.pub, pkPub), last = part(o.last, pkLast);
  return pub === undefined || last === undefined ? null : { ...base, game, pub, last };
}

/** card_hand (§11.3): `cards` is empty when I am not in the hand. */
export function parseCardHand(raw: unknown): CardHand | null {
  const o = obj(raw);
  const serverNow = time(o?.server_now), game = o?.game, handNo = int(o?.hand_no), seat = intOrNull(o?.seat), cs = cards(o?.cards);
  if (!o || serverNow === null || !isCardGame(game) || handNo === null || seat === undefined || cs === null) return null;
  return { serverNow, game, handNo, seat, cards: cs };
}

/** card_lobby (§11.3). */
export function parseCardLobby(raw: unknown): CardLobby | null {
  const o = obj(raw);
  const serverNow = time(o?.server_now);
  const tables = list(o?.tables, (x) => {
    const t = obj(x);
    const game = t?.game, stake = intOrNull(t?.stake), phase = str(t?.phase), max = int(t?.max);
    const seats = list(t?.seats, (y) => {
      const s = obj(y);
      const seat = int(s?.seat), id = str(s?.id), name = str(s?.name);
      return seat === null || id === null || name === null ? null : { seat, id, name };
    });
    if (!isCardGame(game) || stake === undefined || phase === null || !PHASES.includes(phase) || max === null || seats === null) return null;
    return { game, stake, phase: phase as CardPhase, max, seats };
  });
  return serverNow === null || tables === null ? null : { serverNow, tables };
}

/** A write's answer {changed, state, hand, coins}. */
export function parseCardAnswer(raw: unknown): CardAnswer | null {
  const o = obj(raw);
  const state = parseCardState(o?.state);
  const changed = bool(o?.changed);
  if (!o || !state || changed === null) return null;
  const hand = o.hand === undefined || o.hand === null ? null : parseCardHand(o.hand);
  if (o.hand !== undefined && o.hand !== null && hand === null) return null;
  return { changed, state, hand, coins: int(o.coins) };
}

/** card_tick's answer {changed, state}. */
export function parseCardTick(raw: unknown): CardTick | null {
  const o = obj(raw);
  const state = parseCardState(o?.state);
  const changed = bool(o?.changed);
  return !o || !state || changed === null ? null : { changed, state };
}

// ------------------------------------------------------------------ reading a state

/** My seat at this table (a `leaving` one included: it still holds the seat until the hand ends). */
export function mySeat(s: CardState, accountId: string): CardSeat | null {
  return s.seats.find((x) => x.id === accountId) ?? null;
}

/** Am I dealt into the table's current hand? Only card_hand knows: my cards for this hand. */
export function inHand(s: CardState, hand: CardHand | null): boolean {
  return hand !== null && hand.handNo === s.handNo && hand.cards.length > 0 && (s.phase === "playing" || s.phase === "peek");
}

/** Whole seconds left before the deadline on the server's clock (0 when past or none). */
export function secondsLeft(s: Pick<CardState, "deadline">, now: number): number {
  return s.deadline === null ? 0 : Math.max(0, Math.ceil((s.deadline - now) / 1000));
}
