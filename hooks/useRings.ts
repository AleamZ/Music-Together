import { useCallback, useEffect, useRef, useState } from "react";
import { fightErrorMessage, ringRefusalText } from "@/lib/game/fight/messages";
import { ServerClock } from "@/lib/game/fight/referee";
import {
  RING_HINT_DELAY_MS, RING_POLL_MS, anyOccupied, myCorner, ringLabel, type RingFighter, type RingState, type StartedMatch,
} from "@/lib/game/fight/rings";
import { ringAccept, ringLeave, ringOffer, ringState, ringTake } from "@/lib/game/fight/rpc";
import type { MapId } from "@/lib/game/maps/types";

export interface RingsCanvas {
  setRingLabels(labels: ReadonlyArray<string | null>): void;
  ringChanged(r: number, v: number): void;
}

/** A live ring match I fight in (from ring_accept, or ring_state's `mine` after a reload: `resumed`). */
export interface ActiveMatch extends StartedMatch { ring: number; roomId: string; foe: RingFighter | null; resumed: boolean }

/** v20.3 Bãi đất trống's rings for GameShell: ring_state on entering the map, 150 ms after an `rg` hint, every 5 s while a
 *  ring is occupied (every 2 s while I stand in a corner); the labels over the rings; my corner and my live match; the
 *  ring actions (each answered with the room's rings; a refusal is an answer, toasted); my corner is left when I walk
 *  off the map. Before 0051 (or on an error) it stays empty. */
export function useRings({ token, roomId, accountId, mapId, canvas, toast }: {
  token: string | null;
  roomId: string;
  accountId: string;
  mapId: MapId;
  canvas: () => RingsCanvas | null;
  toast: (text: string) => void;
}) {
  const [state, setState] = useState<RingState | null>(null);
  const [active, setActive] = useState<ActiveMatch | null>(null);
  const [busy, setBusy] = useState(false);
  const [clock] = useState(() => new ServerClock());
  const seq = useRef(0);
  const here = mapId === "bai_dat";

  const take = useCallback((s: RingState, sentAt: number, receivedAt: number, notify?: number) => {
    clock.sample(s.serverNowMs, sentAt, receivedAt);
    setState(s);
    if (s.match) {
      const ring = notify ?? myCorner(s, accountId)?.ring ?? 1;
      const view = s.rings.find((r) => r.ring === ring);
      const foe = (s.match.side === 1 ? view?.blue : view?.red) ?? null;
      setActive((a) => a ?? { ...s.match!, ring, roomId, foe, resumed: false });
    } else if (s.mine && s.mine.roomId === roomId) setActive((a) => a ?? { ...s.mine!, roomId, resumed: true });
    if (notify !== undefined) {
      const v = s.rings.find((r) => r.ring === notify)?.v ?? 0;
      canvas()?.ringChanged(notify, v);
    }
  }, [clock, accountId, roomId, canvas]);

  const reload = useCallback(async () => {
    if (!token) return null;
    const mine = ++seq.current;
    try {
      const r = await ringState(roomId, token);
      if (mine === seq.current) take(r.value, r.sentAt, r.receivedAt);
      return r.value;
    } catch {
      return null;
    }
  }, [token, roomId, take]);

  // the labels over the rings
  useEffect(() => {
    canvas()?.setRingLabels(here && state ? state.rings.map(ringLabel) : []);
  }, [state, here, canvas]);

  // fetch on entering the map; poll while something is going on
  const corner = myCorner(state, accountId);
  const occupied = anyOccupied(state);
  useEffect(() => {
    if (!here || !token) return;
    const id = window.setTimeout(() => void reload(), 0);
    return () => window.clearTimeout(id);
  }, [here, token, reload]);
  useEffect(() => {
    if (!here || !token || (!occupied && !corner)) return;
    const id = window.setInterval(() => void reload(), corner ? 2000 : RING_POLL_MS);
    return () => window.clearInterval(id);
  }, [here, token, occupied, corner, reload]);

  // a hint from someone on the map: fetch a moment later (coalesced)
  const hintTimer = useRef<number | null>(null);
  const hint = useCallback(() => {
    if (!here || hintTimer.current !== null) return;
    hintTimer.current = window.setTimeout(() => {
      hintTimer.current = null;
      void reload();
    }, RING_HINT_DELAY_MS);
  }, [here, reload]);
  useEffect(() => () => {
    if (hintTimer.current !== null) window.clearTimeout(hintTimer.current);
  }, []);

  /** Runs a ring action; its answer replaces the rings, a refusal is toasted. Returns the answer (null on an error). */
  const act = useCallback(async (ring: number, run: () => ReturnType<typeof ringState>) => {
    if (!token) return null;
    setBusy(true);
    seq.current++;
    try {
      const r = await run();
      take(r.value, r.sentAt, r.receivedAt, ring);
      if (r.value.refused) toast(ringRefusalText(r.value.refused, r.value.who, myCorner(r.value, accountId)?.corner ?? null));
      return r.value;
    } catch (e) {
      toast(fightErrorMessage(e));
      return null;
    } finally {
      setBusy(false);
    }
  }, [token, take, toast, accountId]);

  const takeCorner = useCallback((ring: number, side: "red" | "blue") => act(ring, () => ringTake(roomId, token!, ring, side)), [act, roomId, token]);
  const leave = useCallback((ring: number) => act(ring, () => ringLeave(roomId, token!, ring)), [act, roomId, token]);
  const offer = useCallback((ring: number, stake: number, n: number) => act(ring, () => ringOffer(roomId, token!, ring, stake, n)), [act, roomId, token]);
  const accept = useCallback((ring: number, v: number, n: number) => act(ring, () => ringAccept(roomId, token!, ring, v, n)), [act, roomId, token]);

  // walking off the map leaves my corner (never during a match: that is absence, the claim rule applies)
  const cornerRef = useRef(corner);
  useEffect(() => { cornerRef.current = corner; }, [corner]);
  const activeRef = useRef(active);
  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => {
    if (here) return;
    const c = cornerRef.current;
    if (c && !activeRef.current && token) void ringLeave(roomId, token, c.ring).catch(() => {});
  }, [here, token, roomId]);

  /** The match ended (its result shown): the next one can start. */
  const finish = useCallback(() => {
    setActive(null);
    void reload();
  }, [reload]);

  return { state, corner, active, busy, clock, reload, hint, takeCorner, leave, offer, accept, finish };
}

export type RingsHook = ReturnType<typeof useRings>;
