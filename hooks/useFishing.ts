"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FishingCatalog } from "@/lib/game/fishing/catalog";
import {
  buyItem, claimDaily, digWorms, fetchFishingCatalog, fetchFishingState, finishCast, fishingErrorMessage, releaseFish,
  sellFish, setLoadout, startCast, type FinishCast, type StartCast,
} from "@/lib/game/fishing/rpc";
import type { FishingState, Loadout } from "@/lib/game/fishing/state";

export interface FishingData {
  /** null until the first fishing_state answer. */
  state: FishingState | null;
  /** fishing_state failed: the HUD shows "—" and offers "Tải lại giỏ đồ". */
  failed: boolean;
  catalog: FishingCatalog | null;
  reload: () => Promise<FishingState | null>;
  claimDaily: () => Promise<{ claimed: boolean; amount: number } | null>;
  dig: () => Promise<{ gained: number } | null>;
  buy: (itemId: string, qty: number) => Promise<boolean>;
  equip: (loadout: Loadout) => Promise<boolean>;
  sell: (ids: string[]) => Promise<{ sold: number; earned: number } | null>;
  release: (id: string) => Promise<boolean>;
  startCast: (roomId: string) => Promise<StartCast | null>;
  finishCast: (castId: string, success: boolean) => Promise<FinishCast | null>;
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
    if (n < applied.current) return;
    applied.current = n;
    setState(s);
    setFailed(false);
  }, []);

  const reload = useCallback(async () => {
    const n = ++seq.current;
    try {
      const s = await fetchFishingState(token);
      apply(n, s);
      return s;
    } catch {
      if (n >= applied.current) setFailed(true);
      return null;
    }
  }, [token, apply]);

  useEffect(() => {
    let active = true;
    const first = setTimeout(() => void reload(), 0);
    fetchFishingCatalog().then((c) => {
      if (active) setCatalog(c);
    }).catch(() => {});
    return () => {
      active = false;
      clearTimeout(first);
    };
  }, [reload]);

  /** Run an RPC; its state replaces ours. On error: toast, refetch, null. */
  const act = useCallback(async <T,>(call: () => Promise<T>, stateOf: (r: T) => FishingState, errorText = fishingErrorMessage): Promise<T | null> => {
    const n = ++seq.current;
    try {
      const r = await call();
      apply(n, stateOf(r));
      return r;
    } catch (err) {
      onErrorRef.current(errorText(err));
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
    sell: useCallback(async (ids: string[]) => {
      const r = await act(() => sellFish(token, ids), (x) => x.state);
      return r && { sold: r.sold, earned: r.earned };
    }, [act, token]),
    release: useCallback(async (id: string) => (await act(() => releaseFish(token, id), (s) => s)) !== null, [act, token]),
    startCast: useCallback((roomId: string) => act(() => startCast(roomId, token), (x) => x.state), [act, token]),
    finishCast: useCallback((castId: string, success: boolean) => act(() => finishCast(token, castId, success), (x) => x.state, lostConnection), [act, token]),
  };
}
