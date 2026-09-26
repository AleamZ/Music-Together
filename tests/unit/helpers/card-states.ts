import { cardsOf } from "@/lib/game/cards/deck";
import { parseCardState, type CardState } from "@/lib/game/cards/state";

/** card_state answers as the server sends them (spec §11.4), for the parser, hook and panel tests. */

export const T0 = "2026-09-26T10:00:00+00:00";
export const at = (sec: number): string => new Date(Date.parse(T0) + sec * 1000).toISOString();
export const ID = ["a1", "a2", "a3", "a4", "a5", "a6"].map((x) => `00000000-0000-4000-8000-0000000000${x}`);
export const NAMES = ["An", "Bình", "Chi", "Dũng", "Em", "Giang"];

export type Raw = Record<string, unknown>;

export function seatRaw(seat: number, over: Raw = {}): Raw {
  return { seat, id: ID[seat - 1], name: NAMES[seat - 1], chips: 0, escrow: 0, leaving: false, ...over };
}

function base(game: string, max: number, over: Raw): Raw {
  return {
    server_now: T0, game, stake: 1000, max, v: 10, seq: 5, hand_no: 3, phase: "playing", turn: 1, deadline: at(15),
    seats: [], pub: {}, last: null, ...over,
  };
}

/** A Tiến lên game: seats 1–4 dealt, 1 to play, 3♠ lead done. */
export function tlRaw(over: Raw = {}, pub: Raw = {}): Raw {
  const players: Raw = {};
  for (const s of [1, 2, 3, 4]) {
    players[s] = { id: ID[s - 1], n: 13, played: false, out: null, place: null, paid: 0, settled: false };
  }
  return base("tienlen", 4, {
    seats: [1, 2, 3, 4].map((s) => seatRaw(s, { escrow: 10000 })),
    pub: {
      first: false, must: null, order: [1, 2, 3, 4], players, top: null, passed: [], pile: [], chain: null, lines: [], ...pub,
    },
    ...over,
  });
}

/** A Cào hand in peek: seats 1–3, dealer 2. */
export function caoRaw(over: Raw = {}, pub: Raw = {}): Raw {
  return base("cao", 6, {
    phase: "peek", turn: null,
    seats: [1, 2, 3].map((s) => seatRaw(s, { escrow: s === 2 ? 2000 : 1000 })),
    pub: { dealer: 2, order: [1, 2, 3], left: [], note: null, ...pub },
    ...over,
  });
}

/** A poker hand preflop: seats 1–3, button 1, SB 2, BB 3, seat 1 to act. */
export function pkRaw(over: Raw = {}, pub: Raw = {}): Raw {
  const p = (s: number, bet: number, last: string | null) => ({
    id: ID[s - 1], bet, put: bet, fold: false, allin: false, acted: null, pending: true, last,
  });
  return base("poker", 6, {
    seats: [1, 2, 3].map((s) => seatRaw(s, { chips: 100000 - (s === 2 ? 500 : s === 3 ? 1000 : 0) })),
    pub: {
      button: 1, sb: 2, bb: 3, street: "preflop", board: [], cur: 1000, raise: 1000, pot: 1500, order: [1, 2, 3],
      players: { 1: p(1, 0, null), 2: p(2, 500, "sb"), 3: p(3, 1000, "bb") }, ...pub,
    },
    ...over,
  });
}

export function parsed(raw: Raw): CardState {
  const s = parseCardState(raw);
  if (!s) throw new Error("the sample state does not parse");
  return s;
}

export const cs = (...codes: string[]): number[] => cardsOf(codes);
