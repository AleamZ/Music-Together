"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GameCanvasHandle } from "@/components/game/GameCanvas";
import { useFishing, type FishingData } from "@/hooks/useFishing";
import {
  BAIT_FULL, dailyText, digText, digWaitText, LOADING, NOT_LOADED, promptText as promptFor, SONG_BONUS,
} from "@/lib/game/fishing/messages";
import { baitTotal, castWaitMin, digWaitSec, handFish } from "@/lib/game/fishing/state";
import type { Interactable } from "@/lib/game/maps/types";
import type { QueueItem } from "@/lib/supabase";

export type FishingPanel = "bag" | "depot" | "shop" | "records";

export interface FishingController {
  data: FishingData;
  panel: FishingPanel | null;
  openPanel: (p: FishingPanel) => void;
  closePanel: () => void;
  /** Handles the pond's interactables; false for anything else. */
  interact: (it: Interactable) => boolean;
  /** The HUD prompt: dig spots and fishing spots show their wait. */
  promptText: (it: Interactable) => string;
}

export interface FishingControllerOptions {
  token: string;
  roomId: string;
  accountId: string;
  /** The game canvas (null while there is none). */
  canvas: () => GameCanvasHandle | null;
  /** The room's current queue item (the song bonus is checked when it changes). */
  current: QueueItem | null;
  toast: (text: string) => void;
}

/** The worm dig's dust puff, before dig_worms is called. */
const DIG_MS = 1000;
/** After a song I queued stops being current, the bonus trigger has run: look at the coins after this. */
const SONG_BONUS_DELAY_MS = 1500;

/** Everything fishing for the game shell (spec §6, §10): the state, the daily check-in, the song bonus, digging,
 *  the HUD prompts and which fishing panel is open. */
export function useFishingController({ token, accountId, canvas, current, toast }: FishingControllerOptions): FishingController {
  const data = useFishing(token, toast);
  const { state, failed, catalog, reload, claimDaily, dig } = data;
  const [panel, setPanel] = useState<FishingPanel | null>(null);
  const stateRef = useRef(state);
  const failedRef = useRef(failed);
  const toastRef = useRef(toast);
  useEffect(() => {
    stateRef.current = state;
    failedRef.current = failed;
    toastRef.current = toast;
  });
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const live = timers.current;
    return () => {
      for (const t of live) clearTimeout(t);
      live.clear();
    };
  }, []);
  const later = useCallback((fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timers.current.delete(t);
      fn();
    }, ms);
    timers.current.add(t);
  }, []);

  // --- the daily check-in: once per visit; the toast only when it paid
  // It waits for the first fishing_state, so the claim is the later call and its answer (with the bonus) is the one kept.
  const loaded = state !== null;
  const claimed = useRef(false);
  useEffect(() => {
    if (!loaded || claimed.current) return;
    claimed.current = true;
    void claimDaily().then((r) => {
      if (r?.claimed) toastRef.current(dailyText(r.amount));
    });
  }, [loaded, claimDaily]);

  // --- names for the catch labels, and the fish in my hand for everyone to see
  useEffect(() => {
    if (catalog) canvas()?.setSpecies(catalog.species.map((s) => ({ id: s.id, name: s.name, rarity: s.rarity })));
  }, [catalog, canvas]);
  const hand = state ? handFish(state)?.speciesId ?? null : null;
  useEffect(() => {
    canvas()?.setHand(hand);
  }, [hand, canvas]);

  // --- the song bonus (spec §10.1): the song I queued stopped being current → did the coins go up by 10?
  const prevItem = useRef<{ id: string; mine: boolean } | null>(null);
  const currentId = current?.id ?? null;
  const currentMine = !!current && current.added_by_account_id === accountId;
  useEffect(() => {
    const prev = prevItem.current;
    prevItem.current = currentId ? { id: currentId, mine: currentMine } : null;
    if (!prev || prev.id === currentId || !prev.mine) return;
    const before = stateRef.current?.coins ?? null;
    later(() => {
      void reload().then((s) => {
        if (s && before !== null && s.coins - before >= 10) toastRef.current(SONG_BONUS);
      });
    }, SONG_BONUS_DELAY_MS);
  }, [currentId, currentMine, reload, later]);

  // --- a clock for the prompts while a cooldown or the hourly cap runs
  const [now, setNow] = useState<number | null>(null);
  const digRunning = !!state?.digReadyAt && (now === null || Date.parse(state.digReadyAt) > now);
  const capRunning = !!state && castWaitMin(state, now ?? 0) > 0;
  const ticking = digRunning || capRunning;
  useEffect(() => {
    if (!ticking) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [ticking]);
  const promptText = useCallback((it: Interactable) => promptFor(it, state, now), [state, now]);

  // --- digging worms: a second of dust, then dig_worms
  const digging = useRef(false);
  const digAt = useCallback((it: Interactable) => {
    const s = stateRef.current;
    if (!s) {
      toastRef.current(failedRef.current ? NOT_LOADED : LOADING);
      return;
    }
    const wait = digWaitSec(s, Date.now());
    if (wait > 0) {
      toastRef.current(digWaitText(wait));
      return;
    }
    if (baitTotal(s) >= s.baitCap) {
      toastRef.current(BAIT_FULL);
      return;
    }
    if (digging.current) return;
    digging.current = true;
    canvas()?.puff({ x: it.use.x, y: it.use.y - 12 });
    later(() => {
      void dig().then((r) => {
        digging.current = false;
        if (r) toastRef.current(digText(r.gained));
      });
    }, DIG_MS);
  }, [canvas, dig, later]);

  const interact = useCallback((it: Interactable): boolean => {
    switch (it.kind) {
      case "dig_spot":
        digAt(it);
        return true;
      default:
        return false;
    }
  }, [digAt]);

  return {
    data,
    panel,
    openPanel: setPanel,
    closePanel: useCallback(() => setPanel(null), []),
    interact,
    promptText,
  };
}
