"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameCanvasHandle } from "@/components/game/GameCanvas";
import { useField, type FieldData } from "@/hooks/useField";
import { plotDraws } from "@/lib/game/art/crops";
import { dueTasks, lower, plotPrompt, type FarmTask, type PlotRun } from "@/lib/game/farm/actions";
import { PART_WAIT_MS, PART_WINDOW_MS, producePrice, ricePrice, type FarmCatalog } from "@/lib/game/farm/catalog";
import { serverNow } from "@/lib/game/farm/clock";
import {
  boughtText, GIFT_TEXT, harvestText, harvesterDoneText, loadedText, NOT_OPEN, pickingText, produceSaleText, riceSaleText,
  WORK_EXPIRED,
} from "@/lib/game/farm/messages";
import type { FieldAction, PartAnswer } from "@/lib/game/farm/rpc";
import type { PlotView } from "@/lib/game/farm/state";
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

/** A 3-second job in progress (transplanting, setting out the ớt, a hoa-màu picking): movement is locked until it is
 *  sent or cancelled (spec §16). `text` is the bar's line. */
export interface FarmWork { plot: number; work: "transplant" | "harvest"; startedAt: number; text: string }

/** A rice harvest round (v15.2 §6.2): HarvestGame plays it, the controller talks to the server. */
export interface FarmRound {
  plot: number;
  /** The part this round cuts, 1–6. */
  part: number;
  /** Seeds the round's sweet bands. */
  seed: number;
  /** When the begin_work answer arrived (client ms): a won round is claimed PART_WAIT_MS after it. */
  begunAt: number;
  /** playing → waiting (the 9 s, "Đang bó lúa…") → won; or lost; or refused (by the server, or left idle too long). */
  phase: "playing" | "waiting" | "won" | "lost" | "refused";
  /** The round's score once it is over. */
  score: number | null;
  /** The part won. */
  result: PartAnswer | null;
  /** A refusal's text (read in the round's context). */
  message: string | null;
  /** The claim has been on its way CLAIM_SLOW_MS: the overlay may close, and its answer still lands in the state. */
  slow: boolean;
}

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
  /** A harvest round, open in its overlay. */
  round: FarmRound | null;
  /** The overlay's round ended: a pass is claimed at 9 s, a fail is reported at once. */
  endRound: (pass: boolean, score: number) => void;
  /** "Gặt tiếp" or "Thử lại": a new round on the same plot (a new begin_work, once a lost round's report has landed). */
  nextRound: () => void;
  /** "Nghỉ tay", "Đóng" or Esc: the overlay closes and nothing is sent; a begin_work answer still to come is dropped. */
  closeRound: () => void;
  /** A land, farming or drying action (a work action starts the progress, a round opens HarvestGame); `done` is toasted
   *  when it succeeds. */
  act: (a: PlotRun, done?: string) => Promise<boolean>;
  buy: (itemId: string, qty: number) => Promise<boolean>;
  sell: (variety: string, dry: boolean, kg: number) => Promise<boolean>;
  loadSprayer: (itemId: string) => Promise<boolean>;
  sellProduce: (upland: string, kg: number) => Promise<boolean>;
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
/** A harvest round re-sends `fa 2` this often while it runs (an `fa` lasts 2.5 s; v15.2 R14). */
export const ROUND_FA_MS = 2000;
/** A round still played this long after its begin_work answer ends as too long, 10 s before the server's window (R6)
 *  would refuse its claim: an idle round would otherwise re-send `fa 2` for ever. */
export const ROUND_LIMIT_MS = PART_WINDOW_MS - 10_000;
/** A claim this long on its way lets the overlay close ("Nghỉ tay", Esc); its answer still lands in the state. */
export const CLAIM_SLOW_MS = 15_000;
/** A harvester of mine is fetched this long after its end, on the server's clock (R15), and again after
 *  HARVESTER_RETRY_MS while it still shows, at most HARVESTER_TRIES times. */
