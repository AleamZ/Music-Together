"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GameCanvasHandle } from "@/components/game/GameCanvas";
import { useCastSession, type CastSession, type CastView } from "@/hooks/useCastSession";
import { useFishing, type FishingData } from "@/hooks/useFishing";
import { serverNow } from "@/lib/game/farm/clock";
import {
  BAIT_FULL, castRefusal, dailyText, digText, digWaitText, LOADING, NET_EXPIRED, NET_TOO_EARLY, netText, NO_NET, NOT_LOADED,
  promptText as promptFor, repairText, saleText, SONG_BONUS,
} from "@/lib/game/fishing/messages";
import { pullWaitMs } from "@/lib/game/fishing/net";
import { NET_WON_MS, type NetInput } from "@/lib/game/fishing/netcast";
import { nearestWater } from "@/lib/game/fishing/shore";
import { fetchFishingBoard, type CaughtFish, type FishingBoard } from "@/lib/game/fishing/rpc";
import { baitTotal, bestNet, castWaitMin, dayCapped, digWaitSec, handFish, type Loadout } from "@/lib/game/fishing/state";
import type { ReelResult } from "@/lib/game/fishing/reel";
import type { Interactable } from "@/lib/game/maps/types";
import type { QueueItem } from "@/lib/supabase";

/** `market_depot` (v18.5): Vựa cá Chợ Lớn, the depot panel at +20%. */
export type FishingPanel = "bag" | "depot" | "market_depot" | "shop" | "records";

