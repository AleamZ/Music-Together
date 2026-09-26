import { describe, it, expect } from "vitest";
import {
  inHand, mySeat, parseCardAnswer, parseCardHand, parseCardLobby, parseCardState, parseCardTick, secondsLeft,
} from "@/lib/game/cards/state";
import { at, caoRaw, cs, ID, parsed, pkRaw, seatRaw, T0, tlRaw } from "./helpers/card-states";

describe("parseCardState (spec §11.4)", () => {
  it("reads a Tiến lên game: the seats, the top, the pile, the chain and the lines", () => {
    const s = parseCardState(tlRaw({}, {
      must: null, top: { type: "pair", len: 2, key: cs("9H")[0], cards: cs("9S", "9H"), seat: 2, done: false },
      pile: [{ seat: 1, cards: cs("7S", "7C") }, { seat: 2, cards: cs("9S", "9H") }], passed: [3],
      chain: { h: 3, victim: 4, cutter: 2, void: false }, lines: [{ from: 4, to: 2, h: 3, paid: 3, why: "chat" }],
    }));
    expect(s?.game).toBe("tienlen");
    if (s?.game !== "tienlen" || !s.pub) throw new Error("no pub");
    expect(s).toMatchObject({ serverNow: Date.parse(T0), stake: 1000, max: 4, v: 10, seq: 5, handNo: 3, phase: "playing", turn: 1,
      deadline: Date.parse(at(15)) });
    expect(s.seats[0]).toEqual({ seat: 1, id: ID[0], name: "An", chips: 0, escrow: 10000, leaving: false });
    expect(s.pub.top).toMatchObject({ type: "pair", len: 2, key: cs("9H")[0], seat: 2, done: false });
    expect(s.pub.pile).toHaveLength(2);
    expect(s.pub.chain).toEqual({ h: 3, victim: 4, cutter: 2, void: false });
    expect(s.pub.players[4]).toMatchObject({ id: ID[3], n: 13, out: null, place: null });
    expect(s.last).toBeNull();
  });

  it("reads an idle table (no stake, no deadline, pub {}) and a result", () => {
    const idle = parseCardState({ server_now: T0, game: "poker", stake: null, max: 6, v: 0, seq: 0, hand_no: 0, phase: "idle",
      turn: null, deadline: null, seats: [], pub: {}, last: null });
    expect(idle).toMatchObject({ game: "poker", stake: null, deadline: null, pub: null, last: null, seats: [] });
    const done = parsed(tlRaw({ phase: "result", turn: null, last: {
      hand_no: 3, trang: null, places: [1, 2, 3, 4], out: { 1: "done", 2: "done", 3: "done" }, hands: { 4: cs("2S") },
      lines: [{ from: 4, to: 1, xu: 1000, paid: 1000, why: "bet" }], net: { 1: 1000, 2: 0, 3: 0, 4: -1000 },
    } }));
    expect(done.game === "tienlen" && done.last).toMatchObject({ places: [1, 2, 3, 4], hands: { 4: cs("2S") }, net: { 4: -1000 } });
  });

  it("reads a Cào hand and its showdown, and a poker hand and its pots", () => {
    const c = parsed(caoRaw({ phase: "result", last: {
      hand_no: 3, dealer: 2, cancelled: false, hands: { 1: { cards: cs("9S", "8C", "2H"), kind: "nut", points: 9 } },
      lines: [{ from: 2, to: 1, xu: 1000, why: "cao" }], net: { 1: 1000, 2: -1000 },
    } }));
    expect(c.game === "cao" && c.pub).toEqual({ dealer: 2, order: [1, 2, 3], left: [], note: null });
    expect(c.game === "cao" && c.last?.hands[1]).toEqual({ cards: cs("9S", "8C", "2H"), kind: "nut", points: 9 });
    const wait = parsed(caoRaw({ phase: "deal_wait", turn: null }, { dealer: null, order: [], note: "no_dealer" }));
    expect(wait.game === "cao" && wait.pub?.note).toBe("no_dealer");
    const p = parsed(pkRaw({ last: { hand_no: 2, board: cs("2S", "7D", "9C", "JH", "KS"), uncontested: false, shown: { 1: cs("AS", "AH") },
      pots: [{ xu: 3000, seats: [1, 2], winners: [1], hand: [1, 14, 13, 11, 9] }], net: { 1: 1500, 2: -1500 } } }));
    if (p.game !== "poker" || !p.pub || !p.last) throw new Error("no poker");
    expect(p.pub).toMatchObject({ button: 1, sb: 2, bb: 3, street: "preflop", cur: 1000, pot: 1500, order: [1, 2, 3] });
    expect(p.pub.players[3]).toMatchObject({ bet: 1000, last: "bb", acted: null, pending: true });
    expect(p.last).toMatchObject({ cancelled: false, uncontested: false, pots: [{ xu: 3000, winners: [1], hand: [1, 14, 13, 11, 9] }] });
  });

  it("is null on malformed input", () => {
    expect(parseCardState(null)).toBeNull();
    expect(parseCardState({ ...tlRaw(), game: "liêng" })).toBeNull();
    expect(parseCardState({ ...tlRaw(), phase: "nap" })).toBeNull();
    expect(parseCardState({ ...tlRaw(), seats: [seatRaw(1, { chips: "9" })] })).toBeNull();
    expect(parseCardState(tlRaw({}, { order: "1,2" }))).toBeNull();
    expect(parseCardState(tlRaw({}, { must: 99 }))).toBeNull();
    expect(parseCardState(tlRaw({}, { top: { cards: cs("3S", "5D"), seat: 1, done: false } }))).toBeNull();
    expect(parseCardState(pkRaw({}, { street: "fifth" }))).toBeNull();
    expect(parseCardState(caoRaw({}, { note: "late" }))).toBeNull();
    expect(parseCardState({ ...tlRaw(), deadline: "soon" })).toBeNull();
  });
});

