"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameCanvasHandle } from "@/components/game/GameCanvas";
import { useField, type FieldData } from "@/hooks/useField";
import { plotDraws } from "@/lib/game/art/crops";
import { dueTasks, plotPrompt, type FarmTask, type PlotRun } from "@/lib/game/farm/actions";
import { ricePrice } from "@/lib/game/farm/catalog";
import { serverNow } from "@/lib/game/farm/clock";
import { boughtText, GIFT_TEXT, harvestText, NOT_OPEN, riceSaleText } from "@/lib/game/farm/messages";
import type { FieldAction } from "@/lib/game/farm/rpc";
import { getMap } from "@/lib/game/maps/registry";
import type { Interactable, MapId } from "@/lib/game/maps/types";
import { FARM_ANIM, type FarmAnim } from "@/lib/game/net/protocol";

/** The field's panels; the plot panel is for one plot, the handbook may open at a tab. */
export type FarmPanel =
  | { kind: "plot"; plot: number }
  | { kind: "coop" }
  | { kind: "shop" }
  | { kind: "depot" }
  | { kind: "drying" }
  | { kind: "handbook"; tab: string | null }
  | { kind: "tasks" };

/** Transplanting or harvesting in progress: movement is locked until it is sent or cancelled (spec §16). */
export interface FarmWork { plot: number; work: "transplant" | "harvest"; startedAt: number }

export interface FarmController {
  data: FieldData;
  /** Now on the server's clock (refreshed every 30 s and by every answer); 0 before the first tick. */
  now: number;
  /** What is due on my plots, urgent first, and how many are urgent (the HUD dot). */
  tasks: FarmTask[];
  urgent: number;
  panel: FarmPanel | null;
  openPanel: (p: FarmPanel) => void;
  closePanel: () => void;
  /** An action is in flight: the panels' buttons wait. */
  busy: boolean;
  work: FarmWork | null;
  cancelWork: () => void;
  /** A land, farming or drying action (a work action starts the progress); `done` is toasted when it succeeds. */
  act: (a: PlotRun, done?: string) => Promise<boolean>;
  buy: (itemId: string, qty: number) => Promise<boolean>;
  sell: (variety: string, dry: boolean, kg: number) => Promise<boolean>;
  /** Handles the field's interactables; false for anything else. */
  interact: (it: Interactable) => boolean;
  /** A plot's prompt names my next job there; the field's other interactables keep theirs; null = not the field's. */
  promptText: (it: Interactable) => string | null;
}

export interface FarmControllerOptions {
  token: string;
  roomId: string;
  accountId: string;
  /** The map I am on: the field is fetched and drawn only while it is "field". */
  mapId: MapId;
  /** The game canvas (null while there is none). */
  canvas: () => GameCanvasHandle | null;
  toast: (text: string) => void;
  /** My coins changed on the field (the HUD's wallet reads the fishing state: fetch it again). */
  onCoinsChanged: () => void;
}

/** Transplanting and harvesting take this long on screen (the server's gate is 2 s; spec §4, §11.4). */
export const WORK_MS = 3000;
/** How often the clock ticks while on the field. */
const TICK_MS = 30_000;
/** The animation each instant action plays (the work actions play theirs while they run). */
const ANIM: Partial<Record<FieldAction["kind"], FarmAnim>> = {
  prepare: FARM_ANIM.prepare, water: FARM_ANIM.pump, spray: FARM_ANIM.spray, fertilize: FARM_ANIM.fertilize,
  pick_snails: FARM_ANIM.snails,
};
const FIELD_KINDS: ReadonlySet<string> = new Set(["plot", "coop", "farm_shop", "rice_depot", "drying"]);

/** Everything farming for the game shell (spec §7–§8, §12–§13): the field, the clock, the prompts, the panels, the
 *  due tasks and the plots on the canvas, the newcomer gift, the actions with their animations (`fa`) and the others'
 *  refetch (`fp`), and the transplant / harvest progress. */
