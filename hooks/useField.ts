"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnticheatError } from "@/lib/anticheat";
import type { FarmCatalog } from "@/lib/game/farm/catalog";
import { syncClock } from "@/lib/game/farm/clock";
import { farmErrorMessage, isMissingRpc } from "@/lib/game/farm/messages";
import {
  buyFarmItem, claimFarmGift, fetchFarmCatalog, fetchFieldState, fieldAction, sellRice,
  type FieldAction, type FieldAnswer, type MineAnswer,
} from "@/lib/game/farm/rpc";
import { withMine, type FarmMine, type FieldState } from "@/lib/game/farm/state";

export interface FieldData {
  /** null until the first field_state answer. */
  state: FieldState | null;
  catalog: FarmCatalog | null;
  /** field_state or the catalog failed: the panels show FIELD_FAILED with a reload button. */
  failed: boolean;
  /** Migration 0013 is not run: the field shows the NOT_OPEN banner. */
  notOpen: boolean;
  /** Fetches the field again, and the catalog too while it has not loaded. */
  reload: () => Promise<FieldState | null>;
  /** A land, farming or drying action; its answer replaces the state. On error: toast, refetch, null. */
  run: (a: FieldAction, itemName?: string) => Promise<FieldAnswer | null>;
  sellRice: (variety: string, dry: boolean, kg: number) => Promise<MineAnswer | null>;
  buyItem: (itemId: string, qty: number, itemName?: string) => Promise<MineAnswer | null>;
  claimGift: () => Promise<(MineAnswer & { gifted: boolean }) | null>;
  /** Someone changed a plot (`fp`): one refetch FP_GATHER_MS after the first of a burst. */
  plotChanged: () => void;
}

/** `fp`s arriving this close together are answered by one refetch (spec §12). */
export const FP_GATHER_MS = 400;

/** Is answer `n` newer than the last one applied? Then it becomes the last one applied. */
function newest(applied: { current: number }, n: number): boolean {
  if (n < applied.current) return false;
  applied.current = n;
  return true;
}

/** The field of this room as the server sees it (spec §11.5) and the RPCs that change it. Answers carry server_now,
 *  which sets the shared clock; after an error the toast shows the Vietnamese text and the field is fetched again. Nothing
 *  is fetched while `active` is false (I am not on the field). */
export function useField(roomId: string, token: string, active: boolean, onError: (text: string) => void): FieldData {
  const [state, setState] = useState<FieldState | null>(null);
  const [catalog, setCatalog] = useState<FarmCatalog | null>(null);
  // The panels need both the field and the catalog: either one failing offers the reload button (`failed`).
  const [fieldFailed, setFieldFailed] = useState(false);
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [notOpen, setNotOpen] = useState(false);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  });
  // Answers can overtake each other: only an answer to a call started after the last applied one is kept. The field
  // and the account part count apart: sell_rice, buy_farm_item and claim_farm_gift answer with the account part only,
  // so they must not make a field_state that is still on its way look old.
  const seq = useRef(0);
  const fieldAt = useRef(0);
  const mineAt = useRef(0);
  /** The account part of the last account-only answer applied. */
  const lastMine = useRef<FarmMine | null>(null);
  const apply = useCallback((n: number, s: FieldState) => {
    syncClock(s.serverNow);
    if (!newest(fieldAt, n)) return;
    // An account answer to a later call has landed: its account part is newer than this answer's, so it stays.
    const newer = newest(mineAt, n) ? null : lastMine.current;
    setState(newer ? withMine(s, newer) : s);
    setFieldFailed(false);
    setNotOpen(false);
  }, []);
  const applyMine = useCallback((n: number, r: MineAnswer) => {
    syncClock(r.serverNow);
    if (!newest(mineAt, n)) return;
    lastMine.current = r.mine;
    setState((s) => s && withMine(s, r.mine));
  }, []);

  const mounted = useRef(false);
  const catalogLoaded = useRef(false);
  const loadCatalog = useCallback(() => fetchFarmCatalog().then((c) => {
    if (!mounted.current) return;
    catalogLoaded.current = true;
    setCatalog(c);
    setCatalogFailed(false);
  }, () => {
    // Another reload may have loaded it meanwhile.
    if (mounted.current && !catalogLoaded.current) setCatalogFailed(true);
  }), []);

  const reload = useCallback(async () => {
    // The catalog comes along until it has loaded, so the next reload fetches a failed one again.
    const catalogDone = catalogLoaded.current ? null : loadCatalog();
    const n = ++seq.current;
    try {
      const s = await fetchFieldState(roomId, token);
      apply(n, s);
      return s;
    } catch (err) {
      if (n >= fieldAt.current) {
        if (isMissingRpc(err)) setNotOpen(true);
        else setFieldFailed(true);
      }
      return null;
    } finally {
      await catalogDone; // the reload is done when the catalog is
    }
  }, [roomId, token, apply, loadCatalog]);

  const gather = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (gather.current) clearTimeout(gather.current);
      gather.current = null;
    };
  }, []);
  useEffect(() => {
    if (!active) return;
    const first = setTimeout(() => void reload(), 0);
    return () => clearTimeout(first);
  }, [active, reload]);

  const plotChanged = useCallback(() => {
    if (gather.current) return;
    gather.current = setTimeout(() => {
      gather.current = null;
      void reload();
    }, FP_GATHER_MS);
  }, [reload]);

  /** Run an RPC and apply its answer. On error: toast, refetch, null. A strike shows no toast: the warning or the ban
   *  modal shows instead (anti-cheat §12.1). */
  const call = useCallback(async <T,>(job: () => Promise<T>, keep: (n: number, r: T) => void, itemName?: string): Promise<T | null> => {
    const n = ++seq.current;
    try {
      const r = await job();
      keep(n, r);
      return r;
    } catch (err) {
      if (isMissingRpc(err)) setNotOpen(true);
      if (!(err instanceof AnticheatError && err.info.strike >= 1)) onErrorRef.current(farmErrorMessage(err, itemName));
      void reload();
      return null;
    }
  }, [reload]);

  return {
    state, catalog, failed: fieldFailed || catalogFailed, notOpen, reload, plotChanged,
    run: useCallback((a: FieldAction, itemName?: string) =>
      call(() => fieldAction(roomId, token, a), (n, r) => apply(n, r.state), itemName), [call, apply, roomId, token]),
    sellRice: useCallback((variety: string, dry: boolean, kg: number) =>
      call(() => sellRice(token, variety, dry, kg), applyMine), [call, applyMine, token]),
    buyItem: useCallback((itemId: string, qty: number, itemName?: string) =>
      call(() => buyFarmItem(token, itemId, qty), applyMine, itemName), [call, applyMine, token]),
    claimGift: useCallback(() => call(() => claimFarmGift(token), applyMine), [call, applyMine, token]),
  };
}