export const HARVESTER_REFETCH_MS = 1000;
const HARVESTER_RETRY_MS = 2000;
const HARVESTER_TRIES = 3;
/** How often the clock ticks while on the field, and while a harvester runs there (its countdowns, v15.2 §13.1, §13.3). */
const TICK_MS = 30_000;
const MACHINE_TICK_MS = 1000;
/** The animation each instant action plays (the work actions and the rounds play theirs while they run; v15.2 §12). */
const ANIM: Partial<Record<FieldAction["kind"], FarmAnim>> = {
  prepare: FARM_ANIM.prepare, prepare_beds: FARM_ANIM.prepare, tend: FARM_ANIM.prepare, water: FARM_ANIM.pump, spray: FARM_ANIM.spray,
  fertilize: FARM_ANIM.fertilize, pick_snails: FARM_ANIM.snails,
};
const FIELD_KINDS: ReadonlySet<string> = new Set(["plot", "coop", "farm_shop", "rice_depot", "drying"]);

/** A round is being played or waits for its claim: no other job or round starts. */
const roundOn = (r: FarmRound | null): boolean => r !== null && (r.phase === "playing" || r.phase === "waiting");
/** The round showing is still `r` (not closed or replaced meanwhile). */
const sameRound = (showing: FarmRound | null, r: FarmRound): boolean => showing?.plot === r.plot && showing.begunAt === r.begunAt;

/** Planting: cuttings are set like seedlings (1); seed is sown (5) — gieo bắp, ươm ớt. */
function plantAnim(catalog: FarmCatalog | null, item: string): FarmAnim {
  const upland = catalog?.items.find((i) => i.id === item)?.upland;
  return catalog?.uplands.find((u) => u.id === upland)?.method === "cutting" ? FARM_ANIM.transplant : FARM_ANIM.fertilize;
}

/** A 3-second job's animation and bar line: rice is transplanted; on beds the ớt is set out and the crops are dug or
 *  picked by their config. */
function workLook(p: PlotView | undefined, catalog: FarmCatalog | null, w: FarmWork["work"], plot: number): { anim: FarmAnim; text: string } {
  const u = p?.crop?.kind === "upland" ? catalog?.uplands.find((x) => x.id === p.crop!.upland) : undefined;
  if (u && w === "harvest") return { anim: u.harvestAnim === "dig" ? FARM_ANIM.dig : FARM_ANIM.pick, text: `🧺 Đang ${lower(u.harvestLabel)} thửa ${plot}…` };
  if (u) return { anim: FARM_ANIM.transplant, text: `🌱 Đang ${lower(u.transplantLabel ?? "Trồng cây con")} thửa ${plot}…` };
  return w === "transplant"
    ? { anim: FARM_ANIM.transplant, text: `🌱 Đang cấy thửa ${plot}…` }
    : { anim: FARM_ANIM.harvest, text: `🌾 Đang gặt thửa ${plot}…` };
}

/** Everything farming for the game shell (spec §7–§8, §12–§13; v15.2 §6, §12–§13): the field, the clock, the prompts,
 *  the panels, the due tasks and the plots on the canvas, the newcomer gift, the actions with their animations (`fa`)
 *  and the others' refetch (`fp`), the 3-second jobs, the harvest rounds and the end of my harvesters. */
