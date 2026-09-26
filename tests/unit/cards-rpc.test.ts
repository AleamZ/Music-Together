import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: h.rpc } }));

import { AnticheatError, subscribeAnticheat, type AnticheatEvent } from "@/lib/anticheat";
import {
  cardAction, cardActionCall, fetchCardHand, fetchCardLobby, fetchCardState, tickCardTable,
} from "@/lib/game/cards/rpc";
import { caoRaw, cs, T0, tlRaw } from "./helpers/card-states";

const events: AnticheatEvent[] = [];
let off: () => void = () => {};
beforeEach(() => {
  h.rpc.mockReset();
  events.length = 0;
  off = subscribeAnticheat((e) => events.push(e));
});
afterEach(() => off());

describe("card reads (spec §11.3)", () => {
  it("call their RPCs with the room, the token and the game", async () => {
    h.rpc.mockResolvedValueOnce({ data: { server_now: T0, tables: [] }, error: null });
    expect(await fetchCardLobby("r", "tok")).toEqual({ serverNow: Date.parse(T0), tables: [] });
    expect(h.rpc).toHaveBeenLastCalledWith("card_lobby", { p_room_id: "r", p_session_token: "tok" });
    h.rpc.mockResolvedValueOnce({ data: tlRaw(), error: null });
    expect((await fetchCardState("r", "tok", "tienlen")).game).toBe("tienlen");
    expect(h.rpc).toHaveBeenLastCalledWith("card_state", { p_room_id: "r", p_session_token: "tok", p_game: "tienlen" });
    h.rpc.mockResolvedValueOnce({ data: { server_now: T0, game: "cao", hand_no: 3, seat: 1, cards: cs("9S", "8C", "2H") }, error: null });
    expect((await fetchCardHand("r", "tok", "cao")).cards).toHaveLength(3);
    h.rpc.mockResolvedValueOnce({ data: { changed: true, state: caoRaw() }, error: null });
    expect(await tickCardTable("r", "tok", "cao")).toMatchObject({ changed: true, state: { game: "cao" } });
    expect(h.rpc).toHaveBeenLastCalledWith("card_tick", { p_room_id: "r", p_session_token: "tok", p_game: "cao" });
  });

  it("throw on an error or a malformed answer", async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: "invalid game", code: "22023" } });
    await expect(fetchCardState("r", "tok", "tienlen")).rejects.toMatchObject({ message: "invalid game" });
    h.rpc.mockResolvedValueOnce({ data: { what: 1 }, error: null });
    await expect(fetchCardState("r", "tok", "tienlen")).rejects.toThrow("bad card state");
  });
});

describe("card writes", () => {
  it("name each action's RPC and arguments", () => {
    expect(cardActionCall("poker", { kind: "sit", seat: 3, stake: 1000, buyin: 100_000 }))
      .toEqual(["card_sit", { p_game: "poker", p_seat: 3, p_stake: 1000, p_buyin: 100_000 }]);
    expect(cardActionCall("tienlen", { kind: "sit", seat: 1, stake: 100, buyin: null }))
      .toEqual(["card_sit", { p_game: "tienlen", p_seat: 1, p_stake: 100, p_buyin: null }]);
    expect(cardActionCall("cao", { kind: "leave" })).toEqual(["card_leave", { p_game: "cao" }]);
    expect(cardActionCall("poker", { kind: "topup", amount: 5000 })).toEqual(["pk_topup", { p_amount: 5000 }]);
    expect(cardActionCall("tienlen", { kind: "tl_play", seq: 7, cards: [0, 1] })).toEqual(["tl_play", { p_seq: 7, p_cards: [0, 1] }]);
    expect(cardActionCall("tienlen", { kind: "tl_pass", seq: 7 })).toEqual(["tl_pass", { p_seq: 7 }]);
    expect(cardActionCall("cao", { kind: "cao_deal", seq: 2 })).toEqual(["cao_deal", { p_seq: 2 }]);
    expect(cardActionCall("poker", { kind: "pk_act", seq: 9, action: "raise", amount: 4000 }))
      .toEqual(["pk_act", { p_seq: 9, p_action: "raise", p_amount: 4000 }]);
  });

  it("answer the state, my hand and my coins", async () => {
    h.rpc.mockResolvedValueOnce({ data: { changed: true, state: tlRaw(), hand: { server_now: T0, game: "tienlen", hand_no: 3, seat: 1,
      cards: cs("3S") }, coins: 9000 }, error: null });
    const a = await cardAction("r", "tok", "tienlen", { kind: "tl_pass", seq: 5 });
    expect(h.rpc).toHaveBeenCalledWith("tl_pass", { p_room_id: "r", p_session_token: "tok", p_seq: 5 });
    expect(a).toMatchObject({ changed: true, coins: 9000, hand: { cards: cs("3S") } });
  });

  it("a flagged answer throws an AnticheatError and reports a strike; a lock is reported (anti-cheat §12.1)", async () => {
    h.rpc.mockResolvedValueOnce({ data: { anticheat: { code: "bad_cards", strike: 1, error: "invalid cards",
      locked_until: "2026-09-26T10:05:00+00:00", banned: false, server_now: T0 } }, error: null });
    const err = await cardAction("r", "tok", "tienlen", { kind: "tl_play", seq: 5, cards: [99] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AnticheatError);
    expect((err as AnticheatError).message).toBe("invalid cards");
    expect(events.map((e) => e.kind)).toEqual(["strike"]);
    h.rpc.mockResolvedValueOnce({ data: { anticheat: { code: "bad_move", strike: 0, error: "cannot beat", locked_until: null,
      banned: false, server_now: T0 } }, error: null });
    await expect(cardAction("r", "tok", "tienlen", { kind: "tl_play", seq: 5, cards: [0] })).rejects.toMatchObject({ message: "cannot beat" });
    expect(events).toHaveLength(1);
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: "account locked", details: "120", code: "42501" } });
    await expect(cardAction("r", "tok", "cao", { kind: "cao_deal", seq: 1 })).rejects.toMatchObject({ message: "account locked" });
    expect(events.map((e) => e.kind)).toEqual(["strike", "lock"]);
  });
});
