"use client";

import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import type { PlotDraw } from "@/lib/game/art/crops";
import type { CardGame } from "@/lib/game/cards/deck";
import type { HouseDraw } from "@/lib/game/housing/lot";
import { GameEngine, type HeatProbe, type LocalFishing, type LocalInfo, type RosterEntry } from "@/lib/game/engine";
import type { UmbrellaKind } from "@/lib/game/rain/model";
import type { FieldRats } from "@/lib/game/farm/rats";
import { phaseCode } from "@/lib/game/fishing/cast";
import { encodeNet, nextNet, type NetInput, type NetState } from "@/lib/game/fishing/netcast";
import type { Rarity } from "@/lib/game/fishing/catalog";
import { getMap, paintMap } from "@/lib/game/maps/registry";
import type { Interactable, MapId, Spot } from "@/lib/game/maps/types";
import { budgetKind, createBudget, GAME_LIMITS } from "@/lib/game/net/budget";
import { joinGameChannel } from "@/lib/game/net/channel";
import { FARM_ANIM, type FarmAnim, type FishPhase, type GameMessage } from "@/lib/game/net/protocol";
import { createReplyScheduler, replyWindowMs, type ReplyScheduler } from "@/lib/game/net/replies";
import type { VehicleId } from "@/lib/game/travel/vehicles";
import type { LocalLift } from "@/lib/game/engine";
import type { LiftMessage } from "@/lib/game/net/protocol";
import type { LiftSend } from "@/lib/game/travel/lift";
import type { Facing, Look, Vec } from "@/lib/game/types";
import type { RoomWeather } from "@/lib/game/weather/model";
import type { WeatherFx } from "@/lib/game/art/weather";

/** v18.10: the heat layer's handlers. */
export interface HeatHandlers { onRescue: (id: string) => void; onLeftWater: () => void }

export interface GameCanvasHandle {
  setRoster: (entries: RosterEntry[]) => void;
  /** Me: name, badges, look, and (v17) my dog, drooping while hungry. */
  setLocal: (info: LocalInfo) => void;
  showBubble: (accountId: string, text: string) => void;
  showReaction: (accountId: string | null, emoji: string) => void;
  setInputEnabled: (enabled: boolean) => void;
  /** v18: scale my walk speed (hunger/thirst), clamped by the engine to [0.1, 1]. */
  setSpeedFactor: (f: number) => void;
  /** v18.7: ride vehicle `v` (null = on foot): faster walking, and the others see it. Kept across worlds. */
  setRiding: (v: VehicleId | null) => void;
  /** v18.12: my following pet's `pt` code (null = none) and its walk-speed factor; the others see it. Kept across worlds. */
  setPet: (code: string | null, speed: number) => void;
  /** v18.8: the room's weather (drawn on every map; null = none). Kept across worlds. */
  setWeather: (w: RoomWeather | null) => void;
  /** v18.8: the viewer's weather-effects level (a personal setting). Kept across worlds. */
  setWeatherFx: (level: WeatherFx) => void;
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
  /** v18.1: a big fish pulled me into the pond — swim mode until I climb onto a bank (the others see it). */
  overboard: () => void;
  /** v18.2: my net throw's phase (null = none): drawn on me, and one `fs` with `n` when it changes. `face` (aiming)
   *  turns me towards the water. */
  setNet: (inp: NetInput | null, face?: Vec) => void;
  /** v18.10: jump into the pond from the shore or dock cell I stand on (false when I can't). */
  jumpIn: () => boolean;
  /** v18.10: the 10 s warm-up stretch (false when I can't), and stopping it early. */
  warmUp: () => boolean;
  cancelWarmUp: () => void;
  /** v18.10: my heat from the server (red face, a cramp's countdown; `rescued` sets a swimmer down on the bank). */
  setHeat: (h: { shocked: boolean; crampLeftMs: number | null; rescued?: boolean }) => void;
  /** v18.9: my rain look (wet, cảm lạnh, the umbrella open over me), and a lightning strike on me. */
  setRain?: (l: { wet: boolean; cold: boolean; umbrella: UmbrellaKind | null }) => void;
  strike?: () => void;
  /** v18.10: what the heat layer shows (null while no world is up). */
  heatProbe: () => HeatProbe | null;
  /** v18.10: who hears E next to a cramping member and my climbing out of the water. */
  setHeatHandlers: (h: HeatHandlers | null) => void;
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
  /** v19.3: Khu nhà's lots and their houses. */
  setHouses: (houses: ReadonlyArray<HouseDraw>) => void;
  /** v18.11: the unread dot on the Báo Làng stand. */
  setNewsUnread: (unread: boolean) => void;
  /** v20.3: the labels over Bãi đất trống's rings (index = ring − 1). */
  setRingLabels: (labels: ReadonlyArray<string | null>) => void;
  /** v20.3: tell the others on this map that ring `r` changed (`rg`): they fetch ring_state. */
  ringChanged: (r: number, v: number) => void;
  /** The map whose world the canvas shows now, or null while it shows none: an answer that lands after I left a map is
   *  dropped (v15.3 §7.2). */
  mapId: () => MapId | null;
  /** The field's rats (v17 §5.4): each walks its seeded path; an ending in `recent` plays once. */
  setRats: (rats: FieldRats | null) => void;
  /** My dog runs for live rat `ratId` (the dog_hunt call, §7.2); false without my dog or the rat. */
  dogPounce: (ratId: number) => boolean;
  /** A refused hunt: my dog comes back. */
  dogRecall: () => void;
  /** Pet my dog (D27): it comes to my front and wags, and `fa 11` shows the hearts to everyone. */
  petDog: () => void;
  /** Where I stand on the map shown (world px), or null while none is. */
  localPos: () => Vec | null;
  /** When I last pressed a key or touched the canvas (performance.now(); −Infinity before). */
  lastInputAt: () => number;
  /** Set camera zoom factor (< 1 zooms out / wider view, > 1 zooms in). */
  setZoom: (zoom: number) => void;
  getZoom: () => number;
  /** v18.13 Đi nhờ xe: my lift (null = none). Kept across worlds: a new world gets it once its channel exists. */
  setLift: (l: LocalLift | null) => void;
  /** v18.13: send a lift message (rq / ra / rx / lg; my id is added). */
  sendLift: (m: LiftSend) => void;
  /** v18.13: the rider I could ask for a lift now (null with no world). */
  liftCandidate: () => { id: string; name: string } | null;
  /** v18.13: is member `id` within lift range of me (false with no world)? */
  nearForLift: (id: string) => boolean;
}