export function useFarmController({ token, roomId, accountId, mapId, canvas, toast, onCoinsChanged }: FarmControllerOptions): FarmController {
  const active = mapId === "field";
  const data = useField(roomId, token, active, toast);
  const { state, catalog, notOpen, run, claimGift, buyItem, sellRice } = data;
  const [panel, setPanel] = useState<FarmPanel | null>(null);
  const [busy, setBusy] = useState(false);
  const [work, setWork] = useState<FarmWork | null>(null);
  const live = useRef({ toast, onCoinsChanged, state, catalog, notOpen });
  useEffect(() => {
    live.current = { toast, onCoinsChanged, state, catalog, notOpen };
  });

  // --- the clock: an answer carries the server's time, and a tick moves it on while I am on the field
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const beat = () => setTick(serverNow());
    const first = setTimeout(beat, 0);
    const timer = setInterval(beat, TICK_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [active]);
  const now = Math.max(tick, state?.serverNow ?? 0);

  // --- due tasks, and the plots on the canvas with my urgent rings
  const tasks = useMemo(() => (state && catalog ? dueTasks(state.plots, accountId, catalog, state.mine, now) : []), [state, catalog, accountId, now]);
  useEffect(() => {
    if (!active || !state) return;
    const urgentPlots = new Set(tasks.filter((t) => t.urgent).map((t) => t.plot));
    canvas()?.setPlots(plotDraws(state.plots, catalog?.varieties ?? [], urgentPlots, now));
  }, [active, state, catalog, tasks, now, canvas]);

  // --- the newcomer gift: asked once, on the first visit that shows it unclaimed
  const giftAsked = useRef(false);
  const giftDue = active && state !== null && !state.mine.giftClaimed;
  useEffect(() => {
    if (!giftDue || giftAsked.current) return;
    giftAsked.current = true;
    void claimGift().then((r) => {
      if (r?.gifted) live.current.toast(GIFT_TEXT);
    });
  }, [giftDue, claimGift]);

  // --- my coins moved (rent, buy, sell, a land sale to me): the HUD's wallet fetches again
  const coins = state?.mine.coins ?? null;
  const lastCoins = useRef<number | null>(null);
  useEffect(() => {
    if (coins === null) return;
    if (lastCoins.current !== null && lastCoins.current !== coins) live.current.onCoinsChanged();
    lastCoins.current = coins;
  }, [coins]);

  // --- transplanting and harvesting: begin_work, the progress (movement locked), then the action with q = 1.0
  const workTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (workTimer.current) clearTimeout(workTimer.current);
  }, []);
  const finishWork = useCallback(async (plot: number, w: FarmWork["work"]) => {
    const r = await run({ kind: w, plot, quality: 1 });
    setWork(null);
    if (!r) return;
    canvas()?.plotChanged(plot);
    if (r.harvest) {
      const name = live.current.catalog?.varieties.find((v) => v.id === r.harvest!.variety)?.name ?? r.harvest.variety;
      live.current.toast(harvestText(r.harvest.kg, name));
    }
  }, [run, canvas]);
  const startWork = useCallback(async (plot: number, w: FarmWork["work"]): Promise<boolean> => {
    if (workTimer.current) return false;
    setBusy(true);
    const begun = await run({ kind: "begin_work", plot, work: w });
    setBusy(false);
    if (!begun) return false;
    const c = canvas();
    const spot = getMap("field").interactables.find((i) => i.plot === plot);
    if (spot) c?.plant(spot.use, spot.face ?? "up");
    c?.farmAnim(w === "transplant" ? FARM_ANIM.transplant : FARM_ANIM.harvest);
    setPanel(null);
    setWork({ plot, work: w, startedAt: Date.now() });
    workTimer.current = setTimeout(() => {
      workTimer.current = null;
      void finishWork(plot, w);
    }, WORK_MS);
    return true;
  }, [run, canvas, finishWork]);
  const cancelWork = useCallback(() => {
    if (!workTimer.current) return;
    clearTimeout(workTimer.current);
    workTimer.current = null;
    setWork(null);
    canvas()?.farmAnim(FARM_ANIM.stop);
  }, [canvas]);
  useEffect(() => {
    if (!active) cancelWork();
  }, [active, cancelWork]);

  // --- the actions
  const act = useCallback(async (a: PlotRun, done?: string): Promise<boolean> => {
    if (a.kind === "work") return startWork(a.plot, a.work);
    // a harvest round (v15.2 §6.2) has its own overlay and flow (Tasks 13 and 14)
    if (a.kind === "round") return false;
    setBusy(true);
    try {
      const itemName = "item" in a ? live.current.catalog?.items.find((i) => i.id === a.item)?.name : undefined;
      const r = await run(a, itemName);
      if (!r) return false;
      const c = canvas();
      const anim = ANIM[a.kind];
      if (anim) c?.farmAnim(anim);
      c?.plotChanged("plot" in a ? a.plot : 0);
      if (done) live.current.toast(done);
      return true;
    } finally {
      setBusy(false);
    }
  }, [run, canvas, startWork]);
  const buy = useCallback(async (itemId: string, qty: number): Promise<boolean> => {
    setBusy(true);
    try {
      const name = live.current.catalog?.items.find((i) => i.id === itemId)?.name ?? itemId;
      const r = await buyItem(itemId, qty, name);
      if (r) live.current.toast(boughtText(name, qty));
      return r !== null;
    } finally {
      setBusy(false);
    }
  }, [buyItem]);
  const sell = useCallback(async (variety: string, dry: boolean, kg: number): Promise<boolean> => {
    setBusy(true);
    try {
      const before = live.current.state?.mine.coins ?? 0;
      const r = await sellRice(variety, dry, kg);
      const v = live.current.catalog?.varieties.find((x) => x.id === variety);
      const name = v?.name ?? variety;
      // What sell_rice paid, by its own arithmetic. The wallet is shared with fishing and moves without a field answer
      // (a song bonus, another tab's sale, a buyer of my plot), so its change is only the fallback for an unknown variety.
      if (r) live.current.toast(riceSaleText(kg, name, dry, v ? ricePrice(kg, v.pricePerKg, dry) : r.mine.coins - before));
      return r !== null;
    } finally {
      setBusy(false);
    }
  }, [sellRice]);

  // --- the field's interactables and prompts
  const interact = useCallback((it: Interactable): boolean => {
    if (!FIELD_KINDS.has(it.kind)) return false;
    if (live.current.notOpen) {
      live.current.toast(NOT_OPEN);
      return true;
    }
    switch (it.kind) {
      case "plot":
        if (it.plot) setPanel({ kind: "plot", plot: it.plot });
        break;
      case "coop":
        setPanel({ kind: "coop" });
        break;
      case "farm_shop":
        setPanel({ kind: "shop" });
        break;
      case "rice_depot":
        setPanel({ kind: "depot" });
        break;
      case "drying":
        setPanel({ kind: "drying" });
        break;
    }
    return true;
  }, []);
  const promptText = useCallback((it: Interactable): string | null => {
    if (!FIELD_KINDS.has(it.kind)) return null;
    const p = it.kind === "plot" ? state?.plots.find((x) => x.no === it.plot) : undefined;
    if (!p || !state || !catalog) return it.prompt;
    return plotPrompt(p, accountId, catalog.varieties.find((v) => v.id === p.crop?.variety) ?? null, catalog, state.mine, now);
  }, [state, catalog, accountId, now]);

  return {
    data,
    now,
    tasks,
    urgent: tasks.filter((t) => t.urgent).length,
    panel,
    openPanel: setPanel,
    closePanel: useCallback(() => setPanel(null), []),
    busy,
    work,
    cancelWork,
    act,
    buy,
    sell,
    interact,
    promptText,
  };
}
