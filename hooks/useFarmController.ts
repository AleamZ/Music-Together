"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { GameCanvasHandle } from "@/components/game/GameCanvas";
import { useField, type FieldData } from "@/hooks/useField";
import { plotDraws } from "@/lib/game/art/crops";
import { dueTasks, lower, plotPrompt, type FarmTask, type PlotRun } from "@/lib/game/farm/actions";
import { PART_WAIT_MS, PART_WINDOW_MS, producePrice, ricePrice, type FarmCatalog } from "@/lib/game/farm/catalog";
import { serverNow } from "@/lib/game/farm/clock";
import {
  BED_BAR_MS, CRAB_FINISH_WAIT_MS, gatherPrompt, heldBox, spotKey, spotState, TRANSPLANT_WAIT_MS,
} from "@/lib/game/farm/gather";
import {
  bedEmptyText, bedResultText, boughtText, CRAB_GAVE_UP, crabResultText, critterSaleText, crittersFullText, FIELD_LOADING,
  GATHER_LIMIT_TEXT, GIFT_TEXT, harvestText, harvesterDoneText, holeEmptyText, loadedText, NOT_OPEN, NOT_OPEN_153, pestSnailText,
  pickingText, produceSaleText, riceSaleText, WORK_EXPIRED, WORK_EXPIRED_TP,
} from "@/lib/game/farm/messages";
import type { CrabVisit, FieldAction, PartAnswer } from "@/lib/game/farm/rpc";
import type { FieldState, PlotView } from "@/lib/game/farm/state";
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

/** A 3-second hoa-màu picking in progress: movement is locked until it is sent or cancelled (spec §16). `text` is the
 *  bar's line. */
export interface FarmWork { plot: number; work: "harvest"; startedAt: number; text: string }

/** A round: a rice part (HarvestGame, v15.2 §6.2) or a transplant (TransplantGame, v15.3 §8). The overlay plays it,
 *  the controller talks to the server. */
export interface FarmRound {
  game: "harvest" | "transplant";
  plot: number;
  /** The part a harvest round cuts, 1–6 (0 in a transplant round). */
  part: number;
  /** A transplant round on beds: the ớt seedlings, "cây" in its texts. */
  ot: boolean;
  /** Seeds the round's bands. */
  seed: number;
  /** When the begin_work answer arrived (client ms): a won round is claimed 9 s after it. */
  begunAt: number;
  /** playing → waiting (the 9 s: "Đang bó lúa…", "Đang cắm nốt hàng mạ…") → won; or lost; or refused (by the server, or
   *  left idle too long). */
  phase: "playing" | "waiting" | "won" | "lost" | "refused";
  /** The round's score once it is over. */
  score: number | null;
  /** The part won (a harvest round). */
  result: PartAnswer | null;
  /** A refusal's text (read in the round's context). */
  message: string | null;
  /** The claim has been on its way CLAIM_SLOW_MS: the overlay may close, and its answer still lands in the state. */
  slow: boolean;
}

/** A crab visit (v15.3 §7.2): CrabGame plays it at a hole, the controller talks to the server. */
export interface FarmCrab {
  hole: number;
  /** The server's visit, from crab_start. */
  visit: CrabVisit;
  /** Seeds the claws' phases. */
  seed: number;
  /** When crab_start's answer arrived (client ms): a catch is sent CRAB_FINISH_WAIT_MS after it (R7). */
  begunAt: number;
  /** playing → waiting (a catch waits out its 4 s, "Đang bỏ cua vào xô…"; hits 0 go at once) → done; or refused. */
  phase: "playing" | "waiting" | "done" | "refused";
  /** The hits reported. */
  hits: number | null;
  /** What the visit brought, or a refusal, in words. */
  message: string | null;
}

