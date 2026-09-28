import { createActor, idleFrame, setKeyboard, setPath, tickActor, walkFrame, type Actor } from "@/lib/game/actor";
import type { Frame } from "@/lib/game/art/layers";
import {
  drawHarvester, drawPlotShimmer, drawUrgentRing, harvesterSpot, liveLook, lookKey, paintPlot, postLabel, type PlotDraw,
} from "@/lib/game/art/crops";
import type { CardGame } from "@/lib/game/cards/deck";
import { dogFrame, drawDog } from "@/lib/game/art/dog";
import { drawFarmAnim } from "@/lib/game/art/farm-anim";
import { drawRat, ratFrame } from "@/lib/game/art/rats";
import { drawBedCue, drawHoleCue } from "@/lib/game/art/gather-art";
import { drawHeldFish, drawRod } from "@/lib/game/art/fishing";
import { drawNetThrower } from "@/lib/game/art/netthrow";
import { facingTowards, netAlive, type NetState } from "@/lib/game/fishing/netcast";
import { serverNow } from "@/lib/game/farm/clock";
import { promptTarget, RAT_PROMPT_RANGE, ratAt, ratInteractable, type FieldRats } from "@/lib/game/farm/rats";
import { getCharacterFrames } from "@/lib/game/art/raster";
import { drawRide } from "@/lib/game/art/ride";
import { drawLeap, drawSwimmer, drawWetDrips, leapDone, type Leap } from "@/lib/game/art/swim";
import { drawCramp, drawHeatFace, drawStretch } from "@/lib/game/art/heat";
import { drawHammockLive, hammockSwing, lyingSprite } from "@/lib/game/art/hammock";
import { hammockBlocked, hammockKeeper, hammockPrompt } from "@/lib/game/hammock";
import { CRAMP_MS, HX, RESCUE_RANGE, WARM_MS } from "@/lib/game/heat/model";
import { drawCold, drawScorch, drawSoaked, drawStrike, drawUmbrella, strikeFlashK } from "@/lib/game/art/rain";
import { DRY_LOOK, encodeRain, STRIKE_MS, type RainLook } from "@/lib/game/rain/model";
import { edgeCell, jumpTarget, nearestEdge } from "@/lib/game/heat/pond";
import { nearestWater, pondWaterCells, shoreInteractable } from "@/lib/game/fishing/shore";
import { inPond } from "@/lib/game/maps/pond";
import { buildSwimMap, inWater, swimSpeed, WET_MS, type SwimCode } from "@/lib/game/swim";
import { riderFrame } from "@/lib/game/art/road";
import { drawLighting, drawNightLights, drawWeather, lightingFor, swayAmp, swayAt, type Lighting, type WeatherFx } from "@/lib/game/art/weather";
import { phaseCode, type LocalPhase } from "@/lib/game/fishing/cast";
import { formatWeight, RARITY_COLOR, type Rarity } from "@/lib/game/fishing/catalog";
import { bobberPoint, SWING_MS } from "@/lib/game/fishing/geometry";
import type { SceneArt } from "@/lib/game/maps/scene-art";
import type { GameMap, Interactable, Spot } from "@/lib/game/maps/types";
import { inputDir, isBlockedAt, WALK_SPEED, type KeyState } from "@/lib/game/movement";
import { FARM_ANIM, facingToCode, MAX_PATH_POINTS, type FacingCode, type FarmAnim, type GameMessage, type Unit } from "@/lib/game/net/protocol";
import { Pack, type DogWalker } from "@/lib/game/pack";
import { unseenGraceMs } from "@/lib/game/net/replies";
import { findPath, smoothPath } from "@/lib/game/pathfinding";
import { rideSpeed } from "@/lib/game/travel/ride";
import { dropSpot, LIFT_RANGE, liftSound } from "@/lib/game/travel/lift";                              // v18.13
import type { Pillion } from "@/lib/game/art/road";
import { drawPet, petAltitude, petHeight } from "@/lib/game/art/pets";
import { EXT_W, paintHouseExterior, paintLotYard, paintSoldFlag } from "@/lib/game/art/house";         // v19.3
import type { HouseDraw } from "@/lib/game/housing/lot";
import { LOTS } from "@/lib/game/maps/khu-nha";
import { RING_RECTS } from "@/lib/game/maps/bai-dat";                                                    // v20.3
import { ctx2d, makeCanvas } from "@/lib/game/maps/scene-art";
import { PetFollowers, petPose, type OwnerState } from "@/lib/game/pets/follow";
import { PARROT_ECHO_MS, parrotEchoes } from "@/lib/game/pets/model";
import type { VehicleId } from "@/lib/game/travel/vehicles";
import { cameraFor, computeView, hitsCharacter, interactableAt, inUseRange, stackBoxes, type Box } from "@/lib/game/scene";
import { wrapBubble } from "@/lib/game/text";
import type { Facing, Look, Vec } from "@/lib/game/types";
import { CATCH_LABEL_MS, FARM_ANIM_MS, RemoteWorld, type RosterEntry } from "@/lib/game/world";
import type { PresenceDog } from "@/lib/presence-modes";
import type { RoomWeather } from "@/lib/game/weather/model";

export type { RosterEntry } from "@/lib/game/world";

/** Me as the engine draws me; `dog` (v17) walks with me, drooping while `dogHungry`. */
export interface LocalInfo { name: string; badges: string; look: Look; dog?: PresenceDog | null; dogHungry?: boolean }

/** `v` (v18.7): the vehicle I ride, present only while riding. `sw` (v18.1): 1 swimming, 2 wet; absent = dry. */
export interface LocalMoveMsg { x: number; y: number; d: FacingCode; mv: boolean; vx: Unit; vy: Unit; h: string | null; v?: VehicleId; sw?: SwimCode; hx?: number; cr?: number; pt?: string; ps?: string; lf?: string; rn?: number; hm?: 1 }

/** v18.13: my lift — carrying `peer` ("driver") or riding along on `peer`'s vehicle ("passenger"). */
export interface LocalLift { role: "driver" | "passenger"; peer: string }

/** v18.10: what the heat layer needs from the world each moment. */
export interface HeatProbe {
  /** The shore or dock cell I stand on (dry, idle), where I may jump in or warm up. */
  edge: { col: number; row: number } | null;
  swimming: boolean;
  /** Warming up (the 10 s stretch) or cramping now. */
  warming: boolean;
  cramping: boolean;
  /** The nearest other member cramping within reach (E rescues them), and my own cell (the rescue's claim). */
  rescue: { id: string; name: string } | null;
  cell: { col: number; row: number };
}

export interface EngineCallbacks {
  /** Keyboard movement started, stopped or turned (plus a keep-alive every 3 s while walking). */
  onLocalMove: (m: LocalMoveMsg) => void;
  /** A click/tap path started. */
  onLocalPath: (m: { x: number; y: number; pts: Array<[number, number]>; h: string | null; v?: VehicleId; sw?: SwimCode; hx?: number; cr?: number; pt?: string; ps?: string; lf?: string; rn?: number }) => void;
  /** v18.13: my lift's partner left, vanished or stopped agreeing: the lift is over (I am already set down). */
  onLiftLost?: () => void;
  /** v18.10: E next to a cramping member (their account id). */
  onRescue?: (id: string) => void;
  /** v18.10: I climbed out of the water onto a bank. */
  onLeftWater?: () => void;
  onInteract: (it: Interactable) => void;
  onPromptChange: (it: Interactable | null) => void;
  onActorClick: (accountId: string) => void;
  /** While the rod is out: a click/tap on the canvas or Space ("tap"), or Esc ("cancel"). */
  onFishingInput?: (kind: "tap" | "cancel") => void;
  /** The first frame has been drawn (the shell fades in). */
  onFirstFrame?: () => void;
  /** Three frames in a row threw: the loop has stopped. */
  onFatal?: (err: unknown) => void;
  /** I pressed a key or touched the canvas (the dog's auto-hunt wants input in the last 3 minutes, v17 §7.2). */
  onInput?: () => void;
}

export interface EngineOptions {
  localId: string;
  name: string;
  badges: string;
  look: Look;
  /** Where I appear (a portal's arrival spot); the map's spawn by default. */
  start?: Spot;
  /** CSS font-family for canvas text (the VT323 family from next/font). */
  fontFamily: string;
  reducedMotion: boolean;
}

/** How the local rod looks (spec §6.1, §11). */
export interface LocalFishing {
  phase: LocalPhase;
  /** Bobber colour at the bite when the bobber reveals the rarity. */
  tint?: string | null;
  /** Phao đèn glows. */
  glow?: boolean;
}

export interface SpeciesInfo { name: string; rarity: Rarity }

const KEYMAP: Record<string, keyof KeyState> = {
  ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down",
  ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right",
};
const KEEPALIVE_MS = 3000;
const BUBBLE_MS = 6000;
const REACTION_MS = 1600;
const MAX_FAILED_FRAMES = 3;
const PUFF_MS = 1000;
/** v18.8: the props whose crowns sway in a storm. */
const SWAY_KINDS: ReadonlySet<string> = new Set(["palm", "banana"]);
/** v18.1: the gap between two leaping fish on the pond. */
const LEAP_GAP_MIN_MS = 3000;
const LEAP_GAP_MAX_MS = 8000;
const NO_KEYS: KeyState = { up: false, down: false, left: false, right: false };

/** Canvas 2D game loop: input, local + remote actors, NPCs, fishing, camera, depth-sorted rendering, overlays.
 *  Browser only. */
