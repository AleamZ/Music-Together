"use client";

import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import type { PlotDraw } from "@/lib/game/art/crops";
import type { CardGame } from "@/lib/game/cards/deck";
import { GameEngine, type LocalFishing, type RosterEntry } from "@/lib/game/engine";
import { phaseCode } from "@/lib/game/fishing/cast";
import type { Rarity } from "@/lib/game/fishing/catalog";
import { getMap, paintMap } from "@/lib/game/maps/registry";
import type { Interactable, MapId, Spot } from "@/lib/game/maps/types";
import { budgetKind, createBudget, GAME_LIMITS } from "@/lib/game/net/budget";
import { joinGameChannel } from "@/lib/game/net/channel";
import type { FarmAnim, FishPhase, GameMessage } from "@/lib/game/net/protocol";
import { createReplyScheduler, replyWindowMs, type ReplyScheduler } from "@/lib/game/net/replies";
import type { Facing, Look, Vec } from "@/lib/game/types";

export interface GameCanvasHandle {
  setRoster: (entries: RosterEntry[]) => void;
  setLocal: (info: { name: string; badges: string; look: Look }) => void;
  showBubble: (accountId: string, text: string) => void;
  showReaction: (accountId: string | null, emoji: string) => void;
  setInputEnabled: (enabled: boolean) => void;
  interact: () => void;
  /** Tell everyone my character changed (they re-fetch it). */
  announceLook: () => void;
  /** Height of the bottom HUD (CSS px): the camera may scroll that far past the map's bottom. */
  setBottomInset: (px: number) => void;
  /** Names and rarities for the catch labels. */
  setSpecies: (list: ReadonlyArray<{ id: string; name: string; rarity: Rarity }>) => void;
  /** Stand on a fishing spot, facing the water. */
  plant: (at: Vec, facing: Facing) => void;
  /** My rod's look; the others get an `fs` when the phase they see changes. */
  setFishing: (f: LocalFishing) => void;
  /** The fish in my hand; the others get an `fs` when it changes. */
  setHand: (speciesId: string | null) => void;
  /** I landed a fish: the label over my head, the new hand fish, rod in, and one `fs` with the catch. */
  landCatch: (speciesId: string, weightG: number, hand: string | null) => void;
  /** Is someone else fishing right at this spot? */
  anglerNear: (p: Vec) => boolean;
  /** A dust puff (digging worms). */
  puff: (at: Vec) => void;
  /** What the field's plots show (crops, name posts, my urgent rings). */
  setPlots: (plots: ReadonlyArray<PlotDraw>) => void;
  /** Which of the field's crab holes and snail beds are ready for me: those show their cue (v15.3 §13.1). */
  setGatherSpots: (spots: ReadonlyArray<{ id: string; ready: boolean }>) => void;
  /** Play a farm animation on my character and show it to the others (`fa`; 0 stops it). */
  farmAnim: (a: FarmAnim) => void;
  /** Tell the others that plot `p` (0 = the drying yard or the offers) changed: they fetch the field again (`fp`). */
  plotChanged: (p: number) => void;
  /** The hall's card-table labels (v16 spec §5). */
  setCardTables: (labels: Readonly<Partial<Record<CardGame, string>>>) => void;
}

export interface GameCanvasProps {
  ref?: Ref<GameCanvasHandle | null>;
  roomId: string;
  localId: string;
  /** The map to show; a change (a portal) starts a new engine and channel there. */
  mapId: MapId;
  /** Where I appear on that map (null = its spawn). */
  arrive: Spot | null;
  /** Used when a world starts; later changes go through the handle's setLocal. */
  initial: { name: string; badges: string; look: Look };
  /** Is this account a current room member? Game messages from anyone else are dropped (spec §8.3). */
  isMember: (accountId: string) => boolean;
  /** Is this member in the room's presence, in game mode, on this map? Only movement, `hello` and `fp` are taken from
   *  members who are not (anti-cheat spec §14). */
  isHere: (accountId: string) => boolean;
  onInteract: (it: Interactable) => void;
  onPromptChange: (it: Interactable | null) => void;
  onActorClick: (accountId: string) => void;
  onConnectionChange: (connected: boolean) => void;
  onLookChanged: (accountId: string) => void;
  /** While my rod is out: a tap/click/Space ("tap") or Esc ("cancel"). */
  onFishingInput: (kind: "tap" | "cancel") => void;
  /** Someone (or my other tab) changed plot `p` on this map (`fp`). */
  onPlotChanged?: (p: number) => void;
  /** A new world drew its first frame. */
  onFirstFrame: () => void;
  /** The browser has no usable 2D canvas. */
  onUnsupported: () => void;
  /** The game loop kept failing and stopped. */
  onFatal: () => void;
}

