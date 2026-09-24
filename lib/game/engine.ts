import { createActor, setKeyboard, setPath, tickActor, walkFrame, type Actor } from "@/lib/game/actor";
import { drawHeldFish, drawRod } from "@/lib/game/art/fishing";
import { getCharacterFrames } from "@/lib/game/art/raster";
import { phaseCode, type LocalPhase } from "@/lib/game/fishing/cast";
import { formatWeight, RARITY_COLOR, type Rarity } from "@/lib/game/fishing/catalog";
import { SWING_MS } from "@/lib/game/fishing/geometry";
import type { SceneArt } from "@/lib/game/maps/scene-art";
import type { GameMap, Interactable, Spot } from "@/lib/game/maps/types";
import { inputDir, type KeyState } from "@/lib/game/movement";
import { facingToCode, MAX_PATH_POINTS, type FacingCode, type GameMessage, type Unit } from "@/lib/game/net/protocol";
import { unseenGraceMs } from "@/lib/game/net/replies";
import { findPath, smoothPath } from "@/lib/game/pathfinding";
import { cameraFor, computeView, hitsCharacter, interactableAt, inUseRange, nearestInteractable, stackBoxes, type Box } from "@/lib/game/scene";
import { wrapBubble } from "@/lib/game/text";
import type { Facing, Look, Vec } from "@/lib/game/types";
import { CATCH_LABEL_MS, RemoteWorld, type RosterEntry } from "@/lib/game/world";

export type { RosterEntry } from "@/lib/game/world";

export interface LocalMoveMsg { x: number; y: number; d: FacingCode; mv: boolean; vx: Unit; vy: Unit; h: string | null }

export interface EngineCallbacks {
  /** Keyboard movement started, stopped or turned (plus a keep-alive every 3 s while walking). */
  onLocalMove: (m: LocalMoveMsg) => void;
  /** A click/tap path started. */
  onLocalPath: (m: { x: number; y: number; pts: Array<[number, number]>; h: string | null }) => void;
  onInteract: (it: Interactable) => void;
  onPromptChange: (it: Interactable | null) => void;
  onActorClick: (accountId: string) => void;
  /** While the rod is out: a click/tap on the canvas or Space ("tap"), or Esc ("cancel"). */
  onFishingInput?: (kind: "tap" | "cancel") => void;
  /** The first frame has been drawn (the shell fades in). */
  onFirstFrame?: () => void;
  /** Three frames in a row threw: the loop has stopped. */
  onFatal?: (err: unknown) => void;
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
  private localInfo: { name: string; badges: string; look: Look };
  private keys: KeyState = { ...NO_KEYS };
  private scale = 3;
  private vw = 320;
  private vh = 180;
  private dpr = 1;
  private cam: Vec = { x: 0, y: 0 };
  /** Height of the bottom HUD in CSS px (the camera may scroll that far past the map's bottom). */
  private insetCss = 0;
  private inputEnabled = true;
  private pendingInteract: Interactable | null = null;
  private prompt: Interactable | null = null;
  private lastSent = { mv: false, vx: 0, vy: 0, at: 0 };
  private fishing: Required<LocalFishing> = { phase: "idle", tint: null, glow: false };
  private castAt = 0;
  private hand: string | null = null;
  private landed: { speciesId: string; weightG: number; until: number } | null = null;
  private puffs: Array<{ x: number; y: number; born: number }> = [];
  private species = new Map<string, SpeciesInfo>();
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
    this.localInfo = { name: opts.name, badges: opts.badges, look: opts.look };
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

  setLocal(info: { name: string; badges: string; look: Look }): void {
    this.localInfo = info;
  }

  /** Everyone online on this map except me. Walking members get an actor (placed with their last known state). */
  setRoster(entries: RosterEntry[]): void {
    this.world.setRoster(entries, performance.now());
  }

  /** Someone's `hello`: a walking member we had dropped (their `bye`) gets an actor again. */
  noteHello(id: string): void {
    this.world.hello(id, performance.now());
  }