export class GameEngine {
  private readonly canvas: HTMLCanvasElement;
  private readonly map: GameMap;
  private readonly art: SceneArt;
  private readonly cb: EngineCallbacks;
  private readonly opts: EngineOptions;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly buf: HTMLCanvasElement;
  private readonly bctx: CanvasRenderingContext2D;
  private readonly ro: ResizeObserver;
  private readonly local: Actor;
  /** Everyone else: roster, remote walkers, their last known state and their fishing. */
  private readonly world: RemoteWorld;
  private readonly bubbles = new Map<string, { lines: string[]; until: number }>();
  private reactions: Array<{ id: string | null; emoji: string; born: number; dx: number }> = [];
  private localInfo: LocalInfo;
  /** The dogs and the field's rats (v17). */
  private readonly pack: Pack;
  /** v18.12: everyone's following pet (mine under my id), my `pt` code, its walk-speed factor and the parrots' echoes. */
  private readonly pets = new PetFollowers();
  private petCode: string | null = null;
  private petSpeedF = 1;
  private echoes: Array<{ id: string; text: string; at: number }> = [];
  private keys: KeyState = { ...NO_KEYS };
  private scale = 3;
  private zoom = 1;
  private vw = 320;
  private vh = 180;
  private dpr = 1;
  private cam: Vec = { x: 0, y: 0 };
  /** Height of the bottom HUD in CSS px (the camera may scroll that far past the map's bottom). */
  private insetCss = 0;
  private inputEnabled = true;
  private speedFactor = 1;
  /** The vehicle I ride (v18.7), or null on foot. */
  private ridingV: VehicleId | null = null;
  /** v18.13: my lift, since when (this world) and when the partner was last seen here (performance ms). */
  private lift: (LocalLift & { since: number; seenAt: number }) | null = null;
  private pendingInteract: Interactable | null = null;
  private prompt: Interactable | null = null;
  private lastSent = { mv: false, vx: 0, vy: 0, at: 0 };
  private fishing: Required<LocalFishing> = { phase: "idle", tint: null, glow: false };
  /** Each angler's rod phase and when it began (drawn strike animation). */
  private rodPhase = new Map<string, { p: number; at: number }>();
  private castAt = 0;
  private hand: string | null = null;
  private landed: { speciesId: string; weightG: number; until: number } | null = null;
  private puffs: Array<{ x: number; y: number; born: number }> = [];
  private species = new Map<string, SpeciesInfo>();
  /** My farm animation and when it started. */
  private farm: { a: FarmAnim; at: number } | null = null;
  /** v18.2: my net throw and when its phase began. */
  private netThrow: { s: NetState; at: number } | null = null;
  private plots = new Map<number, PlotDraw>();
  /** Each plot's painted crop, repainted when its look's key changes. */
  private plotArt = new Map<number, { key: string; canvas: HTMLCanvasElement }>();
  /** The hall's card-table labels (v16 spec §5). */
  private cardTables: Partial<Record<CardGame, string>> = {};
  /** v19.3: Khu nhà's lots as the street sees them, and each built house's painted exterior (by its design + roof). */
  private houses: HouseDraw[] = [];
  private houseArt = new Map<number, { key: string; canvas: HTMLCanvasElement }>();
  /** The field's crab holes and snail beds ready for me (their interactable ids). */
  private gatherReady = new Set<string>();
  /** v18.11: Báo Làng has news I have not read (the red dot on the stand's label). */
  private newsUnread = false;
  /** v20.3: the label over each Bãi đất trống ring (index = ring − 1; null = none). */
  private ringLabels: ReadonlyArray<string | null> = [];
  /** v18.8: the room's weather, the ambient light (recomputed about once a second) and which props sway in the wind. */
  private weather: RoomWeather | null = null;
  private lighting: Lighting = { tint: "rgb(0, 0, 0)", alpha: 0, night: 0, shade: "rgb(255, 255, 255)" };
  private lightingAt = -Infinity;
  /** v18.8: the viewer's weather-effects level (0 off … 4 full). */
  private weatherFx: WeatherFx = 3;
  private readonly swaying: boolean[];
  /** v18.1: the pond with its water walkable (null on other maps); am I swimming; until when I drip (performance ms),
   *  and whether the others were told I am wet (they are told again when it dries). */
  private readonly swimMap: GameMap | null;
  private swimming = false;
  private wetUntil = 0;
  private wetAnnounced = false;
  /** v18.10: heat-shocked (red face), the warm-up stretch until (performance ms), a cramp's end (performance ms, 0 =
   *  none) and the cramping member E would rescue. */
  private heatShocked = false;
  private warmUntil = 0;
  private crampUntil = 0;
  private rescueTarget: { id: string; name: string } | null = null;
  /** v18.9: my rain look (wet, cảm lạnh, the umbrella held open), my lightning strike (performance ms, 0 = none) and its
   *  bolt's seed, and where lightning struck on this map (a scorch mark for a while). */
  private rainLook: RainLook = DRY_LOOK;
  private strikeAt = 0;
  private strikeSeed = 0;
  private scorches: Array<{ x: number; y: number; at: number }> = [];
  /** v18.1: the leaping fish (pond only; cosmetic, each client its own), the next one's time and where they may leap. */
  private leaps: Leap[] = [];
  private nextLeapAt = 0;
  private leapCells: Vec[] | null = null;
  /** The hall's hammock: its interactable (null on other maps) and since when I lie in it (performance ms, null = not). */
  private readonly hammockIt: Interactable | null;
  private hammockSince: number | null = null;
  private raf = 0;
  private lastT = 0;
  private failures = 0;
  private drewFirst = false;
  private destroyed = false;

  constructor(canvas: HTMLCanvasElement, map: GameMap, art: SceneArt, cb: EngineCallbacks, opts: EngineOptions) {
    const ctx = canvas.getContext("2d");
    const buf = document.createElement("canvas");
    const bctx = buf.getContext("2d");
    if (!ctx || !bctx) throw new Error("canvas-2d-unavailable");
    this.canvas = canvas;
    this.map = map;
    this.art = art;
    this.cb = cb;
    this.opts = opts;
    this.ctx = ctx;
    this.buf = buf;
    this.bctx = bctx;
    const start = opts.start ?? map.spawn;
    this.local = createActor(opts.localId, { x: start.x, y: start.y }, start.dir, performance.now());
    this.world = new RemoteWorld(map, opts.localId);
    this.pack = new Pack((x, y) => isBlockedAt(map, x, y), opts.localId);
    this.localInfo = { name: opts.name, badges: opts.badges, look: opts.look };
    // art.props mirrors map.props one to one (each painter maps them through propSprite)
    this.swaying = art.props.map((_, i) => SWAY_KINDS.has(map.props[i]?.kind ?? ""));
    this.swimMap = buildSwimMap(map);
    this.hammockIt = map.interactables.find((i) => i.kind === "hammock") ?? null;
    this.nextLeapAt = performance.now() + LEAP_GAP_MIN_MS;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    canvas.addEventListener("pointerdown", this.onPointerDown);
    this.resize();
  }

  start(): void {
    this.lastT = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
  }

  // ------------------------------------------------------------ data in

  /** v18.8: the room's weather (null = unknown: no effects, lighting by the local clock). */
  setWeather(w: RoomWeather | null): void {
    this.weather = w;
    this.lightingAt = -Infinity;
  }

  /** v18.8: the viewer's weather-effects level (particles, flash, sway, the overcast grey). */
  setWeatherFx(level: WeatherFx): void {
    this.weatherFx = level;
    this.lightingAt = -Infinity;
  }

  setLocal(info: LocalInfo): void {
    this.localInfo = info;
  }

  /** The field's rats (v17 §5.4): each walks its seeded path; a `recent` ending plays once (a sling catch with a puff). */
  setRats(rats: FieldRats | null): void {
    for (const p of this.pack.setRats(rats, performance.now())) this.puff(p);
  }

  /** My dog runs for live rat `ratId` (the dog_hunt call); false without my dog or the rat. */
  dogPounce(ratId: number): boolean {
    return this.pack.pounce(ratId, performance.now(), serverNow());
  }

  /** A refused hunt: my dog comes back. */
  dogRecall(): void {
    this.pack.recall();
  }

  /** My dog comes to my front for 2.5 s (the caller shows `fa 11`). */
  petDog(): void {
    this.pack.pet(performance.now());
  }

  /** Where I stand (world px). */
  localPos(): Vec {
    return { x: this.local.pos.x, y: this.local.pos.y };
  }

  /** Everyone online on this map except me. Walking members get an actor (placed with their last known state). */
  setRoster(entries: RosterEntry[]): void {
    this.world.setRoster(entries, performance.now());
  }

  /** Someone's `hello`: a walking member we had dropped (their `bye`) gets an actor again. */
  noteHello(id: string): void {
    this.world.hello(id, performance.now());
  }

  /** st / mv / pa / fs / fa from the network (other message types are handled by the caller). */
  applyMessage(msg: GameMessage): void {
    this.world.applyMessage(msg, performance.now());
    // v18.12: the pet in a movement message (absent = none)
    if (msg.t === "st" || msg.t === "mv" || msg.t === "pa") this.pets.setCode(msg.id, msg.pt ?? null);
  }

  /** Someone's `bye`. */
  removeActor(id: string): void {
    this.world.remove(id);
    this.pets.remove(id);
    // v18.13: my lift's partner left the map
    if (this.lift?.peer === id) this.loseLift();
  }

  /** How many other members walk on this map (sizes the answer window for `hello`s). */
  walkers(): number {
    return this.world.walkers();
  }

  showBubble(id: string, text: string): void {
    const lines = wrapBubble(text);
    if (lines.length > 0) this.bubbles.set(id, { lines, until: performance.now() + BUBBLE_MS });
    // v18.12: a happy parrot repeats some of its owner's lines (the same pick on every client)
    const pet = this.pets.look(id);
    if (lines.length > 0 && pet?.species === "vet" && pet.happy && parrotEchoes(id, text)) {
      this.echoes.push({ id, text, at: performance.now() + PARROT_ECHO_MS });
    }
  }

  showReaction(id: string | null, emoji: string): void {
    this.reactions.push({ id, emoji, born: performance.now(), dx: Math.round((Math.random() - 0.5) * 12) });
    if (this.reactions.length > 40) this.reactions.shift();
  }

  /** Scales the local walk speed (hunger/thirst slowdown), clamped to [0.1, 1]. */
  setSpeedFactor(f: number): void {
    this.speedFactor = Math.min(1, Math.max(0.1, f));
  }

  /** Get on vehicle `v` or off (null): my walk speed is multiplied by its ride factor, and the others are told at once. */
  setRiding(v: VehicleId | null): void {
    if (v === this.ridingV) return;
    this.ridingV = v;
    if (v) this.hammockSince = null;                                        // getting on a vehicle gets me up
    this.announceNow();
  }

  /** The vehicle I ride, or null. */
  riding(): VehicleId | null {
    return this.ridingV;
  }

  // ------------------------------------------------------------ v18.13 Đi nhờ xe

  /** Carry passenger `peer` ("driver"), ride along on `peer`'s vehicle ("passenger"), or neither (null). A passenger
   *  sits on the driver's vehicle (no walking, taps or prompts); when that ends I am set down beside it. The others are
   *  told at once (`ps` / `lf` on my movement messages). */
  setLift(l: LocalLift | null): void {
    const cur = this.lift;
    if (cur?.role === l?.role && cur?.peer === l?.peer) return;
    const now = performance.now();
    if (cur?.role === "passenger" && l?.role !== "passenger") {
      const at = dropSpot((x, y) => isBlockedAt(this.map, x, y), this.local.pos, this.local.facing);
      this.local.pos = { ...at };
      this.local.display = { ...at };
    }
    this.lift = l ? { role: l.role, peer: l.peer, since: now, seenAt: now } : null;
    if (l?.role === "passenger") {
      this.hammockSince = null;
      this.stopHere();
      if (this.local.path) setKeyboard(this.local, { x: 0, y: 0 });
      this.clearPrompt();
    }
    this.announceNow();
  }

  /** My lift, or null. */
  liftState(): LocalLift | null {
    return this.lift ? { role: this.lift.role, peer: this.lift.peer } : null;
  }

  /** The nearest visible rider carrying nobody within LIFT_RANGE of me — whom I could ask for a lift — while I am on
   *  foot, dry, idle and on nobody's vehicle; else null. */
  liftCandidate(): { id: string; name: string } | null {
    const now = performance.now();
    if (this.ridingV || this.lift || this.swimming || this.rodOut || this.warming(now) || this.cramping(now)) return null;
    let best: { id: string; name: string } | null = null, bestD = LIFT_RANGE;
    for (const [id, a] of this.world.actors) {
      if (!this.visible(id, now) || !this.world.riding(id) || this.world.liftTag(id).ps || this.world.liftTag(id).lf) continue;
      const d = Math.hypot(a.display.x - this.local.pos.x, a.display.y - this.local.pos.y);
      if (d <= bestD) { bestD = d; best = { id, name: this.world.roster.get(id)?.name ?? "" }; }
    }
    return best;
  }

  /** Does member `id` stand close enough for a lift (a little slack: they may have moved since asking)? */
  nearForLift(id: string): boolean {
    const a = this.world.actors.get(id);
    if (!a || !this.visible(id, performance.now())) return false;
    return Math.hypot(a.display.x - this.local.pos.x, a.display.y - this.local.pos.y) <= LIFT_RANGE * 1.5;
  }

  /** The lift ends from here (partner gone): set down, tell the others and the shell. */
  private loseLift(): void {
    this.setLift(null);
    this.cb.onLiftLost?.();
  }

  /** Each frame: a passenger sits where the driver's vehicle is; a driver keeps the passenger's actor on it; a lift
   *  whose partner vanished or stopped agreeing ends. */
  private followLift(now: number): void {
    const l = this.lift;
    if (!l) return;
    const me = this.opts.localId;
    const a = this.world.actors.get(l.peer);
    const seen = !!a && this.world.roster.has(l.peer) && this.visible(l.peer, now);
    if (seen) l.seenAt = now;
    const tag = this.world.liftTag(l.peer);
    const agrees = l.role === "passenger" ? tag.ps === me && this.world.riding(l.peer) !== null : tag.lf === me;
    if (seen && a && l.role === "passenger") {
      this.local.pos = { x: a.pos.x, y: a.pos.y };
      this.local.display = { x: a.display.x, y: a.display.y };
      this.local.facing = a.facing;
    } else if (seen && agrees) {
      this.world.pin(l.peer, this.local.pos, this.local.display, this.local.facing);
    }
    if (!liftSound({ now, since: l.since, seenAt: l.seenAt, seen, agrees })) this.loseLift();
  }

