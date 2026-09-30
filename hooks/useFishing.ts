"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnticheatError, reportLock, reportNoLock } from "@/lib/anticheat";
import { syncClock } from "@/lib/game/farm/clock";
import type { NpcQuota } from "@/lib/game/economy/npc";
import type { FishingCatalog } from "@/lib/game/fishing/catalog";
import {
  buyItem, claimDaily, digWorms, fetchFishingCatalog, fetchFishingState, fetchNotebook, finishCast, finishNet, fishingEquip, fishingErrorMessage,
  hookCast, netHaul, releaseFish, repairRod, sellFish, setLoadout, startCast, startNet, throwGroundbait, type FinishCast, type FinishNet,
  type GroundbaitSpot, type HookCast, type Notebook, type ReelInput, type NetHaul, type NetPull, type NetThrow, type StartCast, type StartNet,
} from "@/lib/game/fishing/rpc";
import type { FishingState, GearSlot, Loadout } from "@/lib/game/fishing/state";
import { extrasErrorMessage, startBoatCast } from "@/lib/game/fishing/extras-rpc";
import { startRiverCast } from "@/lib/game/river/rpc";

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
  /** 0110: mount (`item`) or unmount (null) one slot of the rig. */
  equipSlot: (slot: GearSlot, item: string | null) => Promise<boolean>;
  /** 0110: one bag of groundbait on a spot (the pond cell, or the river in world px). */
  throwGroundbait: (roomId: string, item: string, spot: GroundbaitSpot) => Promise<boolean>;
  /** 0110: Sổ tay câu cá (null: not bought, or an error — the toast says which). */
  notebook: () => Promise<Notebook | null>;
  /** `market` (v18.5): sold at Vựa cá Chợ Lớn, +10% (econ v2). `npcCut` (0101): what the thương lái kept back. */
  sell: (ids: string[], market?: boolean) => Promise<{ sold: number; earned: number; npcCut: number } | null>;
  /** econ v2 (0101): the thương lái's day as the last sale (or learnNpc) told it; null until then. */
  npc: NpcQuota | null;
  /** econ v2: the last sale's pay and cut (a new object per sale), for the depot's note; null until then. */
  lastSale: { earned: number; cut: number } | null;
  /** econ v2: the thương lái's day from elsewhere (the records board) — the depot asks when it opens without one. */
  learnNpc: (q: NpcQuota | null) => void;
  release: (id: string) => Promise<boolean>;
  /** `cell` (v18.1): the pond cell the cast starts from. */
  startCast: (roomId: string, cell?: { col: number; row: number }) => Promise<StartCast | null>;
  /** v21 (0076): a cast from the boat's deck (the deep water); it goes on through hookCast / finishCast. */
  startBoatCast: (roomId: string) => Promise<StartCast | null>;
  /** v22 (0086): a cast from the boat on Sông Cái, where it floats. */
  startRiverCast: (roomId: string, at: { x: number; y: number; map?: "song_cai" | "wild" }) => Promise<StartCast | null>;
  /** `hooked` (v18.1): the reel was lost after the hook (a big fish may pull me in). */
  /** `reel` (0046): the reel's input, replayed by the server. */
  finishCast: (castId: string, success: boolean, hooked?: boolean, reel?: ReelInput) => Promise<FinishCast | null>;
  /** 0059: the server-timed hook; its answer carries the reel's seed. */
  hookCast: (castId: string) => Promise<HookCast | null>;
  /** v18.2 Sửa cần. */
  repair: (itemId: string) => Promise<{ cost: number } | null>;
  /** v18.2: open a net throw at a pond cell (0056: when the aim starts); the server replays the throw and kéo lưới. */
  startNet: (roomId: string, cell: { col: number; row: number }, net: string) => Promise<StartNet | null>;
  netHaul: (throwId: string, input: NetThrow) => Promise<NetHaul | null>;
  finishNet: (throwId: string, pull: NetPull) => Promise<FinishNet | null>;
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
  const [npc, setNpc] = useState<NpcQuota | null>(null);                                  // econ v2 (0101)
  const [lastSale, setLastSale] = useState<{ earned: number; cut: number } | null>(null);
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
    state, failed, catalog, reload, npc, lastSale,
    learnNpc: useCallback((q: NpcQuota | null) => { if (q) setNpc(q); }, []),
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
    equipSlot: useCallback(async (slot: GearSlot, item: string | null) =>
      (await act(() => fishingEquip(token, slot, item), (s) => s)) !== null, [act, token]),                        // 0110
    throwGroundbait: useCallback(async (roomId: string, item: string, spot: GroundbaitSpot) =>
      (await act(() => throwGroundbait(roomId, token, item, spot), (s) => s)) !== null, [act, token]),             // 0110
    notebook: useCallback(async () => {
      try {
        return await fetchNotebook(token);
      } catch (err) {
        onErrorRef.current(fishingErrorMessage(err));
        return null;
      }
    }, [token]),
    sell: useCallback(async (ids: string[], market = false) => {
      const r = await act(() => sellFish(token, ids, market), (x) => x.state);
      if (r) {                                                                            // econ v2 (0101): the thương lái
        if (r.npc) setNpc(r.npc);
        setLastSale({ earned: r.earned, cut: r.npcCut });
      }
      return r && { sold: r.sold, earned: r.earned, npcCut: r.npcCut };
    }, [act, token]),
    release: useCallback(async (id: string) => (await act(() => releaseFish(token, id), (s) => s)) !== null, [act, token]),
    startCast: useCallback((roomId: string, cell?: { col: number; row: number }) => act(() => startCast(roomId, token, cell), (x) => x.state), [act, token]),
    startBoatCast: useCallback((roomId: string) => act(() => startBoatCast(roomId, token), (x) => x.state), [act, token]),   // v21 (0076)
    startRiverCast: useCallback((roomId: string, at: { x: number; y: number; map?: "song_cai" | "wild" }) => act(() => startRiverCast(roomId, token, at.x, at.y, at.map), (x) => x.state, extrasErrorMessage), [act, token]),   // v22 (0086)
    finishCast: useCallback((castId: string, success: boolean, hooked = false, reel?: ReelInput) => act(() => finishCast(token, castId, success, hooked, reel), (x) => x.state, lostConnection), [act, token]),
    hookCast: useCallback((castId: string) => act(() => hookCast(token, castId), (x) => x.state, lostConnection), [act, token]),
    repair: useCallback(async (itemId: string) => {
      const r = await act(() => repairRod(token, itemId), (x) => x.state);
      return r && { cost: r.cost };
    }, [act, token]),
    startNet: useCallback((roomId: string, cell: { col: number; row: number }, net: string) => act(() => startNet(roomId, token, cell, net), (x) => x.state), [act, token]),
    netHaul: useCallback((throwId: string, input: NetThrow) => act(() => netHaul(token, throwId, input), (x) => x.state, lostConnection), [act, token]),
    finishNet: useCallback((throwId: string, pull: NetPull) => act(() => finishNet(token, throwId, pull), (x) => x.state, lostConnection), [act, token]),
  };
}