/** A snail bed's 3-second bar (v15.3 §7.3): movement stays free, and moving cancels it. `text` is the bar's line. */
export interface FarmBed { bed: number; startedAt: number; text: string }

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
  /** A round, open in its overlay. */
  round: FarmRound | null;
  /** The overlay's round ended: a pass is claimed at 9 s; a harvest round's fail is reported at once, a transplant
   *  round's sends nothing. */
  endRound: (pass: boolean, score: number) => void;
  /** "Gặt tiếp" or "Thử lại": a new round of the same game on the same plot (a new begin_work, once a lost harvest
   *  round's report has landed). */
  nextRound: () => void;
  /** "Nghỉ tay", "Đóng" or Esc: the overlay closes and nothing is sent; a begin_work answer still to come is dropped. */
  closeRound: () => void;
  /** A crab visit, open in CrabGame. */
  crab: FarmCrab | null;
  /** CrabGame ended with `hits` (0–3), by itself or by Dừng after a try: a catch is sent 4 s after crab_start's answer,
   *  hits 0 at once (R7). */
  endCrab: (hits: number) => void;
  /** Dừng, Esc or Đóng (R8): before a try ends nothing is sent; a catch waiting out its 4 s is still sent, and toasted. */
  closeCrab: () => void;
  /** A snail bed's bar, running. */
  bed: FarmBed | null;
  /** "Huỷ" or Esc: the bar stops before anything is sent. */
  cancelBed: () => void;
  /** I moved (the canvas): a snail bed's bar stops before anything is sent (§7.3). */
  moved: () => void;
  /** A land, farming or drying action (a picking starts the progress, a round opens its game); `done` is toasted when it
   *  succeeds. */
  act: (a: PlotRun, done?: string) => Promise<boolean>;
  buy: (itemId: string, qty: number) => Promise<boolean>;
  sell: (variety: string, dry: boolean, kg: number) => Promise<boolean>;
  loadSprayer: (itemId: string) => Promise<boolean>;
  sellProduce: (upland: string, kg: number) => Promise<boolean>;
  /** cô Út buys my critters of a kind, or all of them (null), at their stored prices (v15.3 §7.6). */
  sellCritters: (kind: string | null) => Promise<boolean>;
  /** Handles the field's interactables; false for anything else. */
  interact: (it: Interactable) => boolean;
  /** A plot's prompt names my next job there, a hole's or a bed's its state for me (v15.3 §13.1); the field's other
   *  interactables keep theirs; null = not the field's. */
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

/** A hoa-màu picking takes this long on screen (the server's gate is 2 s; spec §4, §11.4). */
export const WORK_MS = 3000;
/** A round re-sends its `fa` this often while it runs (an `fa` lasts 2.5 s; v15.2 R14, v15.3 §12). */
export const ROUND_FA_MS = 2000;
/** A round still played this long after its begin_work answer ends as too long, 10 s before the server's window (R6; a
 *  transplant's is the same, v15.3 §8.3) would refuse its claim: an idle round would otherwise re-send its `fa` for
 *  ever. */
export const ROUND_LIMIT_MS = PART_WINDOW_MS - 10_000;
/** A claim this long on its way lets the overlay close ("Nghỉ tay", Esc); its answer still lands in the state. */
export const CLAIM_SLOW_MS = 15_000;
/** Each round's animation, and how long after its begin_work answer a won round is claimed (the gate is 8 s). */
const ROUND_ANIM: Record<FarmRound["game"], FarmAnim> = { harvest: FARM_ANIM.harvest, transplant: FARM_ANIM.transplant };
const ROUND_WAIT_MS: Record<FarmRound["game"], number> = { harvest: PART_WAIT_MS, transplant: TRANSPLANT_WAIT_MS };
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
const FIELD_KINDS: ReadonlySet<string> = new Set(["plot", "coop", "farm_shop", "rice_depot", "drying", "crab_hole", "snail_bed"]);

/** A round is being played or waits for its claim: no other job or round starts. */
const roundOn = (r: FarmRound | null): boolean => r !== null && (r.phase === "playing" || r.phase === "waiting");
/** The round showing is still `r` (not closed or replaced meanwhile). */
const sameRound = (showing: FarmRound | null, r: FarmRound): boolean => showing?.plot === r.plot && showing.begunAt === r.begunAt;
/** The crab visit showing is still `c`. */
const sameCrab = (showing: FarmCrab | null, c: FarmCrab): boolean => showing?.visit.id === c.visit.id;

