"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnticheatError } from "@/lib/anticheat";
import { joinCardChannel, type CardChannelHandle } from "@/lib/game/cards/channel";
import type { CardGame } from "@/lib/game/cards/deck";
import { cardErrorMessage, isMissingRpc } from "@/lib/game/cards/messages";
import { cardAction, fetchCardHand, fetchCardState, tickCardTable, type CardAction } from "@/lib/game/cards/rpc";
import { mySeat, type CardAnswer, type CardHand, type CardState } from "@/lib/game/cards/state";
import { serverNow, syncClock } from "@/lib/game/farm/clock";
import { CARD_LIMITS, createBudget } from "@/lib/game/net/budget";

/** Hints arriving this close together are answered by one card_state (spec §12, R26). */
export const CV_GATHER_MS = 150;
/** Refetches for hints start at least this far apart; a hint inside the gap brings one trailing refetch. */
export const CV_MIN_GAP_MS = 500;
/** While no hint arrives the table is fetched this often (a lost hint costs at most this). */
export const CARD_POLL_MS = 15_000;
/** A seated client ticks at deadline + TICK_LAG_MS + TICK_STEP_MS × its index among the seated players (§10). */
export const TICK_LAG_MS = 300;
export const TICK_STEP_MS = 200;
/** Spectators tick this much later still. */
export const SPECTATOR_LAG_MS = 3000;
/** A tick that found nothing due (the clocks disagree a little) goes again this much later. */
export const TICK_RETRY_MS = 1000;

/** The room and the session a call is made for. */
interface Where { roomId: string; token: string }

export interface CardTableOptions {
  roomId: string;
  token: string;
  accountId: string;
  /** The table; null = none (the hook idles). */
  game: CardGame | null;
  /** The panel is open on it, or I sit at it: fetch it, subscribe to its hints, poll and tick. */
  active: boolean;
  /** Is this account a room member? Hints from anyone else are dropped. */
  isMember: (accountId: string) => boolean;
  /** An action's refusal, in Vietnamese. */
  onError: (text: string) => void;
  /** My wallet after an action. */
  onCoins?: (coins: number) => void;
  /** Every state applied (the controller follows where I sit). */
  onState?: (game: CardGame, state: CardState) => void;
}

export interface CardTable {
  game: CardGame | null;
  /** The table as card_state shows it (the same for every viewer); null before the first answer. */
  state: CardState | null;
  /** My cards in the table's current hand (card_hand and my own answers); null when I hold none. */
  hand: CardHand | null;
  failed: boolean;
  /** Migration 0017 is not run. */
  notOpen: boolean;
  /** An action is in flight. */
  busy: boolean;
  refetch: () => Promise<void>;
  tick: () => Promise<void>;
  /** A card write; its answer replaces the state and my hand, and the others get a hint. On error: toast, refetch (a
   *  `stale` refusal ticks instead: its sweep was rolled back with it), null. */
  act: (a: CardAction) => Promise<CardAnswer | null>;
}

/** One card table (spec §13.1): its state and my hand, the channel's hints (gathered, gapped and budgeted), the 15 s
 *  poll and the lazy timers' ticks. */
