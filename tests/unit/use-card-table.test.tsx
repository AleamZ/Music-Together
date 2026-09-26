import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { AnticheatError } from "@/lib/anticheat";
import type { CardHand } from "@/lib/game/cards/state";
import { syncClock } from "@/lib/game/farm/clock";
import { cs, ID, parsed, T0, tlRaw, type Raw } from "./helpers/card-states";

const rpc = vi.hoisted(() => ({ fetchCardState: vi.fn(), fetchCardHand: vi.fn(), tickCardTable: vi.fn(), cardAction: vi.fn() }));
vi.mock("@/lib/game/cards/rpc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/game/cards/rpc")>()),
  ...rpc,
}));
const ch = vi.hoisted(() => ({ onHint: null as null | ((h: { id: string; v: number }) => void), sent: [] as unknown[], joins: 0, leaves: 0 }));
vi.mock("@/lib/game/cards/channel", () => ({
  joinCardChannel: (_room: string, _game: string, onHint: (h: { id: string; v: number }) => void) => {
    ch.onHint = onHint;
    ch.joins++;
    return { send: (h: unknown) => ch.sent.push(h), leave: () => { ch.leaves++; } };
  },
}));

import {
  CARD_POLL_MS, CV_GATHER_MS, CV_MIN_GAP_MS, SPECTATOR_LAG_MS, TICK_LAG_MS, TICK_RETRY_MS, TICK_STEP_MS, useCardTable,
} from "@/hooks/useCardTable";

const ME = ID[1]; // seat 2 of the sample table
const state = (over: Raw = {}) => parsed(tlRaw(over));
const hand = (handNo: number, cards = cs("3S", "4D")): CardHand => ({ serverNow: Date.parse(T0), game: "tienlen", handNo, seat: 2, cards });
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const members = new Set(ID.slice(0, 5));