describe("the other answers", () => {
  it("card_hand: my cards, none when I am not in the hand", () => {
    expect(parseCardHand({ server_now: T0, game: "tienlen", hand_no: 3, seat: 2, cards: cs("3S", "2H") }))
      .toEqual({ serverNow: Date.parse(T0), game: "tienlen", handNo: 3, seat: 2, cards: cs("3S", "2H") });
    expect(parseCardHand({ server_now: T0, game: "cao", hand_no: 0, seat: null, cards: [] })).toMatchObject({ seat: null, cards: [] });
    expect(parseCardHand({ server_now: T0, game: "cao", hand_no: 0, seat: null, cards: [52] })).toBeNull();
  });

  it("card_lobby: every table's stake, phase and seats", () => {
    const l = parseCardLobby({ server_now: T0, tables: [
      { game: "tienlen", stake: 1000, phase: "playing", max: 4, seats: [{ seat: 1, id: ID[0], name: "An" }] },
      { game: "cao", stake: null, phase: "idle", max: 6, seats: [] },
    ] });
    expect(l?.tables).toEqual([
      { game: "tienlen", stake: 1000, phase: "playing", max: 4, seats: [{ seat: 1, id: ID[0], name: "An" }] },
      { game: "cao", stake: null, phase: "idle", max: 6, seats: [] },
    ]);
    expect(parseCardLobby({ server_now: T0, tables: [{ game: "cao", stake: null, phase: "idle", max: 6 }] })).toBeNull();
  });

  it("a write's answer and a tick's", () => {
    const a = parseCardAnswer({ changed: true, state: tlRaw(), hand: { server_now: T0, game: "tienlen", hand_no: 3, seat: 1, cards: cs("3S") },
      coins: 42 });
    expect(a).toMatchObject({ changed: true, coins: 42, hand: { seat: 1 } });
    expect(parseCardAnswer({ changed: true, state: { nope: 1 } })).toBeNull();
    expect(parseCardTick({ changed: false, state: caoRaw() })).toMatchObject({ changed: false, state: { game: "cao" } });
  });
});

describe("reading a state", () => {
  it("finds my seat, whether I am in the hand, and the seconds left", () => {
    const s = parsed(tlRaw({ seats: [seatRaw(1), seatRaw(2, { leaving: true })] }));
    expect(mySeat(s, ID[1])?.leaving).toBe(true);
    expect(mySeat(s, ID[4])).toBeNull();
    const hand = { serverNow: 0, game: "tienlen" as const, handNo: 3, seat: 1, cards: cs("3S") };
    expect(inHand(s, hand)).toBe(true);
    expect(inHand(s, { ...hand, handNo: 2 })).toBe(false);
    expect(inHand(s, { ...hand, cards: [] })).toBe(false);
    expect(secondsLeft(s, Date.parse(T0))).toBe(15);
    expect(secondsLeft(s, Date.parse(T0) + 14_100)).toBe(1);
    expect(secondsLeft(s, Date.parse(T0) + 99_000)).toBe(0);
  });
});
