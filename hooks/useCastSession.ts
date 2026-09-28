"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GameCanvasHandle } from "@/components/game/GameCanvas";
import type { FishingData } from "@/hooks/useFishing";
import { canHook, reelParamsFor, type CastInfo } from "@/lib/game/fishing/cast";
import { RARITY_COLOR } from "@/lib/game/fishing/catalog";
import { SWING_MS } from "@/lib/game/fishing/geometry";
import { BAIT_SWITCHED, lostText, overboardText, ROD_BROKE } from "@/lib/game/fishing/messages";
import { cellOf } from "@/lib/game/fishing/shore";
import type { ReelParams, ReelResult } from "@/lib/game/fishing/reel";
import type { CaughtFish } from "@/lib/game/fishing/rpc";
import { handFish } from "@/lib/game/fishing/state";
import type { Interactable } from "@/lib/game/maps/types";

/** What the HUD shows of the cast (spec §6.1). */
export type CastView =
  | { phase: "idle" }
  | { phase: "casting" }
  | { phase: "waiting"; info: CastInfo }
  | { phase: "bite"; info: CastInfo }
  | { phase: "reeling"; info: CastInfo; params: ReelParams }
  | { phase: "finishing" };

export interface CastSession {
  view: CastView;
  /** A fish just landed (the catch card), until dismissed. */
  caught: { fish: CaughtFish; record: boolean } | null;
  dismissCatch: () => void;
  /** Cast at a fishing spot (the caller has checked castRefusal). */
  cast: (spot: Interactable) => void;
  /** Hook the fish (only during the bite). */
  hook: () => void;
  /** "Thu cần" while waiting: the bait is lost. */
  reelIn: () => void;
  /** The reel minigame ended. */
  reelDone: (result: ReelResult) => void;
  /** Leaving the map or the game: give the cast up quietly (fire-and-forget). */
  abandon: () => void;
}

interface Live {
  info: CastInfo | null;
  /** performance.now() when start_cast answered. */
  answeredAt: number;
  /** The player left before start_cast answered: give it up as soon as it does. */
  abandoned: boolean;
  /** The bite was hooked: a second hook (a double tap) must not restart the reel. */
  hooked: boolean;
  timers: Array<ReturnType<typeof setTimeout>>;
}