  /** `ps` / `lf` for my movement messages. */
  private liftFlag(): { ps?: string; lf?: string } {
    if (!this.lift) return {};
    return this.lift.role === "driver" ? { ps: this.lift.peer } : { lf: this.lift.peer };
  }

  /** Am I drawn on my driver's vehicle now (it is visible and ridden)? */
  private aboard(now: number): boolean {
    const l = this.lift;
    return l?.role === "passenger" && this.world.actors.has(l.peer) && this.visible(l.peer, now) && this.world.riding(l.peer) !== null;
  }

  /** Is member `id` drawn on someone's vehicle (their own actor is not drawn)? */
  private carried(id: string, now: number): boolean {
    const l = this.lift;
    if (l?.role === "driver" && l.peer === id) return this.world.liftTag(id).lf === this.opts.localId;
    const d = this.world.carrier(id);
    return d !== null && this.world.actors.has(d) && this.visible(d, now) && this.world.riding(d) !== null;
  }

  /** The passenger's look on rider `id`'s vehicle (me included), or null. */
  private pillionOf(id: string): Look | null {
    const me = this.opts.localId, l = this.lift;
    if (id === me) {
      if (l?.role !== "driver" || this.world.liftTag(l.peer).lf !== me) return null;
      return this.world.roster.get(l.peer)?.look ?? null;
    }
    if (l?.role === "passenger" && l.peer === id) return this.localInfo.look;
    const p = this.world.passengerOf(id);
    return p ? this.world.roster.get(p)?.look ?? null : null;
  }

  /** My walk speed now (px/s): the vitals factor times the ride factor (none while swimming) times the swim factor. */
  localSpeed(): number {
    return WALK_SPEED * this.speedFactor * rideSpeed(this.swimming ? null : this.ridingV) * swimSpeed(this.swimming) * this.petSpeedF;
  }

  /** v18.12: my following pet's `pt` code (null: none) and its walk-speed factor; the others are told at once.
   *  v19.1: `speed` is the pet's factor times the "Ngủ ngon" walk buff (×1.07), so the cap is 1.2. */
  setPet(code: string | null, speed = 1): void {
    this.petSpeedF = Math.min(1.2, Math.max(1, speed));
    if (code === this.petCode) return;
    this.petCode = code;
    this.pets.setCode(this.opts.localId, code);
    this.announceNow();
  }

  /** v18.1: a big fish pulled me in — I surface on the water cell nearest my bobber and swim until I step onto a bank.
   *  Pond only (nothing happens elsewhere). The others are told at once (`sw` 1). */
  overboard(): void {
    if (!this.swimMap) return;
    const at = nearestWater(bobberPoint(this.local.pos, this.local.facing));
    if (!at) return;
    this.keys = { ...NO_KEYS };
    this.pendingInteract = null;
    setKeyboard(this.local, { x: 0, y: 0 });
    this.local.pos = { x: at.x, y: at.y };
    this.local.display = { x: at.x, y: at.y };
    this.swimming = true;
    this.wetUntil = 0;
    this.puff(at);
    if (this.prompt) {
      this.prompt = null;
      this.cb.onPromptChange(null);
    }
    this.announceNow();
  }

  /** v18.1: am I swimming (no actions until I climb out)? */
  isSwimming(): boolean {
    return this.swimming;
  }

  /** v18.10: jump into the water cell next to the shore or dock cell I stand on (pond only). False when I can't. */
  jumpIn(): boolean {
    if (!this.swimMap || this.swimming || this.rodOut || this.warming(performance.now())) return false;
    const at = jumpTarget(this.local.pos, this.local.facing);
    if (!at) return false;
    this.stopHere();
    this.local.pos = { x: at.x, y: at.y };
    this.local.display = { x: at.x, y: at.y };
    this.swimming = true;
    this.wetUntil = 0;
    this.puff(at);
    this.clearPrompt();
    this.announceNow();
    return true;
  }

  /** v18.10: the 10 s warm-up stretch on the shore (movement locked, the others see it). False when I can't. */
  warmUp(): boolean {
    if (this.swimming || this.rodOut || !edgeCell(this.local.pos)) return false;
    this.stopHere();
    this.warmUntil = performance.now() + WARM_MS;
    this.announceNow();
    return true;
  }

  /** v18.10: stop a warm-up early (a refused start). */
  cancelWarmUp(): void {
    if (this.warmUntil === 0) return;
    this.warmUntil = 0;
    this.announceNow();
  }

  /** v18.10: my heat from the server: heat-shocked, and a cramp with `crampLeftMs` left (null = none). A cramp that ends
   *  while I still swim (a rescue) sets me down on the nearest bank. The others are told when it changes. */
  setHeat(h: { shocked: boolean; crampLeftMs: number | null; rescued?: boolean }): void {
    const now = performance.now();
    const until = h.crampLeftMs !== null && h.crampLeftMs > 0 ? now + Math.min(CRAMP_MS, h.crampLeftMs) : 0;
    const changed = h.shocked !== this.heatShocked || (until === 0) !== (this.crampUntil === 0);
    this.heatShocked = h.shocked;
    if (until > 0) this.stopHere();
    this.crampUntil = until;
    if (h.rescued && this.swimming) {
      const at = nearestEdge(this.local.pos);
      if (at) {
        this.local.pos = { x: at.x, y: at.y };
        this.local.display = { x: at.x, y: at.y };
        this.swimming = false;
        this.wetUntil = now + WET_MS;
        this.wetAnnounced = true;
        this.puff(at);
      }
      this.announceNow();
      return;
    }
    if (changed) this.announceNow();
  }

  /** v18.9: my rain look from the server (wet, cảm lạnh, the umbrella open over me); the others are told when it
   *  changes. */
  setRain(l: { wet: boolean; cold: boolean; umbrella: RainLook["umbrella"] }): void {
    const next: RainLook = { wet: l.wet, cold: l.cold, umbrella: l.umbrella, struck: false };
    const r = this.rainLook;
    if (r.wet === next.wet && r.cold === next.cold && r.umbrella === next.umbrella) return;
    this.rainLook = next;
    this.announceNow();
  }

  /** v18.9: lightning struck me: the bolt and the charred look play here for STRIKE_MS (the others see it too), and I
   *  stop where I stand. */
  strike(): void {
    const now = performance.now();
    this.stopHere();
    this.hammockSince = null;
    this.strikeAt = now;
    this.strikeSeed = Math.floor(Math.random() * 1000);
    this.scorches.push({ x: this.local.pos.x, y: this.local.pos.y, at: now });
    this.announceNow();
  }

  private struck(now: number): boolean {
    return this.strikeAt > 0 && now - this.strikeAt < STRIKE_MS;
  }

  /** v18.10: what the heat layer shows now. */
  heatProbe(): HeatProbe {
    const now = performance.now();
    // the pond's edge cells are pond coordinates: on any other map they'd match a street or a stall
    const idle = this.map.id === "pond" && !this.swimming && !this.rodOut && !this.warming(now) && !this.ridingV && this.lift?.role !== "passenger";
    const { x, y } = this.local.pos;
    return {
      edge: idle ? edgeCell(this.local.pos) : null,
      swimming: this.swimming,
      warming: this.warming(now),
      cramping: this.crampUntil > now,
      rescue: this.rescueTarget,
      cell: { col: Math.floor(x / 8), row: Math.floor(y / 8) },
    };
  }

  private warming(now: number): boolean {
    return this.warmUntil > now;
  }

  private cramping(now: number): boolean {
    return this.crampUntil > now;
  }

  /** Stop where I stand (keys, a pending walk and a path). */
  private stopHere(): void {
    this.keys = { ...NO_KEYS };
    this.pendingInteract = null;
    setKeyboard(this.local, { x: 0, y: 0 });
  }

  private clearPrompt(): void {
    if (this.prompt) {
      this.prompt = null;
      this.cb.onPromptChange(null);
    }
  }

  /** The nearest visible member cramping within RESCUE_RANGE of me (not while I cramp myself). */
  private findRescue(now: number): { id: string; name: string } | null {
    if (this.cramping(now)) return null;
    let best: { id: string; name: string } | null = null, bestD = RESCUE_RANGE;
    for (const [id, a] of this.world.actors) {
      if (!this.visible(id, now) || this.world.heat(id, now).crampLeft === null) continue;
      const d = Math.hypot(a.display.x - this.local.pos.x, a.display.y - this.local.pos.y);
      if (d <= bestD) { bestD = d; best = { id, name: this.world.roster.get(id)?.name ?? "" }; }
    }
    return best;
  }

  setInputEnabled(enabled: boolean): void {
    this.inputEnabled = enabled;
    if (!enabled) {
      this.keys = { ...NO_KEYS };
      // drop the pending interaction but let the walk finish: others follow the same `pa` to its end
      this.pendingInteract = null;
    }
  }

  /** Height of the bottom HUD in CSS px: the camera may scroll that far past the map's bottom edge. */
  setBottomInset(cssPx: number): void {
    this.insetCss = Math.max(0, cssPx);
  }

  /** Set camera zoom factor (< 1 for wider / zoom out, > 1 for zoom in). */
  setZoom(zoom: number): void {
    if (typeof zoom === "number" && Number.isFinite(zoom) && zoom > 0 && Math.abs(this.zoom - zoom) > 0.01) {
      this.zoom = zoom;
      this.resize();
    }
  }

  getZoom(): number {
    return this.zoom;
  }

  /** Names and rarities for the catch labels. */
  setSpecies(list: ReadonlyArray<{ id: string; name: string; rarity: Rarity }>): void {
    this.species = new Map(list.map((s) => [s.id, { name: s.name, rarity: s.rarity }]));
  }

  /** The field's plots: the crops, the name posts' labels and my urgent rings (spec §13.4). */
  setPlots(plots: ReadonlyArray<PlotDraw>): void {
    this.plots = new Map(plots.map((p) => [p.no, p]));
  }

  /** v19.3: Khu nhà's lots (the houses built on them, the sold ones' flags). */
  setHouses(houses: ReadonlyArray<HouseDraw>): void {
    this.houses = [...houses];
  }

  /** v18.11: the unread dot on the Báo Làng stand's label. */
  setNewsUnread(unread: boolean): void {
    this.newsUnread = unread;
  }

  /** v20.3: the rings' labels on Bãi đất trống ("⚔️ Hiệp 2 · 1–0", who waits in a corner), from ring_state. */
  setRingLabels(labels: ReadonlyArray<string | null>): void {
    this.ringLabels = [...labels];
  }

  /** The card tables' labels from card_lobby (v16 spec §5): one line over each table of the hall. */
  setCardTables(labels: Readonly<Partial<Record<CardGame, string>>>): void {
    this.cardTables = { ...labels };
  }

  /** The field's crab holes and snail beds, each ready for me or not: a ready one shows its cue (v15.3 §13.1). */
  setGatherSpots(spots: ReadonlyArray<{ id: string; ready: boolean }>): void {
    this.gatherReady = new Set(spots.filter((s) => s.ready).map((s) => s.id));
  }

  /** Play farm animation `a` on my character for FARM_ANIM_MS (0 stops it). */
  showFarmAnim(a: FarmAnim): void {
    this.farm = a === 0 ? null : { a, at: performance.now() };
  }