/** The game world: one engine + one broadcast channel per map visit. */
export default function GameCanvas({ ref, roomId, localId, mapId, arrive, ...rest }: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const sendRef = useRef<((msg: GameMessage) => void) | null>(null);
  const propsRef = useRef(rest);
  // What every new engine must know again: my hand fish, the species names, the HUD inset, the input lock, the plots,
  // the card tables' labels and the gathering cues.
  const handRef = useRef<string | null>(null);
  const phaseRef = useRef<FishPhase>(0);
  const speciesRef = useRef<ReadonlyArray<{ id: string; name: string; rarity: Rarity }>>([]);
  const insetRef = useRef(0);
  const inputRef = useRef(true);
  const plotsRef = useRef<ReadonlyArray<PlotDraw>>([]);
  const cardTablesRef = useRef<Readonly<Partial<Record<CardGame, string>>>>({});
  const gatherRef = useRef<ReadonlyArray<{ id: string; ready: boolean }>>([]);
  // This world's answer to `hello`s, and who of its roster is here (null until its first roster).
  const repliesRef = useRef<ReplyScheduler | null>(null);
  const hereRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    propsRef.current = rest;
  });

  useImperativeHandle(ref, () => {
    const sendFs = (c?: [string, number]) => {
      const msg: GameMessage = c
        ? { t: "fs", id: localId, f: 0, h: handRef.current, c }
        : { t: "fs", id: localId, f: phaseRef.current, h: handRef.current };
      sendRef.current?.(msg);
    };
    return {
      setRoster: (entries) => {
        engineRef.current?.setRoster(entries);
        // a member who appears on this map gets my state too, in case the budget dropped their `hello` (anti-cheat R34)
        const here = new Set(entries.map((e) => e.id).filter((id) => propsRef.current.isHere(id)));
        const known = hereRef.current;
        if (known && [...here].some((id) => !known.has(id))) repliesRef.current?.onHello();
        hereRef.current = here;
      },
      setLocal: (info) => engineRef.current?.setLocal(info),
      showBubble: (id, text) => engineRef.current?.showBubble(id, text),
      showReaction: (id, emoji) => engineRef.current?.showReaction(id, emoji),
      setInputEnabled: (enabled) => {
        inputRef.current = enabled;
        engineRef.current?.setInputEnabled(enabled);
      },
      interact: () => engineRef.current?.interact(),
      announceLook: () => sendRef.current?.({ t: "lk", id: localId }),
      setBottomInset: (px) => {
        insetRef.current = px;
        engineRef.current?.setBottomInset(px);
      },
      setSpecies: (list) => {
        speciesRef.current = list;
        engineRef.current?.setSpecies(list);
      },
      plant: (at, facing) => engineRef.current?.plant(at, facing),
      setFishing: (f) => {
        engineRef.current?.setLocalFishing(f);
        const code = phaseCode(f.phase);
        if (code === phaseRef.current) return;
        phaseRef.current = code;
        sendFs();
      },
      setHand: (speciesId) => {
        engineRef.current?.setLocalHand(speciesId);
        if (speciesId === handRef.current) return;
        handRef.current = speciesId;
        sendFs();
      },
      landCatch: (speciesId, weightG, hand) => {
        const e = engineRef.current;
        e?.setLocalFishing({ phase: "idle" });
        e?.setLocalHand(hand);
        e?.showLocalCatch(speciesId, weightG);
        phaseRef.current = 0;
        handRef.current = hand;
        sendFs([speciesId, weightG]);
      },
      anglerNear: (p) => engineRef.current?.anglerNear(p) ?? false,
      puff: (at) => engineRef.current?.puff(at),
      setPlots: (plots) => {
        plotsRef.current = plots;
        engineRef.current?.setPlots(plots);
      },
      setGatherSpots: (spots) => {
        gatherRef.current = spots;
        engineRef.current?.setGatherSpots(spots);
      },
      farmAnim: (a) => {
        engineRef.current?.showFarmAnim(a);
        sendRef.current?.({ t: "fa", id: localId, a });
      },
      plotChanged: (p) => sendRef.current?.({ t: "fp", id: localId, p }),
      setCardTables: (labels) => {
        cardTablesRef.current = labels;
        engineRef.current?.setCardTables(labels);
      },
    };
  }, [localId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const map = getMap(mapId);
    const init = propsRef.current.initial;
    // a new map starts with the rod in (the shell cancels any cast before travelling)
    phaseRef.current = 0;
    let engine: GameEngine;
    try {
      const art = paintMap(map);
      const fontVar = getComputedStyle(document.documentElement).getPropertyValue("--font-vt323").trim();
      engine = new GameEngine(canvas, map, art, {
        onLocalMove: (m) => channel.send({ t: "mv", id: localId, ...m }),
        onLocalPath: (m) => channel.send({ t: "pa", id: localId, ...m }),
        onInteract: (it) => propsRef.current.onInteract(it),
        onPromptChange: (it) => propsRef.current.onPromptChange(it),
        onActorClick: (id) => propsRef.current.onActorClick(id),
        onFishingInput: (kind) => propsRef.current.onFishingInput(kind),
        onFirstFrame: () => propsRef.current.onFirstFrame(),
        onFatal: () => propsRef.current.onFatal(),
      }, {
        localId,
        name: init.name,
        badges: init.badges,
        look: init.look,
        start: arrive ?? map.spawn,
        fontFamily: fontVar ? `${fontVar}, monospace` : "monospace",
        reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      });
    } catch {
      propsRef.current.onUnsupported();
      return;
    }
    engine.setLocalHand(handRef.current);
    engine.setSpecies(speciesRef.current);
    engine.setBottomInset(insetRef.current);
    engine.setInputEnabled(inputRef.current);
    engine.setPlots(plotsRef.current);
    engine.setCardTables(cardTablesRef.current);
    engine.setGatherSpots(gatherRef.current);

    // One answer (my state) serves every `hello` that arrives before it goes out; answers are spread over a window
    // that grows with the world, because each one reaches every player.
    const replies = createReplyScheduler({
      send: () => channel.send(engine.snapshot()),
      windowMs: () => replyWindowMs(engine.walkers() + 1),
    });
    repliesRef.current = replies;
    hereRef.current = null;
    // what one sender may send (anti-cheat spec §14): the rest is dropped
    const budget = createBudget(GAME_LIMITS);
    const channel = joinGameChannel(roomId, map, {
      onMessage: (msg) => {
        if (msg.id === localId) {
          // Another tab of my account left the world and everyone just dropped my character: tell them where I am.
          if (msg.t === "bye") channel.send(engine.snapshot());
          // …or it changed a plot: this tab fetches the field again too
          else if (msg.t === "fp") propsRef.current.onPlotChanged?.(msg.p);
          return;
        }
        const p = propsRef.current;
        if (!p.isMember(msg.id)) return;
        // Presence arrives at least a second late: movement, a newcomer's `hello` and `fp` count before it does, the
        // rest needs the sender on this map (anti-cheat R34)
        const early = msg.t === "st" || msg.t === "mv" || msg.t === "pa" || msg.t === "hello" || msg.t === "fp";
        if (!early && !p.isHere(msg.id)) return;
        const kind = budgetKind(msg.t);
        if (kind && !budget.take(msg.id, kind, performance.now())) return;
        switch (msg.t) {
          case "hello":
            engine.noteHello(msg.id);
            replies.onHello();
            break;
          case "lk":
            propsRef.current.onLookChanged(msg.id);
            break;
          case "fp":
            propsRef.current.onPlotChanged?.(msg.p);
            break;
          case "bye":
            engine.removeActor(msg.id);
            break;
          default:
            engine.applyMessage(msg);
        }
      },
      onStatus: (connected) => {
        propsRef.current.onConnectionChange(connected);
        if (!connected) return;
        // (Re)entering: ask for everyone's state and announce mine — after a reconnect I may have moved.
        channel.send({ t: "hello", id: localId });
        channel.send(engine.snapshot());
      },
    });

    engineRef.current = engine;
    sendRef.current = (msg) => channel.send(msg);
    engine.start();
    return () => {
      replies.dispose();
      repliesRef.current = null;
      sendRef.current = null;
      engineRef.current = null;
      channel.leave({ t: "bye", id: localId });
      engine.destroy();
    };
  }, [roomId, localId, mapId, arrive]);

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full touch-none select-none" aria-label="Thế giới game" />;
}
