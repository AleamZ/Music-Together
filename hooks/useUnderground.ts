import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fightErrorMessage } from "@/lib/game/fight/messages";
import { ServerClock } from "@/lib/game/fight/referee";
import { UG_CALLED_POLL_MS, UG_POLL_MS } from "@/lib/game/fight/underground";
import {
  ugBoard, ugCupJoin, ugCupLeave, ugEnter, ugLadderStart, ugQueueJoin, ugQueueLeave, ugReady, ugStatus, type UgBoard, type UgCup, type UgMine, type UgState,
} from "@/lib/game/fight/ug-rpc";
import { CAGE_WATCH_IDS } from "@/lib/game/maps/ham-ngam";
import type { MapId } from "@/lib/game/maps/types";

/** The open or running cup I am still in (not knocked out). */
export const myCup = (s: UgState | null, accountId: string): UgCup | null =>
  (s?.cups ?? []).find((c) => (c.status === "open" || c.status === "running") && c.entries.some((e) => e.id === accountId && e.placed === null)) ?? null;

/** A called PvP match of mine that has not started yet (both not ready). */
export const isCalled = (s: UgState | null): boolean => !!s?.mine && s.mine.kind !== "ug_ladder" && s.mine.ready !== 3;

/** v20.4 the underground for GameShell (spec §v20.4, plan rulings U2, U13, U16): ug_status on reaching Chợ Lớn (is the
 *  hatch mine to see?) and in the hầm (every 5 s; every second while a match of mine is called; also while queued or
 *  signed up anywhere), the actions (each answered with the whole state; a refusal is an answer, toasted), the board,
 *  and which interactables stay hidden: the hatch for the locked, the cage's watch spots while nothing is live. Before
 *  0052 (or on an error) it stays locked. */
export function useUnderground({ token, roomId, accountId, mapId, toast, onCoins }: {
  token: string | null;
  roomId: string;
  accountId: string;
  mapId: MapId;
  toast: (text: string) => void;
  onCoins?: () => void;
}) {
  const [state, setState] = useState<UgState | null>(null);
  const [board, setBoard] = useState<UgBoard | null>(null);
  const [busy, setBusy] = useState(false);
  /** The match of mine being fought (a ladder match, or a PvP match once both are ready), kept until its result closes. */
  const [active, setActive] = useState<(UgMine & { resumed: boolean }) | null>(null);
  const [clock] = useState(() => new ServerClock());
  const seq = useRef(0);
  const here = mapId === "ham_ngam";
  const onMarket = mapId === "market";

  const take = useCallback((s: UgState, sentAt: number, receivedAt: number) => {
    clock.sample(s.serverNowMs, sentAt, receivedAt);
    setState(s);
    const m = s.match && (s.match.kind === "ug_ladder" || s.match.ready === 3) ? s.match : s.mine;
    // kept as is: a new object would restart the fight; learned from a poll (not an action's answer) it is resumed from
    // fight_state, as after a reload
    if (m && (m.kind === "ug_ladder" || m.ready === 3)) setActive((a) => a ?? { ...m, resumed: m !== s.match });
  }, [clock]);

  const reload = useCallback(async () => {
    if (!token) return null;
    const mine = ++seq.current;
    try {
      const r = await ugStatus(roomId, token);
      if (mine === seq.current) take(r.value, r.sentAt, r.receivedAt);
      return r.value;
    } catch {
      return null;
    }
  }, [token, roomId, take]);

  // on reaching Chợ Lớn or the hầm
  useEffect(() => {
    if (!token || (!here && !onMarket)) return;
    const id = window.setTimeout(() => void reload(), 0);
    return () => window.clearTimeout(id);
  }, [here, onMarket, token, reload]);
  // the polls: in the hầm, or wherever I wait for a match (queued, signed up, called)
  const called = isCalled(state);
  const waiting = !!state?.queue || !!state?.mine || !!myCup(state, accountId);
  useEffect(() => {
    if (!token || !state?.unlocked || (!here && !waiting)) return;
    const id = window.setInterval(() => void reload(), called ? UG_CALLED_POLL_MS : UG_POLL_MS);
    return () => window.clearInterval(id);
  }, [token, state?.unlocked, here, waiting, called, reload]);

  /** Runs an action; its answer replaces the state, a refusal is toasted. Returns the answer (null on an error). */
  const act = useCallback(async (run: () => ReturnType<typeof ugStatus>, coins = true) => {
    if (!token) return null;
    setBusy(true);
    seq.current++;
    try {
      const r = await run();
      take(r.value, r.sentAt, r.receivedAt);
      if (r.value.refused) toast(fightErrorMessage(r.value.refused));
      else if (coins) onCoins?.();
      return r.value;
    } catch (e) {
      toast(fightErrorMessage(e));
      return null;
    } finally {
      setBusy(false);
    }
  }, [token, take, toast, onCoins]);

  const enter = useCallback(async (): Promise<boolean> => (await act(() => ugEnter(roomId, token!), false))?.unlocked === true, [act, roomId, token]);
  const queueJoin = useCallback((tier: number) => act(() => ugQueueJoin(roomId, token!, tier)), [act, roomId, token]);
  const queueLeave = useCallback(() => act(() => ugQueueLeave(roomId, token!)), [act, roomId, token]);
  const ready = useCallback((match: string, n: number) => act(() => ugReady(roomId, token!, match, n), false), [act, roomId, token]);
  const ladderStart = useCallback((floor: number) => act(() => ugLadderStart(roomId, token!, floor)), [act, roomId, token]);
  const cupJoin = useCallback((tier: number) => act(() => ugCupJoin(roomId, token!, tier)), [act, roomId, token]);
  const cupLeave = useCallback(() => act(() => ugCupLeave(roomId, token!)), [act, roomId, token]);
  const loadBoard = useCallback(async () => {
    if (!token) return;
    try {
      setBoard((await ugBoard(roomId, token)).value);
    } catch (e) {
      toast(fightErrorMessage(e));
    }
  }, [token, roomId, toast]);

  /** The interactables the world hides: the hatch unless unlocked (U16), the cage's watch spots while nothing is live. */
  const unlocked = state?.unlocked === true;
  const liveNow = (state?.live ?? []).some((m) => m.ready === 3);
  const hidden = useMemo((): string[] => [
    ...(unlocked ? [] : ["ug_hatch"]),
    ...(liveNow ? [] : CAGE_WATCH_IDS),
  ], [unlocked, liveNow]);

  /** A match of mine ended (its result shown): back to the panel. */
  const finish = useCallback(() => {
    setActive(null);
    void reload();
  }, [reload]);

  return { state, board, busy, active, clock, hidden, reload, enter, queueJoin, queueLeave, ready, ladderStart, cupJoin, cupLeave, loadBoard, finish };
}

export type UndergroundHook = ReturnType<typeof useUnderground>;
