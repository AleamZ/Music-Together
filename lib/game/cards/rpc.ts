import { AnticheatError, screenAnswer } from "@/lib/anticheat";
import { supabase } from "@/lib/supabase";
import type { CardGame } from "./deck";
import {
  parseCardAnswer, parseCardHand, parseCardLobby, parseCardState, parseCardTick,
  type CardAnswer, type CardHand, type CardLobby, type CardState, type CardTick,
} from "./state";

// Supabase calls for the card corner (spec §11.3). The reads are snapshots; card_tick and the writes lock the table and
// apply what is due first. A flagged answer (anti-cheat §9.1) throws an AnticheatError, exactly as the farm and the
// fishing wrappers do (anti-cheat §12.1).

/** An RPC's answer; a flagged answer throws an AnticheatError. */
async function call(fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.rpc(fn, args);
  const flagged = screenAnswer(data, error);
  if (error) throw error;
  if (flagged) throw new AnticheatError(flagged);
  return data;
}

function parsed<T>(v: T | null, what: string): T {
  if (v === null) throw new Error(`bad ${what}`);
  return v;
}

export async function fetchCardLobby(roomId: string, token: string): Promise<CardLobby> {
  return parsed(parseCardLobby(await call("card_lobby", { p_room_id: roomId, p_session_token: token })), "card lobby");
}

export async function fetchCardState(roomId: string, token: string, game: CardGame): Promise<CardState> {
  return parsed(parseCardState(await call("card_state", { p_room_id: roomId, p_session_token: token, p_game: game })), "card state");
}

export async function fetchCardHand(roomId: string, token: string, game: CardGame): Promise<CardHand> {
  return parsed(parseCardHand(await call("card_hand", { p_room_id: roomId, p_session_token: token, p_game: game })), "card hand");
}

/** Apply what is due at the table (§10). */
export async function tickCardTable(roomId: string, token: string, game: CardGame): Promise<CardTick> {
  return parsed(parseCardTick(await call("card_tick", { p_room_id: roomId, p_session_token: token, p_game: game })), "card tick");
}

/** Every card write (§11.3). The game actions carry the table's `seq` (R24). */
export type CardAction =
  | { kind: "sit"; seat: number; stake: number; buyin: number | null }
  | { kind: "leave" }
  | { kind: "topup"; amount: number }
  | { kind: "tl_play"; seq: number; cards: number[] }
  | { kind: "tl_pass"; seq: number }
  | { kind: "cao_deal"; seq: number }
  | { kind: "pk_act"; seq: number; action: "fold" | "check" | "call" | "bet" | "raise" | "allin"; amount: number | null };

/** The RPC name and its own arguments for an action at `game`'s table. */
export function cardActionCall(game: CardGame, a: CardAction): [string, Record<string, unknown>] {
  switch (a.kind) {
    case "sit": return ["card_sit", { p_game: game, p_seat: a.seat, p_stake: a.stake, p_buyin: a.buyin }];
    case "leave": return ["card_leave", { p_game: game }];
    case "topup": return ["pk_topup", { p_amount: a.amount }];
    case "tl_play": return ["tl_play", { p_seq: a.seq, p_cards: a.cards }];
    case "tl_pass": return ["tl_pass", { p_seq: a.seq }];
    case "cao_deal": return ["cao_deal", { p_seq: a.seq }];
    case "pk_act": return ["pk_act", { p_seq: a.seq, p_action: a.action, p_amount: a.amount }];
  }
}

export async function cardAction(roomId: string, token: string, game: CardGame, a: CardAction): Promise<CardAnswer> {
  const [fn, args] = cardActionCall(game, a);
  return parsed(parseCardAnswer(await call(fn, { p_room_id: roomId, p_session_token: token, ...args })), "card answer");
}