export function useFarmController({ token, roomId, accountId, mapId, canvas, toast, onCoinsChanged }: FarmControllerOptions): FarmController {
  const active = mapId === "field";
  const data = useField(roomId, token, active, toast);
  const { state, catalog, notOpen, run, claimGift, buyItem, sellRice, reload } = data;
  const [panel, setPanel] = useState<FarmPanel | null>(null);
  const [busy, setBusy] = useState(false);
  const [work, setWork] = useState<FarmWork | null>(null);
  const [round, setRound] = useState<FarmRound | null>(null);
  const live = useRef({ toast, onCoinsChanged, state, catalog, notOpen, round });
  useEffect(() => {
    live.current = { toast, onCoinsChanged, state, catalog, notOpen, round };
  });

  // --- the clock: an answer carries the server's time, and a tick moves it on while I am on the field — every second
  //     while a harvester runs there
  const [tick, setTick] = useState(0);
  const now = Math.max(tick, state?.serverNow ?? 0);
  const machine = state?.plots.some((p) => p.crop?.harvester && p.crop.harvester.endsAt > now) ?? false;
  useEffect(() => {
    if (!active) return;
    const beat = () => setTick(serverNow());
    const first = setTimeout(beat, 0);
    const timer = setInterval(beat, machine ? MACHINE_TICK_MS : TICK_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [active, machine]);

  // --- due tasks, and the plots on the canvas with my urgent rings
  const tasks = useMemo(() => (state && catalog ? dueTasks(state.plots, accountId, catalog, state.mine, now) : []), [state, catalog, accountId, now]);
  useEffect(() => {
    if (!active || !state) return;
    const urgentPlots = new Set(tasks.filter((t) => t.urgent).map((t) => t.plot));
    canvas()?.setPlots(plotDraws(state.plots, catalog ?? { varieties: [], uplands: [] }, urgentPlots, now));
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

  // --- 3-second jobs: begin_work, the progress (movement locked), then the action with q = 1.0
  const workTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (workTimer.current) clearTimeout(workTimer.current);
  }, []);
  const finishWork = useCallback(async (plot: number, w: FarmWork["work"], done?: string) => {
    const r = await run({ kind: w, plot, quality: 1 });
    setWork(null);
    if (!r) return;
    canvas()?.plotChanged(plot);
    const cat = live.current.catalog;
    if (r.picking) {
      const u = cat?.uplands.find((x) => x.id === r.picking!.upland);
      live.current.toast(pickingText(r.picking.kg, u?.name ?? r.picking.upland, r.picking.k, r.picking.pickings));
    } else if (r.harvest) {
      // a whole rice harvest: a database without 0016
      const name = cat?.varieties.find((v) => v.id === r.harvest!.variety)?.name ?? r.harvest.variety;
      live.current.toast(harvestText(r.harvest.kg, name));
    } else if (done) {
      live.current.toast(done);
    }
  }, [run, canvas]);
  const startWork = useCallback(async (plot: number, w: FarmWork["work"], done?: string): Promise<boolean> => {
    if (workTimer.current || roundOn(live.current.round)) return false;
    setBusy(true);
    const begun = await run({ kind: "begin_work", plot, work: w });
    setBusy(false);
    if (!begun) return false;
    const c = canvas();
    const spot = getMap("field").interactables.find((i) => i.plot === plot);
    if (spot) c?.plant(spot.use, spot.face ?? "up");
    const look = workLook(begun.state.plots.find((p) => p.no === plot), live.current.catalog, w, plot);
    c?.farmAnim(look.anim);
    setPanel(null);
    setWork({ plot, work: w, startedAt: Date.now(), text: look.text });
    workTimer.current = setTimeout(() => {
      workTimer.current = null;
      void finishWork(plot, w, done);
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

  // --- harvest rounds (v15.2 §6.2): begin_work, the game with fa 2 every 2 s, then harvest_part — a pass 9 s after the
  // begin_work answer, a fail at once. Esc sends nothing: the server's record expires or the next begin_work replaces it.
  const roundAnim = useRef<ReturnType<typeof setInterval> | null>(null);
  /** The round's one pending timer: its idle limit while it is played, then the claim's 9 s, then the slow claim's way out. */
  const roundTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** A lost round's report: it clears the server's record, so the next begin_work waits until it has landed. */
  const lostReport = useRef<Promise<unknown> | null>(null);
  /** Counts the overlay's closes: a begin_work answer that comes back after one is dropped. */
  const closes = useRef(0);
  const stopRoundAnim = useCallback(() => {
    if (!roundAnim.current) return;
    clearInterval(roundAnim.current);
    roundAnim.current = null;
    canvas()?.farmAnim(FARM_ANIM.stop);
  }, [canvas]);
  useEffect(() => () => {
    if (roundAnim.current) clearInterval(roundAnim.current);
    if (roundTimer.current) clearTimeout(roundTimer.current);
  }, []);
  const startRound = useCallback(async (plot: number): Promise<boolean> => {
    if (workTimer.current || roundOn(live.current.round)) return false;
    const closed = closes.current;
    setBusy(true);
    // a lost round's report goes first: landing after this begin_work, it would clear the new record
    await lostReport.current;
    const begun = closes.current === closed ? await run({ kind: "begin_work", plot, work: "harvest" }) : null;
    setBusy(false);
    // closed meanwhile (Esc, Nghỉ tay, the field left): the answer is dropped and the round stays closed
    if (!begun || closes.current !== closed) return false;
    const c = canvas();
    const spot = getMap("field").interactables.find((i) => i.plot === plot);
    if (spot) c?.plant(spot.use, spot.face ?? "up");
    c?.farmAnim(FARM_ANIM.harvest);
    if (roundAnim.current) clearInterval(roundAnim.current);
    roundAnim.current = setInterval(() => canvas()?.farmAnim(FARM_ANIM.harvest), ROUND_FA_MS);
    setPanel(null);
    const parts = begun.state.plots.find((p) => p.no === plot)?.crop?.parts ?? 0;
    const r: FarmRound = {
      plot, part: parts + 1, seed: Math.floor(Math.random() * 0x7fffffff), begunAt: Date.now(), phase: "playing", score: null,
      result: null, message: null, slow: false,
    };
    setRound(r);
    // a round left idle ends before the server's window would refuse its claim, and its fa 2 with it
    if (roundTimer.current) clearTimeout(roundTimer.current);
    roundTimer.current = setTimeout(() => {
      roundTimer.current = null;
      if (!sameRound(live.current.round, r) || live.current.round?.phase !== "playing") return;
      stopRoundAnim();
      setRound({ ...r, phase: "refused", message: WORK_EXPIRED });
    }, ROUND_LIMIT_MS);
    return true;
  }, [run, canvas, stopRoundAnim]);
  const claimPart = useCallback(async (r: FarmRound) => {
    // a claim slow on its way lets the overlay close; its answer still lands in the state
    const slow = setTimeout(() => {
      if (roundTimer.current === slow) roundTimer.current = null;
      if (sameRound(live.current.round, r)) setRound({ ...r, slow: true });
    }, CLAIM_SLOW_MS);
    roundTimer.current = slow;
    let refusal: string | null = null;
    const ans = await run({ kind: "harvest_part", plot: r.plot, success: true }, undefined, (text) => { refusal = text; });
    clearTimeout(slow);
    if (roundTimer.current === slow) roundTimer.current = null;
    // the part changed the plot for everyone, even when the overlay was closed meanwhile
    if (ans) canvas()?.plotChanged(r.plot);
    if (!sameRound(live.current.round, r)) return;
    if (!ans) {
      // a strike shows its modal instead of a text
      setRound(refusal === null ? null : { ...r, phase: "refused", message: refusal });
      return;
    }
    setRound({ ...r, phase: "won", result: ans.harvestPart });
  }, [run, canvas]);
  const endRound = useCallback((pass: boolean, score: number) => {
    const r = live.current.round;
    if (!r || r.phase !== "playing") return;
    stopRoundAnim();
    if (roundTimer.current) clearTimeout(roundTimer.current);
    roundTimer.current = null;
    if (!pass) {
      setRound({ ...r, phase: "lost", score });
      // reported at once, with no gate: it clears the server's record and cuts nothing (R7)
      lostReport.current = run({ kind: "harvest_part", plot: r.plot, success: false }, undefined, () => {});
      return;
    }
    const waiting: FarmRound = { ...r, phase: "waiting", score };
    setRound(waiting);
    roundTimer.current = setTimeout(() => {
      roundTimer.current = null;
      void claimPart(waiting);
    }, Math.max(0, r.begunAt + PART_WAIT_MS - Date.now()));
  }, [run, stopRoundAnim, claimPart]);
  const nextRound = useCallback(() => {
    const r = live.current.round;
    if (r && !roundOn(r)) void startRound(r.plot);
  }, [startRound]);
  const closeRound = useCallback(() => {
    closes.current += 1;
    if (roundTimer.current) clearTimeout(roundTimer.current);
    roundTimer.current = null;
    stopRoundAnim();
    setRound(null);
  }, [stopRoundAnim]);
  useEffect(() => {
    if (active) return;
    cancelWork();
    // leaving the field ends a round too (in a task, as the change of map has rendered)
    const t = setTimeout(closeRound, 0);
    return () => clearTimeout(t);
  }, [active, cancelWork, closeRound]);

  // --- my harvesters (R15): fetched at the end + 1 s, then fp, and a toast with the wet rice they brought
  const harvesterTries = useRef(new Map<string, number>());
  const harvesterEnded = useCallback(async (plot: number, variety: string, key: string) => {
    harvesterTries.current.set(key, (harvesterTries.current.get(key) ?? 0) + 1);
    const before = live.current.state?.mine.rice[variety]?.wet ?? 0;
    const s = await reload();
    if (!s || s.plots.find((p) => p.no === plot)?.crop?.harvester) return;
    canvas()?.plotChanged(plot);
    const got = (s.mine.rice[variety]?.wet ?? 0) - before;
    const name = live.current.catalog?.varieties.find((v) => v.id === variety)?.name ?? variety;
    if (got > 0) live.current.toast(harvesterDoneText(plot, got, name));
  }, [reload, canvas]);
  useEffect(() => {
    if (!active || !state) return;
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    for (const p of state.plots) {
      const job = p.crop?.harvester;
      if (!job || p.farmer?.id !== accountId) continue;
      const key = `${p.no}:${job.endsAt}`;
      const tries = harvesterTries.current.get(key) ?? 0;
      if (tries >= HARVESTER_TRIES) continue;
      const wait = tries === 0 ? job.endsAt + HARVESTER_REFETCH_MS - serverNow() : HARVESTER_RETRY_MS;
      const variety = p.crop!.variety ?? "";
      timers.push(setTimeout(() => void harvesterEnded(p.no, variety, key), Math.max(0, wait)));
    }
    return () => timers.forEach(clearTimeout);
  }, [active, state, accountId, harvesterEnded]);

  // --- the actions
  const act = useCallback(async (a: PlotRun, done?: string): Promise<boolean> => {
    if (a.kind === "work") return startWork(a.plot, a.work, done);
    if (a.kind === "round") return startRound(a.plot);
    setBusy(true);
    try {
      const itemName = "item" in a ? live.current.catalog?.items.find((i) => i.id === a.item)?.name : undefined;
      const r = await run(a, itemName);
      if (!r) return false;
      const c = canvas();
      const anim = a.kind === "plant" ? plantAnim(live.current.catalog, a.item) : ANIM[a.kind];
      if (anim) c?.farmAnim(anim);
      c?.plotChanged("plot" in a ? a.plot : 0);
      if (done) live.current.toast(done);
      return true;
    } finally {
      setBusy(false);
    }
  }, [run, canvas, startWork, startRound]);
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
  const { loadSprayer: loadTank, sellProduce: sellCrop } = data;
  const loadSprayer = useCallback(async (itemId: string): Promise<boolean> => {
    setBusy(true);
    try {
      const name = live.current.catalog?.items.find((i) => i.id === itemId)?.name ?? itemId;
      const r = await loadTank(itemId, name);
      if (r) live.current.toast(loadedText(name));
      return r !== null;
    } finally {
      setBusy(false);
    }
  }, [loadTank]);
  const sellProduce = useCallback(async (upland: string, kg: number): Promise<boolean> => {
    setBusy(true);
    try {
      const before = live.current.state?.mine.coins ?? 0;
      const u = live.current.catalog?.uplands.find((x) => x.id === upland);
      const r = await sellCrop(upland, kg);
      if (r) live.current.toast(produceSaleText(kg, u?.name ?? upland, u ? producePrice(kg, u) : r.mine.coins - before));
      return r !== null;
    } finally {
      setBusy(false);
    }
  }, [sellCrop]);

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
    round,
    endRound,
    nextRound,
    closeRound,
    act,
    buy,
    sell,
    loadSprayer,
    sellProduce,
    interact,
    promptText,
  };
}