  /** Trigger the interactable in range (E key / HUD button). Nothing happens while the rod is out. */
  interact(): void {
    if (this.prompt && this.fishing.phase === "idle" && !this.swimming && !this.warming(performance.now())) this.trigger(this.prompt);
  }

  /** Stand exactly on `at`, facing `facing` (a fishing spot), and tell the others at once. */
  plant(at: Vec, facing: Facing): void {
    this.keys = { ...NO_KEYS };
    this.pendingInteract = null;
    setKeyboard(this.local, { x: 0, y: 0 });
    this.local.pos = { x: at.x, y: at.y };
    this.local.display = { x: at.x, y: at.y };
    this.local.facing = facing;
    this.announceNow();
  }

  /** v18.2: my net throw as drawn (null = none). */
  setLocalNet(s: NetState | null): void {
    const prev = this.netThrow;
    this.netThrow = s ? { s, at: prev && prev.s.show === s.show ? prev.at : performance.now() } : null;
  }

  /** Stop and turn towards `p` (the water before a net throw), and tell the others at once. */
  faceTowards(p: Vec): void {
    this.keys = { ...NO_KEYS };
    this.pendingInteract = null;
    setKeyboard(this.local, { x: 0, y: 0 });
    this.local.facing = facingTowards(this.local.pos, p);
    this.announceNow();
  }

  /** My facing (the net's offsets are relative to it). */
  localFacing(): Facing {
    return this.local.facing;
  }

  /** What my rod shows. While it is out, movement, click-to-move and interactables are off. */
  setLocalFishing(f: LocalFishing): void {
    if (f.phase === "casting" && this.fishing.phase !== "casting") this.castAt = performance.now();
    this.fishing = { phase: f.phase, tint: f.tint ?? null, glow: f.glow ?? false };
    if (f.phase !== "idle") {
      this.keys = { ...NO_KEYS };
      this.pendingInteract = null;
      if (this.local.path) {
        // a click/tap walk stops here too — and say so, or the others follow its `pa` to the end
        setKeyboard(this.local, { x: 0, y: 0 });
        this.announceNow();
      }
    }
  }

  /** The fish in my hands (species id), or null. */
  setLocalHand(speciesId: string | null): void {
    this.hand = speciesId;
  }

  /** "🐟 Cá lóc 1,2 kg" over my head for a moment. */
  showLocalCatch(speciesId: string, weightG: number): void {
    this.landed = { speciesId, weightG, until: performance.now() + CATCH_LABEL_MS };
  }

  /** A dust puff at `at` for a second (digging worms — only I see it). */
  puff(at: Vec): void {
    this.puffs.push({ x: at.x, y: at.y, born: performance.now() });
  }

  /** Is another visible member fishing within `radius` px of `p` (the spot is taken)? */
  anglerNear(p: Vec, radius = 12): boolean {
    const now = performance.now();
    for (const [id, a] of this.world.actors) {
      if (!this.visible(id, now) || this.world.fishing(id, now).phase === 0) continue;
      if (Math.hypot(a.pos.x - p.x, a.pos.y - p.y) <= radius) return true;
    }
    return false;
  }

  /** My current state as a message — the answer to someone's `hello`. */
  snapshot(): GameMessage {
    const id = this.opts.localId;
    if (this.local.path && this.local.path.length > 0) {
      return {
        t: "pa", id, x: Math.round(this.local.pos.x), y: Math.round(this.local.pos.y),
        pts: this.local.path.slice(0, MAX_PATH_POINTS).map((p) => [Math.round(p.x), Math.round(p.y)] as [number, number]),
        h: this.hand,
        ...(this.ridingV ? { v: this.ridingV } : {}), ...this.liftFlag(),
        ...this.swimFlag(),
      };
    }
    return { t: "st", id, ...this.localMove(), f: phaseCode(this.fishing.phase) };
  }

  // ------------------------------------------------------------ internals

  private get rodOut(): boolean {
    return this.fishing.phase !== "idle";
  }

  /** An explicit interaction (in-range click, E/Enter, HUD button) cancels any earlier walk-to-interact. */
  private trigger(it: Interactable): void {
    this.pendingInteract = null;
    this.dispatch(it);
  }

  /** The hammock is the engine's own (lie down / get up); everything else goes to the shell. */
  private dispatch(it: Interactable): void {
    if (it.kind === "hammock") this.toggleHammock();
    else this.cb.onInteract(it);
  }

  /** Am I lying in the hall's hammock? */
  inHammock(): boolean {
    return this.hammockSince !== null;
  }

  /** Lie down in the hammock (not on a vehicle, swimming, fishing, riding along, locked, or while someone else lies in
   *  it), or get up. */
  private toggleHammock(): void {
    const now = performance.now();
    if (this.hammockSince !== null) { this.leaveHammock(); return; }
    const it = this.hammockIt;
    if (!it || this.hammockTaken(now)) return;
    const locked = this.warming(now) || this.cramping(now) || this.struck(now);
    if (hammockBlocked({ riding: this.ridingV !== null, swimming: this.swimming, passenger: this.lift?.role === "passenger", rodOut: this.rodOut, locked })) return;
    this.hammockSince = now;
    this.plant(it.use, "up");                                               // tells the others (hm)
  }

  /** Get up from the hammock (E, a move, a tap, the prompt button); I stand on its use spot. */
  leaveHammock(): void {
    if (this.hammockSince === null) return;
    this.hammockSince = null;
    this.announceNow();
  }

  /** The visible member lying in the hammock (the keeper when several say so), or null. */
  private hammockTaken(now: number): string | null {
    if (!this.hammockIt) return null;
    const ids: string[] = [];
    for (const id of this.world.actors.keys()) if (this.world.hammock(id) && this.visible(id, now)) ids.push(id);
    return hammockKeeper(ids);
  }

  private localMove(): LocalMoveMsg {
    return {
      x: Math.round(this.local.pos.x),
      y: Math.round(this.local.pos.y),
      d: facingToCode(this.local.facing),
      mv: this.local.moving && !this.local.path,
      vx: (Math.sign(this.local.dir.x) || 0) as Unit,
      vy: (Math.sign(this.local.dir.y) || 0) as Unit,
      h: this.hand,
      ...(this.ridingV ? { v: this.ridingV } : {}), ...this.liftFlag(),
      ...this.swimFlag(),
      ...(this.hammockSince !== null ? { hm: 1 as const } : {}),
    };
  }

  /** v18.1: `sw` for my movement messages — 1 swimming, 2 dripping, nothing when dry. */
  private swimFlag(): { sw?: SwimCode; hx?: number; cr?: number; pt?: string; rn?: number } {
    return {
      ...(this.swimming ? { sw: 1 as const } : performance.now() < this.wetUntil ? { sw: 2 as const } : {}), ...this.heatFlag(),
      ...(this.petCode ? { pt: this.petCode } : {}),                                                   // v18.12: my pet
      ...this.rainFlag(),                                                                              // v18.9
    };
  }

  /** v18.9: `rn` (lib/game/rain/model.ts RN) for my movement messages; absent when dry. */
  private rainFlag(): { rn?: number } {
    const bits = encodeRain({ ...this.rainLook, struck: this.struck(performance.now()) });
    return bits === 0 ? {} : { rn: bits };
  }

  /** v18.10: `hx` (1 heat-shocked, 2 warming up, 4 cramping) and `cr` (the cramp's ms left) for my movement messages. */
  private heatFlag(): { hx?: number; cr?: number } {
    const now = performance.now();
    const bits = (this.heatShocked ? HX.shocked : 0) | (this.warming(now) ? HX.warming : 0) | (this.cramping(now) ? HX.cramp : 0);
    if (bits === 0) return {};
    return this.cramping(now) ? { hx: bits, cr: Math.min(CRAMP_MS, Math.round(this.crampUntil - now)) } : { hx: bits };
  }

  /** The collision grid I move on: the swim grid while swimming. */
  private get moveMap(): GameMap {
    return this.swimming && this.swimMap ? this.swimMap : this.map;
  }

  /** A walking member is drawn once we know where they are, or once the answers to their `hello` are overdue
   *  (the answer window grows with the world: everyone else walking + me). */
  private visible(id: string, now: number): boolean {
    return this.world.visible(id, now, unseenGraceMs(this.world.walkers() + 1));
  }

  private resize(): void {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const devW = Math.max(1, Math.round(r.width * this.dpr));
    const devH = Math.max(1, Math.round(r.height * this.dpr));
    if (this.canvas.width !== devW) this.canvas.width = devW;
    if (this.canvas.height !== devH) this.canvas.height = devH;
    const v = computeView(devW, devH, this.map.width, this.map.height, this.zoom);
    this.scale = v.scale;
    this.vw = v.vw;
    this.vh = v.vh;
    this.buf.width = this.vw;
    this.buf.height = this.vh;
  }

  private isTyping(t: EventTarget | null): boolean {
    if (!(t instanceof HTMLElement)) return false;
    return t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable;
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.inputEnabled || e.ctrlKey || e.metaKey || e.altKey || this.isTyping(e.target)) return;
    this.cb.onInput?.();
    if (this.rodOut) {
      // while fishing: Space hooks (and holds while reeling — the reel overlay listens too), Esc reels in
      if (e.code === "Space") {
        e.preventDefault();
        if (!e.repeat) this.cb.onFishingInput?.("tap");
      } else if (e.code === "Escape") {
        this.cb.onFishingInput?.("cancel");
      }
      return;
    }
    // v18.10: E next to a cramping member pulls them out (it wins over any prompt)
    if (e.code === "KeyE" && this.rescueTarget) {
      e.preventDefault();
      if (!e.repeat) this.cb.onRescue?.(this.rescueTarget.id);
      return;
    }
    const k = KEYMAP[e.code];
    if (k) {
      this.keys[k] = true;
      e.preventDefault();
      return;
    }
    if ((e.code === "KeyE" || e.code === "Enter") && this.prompt) {
      // Enter keeps its normal meaning on a focused button or link (HUD controls)
      if (e.code === "Enter" && e.target instanceof HTMLElement && e.target.closest("button, a[href], [role='button']")) return;
      e.preventDefault();
      // a held key triggers once: a repeat would reach the next map's engine, and the hall's arrival is at the dock sign
      if (!e.repeat) this.trigger(this.prompt);
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    const k = KEYMAP[e.code];
    if (k) this.keys[k] = false;
  };

