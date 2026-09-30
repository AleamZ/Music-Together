"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameCanvasHandle } from "@/components/game/GameCanvas";
import { isWildBoatSpot } from "@/lib/game/world/boat";
import { useCastSession, type CastSession, type CastView } from "@/hooks/useCastSession";
import { useFishing, type FishingData } from "@/hooks/useFishing";
import { useFishingExtras, type FishingExtras } from "@/hooks/useFishingExtras";
import { BOAT_DECK_SPOT } from "@/lib/game/maps/pond";
import { serverNow } from "@/lib/game/farm/clock";
import {
  abandonedText, BAIT_FULL, castRefusal, dailyText, digText, digWaitText, GROUNDBAIT_WHERE, groundbaitText, LOADING, NET_EXPIRED, netLostText,
  netText, NO_NET, NOT_LOADED, promptText as promptFor, repairText, saleText, SONG_BONUS,
} from "@/lib/game/fishing/messages";
import { NET_WON_MS, type NetInput } from "@/lib/game/fishing/netcast";
import { nearestWater } from "@/lib/game/fishing/shore";
import {
  fetchFishingBoard, type CaughtFish, type FishingBoard, type GroundbaitSpot, type NetLostWhy, type NetPull, type NetThrow, type Notebook,
} from "@/lib/game/fishing/rpc";
import { baitTotal, bestNet, digWaitSec, groundbaitCount, handFish, type GearSlot, type Loadout } from "@/lib/game/fishing/state";
import type { ReelResult } from "@/lib/game/fishing/reel";
import type { Interactable } from "@/lib/game/maps/types";
import type { QueueItem } from "@/lib/supabase";

/** `market_depot` (v18.5): Vựa cá Chợ Lớn, the depot panel at +20%. */
export type FishingPanel = "bag" | "depot" | "market_depot" | "shop" | "records"
  /** v21 (0076): Bến ghe, the battles' board, the treasure maps. */
  | "boat" | "battle" | "treasure"
  /** 0110: Sổ tay câu cá. */
  | "notebook";

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
  /** 0110: mount (`item`) or unmount (null) one slot of the rig. */
  equipSlot: (slot: GearSlot, item: string | null) => void;
  /** 0110: the groundbait the HUD's "Rải thính" throws (the one picked in the bag, else the first with bags), or null. */
  groundbaitReady: string | null;
  /** 0110: pick the groundbait the HUD throws. */
  pickGroundbait: (item: string) => void;
  /** 0110: throw one bag at this pond cell, or (no cell) where I last fished (the pond, Sông Cái or the wild river). */
  throwGroundbait: (item: string, cell?: { col: number; row: number }) => void;
  /** 0110: Sổ tay câu cá (null: not bought, or an error). */
  loadNotebook: () => Promise<Notebook | null>;
  /** fishing_board for this room (the records panel). */
  loadBoard: () => Promise<FishingBoard>;
  /** v18.2 Sửa cần at chú Tư's. */
  repair: (itemId: string) => void;
  /** v18.2: the net minigame in progress (the NetOverlay), or null. */
  net: NetView | null;
  /** v18.2: the net a throw would use, or null (none owned / not loaded). */
  netReady: string | null;
  /** v18.2: open the net minigame at this pond cell: start_net rolls the school (0056: nothing is spent until the haul). */
  throwNet: (cell: { col: number; row: number }) => void;
  /** v18.2: the net sank (net_haul, 0056: the throw's input, replayed by the server; the throw is spent there). */
  netHaul: (input: NetThrow) => void;
  /** v18.2: kéo lưới ended (finish_net, 0056: the keys, replayed): 0 mistakes all the fish, 1–3 one escapes each, 4 = into the pond. */
  netFinish: (pull: NetPull) => void;
  /** v18.2: close the minigame (Esc before the throw, or the result card). */
  netClose: () => void;
  /** 0056: the aim ran too long (NETX.aimTicks): the open throw lapses, nothing spent. */
  netLapse: () => void;
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
  /** v21 (0076): the boat, the battles and the treasure maps. */
  extras: FishingExtras;
  /** v21 (0076): cast from the boat's deck (aboard only). */
  boatCast: () => void;
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

/** v18.2: the net minigame. `throwId`, `seed` and `openedAt` (performance.now: the school's tick 0) once start_net answered;
 *  `haul`, `arrowSeed` and `haulAt` (kéo lưới's tick 0) once net_haul answered; `result` after finish_net. */
