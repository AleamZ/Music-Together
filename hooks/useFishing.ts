"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnticheatError, reportLock, reportNoLock } from "@/lib/anticheat";
import { syncClock } from "@/lib/game/farm/clock";
import type { FishingCatalog } from "@/lib/game/fishing/catalog";
import {
  buyItem, claimDaily, digWorms, fetchFishingCatalog, fetchFishingState, finishCast, finishNet, fishingErrorMessage, netHaul, releaseFish,
  repairRod, sellFish, setLoadout, startCast, startNet, type FinishCast, type FinishNet, type NetHaul, type StartCast, type StartNet,
} from "@/lib/game/fishing/rpc";
import type { FishingState, Loadout } from "@/lib/game/fishing/state";

export interface FishingData {
  /** null until the first fishing_state answer. */
  state: FishingState | null;
  /** fishing_state failed: the HUD shows "—" and offers "Tải lại giỏ đồ". */
  failed: boolean;
  catalog: FishingCatalog | null;
  /** Fetches the state again, and the catalog too while it has not loaded. */
  reload: () => Promise<FishingState | null>;
  claimDaily: () => Promise<{ claimed: boolean; amount: number } | null>;
  dig: () => Promise<{ gained: number } | null>;
  buy: (itemId: string, qty: number) => Promise<boolean>;
  equip: (loadout: Loadout) => Promise<boolean>;
  /** `market` (v18.5): sold at Vựa cá Chợ Lớn, +20%. */
  sell: (ids: string[], market?: boolean) => Promise<{ sold: number; earned: number } | null>;
  release: (id: string) => Promise<boolean>;
  /** `cell` (v18.1): the pond cell the cast starts from. */
  startCast: (roomId: string, cell?: { col: number; row: number }) => Promise<StartCast | null>;
  /** `hooked` (v18.1): the reel was lost after the hook (a big fish may pull me in). */
  finishCast: (castId: string, success: boolean, hooked?: boolean) => Promise<FinishCast | null>;
  /** v18.2 Sửa cần. */
  repair: (itemId: string) => Promise<{ cost: number } | null>;
  /** v18.2: throw a net from a pond cell; score it. */
  startNet: (roomId: string, cell: { col: number; row: number }, net: string) => Promise<StartNet | null>;
  netHaul: (throwId: string, chargeMs: number, offsets: number[]) => Promise<NetHaul | null>;
  finishNet: (throwId: string, mistakes: number) => Promise<FinishNet | null>;
}

/** A network failure while a cast ends: the fish is gone either way. */
const lostConnection = (err: unknown) => {
  const text = fishingErrorMessage(err);
  return text === "Có lỗi, thử lại nhé." ? "Mất kết nối — cá đã thoát." : text;
};

/** The account's fishing state (spec §8.2) and the RPCs that change it. Every answer carries the full state, which
 *  replaces ours; after an error the toast shows the Vietnamese text and the state is fetched again (§8.6). */
export function useFishing(token: string, onError: (text: string) => void): FishingData {
  const [state, setState] = useState<FishingState | null>(null);
  const [failed, setFailed] = useState(false);
  const [catalog, setCatalog] = useState<FishingCatalog | null>(null);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  });
  // Answers can overtake each other: only an answer to a call started after the last applied one may replace the state.
  const seq = useRef(0);
  const applied = useRef(0);
  const apply = useCallback((n: number, s: FishingState) => {
    syncClock(s.serverNow);
    if (n < applied.current) return;
    applied.current = n;
    // a lock that runs brings the chip back, after a reload too (anti-cheat R14); a state without one ends the chip,
    // which a pardon or a switch to log mode may have left counting
    if (s.lock) reportLock(Date.parse(s.lock.until), s.lock.code);
    else reportNoLock();
    setState(s);
    setFailed(false);
  }, []);

  // The catalog is read with the first state, and by every later reload until it has loaded. A failure stays silent:
  // the bag and the shop show their loading text meanwhile.
  const active = useRef(false);
  const catalogLoaded = useRef(false);
  const loadCatalog = useCallback(() => {
    fetchFishingCatalog().then((c) => {
      if (!active.current) return;
      catalogLoaded.current = true;
      setCatalog(c);
    }).catch(() => {});
  }, []);

  const reload = useCallback(async () => {
    if (!catalogLoaded.current) loadCatalog();
    const n = ++seq.current;
    try {
      const s = await fetchFishingState(token);
      apply(n, s);
      return s;
    } catch {
      if (n >= applied.current) setFailed(true);
      return null;
    }
  }, [token, apply, loadCatalog]);

  useEffect(() => {
    active.current = true;
    const first = setTimeout(() => void reload(), 0);
    return () => {
      active.current = false;
      clearTimeout(first);
    };
  }, [reload]);

  /** Run an RPC; its state replaces ours. On error: toast, refetch, null. A strike shows no toast: the warning or the ban
   *  modal shows instead (anti-cheat §12.1). */
  const act = useCallback(async <T,>(call: () => Promise<T>, stateOf: (r: T) => FishingState, errorText = fishingErrorMessage): Promise<T | null> => {
    const n = ++seq.current;
    try {
      const r = await call();
      apply(n, stateOf(r));
      return r;
    } catch (err) {
      if (!(err instanceof AnticheatError && err.info.strike >= 1)) onErrorRef.current(errorText(err));
      void reload();
      return null;
    }
  }, [apply, reload]);

  return {
    state, failed, catalog, reload,
    claimDaily: useCallback(async () => {
      const r = await act(() => claimDaily(token), (x) => x.state);
      return r && { claimed: r.claimed, amount: r.amount };
    }, [act, token]),
    dig: useCallback(async () => {
      const r = await act(() => digWorms(token), (x) => x.state);
      return r && { gained: r.gained };
    }, [act, token]),
    buy: useCallback(async (itemId: string, qty: number) => (await act(() => buyItem(token, itemId, qty), (s) => s)) !== null, [act, token]),
    equip: useCallback(async (l: Loadout) => (await act(() => setLoadout(token, l), (s) => s)) !== null, [act, token]),
    sell: useCallback(async (ids: string[], market = false) => {
      const r = await act(() => sellFish(token, ids, market), (x) => x.state);
      return r && { sold: r.sold, earned: r.earned };
    }, [act, token]),
    release: useCallback(async (id: string) => (await act(() => releaseFish(token, id), (s) => s)) !== null, [act, token]),
    startCast: useCallback((roomId: string, cell?: { col: number; row: number }) => act(() => startCast(roomId, token, cell), (x) => x.state), [act, token]),
    finishCast: useCallback((castId: string, success: boolean, hooked = false) => act(() => finishCast(token, castId, success, hooked), (x) => x.state, lostConnection), [act, token]),
    repair: useCallback(async (itemId: string) => {
      const r = await act(() => repairRod(token, itemId), (x) => x.state);
      return r && { cost: r.cost };
    }, [act, token]),
    startNet: useCallback((roomId: string, cell: { col: number; row: number }, net: string) => act(() => startNet(roomId, token, cell, net), (x) => x.state), [act, token]),
    netHaul: useCallback((throwId: string, chargeMs: number, offsets: number[]) => act(() => netHaul(token, throwId, chargeMs, offsets), (x) => x.state, lostConnection), [act, token]),
    finishNet: useCallback((throwId: string, mistakes: number) => act(() => finishNet(token, throwId, mistakes), (x) => x.state, lostConnection), [act, token]),
  };
}