  private readonly onBlur = (): void => {
    this.halt();
  };

  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState === "hidden") this.halt();
  };

  /** Focus left the page or the tab was hidden: stop keyboard walking and send the stop now — a hidden tab may not
   *  run another frame, and everyone else would see me walk on. A click/tap path goes on (others follow the same `pa`). */
  private halt(): void {
    this.keys = { ...NO_KEYS };
    if (!this.local.path) setKeyboard(this.local, { x: 0, y: 0 });
    this.announceMove(performance.now());
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (!this.inputEnabled || e.button !== 0) return;
    this.cb.onInput?.();
    if (this.rodOut) {
      this.cb.onFishingInput?.("tap");
      return;
    }
    const r = this.canvas.getBoundingClientRect();
    const w: Vec = {
      x: ((e.clientX - r.left) * this.dpr) / this.scale + this.cam.x,
      y: ((e.clientY - r.top) * this.dpr) / this.scale + this.cam.y,
    };
    // v18.10: no walking while warming up or cramping
    if (this.warming(performance.now()) || this.cramping(performance.now())) return;
    // v18.13: a passenger does not walk or use anything
    if (this.lift?.role === "passenger") return;
    // a tap anywhere gets me out of the hammock (and nothing else)
    if (this.hammockSince !== null) { this.leaveHammock(); return; }
    // v18.1: a swimmer only swims (a tap is somewhere to swim to)
    if (this.swimming) {
      this.pendingInteract = null;
      this.walkTo(w);
      return;
    }
    // Interactables win over people: the DJ stands right behind the booth.
    const it = interactableAt(this.map, w);
    if (it) {
      if (inUseRange(it, this.local.pos)) {
        this.trigger(it);
        return;
      }
      this.pendingInteract = it;
      this.walkTo(it.use);
      return;
    }
    // v17: a tap on a rat shoots it within 40 px, else walks toward it (§12.1)
    const rat = this.ratUnder(w);
    if (rat) {
      if (Math.hypot(rat.use.x - this.local.pos.x, rat.use.y - this.local.pos.y) <= RAT_PROMPT_RANGE) this.trigger(rat);
      else {
        this.pendingInteract = null;
        this.walkTo(rat.use);
      }
      return;
    }
    const hit = this.actorAt(w);
    if (hit) {
      this.cb.onActorClick(hit);
      return;
    }
    this.pendingInteract = null;
    this.walkTo(w);
  };

  /** The live rat drawn under world point p (a finger-sized box around it), as its interactable; field only. */
  private ratUnder(p: Vec): Interactable | null {
    if (this.map.id !== "field") return null;
    const t = serverNow();
    for (const r of this.pack.liveRats) {
      const at = ratAt(r, t);
      if (at && Math.abs(p.x - at.x) <= 8 && p.y >= at.y - 10 && p.y <= at.y + 4) return ratInteractable(r, at);
    }
    return null;
  }

  /** Front-most other member under world point p. */
  private actorAt(p: Vec): string | null {
    const now = performance.now();
    let bestId: string | null = null;
    let bestY = -Infinity;
    for (const e of this.world.roster.values()) {
      const feet = e.spot ?? (this.visible(e.id, now) ? this.world.actors.get(e.id)?.display : undefined);
      if (feet && hitsCharacter(p, feet) && feet.y > bestY) {
        bestId = e.id;
        bestY = feet.y;
      }
    }
    return bestId;
  }

  private walkTo(target: Vec): void {
    const cells = findPath(this.moveMap, this.local.pos, target);
    if (!cells) {
      this.pendingInteract = null;
      return;
    }
    const pts = smoothPath(this.moveMap, this.local.pos, cells);
    setPath(this.local, pts);
    this.lastSent = { mv: false, vx: 0, vy: 0, at: performance.now() };
    this.cb.onLocalPath({
      x: Math.round(this.local.pos.x),
      y: Math.round(this.local.pos.y),
      pts: pts.map((p) => [Math.round(p.x), Math.round(p.y)] as [number, number]),
      h: this.hand,
      ...(this.ridingV ? { v: this.ridingV } : {}), ...this.liftFlag(),
      ...this.swimFlag(),
    });
  }

  /** v18.12: every pet owner here, where they stand, and whether their pet is hidden (riding, swimming, unseen). */
  private petOwners(now: number): OwnerState[] {
    const me = this.opts.localId;
    const out: OwnerState[] = [{ id: me, pos: this.local.display, hidden: this.ridingV !== null || this.swimming || this.lift?.role === "passenger" }];
    for (const e of this.world.roster.values()) {
      if (!this.pets.code(e.id)) continue;
      if (e.spot) { out.push({ id: e.id, pos: e.spot, hidden: false }); continue; }
      const a = this.world.actors.get(e.id);
      if (!a) continue;
      const hidden = !this.visible(e.id, now) || this.world.riding(e.id) !== null || this.world.carrier(e.id) !== null || this.world.swim(e.id, now) === "swim";
      out.push({ id: e.id, pos: a.display, hidden });
    }
    return out;
  }

  private positionOf(id: string, now: number): Vec | null {
    if (id.startsWith("pet:")) {
      // v18.12: a parrot's echo floats over the pet (its head is lower than a person's)
      const p = this.pets.pos(id.slice(4));
      const look = this.pets.look(id.slice(4));
      return p && look ? { x: p.x, y: p.y + 50 - petHeight(look) - 2 - petAltitude(look, 0, true) } : null;
    }
    if (id === this.opts.localId) return this.local.display;
    const e = this.world.roster.get(id);
    if (!e) return null;
    if (e.spot) return e.spot;
    return this.visible(id, now) ? this.world.actors.get(id)?.display ?? null : null;
  }

  /** One frame. A throwing frame is skipped; MAX_FAILED_FRAMES in a row stop the loop and report (M3 guard). */
  private readonly frame = (t: number): void => {
    if (this.destroyed) return;
    const dt = Math.min(0.05, Math.max(0, (t - this.lastT) / 1000));
    this.lastT = t;
    try {
      this.update(dt, t);
      this.render(t);
      this.failures = 0;
    } catch (err) {
      this.failures++;
      if (this.failures >= MAX_FAILED_FRAMES) {
        this.destroyed = true;
        this.cb.onFatal?.(err);
        return;
      }
    }
    if (!this.drewFirst && this.failures === 0) {
      this.drewFirst = true;
      this.cb.onFirstFrame?.();
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  private update(dt: number, now: number): void {
    const locked = this.warming(now) || this.cramping(now)                  // v18.10: the stretch, a cramp
      || this.lift?.role === "passenger"                                    // v18.13: on someone's vehicle
      || this.struck(now);                                                  // v18.9: lightning
    const dir = this.inputEnabled && !this.rodOut && !locked ? inputDir(this.keys) : { x: 0, y: 0 };
    if (this.warmUntil !== 0 && !this.warming(now)) {
      this.warmUntil = 0;
      this.announceNow();
    }
    this.rescueTarget = this.findRescue(now);
    // the hammock: a move gets me up; so does someone else keeping it (we lay down at the same moment)
    if (this.hammockSince !== null) {
      const other = this.hammockTaken(now);
      if (dir.x !== 0 || dir.y !== 0 || (other !== null && hammockKeeper([other, this.opts.localId]) !== this.opts.localId)) this.leaveHammock();
    }
    if (dir.x !== 0 || dir.y !== 0) {
      this.pendingInteract = null;
      setKeyboard(this.local, dir);
    } else if (!this.local.path && this.local.moving) {
      setKeyboard(this.local, dir);
    }
    const arrived = tickActor(this.moveMap, this.local, dt, now, false, this.localSpeed());
    this.updateSwim(now);
    if (arrived && this.pendingInteract) {
      const it = this.pendingInteract;
      this.pendingInteract = null;
      // a long walk can end early (smoothPath caps the waypoints) — only trigger when we really got there
      if (inUseRange(it, this.local.pos)) this.dispatch(it);
    }
    this.announceMove(now);
    // a map interactable in range always wins E; else, on the field, a rat within 40 px (v17 §12.1). The same rat keeps
    // its prompt object while it runs.
    // v18.1: …else, on the pond, a cast from the bank or the platform edge I stand on (the same cell keeps its prompt)
    let near = this.rodOut || this.swimming || locked ? null : promptTarget(this.map, this.local.pos, this.pack.liveRats, serverNow());
    if (!near && !this.rodOut && !this.swimming && !locked && this.map.id === "pond") {
      const bank = shoreInteractable(this.map, this.local.pos, this.local.facing);
      near = bank && this.prompt?.id === bank.id && this.prompt.face === bank.face ? this.prompt : bank;
    }
    // the hammock's prompt: "Dậy" while I lie in it (always, wherever the nearest is), "Có người đang nằm" when taken
    if (this.hammockSince !== null && this.hammockIt) near = hammockPrompt(this.hammockIt, true, false);
    else if (near?.kind === "hammock") near = hammockPrompt(near, false, this.hammockTaken(now) !== null);
    if (near?.kind === "rat" && this.prompt?.kind === "rat" && near.rat === this.prompt.rat) {
      this.prompt.use = near.use;
      this.prompt.rect = near.rect;
    } else if (near !== this.prompt) {
      this.prompt = near;
      this.cb.onPromptChange(near);
    }
    this.world.tick(dt, now);
    this.followLift(now);                                                   // v18.13
    this.pack.step(this.dogWalkers(now), now);
    this.pets.step(this.petOwners(now), dt);                                            // v18.12
    if (this.echoes.length > 0) {
      for (const e of this.echoes) {
        if (e.at > now) continue;
        const lines = wrapBubble(`${e.text}!`);
        if (lines.length > 0 && this.pets.pos(e.id)) this.bubbles.set(`pet:${e.id}`, { lines, until: now + BUBBLE_MS / 2 });
      }
      this.echoes = this.echoes.filter((e) => e.at > now);
    }
    const inset = Math.ceil((this.insetCss * this.dpr) / this.scale);
    this.cam = cameraFor(this.local.display, this.vw, this.vh, this.map.width, this.map.height, inset);
    for (const [id, b] of this.bubbles) if (b.until < now) this.bubbles.delete(id);
    this.reactions = this.reactions.filter((r) => now - r.born < REACTION_MS);
    if (this.landed && this.landed.until < now) this.landed = null;
    if (this.puffs.length > 0) this.puffs = this.puffs.filter((p) => now - p.born < PUFF_MS);
    this.updateLeaps(now);
  }

  /** v18.1: stepping out of the water ends swim mode and starts the drips; the others hear both (and the drying). */
  private updateSwim(now: number): void {
    if (this.swimming && !inWater(this.local.pos)) {
      this.swimming = false;
      this.wetUntil = now + WET_MS;
      this.wetAnnounced = true;
      if (this.local.path) {
        // a tap-walk that crosses the bank stops here: the rest was planned on the swim grid
        setKeyboard(this.local, { x: 0, y: 0 });
      }
      this.announceNow();
      this.cb.onLeftWater?.();                                                     // v18.10: the immunity
    } else if (this.wetAnnounced && now >= this.wetUntil) {
      this.wetAnnounced = false;
      if (!this.local.path) this.announceNow();
    }
    // v18.9: the strike is over — say so (the struck bit goes)
    if (this.strikeAt > 0 && !this.struck(now)) {
      this.strikeAt = 0;
      this.announceNow();
    }
  }

  /** v18.1: every 3–8 s a fish leaps from a random open-water cell of the pond (cosmetic; only this client sees it). */
  private updateLeaps(now: number): void {
    if (this.map.id !== "pond") return;
    if (this.leaps.length > 0) this.leaps = this.leaps.filter((l) => !leapDone(l, now));
    if (now < this.nextLeapAt) return;
    this.nextLeapAt = now + LEAP_GAP_MIN_MS + Math.random() * (LEAP_GAP_MAX_MS - LEAP_GAP_MIN_MS);
    this.leapCells ??= pondWaterCells().filter((p) => inPond(p.x, p.y, -18));
    const cells = this.leapCells;
    if (cells.length === 0) return;
    const from = cells[Math.floor(Math.random() * cells.length)];
    const dir = Math.random() < 0.5 ? -1 : 1;
    const to = { x: from.x + dir * (12 + Math.round(Math.random() * 6)), y: from.y + Math.round(Math.random() * 4 - 2) };
    if (!inPond(to.x, to.y, -10)) return;
    this.leaps.push({ x0: from.x, y0: from.y, x1: to.x, y1: to.y, born: now });
  }

  /** Everyone drawn walking with a dog this frame: me, and the visible walkers whose presence has one (v17 §7.3). */
  private dogWalkers(now: number): DogWalker[] {
    const out: DogWalker[] = [];
    const me = this.localInfo;
    if (me.dog) {
      out.push({
        id: this.opts.localId, x: this.local.display.x, y: this.local.display.y, facing: this.local.facing, dog: me.dog,
        hungry: me.dogHungry ?? false, petAt: null,
      });
    }
    for (const e of this.world.roster.values()) {
      const a = e.dog && !e.spot ? this.world.actors.get(e.id) : undefined;
      if (!e.dog || !a || !this.visible(e.id, now)) continue;
      out.push({
        id: e.id, x: a.display.x, y: a.display.y, facing: a.facing, dog: e.dog, hungry: false,
        petAt: this.world.farmAnim(e.id, now) === FARM_ANIM.pet ? this.world.farmAnimAt(e.id, now) : null,
      });
    }
    return out;
  }

  /** Keyboard walking started, stopped or turned → `mv` (plus a keep-alive every 3 s while walking). A path is
   *  announced once, when it starts. */
  private announceMove(now: number): void {
    if (this.local.path) return;
    const m = this.localMove();
    const changed = m.mv !== this.lastSent.mv || m.vx !== this.lastSent.vx || m.vy !== this.lastSent.vy;
    if (changed || (m.mv && now - this.lastSent.at > KEEPALIVE_MS)) {
      this.cb.onLocalMove(m);
      this.lastSent = { mv: m.mv, vx: m.vx, vy: m.vy, at: now };
    }
  }

  /** Send my state now, changed or not: a jump or a stopped path, which the change check above would miss. */
  private announceNow(): void {
    const m = this.localMove();
    this.cb.onLocalMove(m);
    this.lastSent = { mv: m.mv, vx: m.vx, vy: m.vy, at: performance.now() };
  }

  private render(t: number): void {
    const b = this.bctx;
    const camX = Math.round(this.cam.x), camY = Math.round(this.cam.y);
    const reduced = this.opts.reducedMotion;
    b.imageSmoothingEnabled = false;
    b.fillStyle = this.art.edge;
    b.fillRect(0, 0, this.vw, this.vh);
    b.drawImage(this.art.background, -camX, -camY);
    this.art.drawAnimated(b, t, camX, camY, reduced);
    this.drawPlots(b, t, camX, camY, reduced);
    this.drawHouses(b, camX, camY);
    this.drawGatherCues(b, t, camX, camY, reduced);
    // v18.1: the leaping fish, on the water under the people
    for (const l of this.leaps) {
      if (l.x0 - camX < -24 || l.x0 - camX > this.vw + 24 || l.y0 - camY < -24 || l.y0 - camY > this.vh + 24) continue;
      drawLeap(b, { ...l, x0: l.x0 - camX, y0: l.y0 - camY, x1: l.x1 - camX, y1: l.y1 - camY }, t, reduced);
    }

    const items: Array<{ y: number; draw: () => void }> = [];
    const amp = swayAmp(this.weather, reduced, this.weatherFx);
    // the hammock's sleeper (me, or the member keeping it) is drawn in it, not standing on its use spot
    const lyingId = this.hammockSince !== null ? this.opts.localId : this.hammockTaken(t);
    this.art.props.forEach((p, i) => {
      const x = p.x - camX, y = p.y - camY;
      if (x > this.vw || y > this.vh || x + p.canvas.width < 0 || y + p.canvas.height < 0) return;
      const hp = this.map.props[i];
      if (hp?.kind === "hammock") {
        items.push({ y: p.sortY, draw: () => this.drawHammock(b, hp, lyingId, camX, camY, amp, t, reduced) });
        return;
      }
      const s = this.swaying[i] ? swayAt(amp, t, i) : 0;
      if (s === 0) { items.push({ y: p.sortY, draw: () => b.drawImage(p.canvas, x, y) }); return; }
      // v18.8: in the wind the crown leans (the top half by s, the middle by s/2, the base stays planted)
      const cw = p.canvas.width, ch = p.canvas.height, top = Math.floor(ch * 0.5), mid = Math.floor(ch * 0.25);
      items.push({
        y: p.sortY,
        draw: () => {
          b.drawImage(p.canvas, 0, 0, cw, top, x + s, y, cw, top);
          b.drawImage(p.canvas, 0, top, cw, mid, x + Math.round(s / 2), y + top, cw, mid);
          b.drawImage(p.canvas, 0, top + mid, cw, ch - top - mid, x, y + top + mid, cw, ch - top - mid);
        },
      });
    });
    const onScreen = (pos: Vec) => {
      const x = Math.round(pos.x) - camX, y = Math.round(pos.y) - camY;
      return x >= -16 && x <= this.vw + 16 && y >= -4 && y <= this.vh + 60;
    };
    const drawActor = (look: Look, pos: Vec, facing: Facing, walk: Frame) => {
      const x = Math.round(pos.x) - camX, y = Math.round(pos.y) - camY;
      // standing still: a slow breath, staggered by where the character stands (held under reduced motion)
      const frame = walk === 0 && !reduced ? idleFrame(t, (Math.round(pos.x) * 37 + Math.round(pos.y) * 11) % 900) : walk;
      b.fillStyle = "rgba(40, 25, 10, 0.28)";
      b.fillRect(x - 7, y - 1, 14, 2);
      b.fillRect(x - 5, y + 1, 10, 1);
      b.drawImage(getCharacterFrames(look)[facing][frame], x - 12, y - 46);
    };
    /** v18.7: a character riding `v` (side views mirror the right-facing frame). */
    const drawRider = (look: Look, pos: Vec, facing: Facing, v: VehicleId, moving: boolean, pillion: Look | null = null) => {
      const feet = { x: Math.round(pos.x) - camX, y: Math.round(pos.y) - camY };
      const frame = getCharacterFrames(look)[facing === "left" ? "right" : facing][riderFrame(v, t, reduced || !moving)];
      // v18.13: the passenger's still frames
      const pf = pillion ? getCharacterFrames(pillion) : null;
      const p: Pillion | null = pf ? { right: pf.right[0], down: pf.down[0], up: pf.up[0] } : null;
      drawRide(b, feet, facing, v, frame, t, moving, reduced, p);
    };
    /** v18.1: a swimmer (sunk to the chest, stroking), and the drips of someone who just climbed out. */
    const drawSwim = (look: Look, pos: Vec, facing: Facing, moving: boolean) => {
      const feet = { x: Math.round(pos.x) - camX, y: Math.round(pos.y) - camY };
      drawSwimmer(b, feet, facing, getCharacterFrames(look)[facing][0], look.skin, t, moving, reduced);
    };
    /** v18.10: a cramping swimmer sinking with `left` ms to go; the warm-up stretch; the heat-shocked face. */
    const drawCrampAt = (look: Look, pos: Vec, facing: Facing, left: number) => {
      const feet = { x: Math.round(pos.x) - camX, y: Math.round(pos.y) - camY };
      drawCramp(b, feet, facing, getCharacterFrames(look)[facing][0], look.skin, t, left, CRAMP_MS, reduced);
    };
    const heatFace = (pos: Vec, facing: Facing) => {
      const feet = { x: Math.round(pos.x) - camX, y: Math.round(pos.y) - camY };
      drawHeatFace(b, feet, feet.y - 46, facing, t, reduced);
    };
    const drawStretchAt = (look: Look, pos: Vec, facing: Facing, shocked: boolean) => {
      const feet = { x: Math.round(pos.x) - camX, y: Math.round(pos.y) - camY };
      drawStretch(b, feet, facing, getCharacterFrames(look)[facing][0], look.skin, t, reduced);
      if (shocked) heatFace(pos, facing);
    };
    const drips = (pos: Vec, left: number) => {
      drawWetDrips(b, { x: Math.round(pos.x) - camX, y: Math.round(pos.y) - camY }, t, left, reduced);
    };
    /** v18.9: the umbrella's shaft (before the body) and canopy (after it); on a vehicle, `lift` raises it (never in a car). */
    const umbrellaAt = (r: RainLook, pos: Vec, facing: Facing, layer: "back" | "front", v: VehicleId | null = null) => {
      if (!r.umbrella || v === "car") return;
      drawUmbrella(b, { x: Math.round(pos.x) - camX, y: Math.round(pos.y) - camY }, facing, r.umbrella, t, reduced, layer, v === "moto" ? 1 : 0);
    };
    /** v18.9: soaked, cảm lạnh and a lightning strike `struckAge` ms ago, over the character. */
    const rainOver = (r: RainLook, pos: Vec, facing: Facing, struckAge: number | null, seed: number, onFoot: boolean) => {
      const feet = { x: Math.round(pos.x) - camX, y: Math.round(pos.y) - camY };
      if (r.cold && onFoot) drawCold(b, feet, feet.y - 46, facing, t, reduced);
      if (r.wet && onFoot) drawSoaked(b, feet, t, reduced);
      if (struckAge !== null && struckAge < STRIKE_MS) drawStrike(b, feet, struckAge, seed, reduced);
    };
    const seedOf = (id: string) => [...id].reduce((s, ch) => (s * 31 + ch.charCodeAt(0)) % 997, 7);
    // v18.9: the scorch marks where lightning struck (under the people, 20 s)
    this.scorches = this.scorches.filter((s) => t - s.at < 20_000);
    for (const s of this.scorches) drawScorch(b, { x: Math.round(s.x) - camX, y: Math.round(s.y) - camY });
    /** The rod (while fishing), the fish in hand or a farm animation, drawn over the character. */
    const drawGear = (key: string, look: Look, pos: Vec, facing: Facing, phase: 0 | 1 | 2 | 3, hand: string | null, rod: { swing: number; tint: string | null; glow: boolean } | null, farm: FarmAnim) => {
      const feet = { x: Math.round(pos.x) - camX, y: Math.round(pos.y) - camY };
      // when each angler's phase began (for the strike); a phase first seen now counts as long ago
      const seen = this.rodPhase.get(key);
      if (!seen || seen.p !== phase) this.rodPhase.set(key, { p: phase, at: seen ? t : t - 1e6 });
      const since = t - this.rodPhase.get(key)!.at;
      if (rod) drawRod(b, feet, facing, { phase, swing: rod.swing, tint: rod.tint, glow: rod.glow, t, reducedMotion: reduced, skin: look.skin, since });
      else if (farm !== 0) drawFarmAnim(b, feet, facing, farm, t, reduced);
      else if (hand) drawHeldFish(b, feet, facing, hand);
    };
    /** v18.2: a character throwing a net (behind the body facing away, else in front; leaning back while pulling). */
    const netAt = (look: Look, pos: Vec, facing: Facing, n: { s: NetState; since: number }) => {
      const feet = { x: Math.round(pos.x) - camX, y: Math.round(pos.y) - camY };
      drawNetThrower(b, feet, facing, getCharacterFrames(look)[facing][0], look.skin, n.s, n.since, t, reduced);
    };
    for (const e of this.world.roster.values()) {
      const spot = e.spot;
      if (spot) {
        if (onScreen(spot)) items.push({ y: spot.y, draw: () => drawActor(e.look, spot, spot.dir, 0) });
        continue;
      }
      const a = this.world.actors.get(e.id);
      if (!a || !this.visible(e.id, t) || !onScreen(a.display)) continue;
      if (this.carried(e.id, t)) continue;                                // v18.13: drawn on the driver's vehicle
      if (e.id === lyingId) continue;                                     // drawn in the hammock
      const f = this.world.fishing(e.id, t);
      const farm = this.world.farmAnim(e.id, t);
      items.push({
        y: a.display.y,
        draw: () => {
          const sw = this.world.swim(e.id, t);
          const hx = this.world.heat(e.id, t);
          if (sw === "swim" && hx.crampLeft !== null) { drawCrampAt(e.look, a.display, a.facing, hx.crampLeft); return; }
          if (sw === "swim") { drawSwim(e.look, a.display, a.facing, a.moving); return; }
          const rl = this.world.rain(e.id, t);                                                    // v18.9
          const v = this.world.riding(e.id);
          if (v) {
            umbrellaAt(rl, a.display, a.facing, "back", v);
            drawRider(e.look, a.display, a.facing, v, a.moving, this.pillionOf(e.id));
            umbrellaAt(rl, a.display, a.facing, "front", v);
            rainOver(rl, a.display, a.facing, rl.struckAge, seedOf(e.id), false);
            return;
          }
          if (hx.warming) { drawStretchAt(e.look, a.display, a.facing, hx.shocked); return; }
          const nt = this.world.net(e.id, t);
          if (nt) { netAt(e.look, a.display, a.facing, nt); rainOver(rl, a.display, a.facing, rl.struckAge, seedOf(e.id), true); return; }
          const gear = () => drawGear(e.id, e.look, a.display, a.facing, f.phase, f.hand, f.phase === 0 ? null : { swing: 1, tint: null, glow: false }, farm);
          // facing away, the rod and hands are in front of the body, so the body hides them
          const rlU = f.phase === 0 ? rl : { ...rl, umbrella: null };                               // no umbrella while fishing
          umbrellaAt(rlU, a.display, a.facing, "back");
          if (a.facing === "up") gear();
          drawActor(e.look, a.display, a.facing, walkFrame(a));
          if (hx.shocked) heatFace(a.display, a.facing);
          if (a.facing !== "up") gear();
          if (sw === "wet") drips(a.display, 1);
          umbrellaAt(rlU, a.display, a.facing, "front");
          rainOver(rl, a.display, a.facing, rl.struckAge, seedOf(e.id), true);
        },
      });
    }
    for (const n of this.map.npcs) {
      if (onScreen(n.spot)) items.push({ y: n.spot.y, draw: () => drawActor(n.look, n.spot, n.spot.dir, 0) });
    }
    // v17: the dogs, and the field's rats, sorted with props and people (one frame held under reduced motion)
    const ft = reduced ? 0 : t;
    // v18.12: the pets following their owners
    for (const p of this.pets.drawn()) {
      if (onScreen(p)) items.push({ y: p.y, draw: () => drawPet(b, p.look, p.facing, petPose(p.moving, t, reduced), Math.round(p.x) - camX, Math.round(p.y) - camY, t, reduced) });
    }
    for (const d of this.pack.drawnDogs(t)) {
      if (onScreen(d)) items.push({ y: d.y, draw: () => drawDog(b, d.coat, d.facing, dogFrame(d.pose, ft), Math.round(d.x) - camX, Math.round(d.y) - camY) });
    }
    if (this.map.id === "field") {
      for (const r of this.pack.drawnRats(t, serverNow())) {
        if (!onScreen(r)) continue;
        items.push({ y: r.y, draw: () => drawRat(b, r.fallen ? "fall" : ratFrame(r.moving, ft), r.dir, Math.round(r.x) - camX, Math.round(r.y) - camY) });
      }
    }
    const me = this.local;
    const fishing = this.fishing;
    const myFarm = this.farm && t - this.farm.at < FARM_ANIM_MS ? this.farm.a : 0;
    items.push({
      y: me.display.y,
      draw: () => {
        if (this.swimming && this.cramping(t)) { drawCrampAt(this.localInfo.look, me.display, me.facing, this.crampUntil - t); return; }
        if (this.swimming) { drawSwim(this.localInfo.look, me.display, me.facing, me.moving); return; }
        if (this.aboard(t)) return;                                         // v18.13: drawn on the driver's vehicle
        if (this.hammockSince !== null) return;                             // drawn in the hammock
        const rl = this.rainLook, sAge = this.struck(t) ? t - this.strikeAt : null;                 // v18.9
        if (this.ridingV) {
          umbrellaAt(rl, me.display, me.facing, "back", this.ridingV);
          drawRider(this.localInfo.look, me.display, me.facing, this.ridingV, me.moving, this.pillionOf(this.opts.localId));
          umbrellaAt(rl, me.display, me.facing, "front", this.ridingV);
          rainOver(rl, me.display, me.facing, sAge, this.strikeSeed, false);
          return;
        }
        if (this.warming(t)) { drawStretchAt(this.localInfo.look, me.display, me.facing, this.heatShocked); return; }
        const myNet = this.netThrow;
        if (myNet && netAlive(myNet.s.show, t - myNet.at)) {
          netAt(this.localInfo.look, me.display, me.facing, { s: myNet.s, since: t - myNet.at });
          rainOver(rl, me.display, me.facing, sAge, this.strikeSeed, true);
          return;
        }
        const swing = Math.min(1, (t - this.castAt) / SWING_MS);
        const gear = () => drawGear("@me", this.localInfo.look, me.display, me.facing, phaseCode(fishing.phase), this.hand,
          fishing.phase === "idle" ? null : { swing, tint: fishing.tint, glow: fishing.glow }, myFarm);
        // v18.9: the rod needs both hands — no umbrella while fishing
        const myRain = fishing.phase === "idle" ? rl : { ...rl, umbrella: null };
        umbrellaAt(myRain, me.display, me.facing, "back");
        if (me.facing === "up") gear();
        drawActor(this.localInfo.look, me.display, me.facing, walkFrame(me));
        if (this.heatShocked) heatFace(me.display, me.facing);
        if (me.facing !== "up") gear();
        if (t < this.wetUntil) drips(me.display, (this.wetUntil - t) / WET_MS);
        umbrellaAt(myRain, me.display, me.facing, "front");
        rainOver(rl, me.display, me.facing, sAge, this.strikeSeed, true);
      },
    });
    items.sort((p, q) => p.y - q.y);
    for (const it of items) it.draw();
    for (const p of this.puffs) {
      const age = Math.min(1, (t - p.born) / PUFF_MS);
      const r = reduced ? 4 : 2 + age * 6;
      b.globalAlpha = 1 - age;
      b.fillStyle = "#b58a52";
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        b.fillRect(Math.round(p.x + Math.cos(a) * r) - camX, Math.round(p.y - 2 + Math.sin(a) * r * 0.5) - camY, 2, 2);
      }
      b.globalAlpha = 1;
    }
    this.art.drawOverhead(b, t, camX, camY, reduced);

    // v18.8: the ambient light, the scene's night lights, then the weather's particles and lightning
    const wallNow = Date.now();
    if (wallNow - this.lightingAt > 1000) {
      this.lighting = lightingFor(wallNow, this.weather, this.weatherFx);
      this.lightingAt = wallNow;
    }
    // clipped to the map: the off-map edge stays the colour of the page around the canvas
    b.save();
    b.beginPath();
    b.rect(-camX, -camY, this.map.width, this.map.height);
    b.clip();
    drawLighting(b, this.vw, this.vh, this.lighting);
    drawNightLights(b, this.art, camX, camY, this.vw, this.vh, this.lighting.night, t, reduced);
    drawWeather(b, this.vw, this.vh, this.cam, t, this.weather, this.map.id, reduced, this.lighting.night, this.weatherFx);
    // v18.9: a lightning strike here flashes the screen (by the viewer's weather-effects level; never under reduced motion)
    let flashAge = this.struck(t) ? t - this.strikeAt : Infinity;
    for (const id of this.world.actors.keys()) {
      const s = this.world.rain(id, t).struckAge;
      if (s !== null && s < flashAge && this.visible(id, t)) flashAge = s;
    }
    const flashK = strikeFlashK(this.weatherFx);
    if (flashK > 0 && !reduced && flashAge < 160) {
      b.globalAlpha = 0.6 * flashK * (1 - flashAge / 160);
      b.fillStyle = "#ffffff";
      b.fillRect(0, 0, this.vw, this.vh);
      b.globalAlpha = 1;
    }
    b.restore();

    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.imageSmoothingEnabled = false;
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.drawImage(this.buf, 0, 0, this.vw * this.scale, this.vh * this.scale);
    this.drawOverlays(t, camX, camY);
  }

  /** The hall's hammock, live: swaying in the wind, swinging with `lyingId` (me or a member) lying in it. */
  private drawHammock(b: CanvasRenderingContext2D, p: { x: number; y: number; x2: number }, lyingId: string | null, camX: number, camY: number, wind: number, t: number, reduced: boolean): void {
    const me = lyingId === this.opts.localId;
    const look = lyingId === null ? null : me ? this.localInfo.look : this.world.roster.get(lyingId)?.look ?? null;
    const since = lyingId === null ? null : me ? this.hammockSince : this.world.hammockSince(lyingId);
    const body = look ? lyingSprite(getCharacterFrames(look).down[0], makeCanvas) : null;
    const swing = hammockSwing(t, body !== null, wind, reduced);
    drawHammockLive(b, p.x, p.y, p.x2, camX, camY, swing, body, since === null ? 0 : t - since, t, reduced);
  }

  /** The crops on the plots (between the background and the props), their glints, a running harvester (v15.2 §15)
   *  and my urgent rings. A harvester's cut and its end are read on the server's clock. */
  private drawPlots(b: CanvasRenderingContext2D, t: number, camX: number, camY: number, reduced: boolean): void {
    const now = serverNow();
    for (const g of this.map.plots) {
      const d = this.plots.get(g.no);
      if (!d) continue;
      const { w, h } = g.rect;
      const x = g.rect.x - camX, y = g.rect.y - camY;
      if (x > this.vw || y > this.vh || x + w < 0 || y + h < 0) continue;
      const look = liveLook(d, now);
      if (look) {
        const key = lookKey(look);
        let art = this.plotArt.get(g.no);
        if (!art || art.key !== key) {
          art = { key, canvas: paintPlot(look, w, h) };
          this.plotArt.set(g.no, art);
        }
        b.drawImage(art.canvas, x, y);
        drawPlotShimmer(b, x, y, w, h, look, t, reduced);
        if (d.harvester && now < d.harvester.endsAt) drawHarvester(b, harvesterSpot(x, y, w, h, look.cut), t, reduced);
      }
      if (d.urgent) drawUrgentRing(b, x, y, w, h, t, reduced);
    }
  }

  /** v19.3: the houses on Khu nhà's lots (over the lot's ground, under props and people); a sold, unbuilt lot shows a flag. */
  private drawHouses(b: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (this.map.id !== "khu_nha" || this.houses.length === 0) return;
    for (const h of this.houses) {
      const r = LOTS[h.lot - 1];
      if (!r) continue;
      const x = r.x - camX, y = r.y - camY;
      if (x > this.vw || y > this.vh || x + r.w < 0 || y + r.h < 0) continue;
      if (h.grid) {
        const key = `${h.roof}|${h.grid}`;
        let art = this.houseArt.get(h.lot);
        if (!art || art.key !== key) {
          const canvas = makeCanvas(r.w, r.h);
          const hc = ctx2d(canvas);
          paintLotYard(hc, 1, 1, r.w - 2, r.h - 2, h.lot);
          paintHouseExterior(hc, h.grid, h.roof, Math.floor((r.w - EXT_W) / 2), 0);
          art = { key, canvas };
          this.houseArt.set(h.lot, art);
        }
        b.drawImage(art.canvas, x, y);
      } else if (h.owned) paintSoldFlag(b, x + 4, y + 3);
    }
  }

  /** The cue on each crab hole and snail bed ready for me (v15.3 §15): over the background, under props and people. */
  private drawGatherCues(b: CanvasRenderingContext2D, t: number, camX: number, camY: number, reduced: boolean): void {
    if (this.gatherReady.size === 0) return;
    for (const it of this.map.interactables) {
      if (!this.gatherReady.has(it.id)) continue;
      const x = it.rect.x - camX, y = it.rect.y - camY;
      if (x > this.vw || y > this.vh || x + it.rect.w < 0 || y + it.rect.h < 0) continue;
      if (it.kind === "crab_hole") drawHoleCue(b, x, y, t, reduced);
      else if (it.kind === "snail_bed") drawBedCue(b, x, y, t, reduced);
    }
  }

  private drawOverlays(now: number, camX: number, camY: number): void {
    const c = this.ctx, s = this.scale, font = this.opts.fontFamily;
    const dev = (x: number, y: number): [number, number] => [(x - camX) * s, (y - camY) * s];
    c.textAlign = "center";
    c.textBaseline = "middle";

    // the plots' name posts: a label over each post, under the people's tags (a cut plot's parts and a harvester's
    // seconds are counted every frame)
    c.font = `${Math.round(4 * s)}px ${font}`;
    const farmNow = serverNow();
    for (const g of this.map.plots) {
      const d = this.plots.get(g.no);
      if (!d) continue;
      const [x, y] = dev(g.post.x, g.post.y - 22);
      const label = postLabel(d, farmNow);
      const w = Math.round(c.measureText(label).width + 3 * s), h = Math.round(4.8 * s);
      if (x + w / 2 < 0 || x - w / 2 > this.canvas.width || y + h < 0 || y - h > this.canvas.height) continue;
      c.fillStyle = "rgba(110, 68, 36, 0.88)";
      c.fillRect(Math.round(x - w / 2), Math.round(y - h / 2), w, h);
      c.fillStyle = "#fbf3dc";
      c.fillText(label, x, y + s * 0.3);
    }

    // the card tables' labels: the lobby's line over each table (v16 spec §5)
    for (const it of this.map.interactables) {
      const text = it.kind === "card_table" && it.game ? this.cardTables[it.game] : undefined;
      if (!text) continue;
      const [x, y] = dev(it.rect.x + it.rect.w / 2, it.rect.y - 4);
      const w = Math.round(c.measureText(text).width + 3 * s), h = Math.round(4.8 * s);
      if (x + w / 2 < 0 || x - w / 2 > this.canvas.width || y + h < 0 || y - h > this.canvas.height) continue;
      c.fillStyle = "rgba(31, 90, 58, 0.9)";
      c.fillRect(Math.round(x - w / 2), Math.round(y - h / 2), w, h);
      c.fillStyle = "#fbf3dc";
      c.fillText(text, x, y + s * 0.3);
    }

    // v20.3: each Bãi đất trống ring's label above its roof (a bystander sees the round and the score)
    if (this.map.id === "bai_dat") {
      RING_RECTS.forEach((r, i) => {
        const text = this.ringLabels[i];
        if (!text) return;
        const [x, y] = dev(r.x + r.w / 2, r.y - 22);
        const w = Math.round(c.measureText(text).width + 3 * s), h = Math.round(4.8 * s);
        if (x + w / 2 < 0 || x - w / 2 > this.canvas.width || y + h < 0 || y - h > this.canvas.height) return;
        c.fillStyle = text.startsWith("⚔️") ? "rgba(142, 42, 31, 0.92)" : "rgba(58, 36, 24, 0.88)";
        c.fillRect(Math.round(x - w / 2), Math.round(y - h / 2), w, h);
        c.fillStyle = "#fbf3dc";
        c.fillText(text, x, y + s * 0.3);
      });
    }

    // v18.11: the Báo Làng stand's label, with a red dot while something is unread
    for (const it of this.map.interactables) {
      if (it.kind !== "news_stand") continue;
      const text = it.label;
      const [x, y] = dev(it.rect.x + it.rect.w / 2, it.rect.y - 4);
      const w = Math.round(c.measureText(text).width + 3 * s), h = Math.round(4.8 * s);
      if (x + w / 2 < 0 || x - w / 2 > this.canvas.width || y + h < 0 || y - h > this.canvas.height) continue;
      c.fillStyle = "rgba(107, 36, 36, 0.9)";
      c.fillRect(Math.round(x - w / 2), Math.round(y - h / 2), w, h);
      c.fillStyle = "#fbf3dc";
      c.fillText(text, x, y + s * 0.3);
      if (this.newsUnread) {
        c.fillStyle = "#e5322d";
        c.beginPath();
        c.arc(Math.round(x + w / 2), Math.round(y - h / 2), Math.max(2, 1.6 * s), 0, Math.PI * 2);
        c.fill();
      }
    }

    // name tags under the feet — neighbours at a table would overlap, so later tags move down
    const tags: Array<{ kind: "me" | "other" | "npc"; label: string; pos: Vec }> = [
      { kind: "me", label: this.label(this.localInfo.badges, this.localInfo.name), pos: this.local.display },
    ];
    for (const e of this.world.roster.values()) {
      const pos = this.positionOf(e.id, now);
      if (pos) tags.push({ kind: "other", label: this.label(e.badges, e.name), pos });
    }
    for (const n of this.map.npcs) tags.push({ kind: "npc", label: n.name, pos: n.spot });
    tags.sort((p, q) => p.pos.y - q.pos.y);
    c.font = `${Math.round(4.4 * s)}px ${font}`;
    const tagBoxes = stackBoxes(tags.map((tg): Box => {
      const [x, y] = dev(tg.pos.x, tg.pos.y + 3);
      const w = Math.round(c.measureText(tg.label).width + 3 * s);
      return { x: Math.round(x - w / 2), y: Math.round(y), w, h: Math.round(5.2 * s) };
    }), 1, 1);
    tags.forEach((tg, i) => {
      const bx = tagBoxes[i];
      c.fillStyle = tg.kind === "me" ? "rgba(139, 90, 43, 0.92)" : tg.kind === "npc" ? "rgba(47, 110, 143, 0.88)" : "rgba(58, 36, 24, 0.78)";
      c.fillRect(bx.x, bx.y, bx.w, bx.h);
      c.fillStyle = "#fbf3dc";
      c.fillText(tg.label, bx.x + bx.w / 2, bx.y + bx.h / 2 + s * 0.3);
    });

    // fishing: ❗ over an angler at the bite, a catch label over whoever just landed a fish
    const marks: Array<{ pos: Vec; bite: boolean; landed: { speciesId: string; weightG: number } | null }> = [];
    if (this.fishing.phase === "bite" || this.landed) {
      marks.push({ pos: this.local.display, bite: this.fishing.phase === "bite", landed: this.landed });
    }
    for (const id of this.world.actors.keys()) {
      const f = this.world.fishing(id, now);
      if (f.phase !== 2 && !f.landed) continue;
      const pos = this.positionOf(id, now);
      if (pos) marks.push({ pos, bite: f.phase === 2, landed: f.landed });
    }
    for (const m of marks) {
      if (m.bite) {
        c.font = `${Math.round(10 * s)}px ${font}`;
        c.fillStyle = "#fbf3dc";
        const [x, y] = dev(m.pos.x, m.pos.y - 56);
        c.fillText("❗", x, y);
      }
      if (m.landed) {
        const info = this.species.get(m.landed.speciesId);
        const text = `🐟 ${info ? `${info.name} ` : ""}${formatWeight(m.landed.weightG)}`;
        c.font = `${Math.round(5 * s)}px ${font}`;
        const w = Math.round(c.measureText(text).width + 4 * s), h = Math.round(6.4 * s);
        const [x, y] = dev(m.pos.x, m.pos.y - 62);
        c.fillStyle = "rgba(58, 36, 24, 0.85)";
        c.fillRect(Math.round(x - w / 2), Math.round(y - h / 2), w, h);
        c.fillStyle = info ? RARITY_COLOR[info.rarity] : "#fbf3dc";
        c.fillText(text, x, y + s * 0.3);
      }
    }

    // v18.10: a cramping swimmer's countdown over their head (everyone sees it)
    const cramps: Array<{ pos: Vec; left: number }> = [];
    if (this.swimming && this.cramping(now)) cramps.push({ pos: this.local.display, left: this.crampUntil - now });
    for (const id of this.world.actors.keys()) {
      const left = this.world.heat(id, now).crampLeft;
      const pos = left !== null ? this.positionOf(id, now) : null;
      if (pos && left !== null) cramps.push({ pos, left });
    }
    for (const m of cramps) {
      const text = `🆘 ${Math.ceil(m.left / 1000)}`;
      c.font = `${Math.round(6 * s)}px ${font}`;
      const w = Math.round(c.measureText(text).width + 4 * s), h = Math.round(7.4 * s);
      const [x, y] = dev(m.pos.x, m.pos.y - 36);
      c.fillStyle = "rgba(160, 30, 30, 0.9)";
      c.fillRect(Math.round(x - w / 2), Math.round(y - h / 2), w, h);
      c.fillStyle = "#fbf3dc";
      c.fillText(text, x, y + s * 0.3);
    }

    // v18.9: 🤧 over everyone with cảm lạnh (bobbing), ⚡ over a lightning strike
    const colds: Array<{ pos: Vec; icon: string }> = [];
    const rainIcons = (pos: Vec, r: { wet: boolean; cold: boolean }, struck: boolean) => {
      if (r.cold) colds.push({ pos, icon: "🤧" });
      else if (r.wet) colds.push({ pos, icon: "💦" });
      if (struck) colds.push({ pos, icon: "⚡" });
    };
    rainIcons(this.local.display, this.rainLook, this.struck(now));
    for (const id of this.world.actors.keys()) {
      const r = this.world.rain(id, now);
      const struck = r.struckAge !== null && r.struckAge < STRIKE_MS;
      const pos = r.cold || r.wet || struck ? this.positionOf(id, now) : null;
      if (pos) rainIcons(pos, r, struck);
    }
    c.font = `${Math.round(5 * s)}px ${font}`;
    for (const m of colds) {
      const bob = this.opts.reducedMotion ? 0 : Math.sin(now / 300) * 0.8;
      const [x, y] = dev(m.pos.x + (m.icon === "⚡" ? -10 : 10), m.pos.y - 40 + bob);
      c.fillText(m.icon, x, y);
    }

    // chat bubbles above heads — kept on screen; people side by side get stacked bubbles
    c.font = `${Math.round(4.8 * s)}px ${font}`;
    const lineH = 5.4 * s, pad = 2 * s;
    const speakers: Array<{ x: number; lines: string[] }> = [];
    const bubbleBoxes: Box[] = [];
    const sorted = [...this.bubbles].map(([id, bub]) => ({ pos: this.positionOf(id, now), lines: bub.lines }))
      .filter((q): q is { pos: Vec; lines: string[] } => q.pos !== null)
      .sort((p, q) => q.pos.y - p.pos.y);
    for (const { pos, lines } of sorted) {
      const [x, yTop] = dev(pos.x, pos.y - 50);
      const w = Math.round(Math.max(...lines.map((l) => c.measureText(l).width)) + pad * 2);
      const h = Math.round(lines.length * lineH + pad * 1.4);
      const bx = Math.round(Math.min(Math.max(2, x - w / 2), this.canvas.width - w - 2));
      speakers.push({ x, lines });
      bubbleBoxes.push({ x: bx, y: Math.round(Math.max(2, yTop - h)), w, h });
    }
    stackBoxes(bubbleBoxes, -1, 2, 2).forEach((bx, i) => {
      const { x, lines } = speakers[i];
      const tailX = Math.round(Math.min(Math.max(bx.x + s, x - s), bx.x + bx.w - 3 * s));
      c.fillStyle = "#fbf3dc";
      c.strokeStyle = "#8b5a2b";
      c.lineWidth = Math.max(1, Math.round(s * 0.7));
      c.fillRect(bx.x, bx.y, bx.w, bx.h);
      c.strokeRect(bx.x, bx.y, bx.w, bx.h);
      c.fillRect(tailX, bx.y + bx.h - 1, Math.round(2 * s), Math.round(2 * s));
      c.fillStyle = "#4a2e17";
      lines.forEach((l, j) => c.fillText(l, bx.x + bx.w / 2, bx.y + pad * 0.7 + lineH * (j + 0.5)));
    });

    // floating reactions (id null or not on this map = the whole room: rise from the top middle)
    c.font = `${Math.round(9 * s)}px ${font}`;
    for (const r of this.reactions) {
      const age = (now - r.born) / REACTION_MS;
      const pos = r.id ? this.positionOf(r.id, now) : null;
      const wx = pos ? pos.x + r.dx : this.cam.x + this.vw / 2 + r.dx;
      const wy = (pos ? pos.y - 56 : this.cam.y + 40) - age * 22;
      const [x, y] = dev(wx, wy);
      c.globalAlpha = Math.max(0, 1 - age);
      c.fillText(r.emoji, x, y);
      c.globalAlpha = 1;
    }
  }

  private label(badges: string, name: string): string {
    return badges ? `${badges} ${name}` : name;
  }
}