export function useCardTable({ roomId, token, accountId, game, active, isMember, onError, onCoins, onState }: CardTableOptions): CardTable {
  const [data, setData] = useState<{ game: CardGame | null; state: CardState | null; hand: CardHand | null }>(
    { game: null, state: null, hand: null });
  const [failed, setFailed] = useState(false);
  const [notOpen, setNotOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Bumped after every fetch or tick, so the poll and the tick schedule re-arm. */
  const [pulse, setPulse] = useState(0);
  const live = useRef({ roomId, token, accountId, game, isMember, onError, onCoins, onState });
  useEffect(() => {
    live.current = { roomId, token, accountId, game, isMember, onError, onCoins, onState };
  });

  /** The version applied last (answers may overtake each other), the call that brought the hand, the hand number
   *  fetched last, and the state applied last (for an error's `must`). */
  const appliedV = useRef(-1);
  const callNo = useRef(0);
  const handAt = useRef(0);
  const handNo = useRef<number | null>(null);
  const lastState = useRef<CardState | null>(null);
  const channel = useRef<CardChannelHandle | null>(null);

  /** Where a call is made (the room and the session): its answer applies only while the hook still serves them. A
   *  room change remounts the page today; this keeps an in-place switch safe. */
  const where = useCallback((): Where => ({ roomId: live.current.roomId, token: live.current.token }), []);
  const still = useCallback((w: Where) => w.roomId === live.current.roomId && w.token === live.current.token, []);

  const loadHand = useCallback(async (g: CardGame) => {
    const n = ++callNo.current;
    const w = where();
    try {
      const h = await fetchCardHand(w.roomId, w.token, g);
      if (!still(w) || live.current.game !== g || n < handAt.current) return;
      handAt.current = n;
      handNo.current = h.handNo;
      setData((d) => (d.game === g ? { ...d, hand: h.cards.length > 0 ? h : null } : d));
    } catch {
      if (still(w)) handNo.current = null; // the next state tries again
    }
  }, [where, still]);

  /** Apply a state (and the hand that came with it): only the newest version, only for the table I still watch. A new
   *  hand number fetches my cards once while I sit at the table. */
  const apply = useCallback((g: CardGame, s: CardState, n: number, hand?: CardHand | null) => {
    syncClock(s.serverNow);
    if (live.current.game !== g || s.v < appliedV.current) return;
    appliedV.current = s.v;
    lastState.current = s;
    const seat = mySeat(s, live.current.accountId);
    const sitting = seat !== null && !seat.leaving;
    let fresh: CardHand | null | undefined;
    if (hand !== undefined && n >= handAt.current) {
      handAt.current = n;
      handNo.current = hand?.handNo ?? s.handNo;
      fresh = hand && hand.cards.length > 0 ? hand : null;
    }
    setData((d) => {
      let h = fresh !== undefined ? fresh : d.game === g ? d.hand : null;
      if (!sitting || (h && h.handNo !== s.handNo)) h = null;
      return { game: g, state: s, hand: h };
    });
    setFailed(false);
    setNotOpen(false);
    live.current.onState?.(g, s);
    if (sitting && fresh === undefined && handNo.current !== s.handNo) {
      handNo.current = s.handNo;
      void loadHand(g);
    }
  }, [loadHand]);

  const refetch = useCallback(async () => {
    const g = live.current.game;
    if (!g) return;
    const n = ++callNo.current;
    const w = where();
    try {
      const s = await fetchCardState(w.roomId, w.token, g);
      if (still(w)) apply(g, s, n);
    } catch (err) {
      if (!still(w)) return;
      if (isMissingRpc(err)) setNotOpen(true);
      else setFailed(true);
    } finally {
      setPulse((p) => p + 1);
    }
  }, [apply, where, still]);

  const tick = useCallback(async () => {
    const g = live.current.game;
    if (!g) return;
    const n = ++callNo.current;
    const w = where();
    try {
      const r = await tickCardTable(w.roomId, w.token, g);
      if (!still(w)) return;
      apply(g, r.state, n);
      if (r.changed) channel.current?.send({ id: live.current.accountId, v: r.state.v });
    } catch (err) {
      if (still(w) && isMissingRpc(err)) setNotOpen(true);
    } finally {
      setPulse((p) => p + 1);
    }
  }, [apply, where, still]);

  const act = useCallback(async (a: CardAction): Promise<CardAnswer | null> => {
    const g = live.current.game;
    if (!g) return null;
    const n = ++callNo.current;
    const w = where();
    setBusy(true);
    try {
      const r = await cardAction(w.roomId, w.token, g, a);
      if (!still(w)) return null;
      apply(g, r.state, n, r.hand);
      if (r.changed) channel.current?.send({ id: live.current.accountId, v: r.state.v });
      if (r.coins !== null) live.current.onCoins?.(r.coins);
      return r;
    } catch (err) {
      if (!still(w)) return null;
      const s = lastState.current;
      const must = s?.game === "tienlen" ? s.pub?.must ?? null : null;
      // a strike shows the anti-cheat warning or ban instead (anti-cheat §12.1)
      if (!(err instanceof AnticheatError && err.info.strike >= 1)) live.current.onError(cardErrorMessage(err, must));
      if (isMissingRpc(err)) setNotOpen(true);
      const msg = err && typeof err === "object" ? (err as { message?: unknown }).message : null;
      void (msg === "stale" ? tick() : refetch());
      return null;
    } finally {
      setBusy(false);
    }
  }, [apply, refetch, tick, where, still]);

  // --- the channel: hints from members, newer than what I show, within the sender's budget; gathered, then gapped
  const gather = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hintAt = useRef<number | null>(null);
  useEffect(() => {
    if (!active || !game) return;
    appliedV.current = -1;
    handAt.current = 0;
    handNo.current = null;
    lastState.current = null;
    const budget = createBudget(CARD_LIMITS);
    const hinted = () => {
      if (gather.current) return;
      const gap = hintAt.current === null ? 0 : hintAt.current + CV_MIN_GAP_MS - Date.now();
      gather.current = setTimeout(() => {
        gather.current = null;
        hintAt.current = Date.now();
        void refetch();
      }, Math.max(CV_GATHER_MS, gap));
    };
    const ch = joinCardChannel(roomId, game, (h) => {
      if (!live.current.isMember(h.id) || h.v <= appliedV.current) return;
      if (!budget.take(h.id, "cv", performance.now())) return;
      hinted();
    });
    channel.current = ch;
    const first = setTimeout(() => void refetch(), 0);
    return () => {
      clearTimeout(first);
      if (gather.current) clearTimeout(gather.current);
      gather.current = null;
      hintAt.current = null;
      channel.current = null;
      ch.leave();
    };
  }, [active, game, roomId, refetch]);

  const state = data.game === game ? data.state : null;
  const hand = data.game === game ? data.hand : null;

  // --- the poll: every 15 s while nothing else fetched the table
  useEffect(() => {
    if (!active || !game) return;
    const t = setTimeout(() => void refetch(), CARD_POLL_MS);
    return () => clearTimeout(t);
  }, [active, game, pulse, state, refetch]);

  // --- the lazy timers (§10): a tick after the deadline, seated players in seat order, spectators later; a new state
  //     cancels it, and a tick that found nothing due goes again a second later
  const deadline = state?.deadline ?? null;
  const v = state?.v ?? -1;
  const sitting = state ? state.seats.filter((s) => !s.leaving) : [];
  const index = sitting.findIndex((s) => s.id === accountId);
  const tickedFor = useRef<number | null>(null);
  useEffect(() => {
    if (!active || !game || deadline === null) return;
    const lag = index >= 0 ? TICK_LAG_MS + TICK_STEP_MS * index : TICK_LAG_MS + SPECTATOR_LAG_MS;
    let delay = deadline - serverNow() + lag;
    if (tickedFor.current === deadline) delay = Math.max(delay, TICK_RETRY_MS);
    const t = setTimeout(() => {
      tickedFor.current = deadline;
      void tick();
    }, Math.max(0, delay));
    return () => clearTimeout(t);
  }, [active, game, deadline, v, index, pulse, tick]);

  return { game, state, hand, failed, notOpen, busy, refetch, tick, act };
}