  /** st / mv / pa / fs from the network (other message types are handled by the caller). */
  applyMessage(msg: GameMessage): void {
    this.world.applyMessage(msg, performance.now());
  }

  /** Someone's `bye`. */
  removeActor(id: string): void {
    this.world.remove(id);
  }

  /** How many other members walk on this map (sizes the answer window for `hello`s). */
  walkers(): number {
    return this.world.walkers();
  }

  showBubble(id: string, text: string): void {
    const lines = wrapBubble(text);
    if (lines.length > 0) this.bubbles.set(id, { lines, until: performance.now() + BUBBLE_MS });
  }

  showReaction(id: string | null, emoji: string): void {
    this.reactions.push({ id, emoji, born: performance.now(), dx: Math.round((Math.random() - 0.5) * 12) });
    if (this.reactions.length > 40) this.reactions.shift();
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

  /** Names and rarities for the catch labels. */
  setSpecies(list: ReadonlyArray<{ id: string; name: string; rarity: Rarity }>): void {
    this.species = new Map(list.map((s) => [s.id, { name: s.name, rarity: s.rarity }]));
  }

  /** Trigger the interactable in range (E key / HUD button). Nothing happens while the rod is out. */
  interact(): void {
    if (this.prompt && this.fishing.phase === "idle") this.trigger(this.prompt);
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
    this.cb.onInteract(it);
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
    };
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
    const v = computeView(devW, devH, this.map.width, this.map.height);
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
      this.trigger(this.prompt);
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
    if (this.rodOut) {
      this.cb.onFishingInput?.("tap");
      return;
    }
    const r = this.canvas.getBoundingClientRect();
    const w: Vec = {
      x: ((e.clientX - r.left) * this.dpr) / this.scale + this.cam.x,
      y: ((e.clientY - r.top) * this.dpr) / this.scale + this.cam.y,
    };
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
    const hit = this.actorAt(w);
    if (hit) {
      this.cb.onActorClick(hit);
      return;
    }
    this.pendingInteract = null;
    this.walkTo(w);
  };

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
    const cells = findPath(this.map, this.local.pos, target);
    if (!cells) {
      this.pendingInteract = null;
      return;
    }
    const pts = smoothPath(this.map, this.local.pos, cells);
    setPath(this.local, pts);
    this.lastSent = { mv: false, vx: 0, vy: 0, at: performance.now() };
    this.cb.onLocalPath({
      x: Math.round(this.local.pos.x),
      y: Math.round(this.local.pos.y),
      pts: pts.map((p) => [Math.round(p.x), Math.round(p.y)] as [number, number]),
      h: this.hand,
    });
  }

  private positionOf(id: string, now: number): Vec | null {
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
    const dir = this.inputEnabled && !this.rodOut ? inputDir(this.keys) : { x: 0, y: 0 };
    if (dir.x !== 0 || dir.y !== 0) {
      this.pendingInteract = null;
      setKeyboard(this.local, dir);
    } else if (!this.local.path && this.local.moving) {
      setKeyboard(this.local, dir);
    }
    const arrived = tickActor(this.map, this.local, dt, now, false);
    if (arrived && this.pendingInteract) {
      const it = this.pendingInteract;
      this.pendingInteract = null;
      // a long walk can end early (smoothPath caps the waypoints) — only trigger when we really got there
      if (inUseRange(it, this.local.pos)) this.cb.onInteract(it);
    }
    this.announceMove(now);
    const near = this.rodOut ? null : nearestInteractable(this.map, this.local.pos);
    if (near !== this.prompt) {
      this.prompt = near;
      this.cb.onPromptChange(near);
    }
    this.world.tick(dt, now);
    const inset = Math.ceil((this.insetCss * this.dpr) / this.scale);
    this.cam = cameraFor(this.local.display, this.vw, this.vh, this.map.width, this.map.height, inset);
    for (const [id, b] of this.bubbles) if (b.until < now) this.bubbles.delete(id);
    this.reactions = this.reactions.filter((r) => now - r.born < REACTION_MS);
    if (this.landed && this.landed.until < now) this.landed = null;
    if (this.puffs.length > 0) this.puffs = this.puffs.filter((p) => now - p.born < PUFF_MS);
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

    const items: Array<{ y: number; draw: () => void }> = [];
    for (const p of this.art.props) {
      const x = p.x - camX, y = p.y - camY;
      if (x > this.vw || y > this.vh || x + p.canvas.width < 0 || y + p.canvas.height < 0) continue;
      items.push({ y: p.sortY, draw: () => b.drawImage(p.canvas, x, y) });
    }
    const onScreen = (pos: Vec) => {
      const x = Math.round(pos.x) - camX, y = Math.round(pos.y) - camY;
      return x >= -16 && x <= this.vw + 16 && y >= -4 && y <= this.vh + 60;
    };
    const drawActor = (look: Look, pos: Vec, facing: Facing, frame: 0 | 1 | 2 | 3) => {
      const x = Math.round(pos.x) - camX, y = Math.round(pos.y) - camY;
      b.fillStyle = "rgba(40, 25, 10, 0.28)";
      b.fillRect(x - 7, y - 1, 14, 2);
      b.fillRect(x - 5, y + 1, 10, 1);
      b.drawImage(getCharacterFrames(look)[facing][frame], x - 12, y - 46);
    };
    /** The rod (while fishing) or the fish in hand, drawn over the character. */
    const drawGear = (pos: Vec, facing: Facing, phase: 0 | 1 | 2 | 3, hand: string | null, rod: { swing: number; tint: string | null; glow: boolean } | null) => {
      const feet = { x: Math.round(pos.x) - camX, y: Math.round(pos.y) - camY };
      if (rod) drawRod(b, feet, facing, { phase, swing: rod.swing, tint: rod.tint, glow: rod.glow, t, reducedMotion: reduced });
      else if (hand) drawHeldFish(b, feet, facing, hand);
    };
    for (const e of this.world.roster.values()) {
      const spot = e.spot;
      if (spot) {
        if (onScreen(spot)) items.push({ y: spot.y, draw: () => drawActor(e.look, spot, spot.dir, 0) });
        continue;
      }
      const a = this.world.actors.get(e.id);
      if (!a || !this.visible(e.id, t) || !onScreen(a.display)) continue;
      const f = this.world.fishing(e.id, t);
      items.push({
        y: a.display.y,
        draw: () => {
          drawActor(e.look, a.display, a.facing, walkFrame(a));
          drawGear(a.display, a.facing, f.phase, f.hand, f.phase === 0 ? null : { swing: 1, tint: null, glow: false });
        },
      });
    }
    for (const n of this.map.npcs) {
      if (onScreen(n.spot)) items.push({ y: n.spot.y, draw: () => drawActor(n.look, n.spot, n.spot.dir, 0) });
    }
    const me = this.local;
    const fishing = this.fishing;
    items.push({
      y: me.display.y,
      draw: () => {
        drawActor(this.localInfo.look, me.display, me.facing, walkFrame(me));
        const swing = Math.min(1, (t - this.castAt) / SWING_MS);
        drawGear(me.display, me.facing, phaseCode(fishing.phase), this.hand,
          fishing.phase === "idle" ? null : { swing, tint: fishing.tint, glow: fishing.glow });
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

    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.imageSmoothingEnabled = false;
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.drawImage(this.buf, 0, 0, this.vw * this.scale, this.vh * this.scale);
    this.drawOverlays(t, camX, camY);
  }

  private drawOverlays(now: number, camX: number, camY: number): void {
    const c = this.ctx, s = this.scale, font = this.opts.fontFamily;
    const dev = (x: number, y: number): [number, number] => [(x - camX) * s, (y - camY) * s];
    c.textAlign = "center";
    c.textBaseline = "middle";

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