/** Why a hole or a bed cannot be visited now (v15.3 §13.1), in the server's refusal order, or null: it is ready. */
function gatherRefusal(it: Interactable, s: FieldState | null, catalog: FarmCatalog | null, now: number): string | null {
  if (!s || !catalog) return FIELD_LOADING;
  // before 0018 the catalog has no critters (R23)
  if (catalog.critters.length === 0) return NOT_OPEN_153;
  const st = spotState(it, s.mine, catalog, now);
  switch (st.kind) {
    case "limit": return GATHER_LIMIT_TEXT;
    case "full": return crittersFullText(st.box?.name ?? null);
    case "cooling": return it.kind === "crab_hole" ? holeEmptyText(st.readyAt - now) : bedEmptyText(st.readyAt - now);
    case "ready": return null;
  }
}

/** The container a `critters full` refusal names (v15.3 §11.8): the largest one held, as the capacity counts it (R5);
 *  undefined for bare hands. The server refuses what the state did not foresee only when that state is stale. */
function boxHeld(s: FieldState | null, catalog: FarmCatalog | null): string | undefined {
  return s ? heldBox(s.mine.items, catalog?.items ?? [])?.name : undefined;
}

/** Planting: cuttings are set like seedlings (1); seed is sown (5) — gieo bắp, ươm ớt. */
function plantAnim(catalog: FarmCatalog | null, item: string): FarmAnim {
  const upland = catalog?.items.find((i) => i.id === item)?.upland;
  return catalog?.uplands.find((u) => u.id === upland)?.method === "cutting" ? FARM_ANIM.transplant : FARM_ANIM.fertilize;
}

/** A picking's animation and bar line: the crop's config digs or picks; rice (a database without 0016) is cut. */
function workLook(p: PlotView | undefined, catalog: FarmCatalog | null, plot: number): { anim: FarmAnim; text: string } {
  const u = p?.crop?.kind === "upland" ? catalog?.uplands.find((x) => x.id === p.crop!.upland) : undefined;
  if (u) return { anim: u.harvestAnim === "dig" ? FARM_ANIM.dig : FARM_ANIM.pick, text: `🧺 Đang ${lower(u.harvestLabel)} thửa ${plot}…` };
  return { anim: FARM_ANIM.harvest, text: `🌾 Đang gặt thửa ${plot}…` };
}

/** Everything farming for the game shell (spec §7–§8, §12–§13; v15.2 §6, §12–§13; v15.3 §7–§8): the field, the clock,
 *  the prompts, the panels, the due tasks and the plots on the canvas, the newcomer gift, the actions with their
 *  animations (`fa`) and the others' refetch (`fp`), the 3-second pickings, the harvest and transplant rounds, the crab
 *  visits and the end of my harvesters. */