/** One cast at a time: start_cast → swing → wait → bite → hook → reel → finish_cast (spec §6.1). */
export function useCastSession({ roomId, data, canvas, toast, itemName }: {
  roomId: string;
  data: Pick<FishingData, "startCast" | "finishCast">;
  canvas: () => GameCanvasHandle | null;
  toast: (text: string) => void;
  /** v18.1: a shop item's display name (a rod lost in the pond); the id by default. */
  itemName?: (id: string) => string;
}): CastSession {
  const [view, setView] = useState<CastView>({ phase: "idle" });
  const [caught, setCaught] = useState<{ fish: CaughtFish; record: boolean } | null>(null);
  const live = useRef<Live | null>(null);
  const { startCast, finishCast } = data;
  const toastRef = useRef(toast);
  const itemNameRef = useRef<(id: string) => string>((id) => id);
  useEffect(() => {
    toastRef.current = toast;
    itemNameRef.current = itemName ?? ((id) => id);
  });

  const clearTimers = (l: Live) => {
    for (const t of l.timers) clearTimeout(t);
    l.timers = [];
  };

  const end = useCallback(async (success: boolean, cause: "missed" | "reeled_in" | "reel" | "nobite", reel?: ReelResult) => {
    const l = live.current;
    if (!l?.info) return;
    live.current = null;
    clearTimers(l);
    setView({ phase: "finishing" });
    // v18.1: a reel lost after the hook tells the server so (a big fish may pull me in)
    // 0046: a reel sends its input — the server replays it and decides the catch
    // (only to a server that chose the seed: one before 0046 would not know the arguments)
    const input = reel && l.info.reelSeed != null ? { toggles: reel.toggles, ticks: reel.ticks } : undefined;
    const r = cause === "reel" && !success ? await finishCast(l.info.castId, false, true, input)
      : input ? await finishCast(l.info.castId, success, false, input) : await finishCast(l.info.castId, success);
    setView({ phase: "idle" });
    if (!r) {
      canvas()?.setFishing({ phase: "idle" });
      return;
    }
    if (r.result === "caught") {
      canvas()?.landCatch(r.fish.speciesId, r.fish.weightG, handFish(r.state)?.speciesId ?? null);
      setCaught({ fish: r.fish, record: r.record });
    } else if (r.overboard) {
      // v18.1: into the pond — swim mode until I climb onto the bank
      canvas()?.setFishing({ phase: "idle" });
      canvas()?.overboard();
      toastRef.current(overboardText(r.overboard.hunger, r.overboard.rodLost ? itemNameRef.current(r.overboard.rod) : null));
    } else {
      canvas()?.setFishing({ phase: "idle" });
      // a reel reported too fast as a strike: the warning or the ban modal shows instead (anti-cheat §12.1)
      if ((r.anticheat?.strike ?? 0) < 1) toastRef.current(lostText(cause, success ? r.why : null, r.state.fishCap));
    }
    if (r.rodBroke) toastRef.current(ROD_BROKE);                                          // v18.2
  }, [canvas, finishCast]);

  const cast = useCallback((spot: Interactable) => {
    if (live.current) return;
    const l: Live = { info: null, answeredAt: 0, abandoned: false, hooked: false, timers: [] };
    live.current = l;
    const startedAt = performance.now();
    canvas()?.plant(spot.use, spot.face ?? "up");
    canvas()?.setFishing({ phase: "casting" });
    setView({ phase: "casting" });
    void startCast(roomId, cellOf(spot.use)).then((r) => {
      if (live.current !== l) return;
      if (!r) {
        // start_cast refused (the toast is shown): the rod comes back in
        live.current = null;
        canvas()?.setFishing({ phase: "idle" });
        setView({ phase: "idle" });
        return;
      }
      const info: CastInfo = {
        castId: r.castId, biteMs: r.biteMs, windowMs: r.windowMs, difficulty: r.difficulty, minReelMs: r.minReelMs,
        zonePct: r.zonePct, rarity: r.rarity, bites: r.bites, reelSeed: r.reelSeed,
      };
      l.info = info;
      l.answeredAt = performance.now();
      if (l.abandoned) {
        live.current = null;
        void finishCast(info.castId, false);
        return;
      }
      if (r.baitSwitched) toastRef.current(BAIT_SWITCHED);
      const bobber = r.state.loadout.bobber;
      const swingLeft = Math.max(0, SWING_MS - (l.answeredAt - startedAt));
      l.timers.push(setTimeout(() => {
        canvas()?.setFishing({ phase: "waiting" });
        setView({ phase: "waiting", info });
      }, swingLeft));
      if (!r.bites) {
        // v18.1: a shore cast nothing bites — the bobber just sits until the wait is over
        l.timers.push(setTimeout(() => void end(false, "nobite"), Math.max(swingLeft, info.biteMs)));
        return;
      }
      l.timers.push(setTimeout(() => {
        canvas()?.setFishing({ phase: "bite", tint: info.rarity ? RARITY_COLOR[info.rarity] : null, glow: bobber === "bobber_lamp" });
        setView({ phase: "bite", info });
      }, Math.max(swingLeft, info.biteMs)));
      l.timers.push(setTimeout(() => void end(false, "missed"), info.biteMs + info.windowMs));
    });
  }, [canvas, roomId, startCast, finishCast, end]);

  const hook = useCallback(() => {
    const l = live.current;
    if (!l?.info || l.hooked || !canHook(l.info, performance.now() - l.answeredAt)) return;
    l.hooked = true;
    clearTimers(l);
    // 0046: the server's seed (a server before 0046 sends none: any seed will do, it trusts the outcome)
    const params = reelParamsFor(l.info, l.info.reelSeed ?? crypto.getRandomValues(new Uint32Array(1))[0]);
    canvas()?.setFishing({ phase: "reeling" });
    setView({ phase: "reeling", info: l.info, params });
  }, [canvas]);

  const reelIn = useCallback(() => {
    const l = live.current;
    if (!l?.info || view.phase !== "waiting") return;
    void end(false, "reeled_in");
  }, [end, view.phase]);

  const reelDone = useCallback((result: ReelResult) => {
    void end(result.caught, "reel", result);
  }, [end]);

  const abandon = useCallback(() => {
    const l = live.current;
    if (!l) return;
    clearTimers(l);
    if (l.info) {
      live.current = null;
      void finishCast(l.info.castId, false);
    } else {
      l.abandoned = true;
    }
    canvas()?.setFishing({ phase: "idle" });
    setView({ phase: "idle" });
  }, [canvas, finishCast]);

  // unmounting mid-cast gives the cast up
  const abandonRef = useRef(abandon);
  useEffect(() => {
    abandonRef.current = abandon;
  });
  useEffect(() => () => abandonRef.current(), []);

  return { view, caught, dismissCatch: useCallback(() => setCaught(null), []), cast, hook, reelIn, reelDone, abandon };
}