export interface NetView {
  cell: { col: number; row: number };
  net: string;
  name: string;
  radiusPx: number;
  /** Throws left on the net before this one. */
  left: number;
  max: number;
  throwId: string | null;
  /** The school's seed (0056). */
  seed: number;
  openedAt: number | null;
  busy: boolean;
  /** The fish under the net (net_haul), for kéo lưới; null before. */
  haul: CaughtFish[] | null;
  /** Kéo lưới's seed, answered with the haul (0056). */
  arrowSeed: number;
  haulAt: number | null;
  result: { count: number; fish: CaughtFish[]; escaped: number } | { lost: NetLostWhy } | null;
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
  // v21 (0076): a cast from the boat goes to start_boat_cast; the rest of the cast (hook, reel, finish) is the same
  const boatCasting = useRef(false);
  // v22 (0086): a cast on Sông Cái goes to start_river_cast from where the boat floats
  const riverAt = useRef<{ x: number; y: number; map?: "song_cai" | "wild" } | null>(null);
  // 0110: where I last fished (a groundbait thrown from the bag lands there)
  const lastSpot = useRef<GroundbaitSpot | null>(null);
  const castData = useMemo(() => ({
    ...data, startCast: (r: string, cell?: { col: number; row: number }) => {
      const river = riverAt.current;
      riverAt.current = null;
      if (river) {
        lastSpot.current = { map: river.map ?? "song_cai", x: river.x, y: river.y };
        return data.startRiverCast(r, river);
      }
      if (!boatCasting.current && cell) lastSpot.current = { map: "pond", col: cell.col, row: cell.row };
      return boatCasting.current ? data.startBoatCast(r) : data.startCast(r, cell);
    },
  }), [data]);
  const speciesName = useCallback((id: string) => itemCatalog?.species.find((s) => s.id === id)?.name ?? id, [itemCatalog]);   // 0110
  const session = useCastSession({ roomId, data: castData, canvas, toast, itemName, speciesName });
  const { state, failed, catalog, reload, claimDaily, dig, sell: sellFish, release: releaseFish, buy: buyItem, equip: setLoadout, repair: repairRod,
    equipSlot: mountSlot, throwGroundbait: throwBag, notebook: loadNotebook } = data;
  const [panel, setPanel] = useState<FishingPanel | null>(null);
  const extras = useFishingExtras({ token, roomId, canvas, toast, watching: panel === "battle", onCoins: () => void reload() });   // v21
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