export function useFarmController({ token, roomId, accountId, mapId, canvas, toast, onCoinsChanged }: FarmControllerOptions): FarmController {
  const active = mapId === "field";
  const data = useField(roomId, token, active, toast);
  const { state, catalog, notOpen, run, claimGift, buyItem, sellRice, reload, crabStart, crabFinish, pickSnailBed } = data;
  const [panel, setPanel] = useState<FarmPanel | null>(null);
  const [busy, setBusy] = useState(false);
  const [work, setWork] = useState<FarmWork | null>(null);
  const [round, setRound] = useState<FarmRound | null>(null);
  const [crab, setCrab] = useState<FarmCrab | null>(null);
  const [bed, setBed] = useState<FarmBed | null>(null);
  const live = useRef({ toast, onCoinsChanged, state, catalog, notOpen, round, crab });
  useEffect(() => {
    live.current = { toast, onCoinsChanged, state, catalog, notOpen, round, crab };
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

  // --- the ready cue on each hole and bed (v15.3 §13.1): open (0018 has critters) and not cooling for me; it follows every
  //     answer and the clock's tick
  useEffect(() => {
    if (!active) return;
    const open = state !== null && (catalog?.critters.length ?? 0) > 0;
    const readyAt = state?.mine.gather.readyAt ?? {};
    canvas()?.setGatherSpots(getMap("field").interactables
      .filter((i) => i.kind === "crab_hole" || i.kind === "snail_bed")
      .map((i) => ({ id: i.id, ready: open && !((readyAt[spotKey(i.id) ?? ""] ?? 0) > now) })));
  }, [active, state, catalog, now, canvas]);

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

  // --- 3-second pickings: begin_work, the progress (movement locked), then harvest with q = 1.0
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
    if (workTimer.current || roundOn(live.current.round) || live.current.crab) return false;
    setBusy(true);
    const begun = await run({ kind: "begin_work", plot, work: w });
    setBusy(false);
    if (!begun) return false;
    const c = canvas();
    const spot = getMap("field").interactables.find((i) => i.plot === plot);
    if (spot) c?.plant(spot.use, spot.face ?? "up");
    const look = workLook(begun.state.plots.find((p) => p.no === plot), live.current.catalog, plot);
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

  // --- rounds (v15.2 §6.2, v15.3 §8): begin_work, the game with its fa re-sent every 2 s (2 cuts rice, 1 transplants),
  // then the claim of a pass 9 s after the begin_work answer, harvest_part or transplant. A lost harvest round is
  // reported at once; a lost transplant round sends nothing. Esc sends nothing: the server's record expires or the next
  // begin_work replaces it.
  const roundAnim = useRef<ReturnType<typeof setInterval> | null>(null);
  /** The round's one pending timer: its idle limit while it is played, then the claim's 9 s, then the slow claim's way out. */
  const roundTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** A lost harvest round's report: it clears the server's record, so the next begin_work waits until it has landed. */
  const lostReport = useRef<Promise<unknown> | null>(null);
  /** Counts the round overlay's closes (leaving the field is one, counted in the commit that leaves it): a begin_work or
   *  crab_start answer that comes back after one is dropped. */
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
  const startRound = useCallback(async (plot: number, game: FarmRound["game"]): Promise<boolean> => {
    if (workTimer.current || roundOn(live.current.round) || live.current.crab) return false;
    const closed = closes.current;
    setBusy(true);
    // a lost round's report goes first: landing after this begin_work, it would clear the new record
    await lostReport.current;
    const begun = closes.current === closed ? await run({ kind: "begin_work", plot, work: game }) : null;
    setBusy(false);
    // closed meanwhile (Esc, Nghỉ tay, the field left), or the canvas shows another map by now: the answer is dropped and
    // the round stays closed
    const c = canvas();
    if (!begun || closes.current !== closed || c?.mapId() !== "field") return false;
    const spot = getMap("field").interactables.find((i) => i.plot === plot);
    if (spot) c?.plant(spot.use, spot.face ?? "up");
    const anim = ROUND_ANIM[game];
    c?.farmAnim(anim);
    if (roundAnim.current) clearInterval(roundAnim.current);
    roundAnim.current = setInterval(() => canvas()?.farmAnim(anim), ROUND_FA_MS);
    setPanel(null);
    const crop = begun.state.plots.find((p) => p.no === plot)?.crop;
    const r: FarmRound = {
      game, plot, part: game === "harvest" ? (crop?.parts ?? 0) + 1 : 0, ot: crop?.kind === "upland",
      seed: Math.floor(Math.random() * 0x7fffffff), begunAt: Date.now(), phase: "playing", score: null, result: null, message: null,
      slow: false,
    };
    setRound(r);
    // a round left idle ends before the server's window would refuse its claim, and its fa with it
    if (roundTimer.current) clearTimeout(roundTimer.current);
    roundTimer.current = setTimeout(() => {
      roundTimer.current = null;
      if (!sameRound(live.current.round, r) || live.current.round?.phase !== "playing") return;
      stopRoundAnim();
      setRound({ ...r, phase: "refused", message: game === "harvest" ? WORK_EXPIRED : WORK_EXPIRED_TP });
    }, ROUND_LIMIT_MS);
    return true;
  }, [run, canvas, stopRoundAnim]);
  const claimRound = useCallback(async (r: FarmRound) => {
    // a claim slow on its way lets the overlay close; its answer still lands in the state
    const slow = setTimeout(() => {
      if (roundTimer.current === slow) roundTimer.current = null;
      if (sameRound(live.current.round, r)) setRound({ ...r, slow: true });
    }, CLAIM_SLOW_MS);
    roundTimer.current = slow;
    let refusal: string | null = null;
    const refused = (text: string) => { refusal = text; };
    // the transplant's quality is ignored for good, and always 1 (v15.3 R20)
    const ans = r.game === "harvest"
      ? await run({ kind: "harvest_part", plot: r.plot, success: true }, undefined, refused)
      : await run({ kind: "transplant", plot: r.plot, quality: 1 }, undefined, refused);
    clearTimeout(slow);
    if (roundTimer.current === slow) roundTimer.current = null;
    // the claim changed the plot for everyone, even when the overlay was closed meanwhile
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
      // a harvest round's fail is reported at once, with no gate: it clears the server's record and cuts nothing (v15.2
      // R7); a transplant round's sends nothing (v15.3 R19)
      if (r.game === "harvest") {
        lostReport.current = run({ kind: "harvest_part", plot: r.plot, success: false }, undefined, () => {});
      }
      return;
    }
    const waiting: FarmRound = { ...r, phase: "waiting", score };
    setRound(waiting);
    roundTimer.current = setTimeout(() => {
      roundTimer.current = null;
      void claimRound(waiting);
    }, Math.max(0, r.begunAt + ROUND_WAIT_MS[r.game] - Date.now()));
  }, [run, stopRoundAnim, claimRound]);
  const nextRound = useCallback(() => {
    const r = live.current.round;
    if (r && !roundOn(r)) void startRound(r.plot, r.game);
  }, [startRound]);
  const closeRound = useCallback(() => {
    closes.current += 1;
    if (roundTimer.current) clearTimeout(roundTimer.current);
    roundTimer.current = null;
    stopRoundAnim();
    setRound(null);
  }, [stopRoundAnim]);

  // --- crab holes (v15.3 §7.2): crab_start, CrabGame with fa 6 every 2 s, then crab_finish — a catch no earlier than 4 s
  // after crab_start's answer, hits 0 at once (R7). Dừng before a try ends sends nothing, and the hole keeps its cooldown;
  // a catch waiting out its 4 s is still sent, and toasted once the overlay has closed (R8).
  const crabAnim = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopCrabAnim = useCallback(() => {
    if (!crabAnim.current) return;
    clearInterval(crabAnim.current);
    crabAnim.current = null;
    canvas()?.farmAnim(FARM_ANIM.stop);
  }, [canvas]);
  useEffect(() => () => {
    if (crabAnim.current) clearInterval(crabAnim.current);
  }, []);
  const startCrab = useCallback(async (it: Interactable): Promise<boolean> => {
    if (it.spot === undefined || workTimer.current || roundOn(live.current.round) || live.current.crab) return false;
    const closed = closes.current;
    setBusy(true);
    const begun = await crabStart(it.spot, boxHeld(live.current.state, live.current.catalog));
    setBusy(false);
    // the field left meanwhile, or the canvas shows another map by now: the answer is dropped, and the hole keeps its
    // cooldown as after Dừng before a try (R8)
    const c = canvas();
    if (!begun || closes.current !== closed || c?.mapId() !== "field") return false;
    c?.plant(it.use, it.face ?? "down");
    c?.farmAnim(FARM_ANIM.crab);
    if (crabAnim.current) clearInterval(crabAnim.current);
    crabAnim.current = setInterval(() => canvas()?.farmAnim(FARM_ANIM.crab), ROUND_FA_MS);
    setPanel(null);
    setCrab({
      hole: it.spot, visit: begun.visit, seed: Math.floor(Math.random() * 0x7fffffff), begunAt: Date.now(), phase: "playing", hits: null,
      message: null,
    });
    return true;
  }, [crabStart, canvas]);
  const finishCrab = useCallback(async (c: FarmCrab) => {
    let refusal: string | null = null;
    const r = await crabFinish(c.visit.id, c.hits ?? 0, (text) => { refusal = text; });
    const cat = live.current.catalog;
    const text = r ? crabResultText(r.crab, cat?.critters ?? [], heldBox(r.mine.items, cat?.items ?? [])?.name ?? null) : refusal;
    if (!sameCrab(live.current.crab, c)) {
      // closed while the catch waited (R8): what it brought comes as a toast
      if (text !== null) live.current.toast(text);
      return;
    }
    // a strike shows its modal instead of a text
    setCrab(text === null ? null : { ...c, phase: r ? "done" : "refused", message: text });
  }, [crabFinish]);
  const endCrab = useCallback((hits: number) => {
    const c = live.current.crab;
    if (!c || c.phase !== "playing") return;
    stopCrabAnim();
    const waiting: FarmCrab = { ...c, phase: "waiting", hits };
    setCrab(waiting);
    if (hits === 0) {
      void finishCrab(waiting);
      return;
    }
    // not cleared on a close: the catch is kept (R8)
    setTimeout(() => void finishCrab(waiting), Math.max(0, c.begunAt + CRAB_FINISH_WAIT_MS - Date.now()));
  }, [stopCrabAnim, finishCrab]);
  /** Closes the visit's overlay. Before a try ended nothing is sent, which the toast says unless the field was left. */
  const shutCrab = useCallback((told: boolean) => {
    const c = live.current.crab;
    if (!c) return;
    stopCrabAnim();
    if (c.phase === "playing" && told) live.current.toast(CRAB_GAVE_UP);
    setCrab(null);
  }, [stopCrabAnim]);
  const closeCrab = useCallback(() => shutCrab(true), [shutCrab]);

  // --- snail beds (v15.3 §7.3): a 3 s bar with fa 7 at its start and at 2 s, then pick_snail_bed (no server gate, R9).
  // Movement stays free: moving, Huỷ or Esc stops the bar before anything is sent.
  const bedTimers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  useEffect(() => () => bedTimers.current.forEach(clearTimeout), []);
  const finishBed = useCallback(async (n: number) => {
    bedTimers.current = [];
    setBed(null);
    canvas()?.farmAnim(FARM_ANIM.stop);
    const r = await pickSnailBed(n, boxHeld(live.current.state, live.current.catalog));
    if (!r) return;
    const cat = live.current.catalog;
    live.current.toast(bedResultText(r.snails, cat?.critters ?? [], heldBox(r.mine.items, cat?.items ?? [])?.name ?? null));
  }, [pickSnailBed, canvas]);
  const startBed = useCallback((it: Interactable) => {
    if (it.spot === undefined || workTimer.current || roundOn(live.current.round) || live.current.crab || bedTimers.current.length > 0) return;
    const n = it.spot;
    const c = canvas();
    c?.plant(it.use, it.face ?? "down");
    c?.farmAnim(FARM_ANIM.snails);
    setBed({ bed: n, startedAt: Date.now(), text: `🐌 Đang mò ốc bãi ${n}…` });
    bedTimers.current = [
      setTimeout(() => canvas()?.farmAnim(FARM_ANIM.snails), ROUND_FA_MS),
      setTimeout(() => void finishBed(n), BED_BAR_MS),
    ];
  }, [canvas, finishBed]);
  const cancelBed = useCallback(() => {
    if (bedTimers.current.length === 0) return;
    bedTimers.current.forEach(clearTimeout);
    bedTimers.current = [];
    setBed(null);
    canvas()?.farmAnim(FARM_ANIM.stop);
  }, [canvas]);

  // leaving the field drops a begin_work or crab_start answer still on its way from the commit that leaves it, before the
  // canvas switches worlds (only a ref here: the overlays close in the task below)
  useLayoutEffect(() => {
    if (!active) closes.current += 1;
  }, [active]);
  useEffect(() => {
    if (active) return;
    cancelWork();
    cancelBed();
    // leaving the field ends a round and a crab visit too (in a task, as the change of map has rendered)
    const t = setTimeout(() => {
      closeRound();
      shutCrab(false);
    }, 0);
    return () => clearTimeout(t);
  }, [active, cancelWork, cancelBed, closeRound, shutCrab]);

  // --- my harvesters (R15): fetched at the end + 1 s, and again while the job still shows. The end is seen on the state's
  //     change, whichever fetch brings it: then fp, and a toast with the wet rice they brought
  const harvesterTries = useRef(new Map<string, number>());
  const harvesterEnded = useCallback(async (key: string) => {
    harvesterTries.current.set(key, (harvesterTries.current.get(key) ?? 0) + 1);
    await reload();
  }, [reload]);
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
      timers.push(setTimeout(() => void harvesterEnded(key), Math.max(0, wait)));
    }
    return () => timers.forEach(clearTimeout);
  }, [active, state, accountId, harvesterEnded]);
  // a job of mine in the last state and gone from this one has ended: its rice is the change in my wet stock
  const lastState = useRef<FieldState | null>(null);
  useEffect(() => {
    const prev = lastState.current;
    lastState.current = state;
    if (!prev || !state || prev === state) return;
    for (const p of prev.plots) {
      if (!p.crop?.harvester || p.farmer?.id !== accountId || state.plots.find((x) => x.no === p.no)?.crop?.harvester) continue;
      canvas()?.plotChanged(p.no);
      const variety = p.crop.variety ?? "";
      const got = (state.mine.rice[variety]?.wet ?? 0) - (prev.mine.rice[variety]?.wet ?? 0);
      const name = live.current.catalog?.varieties.find((v) => v.id === variety)?.name ?? variety;
      if (got > 0) live.current.toast(harvesterDoneText(p.no, got, name));
    }
  }, [state, accountId, canvas]);

  // --- the actions
  const act = useCallback(async (a: PlotRun, done?: string): Promise<boolean> => {
    if (a.kind === "work") return startWork(a.plot, a.work, done);
    if (a.kind === "round") return startRound(a.plot, a.game);
    setBusy(true);
    try {
      const itemName = "item" in a ? live.current.catalog?.items.find((i) => i.id === a.item)?.name : undefined;
      const r = await run(a, itemName);
      if (!r) return false;
      const c = canvas();
      const anim = a.kind === "plant" ? plantAnim(live.current.catalog, a.item) : ANIM[a.kind];
      if (anim) c?.farmAnim(anim);
      c?.plotChanged("plot" in a ? a.plot : 0);
      // a pest-snail pick says what the picker kept (v15.3 R10); before 0018 its answer has no snails
      const said = a.kind === "pick_snails"
        ? pestSnailText(a.plot, r.snails, heldBox(r.state.mine.items, live.current.catalog?.items ?? [])?.name ?? null)
        : done;
      if (said) live.current.toast(said);
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
  const { sellCritters: sellCatch } = data;
  const sellCritters = useCallback(async (kind: string | null): Promise<boolean> => {
    setBusy(true);
    try {
      const r = await sellCatch(kind);
      // what she paid, from the answer (the prices were fixed at the catch)
      if (r) live.current.toast(critterSaleText(r.sold.n, r.sold.xu));
      return r !== null;
    } finally {
      setBusy(false);
    }
  }, [sellCatch]);

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
      case "crab_hole":
      case "snail_bed": {
        const why = gatherRefusal(it, live.current.state, live.current.catalog, serverNow());
        if (why !== null) live.current.toast(why);
        else if (it.kind === "crab_hole") void startCrab(it);
        else startBed(it);
        break;
      }
    }
    return true;
  }, [startCrab, startBed]);
  const promptText = useCallback((it: Interactable): string | null => {
    if (!FIELD_KINDS.has(it.kind)) return null;
    if (it.kind === "crab_hole" || it.kind === "snail_bed") return gatherPrompt(it, state?.mine ?? null, catalog, now);
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
    crab,
    endCrab,
    closeCrab,
    bed,
    cancelBed,
    moved: cancelBed,
    act,
    buy,
    sell,
    loadSprayer,
    sellProduce,
    sellCritters,
    interact,
    promptText,
  };
}