function mount(over: {
  active?: boolean; accountId?: string; onError?: (t: string) => void; onCoins?: (c: number) => void;
  onState?: (g: string, s: unknown) => void;
} = {}) {
  return renderHook((p: { active: boolean }) => useCardTable({
    roomId: "r", token: "tok", accountId: over.accountId ?? ME, game: "tienlen", active: p.active,
    isMember: (id) => members.has(id), onError: over.onError ?? (() => {}), onCoins: over.onCoins, onState: over.onState,
  }), { initialProps: { active: over.active ?? true } });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse(T0));
  syncClock(T0);
  for (const f of Object.values(rpc)) f.mockReset();
  ch.onHint = null;
  ch.sent.length = 0;
  ch.joins = 0;
  ch.leaves = 0;
  // no deadline unless a test sets one: the ticks stay out of the way
  rpc.fetchCardState.mockResolvedValue(state({ deadline: null }));
  rpc.fetchCardHand.mockResolvedValue(hand(3));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useCardTable (spec §12, §13.1)", () => {
  it("fetches the table while active, subscribes to its hints, and fetches my hand once per hand number", async () => {
    const onState = vi.fn();
    const { result, rerender } = mount({ active: false, onState });
    await flush();
    expect(rpc.fetchCardState).not.toHaveBeenCalled();
    rerender({ active: true });
    await flush();
    expect(ch.joins).toBe(1);
    expect(rpc.fetchCardState).toHaveBeenCalledWith("r", "tok", "tienlen");
    expect(result.current.state?.v).toBe(10);
    expect(onState).toHaveBeenCalledWith("tienlen", result.current.state);
    expect(rpc.fetchCardHand).toHaveBeenCalledTimes(1);
    expect(result.current.hand?.cards).toEqual(cs("3S", "4D"));
    await act(async () => { await result.current.refetch(); });
    expect(rpc.fetchCardHand).toHaveBeenCalledTimes(1);
    rpc.fetchCardState.mockResolvedValueOnce(state({ deadline: null, v: 11, hand_no: 4 }));
    rpc.fetchCardHand.mockResolvedValueOnce(hand(4, cs("2H")));
    await act(async () => { await result.current.refetch(); });
    expect(rpc.fetchCardHand).toHaveBeenCalledTimes(2);
    expect(result.current.hand).toMatchObject({ handNo: 4, cards: cs("2H") });
    rerender({ active: false });
    expect(ch.leaves).toBe(1);
  });

  it("a spectator gets no hand", async () => {
    const { result } = mount({ accountId: ID[5] });
    await flush();
    expect(result.current.state).not.toBeNull();
    expect(rpc.fetchCardHand).not.toHaveBeenCalled();
    expect(result.current.hand).toBeNull();
  });

  it("answers a hint with one refetch after 150 ms, and keeps refetches 500 ms apart with one trailing refetch", async () => {
    mount();
    await flush();
    rpc.fetchCardState.mockClear();
    act(() => ch.onHint!({ id: ID[0], v: 11 }));
    act(() => ch.onHint!({ id: ID[2], v: 12 }));
    await advance(CV_GATHER_MS - 1);
    expect(rpc.fetchCardState).not.toHaveBeenCalled();
    await advance(1);
    expect(rpc.fetchCardState).toHaveBeenCalledTimes(1);
    act(() => ch.onHint!({ id: ID[0], v: 13 }));
    await advance(CV_MIN_GAP_MS - 1);
    expect(rpc.fetchCardState).toHaveBeenCalledTimes(1);
    act(() => ch.onHint!({ id: ID[0], v: 14 }));
    await advance(1);
    expect(rpc.fetchCardState).toHaveBeenCalledTimes(2);
  });

  it("drops hints from non-members, for a version I already show, and past the sender's budget", async () => {
    mount();
    await flush();
    rpc.fetchCardState.mockClear();
    act(() => ch.onHint!({ id: "stranger", v: 99 }));
    act(() => ch.onHint!({ id: ID[0], v: 10 }));
    await advance(1000);
    expect(rpc.fetchCardState).not.toHaveBeenCalled();
    // six hints at once from one sender: the budget lets five through, and they are all answered by one refetch
    for (let k = 0; k < 6; k++) act(() => ch.onHint!({ id: ID[0], v: 20 + k }));
    await advance(CV_GATHER_MS);
    expect(rpc.fetchCardState).toHaveBeenCalledTimes(1);
  });

  it("ticks after the deadline, in seat order, spectators later; a new state cancels the pending tick", async () => {
    rpc.fetchCardState.mockResolvedValue(state({ deadline: new Date(Date.parse(T0) + 2000).toISOString() }));
    rpc.tickCardTable.mockResolvedValue({ changed: true, state: state({ v: 11, deadline: new Date(Date.parse(T0) + 60_000).toISOString() }) });
    mount();
    await flush();
    const at = 2000 + TICK_LAG_MS + TICK_STEP_MS * 1; // I sit in seat 2: index 1
    await advance(at - 1);
    expect(rpc.tickCardTable).not.toHaveBeenCalled();
    await advance(1);
    expect(rpc.tickCardTable).toHaveBeenCalledWith("r", "tok", "tienlen");
    expect(ch.sent).toEqual([{ id: ME, v: 11 }]);
    // a spectator waits 3 s more
    cleanup();
    rpc.tickCardTable.mockClear();
    vi.setSystemTime(Date.parse(T0));
    rpc.fetchCardState.mockResolvedValue(state({ deadline: new Date(Date.parse(T0) + 2000).toISOString() }));
    mount({ accountId: ID[5] });
    await flush();
    await advance(2000 + TICK_LAG_MS + SPECTATOR_LAG_MS - 1);
    expect(rpc.tickCardTable).not.toHaveBeenCalled();
    await advance(1);
    expect(rpc.tickCardTable).toHaveBeenCalledTimes(1);
  });

  it("sends a tick that found nothing due again a second later; a newer state moves the schedule", async () => {
    const due = new Date(Date.parse(T0) + 1000).toISOString();
    rpc.fetchCardState.mockResolvedValue(state({ deadline: due }));
    // the answer carries the server's time when it was made (the clock follows it)
    rpc.tickCardTable.mockImplementation(async () => ({
      changed: false, state: state({ deadline: due, server_now: new Date(Date.now()).toISOString() }),
    }));
    const { result } = mount({ accountId: ID[0] });
    await flush();
    await advance(1000 + TICK_LAG_MS);
    expect(rpc.tickCardTable).toHaveBeenCalledTimes(1);
    await advance(TICK_RETRY_MS - 1);
    expect(rpc.tickCardTable).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(rpc.tickCardTable).toHaveBeenCalledTimes(2);
    expect(ch.sent).toEqual([]);
    rpc.fetchCardState.mockResolvedValueOnce(state({ v: 12, deadline: new Date(Date.parse(T0) + 30_000).toISOString() }));
    await act(async () => { await result.current.refetch(); });
    await advance(5000);
    expect(rpc.tickCardTable).toHaveBeenCalledTimes(2);
  });

  it("polls every 15 s while nothing arrives", async () => {
    mount();
    await flush();
    rpc.fetchCardState.mockClear();
    await advance(CARD_POLL_MS - 1);
    expect(rpc.fetchCardState).not.toHaveBeenCalled();
    await advance(1);
    expect(rpc.fetchCardState).toHaveBeenCalledTimes(1);
    await advance(CARD_POLL_MS);
    expect(rpc.fetchCardState).toHaveBeenCalledTimes(2);
  });

  it("applies an action's answer, hints the others and reports my coins; a refusal toasts and refetches, `stale` ticks", async () => {
    const onError = vi.fn(), onCoins = vi.fn();
    const { result } = mount({ onError, onCoins });
    await flush();
    rpc.cardAction.mockResolvedValueOnce({ changed: true, state: state({ v: 15, deadline: null }), hand: hand(3, cs("4D")), coins: 7000 });
    await act(async () => { await result.current.act({ kind: "tl_play", seq: 5, cards: cs("3S") }); });
    expect(rpc.cardAction).toHaveBeenCalledWith("r", "tok", "tienlen", { kind: "tl_play", seq: 5, cards: cs("3S") });
    expect(result.current.state?.v).toBe(15);
    expect(result.current.hand?.cards).toEqual(cs("4D"));
    expect(ch.sent).toEqual([{ id: ME, v: 15 }]);
    expect(onCoins).toHaveBeenCalledWith(7000);

    rpc.fetchCardState.mockClear();
    rpc.cardAction.mockRejectedValueOnce({ message: "cannot beat" });
    await act(async () => { expect(await result.current.act({ kind: "tl_play", seq: 6, cards: cs("4D") })).toBeNull(); });
    expect(onError).toHaveBeenLastCalledWith("Bài này không chặn được.");
    expect(rpc.fetchCardState).toHaveBeenCalledTimes(1);

    rpc.tickCardTable.mockResolvedValueOnce({ changed: true, state: state({ v: 16, deadline: null }) });
    rpc.cardAction.mockRejectedValueOnce({ message: "stale" });
    await act(async () => { await result.current.act({ kind: "tl_pass", seq: 1 }); });
    expect(onError).toHaveBeenLastCalledWith("Bàn vừa thay đổi — xem lại nhé.");
    expect(rpc.tickCardTable).toHaveBeenCalledTimes(1);
    expect(result.current.state?.v).toBe(16);

    onError.mockClear();
    rpc.cardAction.mockRejectedValueOnce(new AnticheatError({ code: "bad_cards", strike: 1, error: "invalid cards", lockedUntil: null,
      banned: false, serverNow: null }));
    await act(async () => { await result.current.act({ kind: "tl_play", seq: 6, cards: [99] }); });
    expect(onError).not.toHaveBeenCalled();
  });

  it("keeps the newest version when answers overtake each other", async () => {
    const { result } = mount();
    await flush();
    let slow!: (s: unknown) => void;
    rpc.fetchCardState.mockReturnValueOnce(new Promise((resolve) => { slow = resolve; }));
    const pending = act(async () => { await result.current.refetch(); });
    rpc.cardAction.mockResolvedValueOnce({ changed: true, state: state({ v: 30, deadline: null }), hand: hand(3), coins: null });
    await act(async () => { await result.current.act({ kind: "tl_pass", seq: 5 }); });
    slow(state({ v: 20, deadline: null }));
    await pending;
    expect(result.current.state?.v).toBe(30);
  });
});