  // --- a clock for the prompts: every second while the dig cooldown counts down (0047: no cast caps to count)
  const [now, setNow] = useState<number | null>(null);
  const ticking = !!state?.digReadyAt && (now === null || Date.parse(state.digReadyAt) > now);
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
    const refusal = castRefusal(stateRef.current, failedRef.current, canvas()?.anglerNear(it.use) ?? false);
    if (refusal) toastRef.current(refusal);
    else {
      riverAt.current = isWildBoatSpot(it) ? { x: it.use.x, y: it.use.y, map: "wild" }   // 0095: the wild river / canals
        : canvas()?.mapId() === "song_cai" ? { x: it.use.x, y: it.use.y } : null;   // v22 (0086)
      castAt(it);
      riverAt.current = null;                                         // a cast already out never read it
    }
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
    if (r) toastRef.current(saleText(r.sold, r.earned, r.npcCut));                         // econ v2 (0101): the thương lái's cut
  }), [run, sellFish]);
  const release = useCallback((id: string) => void run(() => releaseFish(id)), [run, releaseFish]);
  const buy = useCallback((itemId: string, qty: number) => void run(async () => {
    const name = catalog?.items.find((i) => i.id === itemId)?.name ?? itemId;
    if (await buyItem(itemId, qty)) toastRef.current(`🛒 Đã mua ${name}${qty > 1 ? ` × ${qty}` : ""}.`);
  }), [run, buyItem, catalog]);
  const equip = useCallback((l: Loadout) => void run(() => setLoadout(l)), [run, setLoadout]);
  const equipSlot = useCallback((slot: GearSlot, item: string | null) => void run(() => mountSlot(slot, item)), [run, mountSlot]);   // 0110
  // 0110: thính — the one picked in the bag (or the first with bags), thrown at the pond's edge or where I last fished
  const [gbPick, setGbPick] = useState<string | null>(null);
  const gbItems = catalog?.items.filter((i) => i.kind === "groundbait") ?? [];
  const groundbaitReady = state
    ? (gbPick && groundbaitCount(state, gbPick) > 0 ? gbPick : gbItems.find((i) => groundbaitCount(state, i.id) > 0)?.id ?? null)
    : null;
  const throwGroundbait = useCallback((item: string, cell?: { col: number; row: number }) => void run(async () => {
    const spot: GroundbaitSpot | null = cell ? { map: "pond", col: cell.col, row: cell.row } : lastSpot.current;
    if (!spot) {
      toastRef.current(GROUNDBAIT_WHERE);
      return;
    }
    if (await throwBag(roomId, item, spot)) toastRef.current(groundbaitText(itemName(item)));
  }), [run, throwBag, roomId, itemName]);
  const repair = useCallback((itemId: string) => void run(async () => {
    const r = await repairRod(itemId);
    if (r) toastRef.current(repairText(itemName(itemId), r.cost));
  }), [run, repairRod, itemName]);

  // --- v18.2 the net: open: start_net (the school; 0056: nothing spent, Esc cancels) → aim + charge + release → sink:
  //     net_haul (the throw's input; spent there) → Kéo lưới: finish_net (the keys) → result card
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
      throwId: null, seed: 0, openedAt: null, busy: true, haul: null, arrowSeed: 0, haulAt: null, result: null,
    });
    // 0056: the school (and the power bar's period) come from the server's seed, so the throw opens with the aim
    void startNet(roomId, cell, netItem.id).then((r) => {
      if (!r) {
        setNet(null);                                                                     // refused: the toast says why
        return;
      }
      if (r.abandoned) toastRef.current(abandonedText(r.abandoned, itemName(r.abandoned.rod)));   // 0059: a hooked cast given up
      setNet((cur) => cur && !cur.throwId
        ? { ...cur, busy: false, throwId: r.throwId, seed: r.seed, radiusPx: r.radiusPx, openedAt: performance.now() } : cur);
    });
  }, [net, session.view.phase, netItem, canvas, startNet, roomId, itemName]);
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
  /** A lost throw or pull: its text (none when a strike's modal shows instead) and the card. */
  const netLost = useCallback((why: NetLostWhy, strike: number) => {
    if (strike < 1) toastRef.current(netLostText(why));
    setNet((cur) => cur && { ...cur, busy: false, result: { lost: why } });
    canvas()?.setNet(null);
  }, [canvas]);
  const netHaul = useCallback((input: NetThrow) => {
    if (!net?.throwId || net.busy || net.haul || net.result) return;
    const at = net;
    setNet({ ...at, busy: true });
    void haulNet(at.throwId!, input).then((r) => {
      if (!r) {
        setNet(null);
        return;
      }
      if (r.result === "haul") {
        setNet((cur) => cur && { ...cur, busy: false, haul: r.fish, arrowSeed: r.arrowSeed, haulAt: performance.now() });
      } else if (r.result === "empty") {
        setNet((cur) => cur && { ...cur, busy: false, result: { count: 0, fish: [], escaped: 0 } });
        showWon(0);
      } else netLost(r.why, r.anticheat?.strike ?? 0);
    });
  }, [net, haulNet, showWon, netLost]);
  const netFinish = useCallback((pull: NetPull) => {
    if (!net?.throwId || !net.haul || net.busy || net.result) return;
    const at = net;
    setNet({ ...at, busy: true });
    void finishNet(at.throwId!, pull).then((r) => {
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
      } else netLost(r.why, r.anticheat?.strike ?? 0);
    });
  }, [net, finishNet, canvas, showWon, netLost]);
  const netClose = useCallback(() => {
    // 0056: before the haul nothing is spent (the next start_net replaces the open throw); a call in flight finishes first
    setNet((cur) => (cur && cur.busy && cur.throwId ? cur : null));
  }, []);
  const netLapse = useCallback(() => {
    toastRef.current(NET_EXPIRED);
    setNet(null);
  }, []);
  const loadBoard = useCallback(() => fetchFishingBoard(roomId, token), [roomId, token]);

  // v21 (0076): a cast from the boat's deck — the same checks, then start_boat_cast
  const boatCast = useCallback(() => {
    const refusal = castRefusal(stateRef.current, failedRef.current, false);
    if (refusal) {
      toastRef.current(refusal);
      return;
    }
    boatCasting.current = true;
    try {
      castAt(BOAT_DECK_SPOT);
    } finally {
      boatCasting.current = false;
    }
  }, [castAt]);
  const reloadExtras = extras.reload;

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
      case "boat":                                                         // v21 (0076); v22: the ghe sails to Sông Cái
        setPanel("boat");
        reloadExtras();
        return true;
      case "fish_battle":                                                  // v21 (0076)
        setPanel("battle");
        return true;
      default:
        return false;
    }
  }, [digAt, fishAt, reloadExtras]);

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
    equipSlot,
    groundbaitReady,
    pickGroundbait: setGbPick,
    throwGroundbait,
    loadNotebook,
    repair,
    net,
    netReady,
    throwNet,
    netHaul,
    netFinish,
    netClose,
    netLapse,
    netPhase,
    loadBoard,
    interact,
    promptText,
    extras,
    boatCast,
  };
}