export interface GameCanvasProps {
  ref?: Ref<GameCanvasHandle | null>;
  roomId: string;
  localId: string;
  /** The map to show; a change (a portal) starts a new engine and channel there. */
  mapId: MapId;
  /** Where I appear on that map (null = its spawn). */
  arrive: Spot | null;
  /** Used when a world starts; later changes go through the handle's setLocal (whose dog every new world keeps). */
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
  /** v20.3: someone (or my other tab) changed ring `r` on Bãi đất trống (`rg`). */
  onRingHint?: (r: number) => void;
  /** I started walking or set off on a path (a stop or a jump is not a move): a snail bed's bar stops (v15.3 §7.3). */
  onLocalMove?: () => void;
  /** A new world drew its first frame. */
  onFirstFrame: () => void;
  /** The browser has no usable 2D canvas. */
  onUnsupported: () => void;
  /** The game loop kept failing and stopped. */
  onFatal: () => void;
  /** v18.13: a lift message addressed to me, from a member on this map. */
  onLift?: (msg: LiftMessage) => void;
  /** v18.13: the engine ended my lift (the partner left, vanished or stopped agreeing). */
  onLiftLost?: () => void;
}

/** The game world: one engine + one broadcast channel per map visit. */
export default function GameCanvas({ ref, roomId, localId, mapId, arrive, ...rest }: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  // The map of the world that is up, set and cleared with its engine.
  const worldRef = useRef<MapId | null>(null);
  const sendRef = useRef<((msg: GameMessage) => void) | null>(null);
  const propsRef = useRef(rest);
  // What every new engine must know again: my hand fish, the species names, the HUD inset, the input lock, the plots,
  // the card tables' labels and the gathering cues.
  const handRef = useRef<string | null>(null);
  const phaseRef = useRef<FishPhase>(0);
  const netRef = useRef<NetState | null>(null);                                    // v18.2
  const speciesRef = useRef<ReadonlyArray<{ id: string; name: string; rarity: Rarity }>>([]);
  const insetRef = useRef(0);
  const inputRef = useRef(true);
  const speedRef = useRef(1);
  const ridingRef = useRef<VehicleId | null>(null);
  const liftRef = useRef<LocalLift | null>(null);                                   // v18.13
  const weatherRef = useRef<RoomWeather | null>(null);
  const weatherFxRef = useRef<WeatherFx>(3);
  const plotsRef = useRef<ReadonlyArray<PlotDraw>>([]);
  const cardTablesRef = useRef<Readonly<Partial<Record<CardGame, string>>>>({});
  const housesRef = useRef<ReadonlyArray<HouseDraw>>([]);                           // v19.3
  const newsUnreadRef = useRef(false);
  const ringLabelsRef = useRef<ReadonlyArray<string | null>>([]);
  const gatherRef = useRef<ReadonlyArray<{ id: string; ready: boolean }>>([]);
  // v17: my dog (from the latest setLocal), the field's rats and my last input, kept across worlds
  const dogRef = useRef<Pick<LocalInfo, "dog" | "dogHungry">>({});
  // v18.12: my following pet, kept across worlds
  const petRef = useRef<{ code: string | null; speed: number }>({ code: null, speed: 1 });
  const ratsRef = useRef<FieldRats | null>(null);
  const zoomRef = useRef(1);
  const inputAtRef = useRef(-Infinity);
  // v18.10: heat-shocked (kept across worlds) and the heat layer's handlers (E rescue, climbing out)
  const shockedRef = useRef(false);
  const heatHandlersRef = useRef<HeatHandlers | null>(null);
  // v18.9: my rain look, kept across worlds
  const rainRef = useRef<{ wet: boolean; cold: boolean; umbrella: UmbrellaKind | null } | null>(null);
  // This world's answer to `hello`s, and who of its roster is here (null until its first roster).
  const repliesRef = useRef<ReplyScheduler | null>(null);
  const hereRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    propsRef.current = rest;
  });

  useImperativeHandle(ref, () => {
    const sendFs = (c?: [string, number]) => {
      const net = netRef.current;
      const msg: GameMessage = c
        ? { t: "fs", id: localId, f: 0, h: handRef.current, c }
        : net && phaseRef.current === 0
          ? { t: "fs", id: localId, f: 0, h: handRef.current, n: encodeNet(net) }
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
      setLocal: (info) => {
        // a call without a dog keeps the one I have (null removes it)
        dogRef.current = {
          dog: info.dog !== undefined ? info.dog : dogRef.current.dog, dogHungry: info.dogHungry ?? dogRef.current.dogHungry,
        };
        engineRef.current?.setLocal({ ...info, ...dogRef.current });
      },
      showBubble: (id, text) => engineRef.current?.showBubble(id, text),
      showReaction: (id, emoji) => engineRef.current?.showReaction(id, emoji),
      setInputEnabled: (enabled) => {
        inputRef.current = enabled;
        engineRef.current?.setInputEnabled(enabled);
      },
      setSpeedFactor: (f) => {
        speedRef.current = f;
        engineRef.current?.setSpeedFactor(f);
      },
      setRiding: (v) => {
        ridingRef.current = v;
        engineRef.current?.setRiding(v);
      },
      setPet: (code, speed) => {
        petRef.current = { code, speed };
        engineRef.current?.setPet(code, speed);
      },
      setWeather: (w) => {
        weatherRef.current = w;
        engineRef.current?.setWeather(w);
      },
      setWeatherFx: (level) => {
        weatherFxRef.current = level;
        engineRef.current?.setWeatherFx(level);
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
      overboard: () => engineRef.current?.overboard(),
      setNet: (inp, face) => {
        const e = engineRef.current;
        const prev = netRef.current;
        if (inp && face) e?.faceTowards(face);                                         // turn first: offsets follow the facing
        const s = inp ? nextNet(prev, inp, e?.localFacing() ?? "down") : null;
        e?.setLocalNet(s);
        netRef.current = s;
        if (JSON.stringify(s && encodeNet(s)) === JSON.stringify(prev && encodeNet(prev))) return;
        sendFs();
      },
      jumpIn: () => engineRef.current?.jumpIn() ?? false,
      warmUp: () => engineRef.current?.warmUp() ?? false,
      cancelWarmUp: () => engineRef.current?.cancelWarmUp(),
      setHeat: (h) => {
        shockedRef.current = h.shocked;
        engineRef.current?.setHeat(h);
      },
      setRain: (l) => {
        rainRef.current = l;
        engineRef.current?.setRain(l);
      },
      strike: () => engineRef.current?.strike(),
      heatProbe: () => engineRef.current?.heatProbe() ?? null,
      setHeatHandlers: (h) => {
        heatHandlersRef.current = h;
      },
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
      setHouses: (houses) => {
        housesRef.current = houses;
        engineRef.current?.setHouses(houses);
      },
      setRingLabels: (labels) => {
        ringLabelsRef.current = labels;
        engineRef.current?.setRingLabels(labels);
      },
      ringChanged: (r, v) => sendRef.current?.({ t: "rg", id: localId, r, v }),
      setNewsUnread: (unread) => {
        newsUnreadRef.current = unread;
        engineRef.current?.setNewsUnread(unread);
      },
      mapId: () => worldRef.current,
      setRats: (rats) => {
        ratsRef.current = rats;
        engineRef.current?.setRats(rats);
      },
      dogPounce: (ratId) => engineRef.current?.dogPounce(ratId) ?? false,
      dogRecall: () => engineRef.current?.dogRecall(),
      petDog: () => {
        const e = engineRef.current;
        if (!e) return;
        e.petDog();
        e.showFarmAnim(FARM_ANIM.pet);
        sendRef.current?.({ t: "fa", id: localId, a: FARM_ANIM.pet });
      },
      localPos: () => engineRef.current?.localPos() ?? null,
      lastInputAt: () => inputAtRef.current,
      setZoom: (zoom: number) => {
        zoomRef.current = zoom;
        engineRef.current?.setZoom(zoom);
      },
      getZoom: () => zoomRef.current,
      setLift: (l) => {
        liftRef.current = l;
        engineRef.current?.setLift(l);
      },
      sendLift: (m) => sendRef.current?.({ ...m, id: localId } as GameMessage),
      liftCandidate: () => engineRef.current?.liftCandidate() ?? null,
      nearForLift: (id) => engineRef.current?.nearForLift(id) ?? false,
    };
  }, [localId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const map = getMap(mapId);
    const init = propsRef.current.initial;
    // a new map starts with the rod in (the shell cancels any cast before travelling)
    phaseRef.current = 0;
    netRef.current = null;
    let engine: GameEngine;
    try {
      const art = paintMap(map);
      const fontVar = getComputedStyle(document.documentElement).getPropertyValue("--font-vt323").trim();
      engine = new GameEngine(canvas, map, art, {
        onLocalMove: (m) => {
          channel.send({ t: "mv", id: localId, ...m });
          if (m.mv) propsRef.current.onLocalMove?.();
        },
        onLocalPath: (m) => {
          channel.send({ t: "pa", id: localId, ...m });
          propsRef.current.onLocalMove?.();
        },
        onInteract: (it) => propsRef.current.onInteract(it),
        onPromptChange: (it) => propsRef.current.onPromptChange(it),
        onActorClick: (id) => propsRef.current.onActorClick(id),
        onFishingInput: (kind) => propsRef.current.onFishingInput(kind),
        onFirstFrame: () => propsRef.current.onFirstFrame(),
        onFatal: () => propsRef.current.onFatal(),
        onInput: () => {
          inputAtRef.current = performance.now();
        },
        onRescue: (id) => heatHandlersRef.current?.onRescue(id),
        onLeftWater: () => heatHandlersRef.current?.onLeftWater(),
        onLiftLost: () => {
          liftRef.current = null;
          propsRef.current.onLiftLost?.();
        },
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
    engine.setSpeedFactor(speedRef.current);
    engine.setWeather(weatherRef.current);
    engine.setWeatherFx(weatherFxRef.current);
    engine.setPlots(plotsRef.current);
    engine.setCardTables(cardTablesRef.current);
    engine.setHouses(housesRef.current);
    engine.setNewsUnread(newsUnreadRef.current);
    engine.setRingLabels(ringLabelsRef.current);
    engine.setGatherSpots(gatherRef.current);
    engine.setLocal({ name: init.name, badges: init.badges, look: init.look, ...dogRef.current });
    if (zoomRef.current !== 1) engine.setZoom(zoomRef.current);
    if (map.id === "field") engine.setRats(ratsRef.current);

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
          else if (msg.t === "rg") propsRef.current.onRingHint?.(msg.r);                     // v20.3
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
          case "rg":                                                                          // v20.3
            propsRef.current.onRingHint?.(msg.r);
            break;
          case "bye":
            engine.removeActor(msg.id);
            break;
          case "rq":
          case "ra":
          case "rx":
          case "lg":
            // v18.13: a lift message addressed to me goes to the shell
            if (msg.to === localId) propsRef.current.onLift?.(msg);
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
    worldRef.current = map.id;
    sendRef.current = (msg) => channel.send(msg);
    // setRiding announces my state at once (onLocalMove → channel.send), so it waits until the channel exists: riding
    // through a portal rebuilds the engine with the vehicle still on
    engine.setRiding(ridingRef.current);
    engine.setPet(petRef.current.code, petRef.current.speed);                           // v18.12
    // v18.13: a lift through a portal goes on in the new world (it announces too, so it waits for the channel as well)
    engine.setLift(liftRef.current);
    // v18.9/v18.10: soaked, the umbrella or the heat announce my state too — after the channel exists (walking through
    // a portal in the rain rebuilt the engine and crashed on `channel` here)
    if (shockedRef.current) engine.setHeat({ shocked: true, crampLeftMs: null });
    if (rainRef.current) engine.setRain(rainRef.current);
    engine.start();
    return () => {
      replies.dispose();
      repliesRef.current = null;
      sendRef.current = null;
      engineRef.current = null;
      worldRef.current = null;
      channel.leave({ t: "bye", id: localId });
      engine.destroy();
    };
  }, [roomId, localId, mapId, arrive]);

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full touch-none select-none" aria-label="Thế giới game" />;
}