export interface FishingController {
  data: FishingData;
  /** The cast in progress (spec §6.1). */
  cast: CastView;
  caught: CastSession["caught"];
  dismissCatch: () => void;
  hook: () => void;
  reelIn: () => void;
  reelDone: (result: ReelResult) => void;
  /** Give up the cast quietly (a portal). */
  cancelCast: () => void;
  /** Canvas input while the rod is out: a tap hooks at the bite, Esc reels in while waiting. */
  onFishingInput: (kind: "tap" | "cancel") => void;
  panel: FishingPanel | null;
  openPanel: (p: FishingPanel) => void;
  closePanel: () => void;
  /** A panel action (buy, sell, equip, release) is in flight. */
  busy: boolean;
  /** `market`: to Vựa cá Chợ Lớn (+20%, v18.5). */
  sell: (fishIds: string[], market?: boolean) => void;
  release: (fishId: string) => void;
  buy: (itemId: string, qty: number) => void;
  equip: (loadout: Loadout) => void;
  /** fishing_board for this room (the records panel). */
  loadBoard: () => Promise<FishingBoard>;
  /** v18.2 Sửa cần at chú Tư's. */
  repair: (itemId: string) => void;
  /** v18.2: the net minigame in progress (the NetOverlay), or null. */
  net: NetView | null;
  /** v18.2: the net a throw would use, or null (none owned / not loaded). */
  netReady: string | null;
  /** v18.2: open the net minigame at this pond cell (aiming costs nothing). */
  throwNet: (cell: { col: number; row: number }) => void;
  /** v18.2: the net left the hands (start_net: the throw is spent). */
  netThrow: (chargeMs: number) => void;
  /** v18.2: the net sank (net_haul) with the shadows it covered as offsets. */
  netHaul: (chargeMs: number, offsets: number[]) => void;
  /** v18.2: kéo lưới ended (finish_net) with this many mistakes: 0 all the fish, 1–3 one escapes each, 4 = into the pond. */
  netFinish: (mistakes: number) => void;
  /** v18.2: close the minigame (Esc before the throw, or the result card). */
  netClose: () => void;
  /** v18.2: the net minigame's phase, drawn on my character for everyone. */
  netPhase: (inp: NetInput) => void;
  /** The fish shown in my hands (species id), or null: none in the bag, or put away. */
  handFish: string | null;
  /** Whether a fish is put away in the bag instead of held (remembered on this device). */
  fishStowed: boolean;
  /** Put the fish away / take it out again. */
  toggleFishStowed: () => void;
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

/** v18.2: the net minigame. `throwId` once start_net answered; `readyAt` (performance.now) the earliest pull the server
 *  accepts; `result` after finish_net. */
export interface NetView {
  cell: { col: number; row: number };
  net: string;
  name: string;
  radiusPx: number;
  /** Throws left on the net before this one. */
  left: number;
  max: number;
  throwId: string | null;
  readyAt: number | null;
  busy: boolean;
  /** The fish under the net (net_haul), for kéo lưới; null before. */
  haul: CaughtFish[] | null;
  result: { count: number; fish: CaughtFish[]; escaped: number } | { lost: "expired" | "too_early" } | null;
}

/** The worm dig's dust puff, before dig_worms is called. */
const DIG_MS = 1000;
/** After a song I queued stops being current, the bonus trigger has run: look at the coins after this. */
const SONG_BONUS_DELAY_MS = 1500;

/** Everything fishing for the game shell (spec §6, §10): the state, the daily check-in, the song bonus, digging,
 *  the HUD prompts and which fishing panel is open. */
const STOWED_KEY = "mt.fishStowed";
function readStowed(): boolean {
  try { return localStorage.getItem(STOWED_KEY) === "1"; } catch { return false; }
}

export function useFishingController({ token, roomId, accountId, canvas, current, toast }: FishingControllerOptions): FishingController {
  const data = useFishing(token, toast);
  const itemCatalog = data.catalog;
  const itemName = useCallback((id: string) => itemCatalog?.items.find((i) => i.id === id)?.name ?? id, [itemCatalog]);
  const session = useCastSession({ roomId, data, canvas, toast, itemName });
  const { state, failed, catalog, reload, claimDaily, dig, sell: sellFish, release: releaseFish, buy: buyItem, equip: setLoadout, repair: repairRod } = data;
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
  // the owner's ask: a way to put the fish away (and take it out again); remembered per device
  const [fishStowed, setFishStowed] = useState(readStowed);
  const toggleFishStowed = useCallback(() => {
    setFishStowed((v) => {
      try { localStorage.setItem(STOWED_KEY, v ? "0" : "1"); } catch { /* private mode: this visit only */ }
      return !v;
    });
  }, []);
  const hand = state && !fishStowed ? handFish(state)?.speciesId ?? null : null;
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

  // --- a clock for the prompts: every second while a cooldown or the hourly cap counts down
  const [now, setNow] = useState<number | null>(null);
  const digRunning = !!state?.digReadyAt && (now === null || Date.parse(state.digReadyAt) > now);
  const capRunning = !!state && castWaitMin(state, now ?? 0) > 0;
  const ticking = digRunning || capRunning;
  useEffect(() => {
    if (!ticking) return;
    const tick = () => setNow(serverNow());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [ticking]);
  // …the daily cap shows no countdown: one tick to show it, then one when the Vietnam day turns (a tick that comes early
  // waits for the rest)
  const dayRunning = !!state && dayCapped(state, now ?? 0);
  const dayEnd = dayRunning && state.dayResetsAt !== null ? Date.parse(state.dayResetsAt) : null;
  useEffect(() => {
    if (!dayRunning || ticking) return;
    const wait = now === null ? 0 : dayEnd !== null && Number.isFinite(dayEnd) ? Math.max(0, dayEnd - serverNow()) : null;
    if (wait === null) return;
    const timer = setTimeout(() => setNow(serverNow()), wait);
    return () => clearTimeout(timer);
  }, [dayRunning, ticking, dayEnd, now]);
  const promptText = useCallback((it: Interactable) => promptFor(it, state, now), [state, now]);

  // --- digging worms: a second of dust, then dig_worms
  const digging = useRef(false);
  const digAt = useCallback((it: Interactable) => {
    const s = stateRef.current;
    if (!s) {
      toastRef.current(failedRef.current ? NOT_LOADED : LOADING);
      return;
    }
    const wait = digWaitSec(s, serverNow());
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

  // --- casting: the checks of spec §6.1, then the session takes over
  const { cast: castAt, hook, reelIn } = session;
  const fishAt = useCallback((it: Interactable) => {
    const refusal = castRefusal(stateRef.current, failedRef.current, serverNow(), canvas()?.anglerNear(it.use) ?? false);
    if (refusal) toastRef.current(refusal);
    else castAt(it);
  }, [canvas, castAt]);
  const castPhase = session.view.phase;
  const onFishingInput = useCallback((kind: "tap" | "cancel") => {
    if (kind === "tap" && castPhase === "bite") hook();
    else if (kind === "cancel" && castPhase === "waiting") reelIn();
  }, [castPhase, hook, reelIn]);

  // --- the depot, the shop, the records board and the bag
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (job: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await job();
    } finally {
      setBusy(false);
    }
  }, []);
  const sell = useCallback((ids: string[], market = false) => void run(async () => {
    const r = await sellFish(ids, market);
    if (r) toastRef.current(saleText(r.sold, r.earned));
  }), [run, sellFish]);
  const release = useCallback((id: string) => void run(() => releaseFish(id)), [run, releaseFish]);
  const buy = useCallback((itemId: string, qty: number) => void run(async () => {
    const name = catalog?.items.find((i) => i.id === itemId)?.name ?? itemId;
    if (await buyItem(itemId, qty)) toastRef.current(`🛒 Đã mua ${name}${qty > 1 ? ` × ${qty}` : ""}.`);
  }), [run, buyItem, catalog]);
  const equip = useCallback((l: Loadout) => void run(() => setLoadout(l)), [run, setLoadout]);
  const repair = useCallback((itemId: string) => void run(async () => {
    const r = await repairRod(itemId);
    if (r) toastRef.current(repairText(itemName(itemId), r.cost));
  }), [run, repairRod, itemName]);

  // --- v18.2 the net: aim + charge (free, Esc cancels) → release: start_net → sink → Kéo lưới: finish_net → result card
  const [net, setNet] = useState<NetView | null>(null);
  /** A won pull's bundle stays up NET_WON_MS even when the result card is closed sooner. */
  const wonRef = useRef(false);
  const netItem = state && catalog ? bestNet(state, catalog.items) : null;
  const netReady = netItem?.id ?? null;
  const { startNet, netHaul: haulNet, finishNet } = data;
  const throwNet = useCallback((cell: { col: number; row: number }) => {
    if (net || session.view.phase !== "idle") return;
    const s = stateRef.current;
    if (!netItem || !s) {
      toastRef.current(NO_NET);
      return;
    }
    const w = s.wear[netItem.id];
    // everyone sees me take up the net, facing the water
    const c = canvas();
    const pos = c?.localPos();
    c?.setNet({ show: "aim" }, (pos && nearestWater(pos)) ?? undefined);
    wonRef.current = false;
    setNet({
      cell, net: netItem.id, name: netItem.name, radiusPx: netItem.radiusPx ?? 24, left: w?.left ?? 0, max: w?.max ?? 0,
      throwId: null, readyAt: null, busy: false, haul: null, result: null,
    });
  }, [net, session.view.phase, netItem, canvas]);
  /** v18.2: the minigame's phase, shown on my character to everyone. */
  const netPhase = useCallback((inp: NetInput) => canvas()?.setNet(inp), [canvas]);
  const showWon = useCallback((k: number) => {
    const c = canvas();
    c?.setNet({ show: "won", k });
    wonRef.current = true;
    later(() => {
      if (!wonRef.current) return;
      wonRef.current = false;
      canvas()?.setNet(null);
    }, NET_WON_MS);
  }, [canvas, later]);
  const netOpen = net !== null;
  const wasOpen = useRef(false);
  useEffect(() => {
    // the minigame closed (Esc, refused, lost, the card closed): the others stop seeing the throw
    if (netOpen) wasOpen.current = true;
    else if (wasOpen.current) {
      wasOpen.current = false;
      if (!wonRef.current) canvas()?.setNet(null);
    }
  }, [netOpen, canvas]);
  const netThrow = useCallback(() => {
    if (!net || net.throwId || net.busy) return;
    const at = net;
    setNet({ ...at, busy: true });
    void startNet(roomId, at.cell, at.net).then((r) => {
      if (!r) {
        setNet(null);                                                                     // refused: the toast says why
        return;
      }
      setNet((cur) => cur && { ...cur, busy: false, throwId: r.throwId, readyAt: performance.now() + pullWaitMs(r.beatMs) });
    });
  }, [net, startNet, roomId]);
  const netHaul = useCallback((chargeMs: number, offsets: number[]) => {
    if (!net?.throwId || net.busy || net.haul || net.result) return;
    const at = net;
    setNet({ ...at, busy: true });
    void haulNet(at.throwId!, chargeMs, offsets).then((r) => {
      if (!r) {
        setNet(null);
        return;
      }
      if (r.result === "haul") setNet((cur) => cur && { ...cur, busy: false, haul: r.fish });
      else if (r.result === "empty") {
        setNet((cur) => cur && { ...cur, busy: false, result: { count: 0, fish: [], escaped: 0 } });
        showWon(0);
      } else {
        toastRef.current(r.why === "expired" ? NET_EXPIRED : NET_TOO_EARLY);
        setNet((cur) => cur && { ...cur, busy: false, result: { lost: r.why } });
        canvas()?.setNet(null);
      }
    });
  }, [net, haulNet, showWon, canvas]);
  const netFinish = useCallback((mistakes: number) => {
    if (!net?.throwId || !net.haul || net.busy || net.result) return;
    const at = net;
    setNet({ ...at, busy: true });
    void finishNet(at.throwId!, mistakes).then((r) => {
      if (!r) {
        setNet(null);
        return;
      }
      if (r.result === "caught") {
        toastRef.current(netText(r.count));
        setNet((cur) => cur && { ...cur, busy: false, result: { count: r.count, fish: r.fish, escaped: r.escaped } });
        const last = r.fish[r.fish.length - 1];
        if (last) canvas()?.landCatch(last.speciesId, last.weightG, handFish(r.state)?.speciesId ?? null);
        showWon(r.count);                                                                   // after the catch's own `fs`
      } else if (r.why === "overboard") {
        // pulled into the pond by the catch: the v18.1 swim until I climb onto the bank
        setNet(null);
        canvas()?.setNet(null);
        canvas()?.overboard();
        toastRef.current(`🌊 Kéo hụt — bạn bị lôi xuống ao! (−${r.overboard?.hunger ?? 10} no)`);
      } else {
        toastRef.current(r.why === "expired" ? NET_EXPIRED : NET_TOO_EARLY);
        setNet((cur) => cur && { ...cur, busy: false, result: { lost: r.why === "expired" ? "expired" : "too_early" } });
        canvas()?.setNet(null);
      }
    });
  }, [net, finishNet, canvas, showWon]);
  const netClose = useCallback(() => {
    // before the throw nothing is spent; a throw in the water is given up (its use is already spent)
    setNet((cur) => (cur && cur.busy ? cur : null));
  }, []);
  const loadBoard = useCallback(() => fetchFishingBoard(roomId, token), [roomId, token]);

  const interact = useCallback((it: Interactable): boolean => {
    switch (it.kind) {
      case "dig_spot":
        digAt(it);
        return true;
      case "fish_spot":
        fishAt(it);
        return true;
      case "depot":
      case "shop":
      case "records":
        setPanel(it.kind);
        return true;
      case "market_fish_depot":
        setPanel("market_depot");
        return true;
      default:
        return false;
    }
  }, [digAt, fishAt]);

  return {
    data,
    handFish: state ? handFish(state)?.speciesId ?? null : null,
    fishStowed,
    toggleFishStowed,
    cast: session.view,
    caught: session.caught,
    dismissCatch: session.dismissCatch,
    hook,
    reelIn,
    reelDone: session.reelDone,
    cancelCast: session.abandon,
    onFishingInput,
    panel,
    openPanel: setPanel,
    closePanel: useCallback(() => setPanel(null), []),
    busy,
    sell,
    release,
    buy,
    equip,
    repair,
    net,
    netReady,
    throwNet,
    netThrow,
    netHaul,
    netFinish,
    netClose,
    netPhase,
    loadBoard,
    interact,
    promptText,
  };
}
