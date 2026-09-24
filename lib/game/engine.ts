import { applyPathMsg, applyStateMsg, createActor, setKeyboard, setPath, tickActor, walkFrame, type Actor } from "@/lib/game/actor";
import { getCharacterFrames } from "@/lib/game/art/raster";
import type { HallArt } from "@/lib/game/maps/hall-art";
import type { GameMap, InteractId, Spot } from "@/lib/game/maps/types";
import { inputDir, type KeyState } from "@/lib/game/movement";
import { codeToFacing, facingToCode, MAX_PATH_POINTS, type FacingCode, type GameMessage, type Unit } from "@/lib/game/net/protocol";
import { findPath, smoothPath } from "@/lib/game/pathfinding";
import { cameraFor, computeView, hitsCharacter, interactableAt, nearestInteractable, PROMPT_RANGE, stackBoxes, type Box } from "@/lib/game/scene";
import { wrapBubble } from "@/lib/game/text";
import type { Facing, Look, Vec } from "@/lib/game/types";

export interface LocalMoveMsg { x: number; y: number; d: FacingCode; mv: boolean; vx: Unit; vy: Unit }

export interface EngineCallbacks {
  /** Keyboard movement started, stopped or turned (plus a keep-alive every 3 s while walking). */
  onLocalMove: (m: LocalMoveMsg) => void;
  /** A click/tap path started. */
  onLocalPath: (m: { x: number; y: number; pts: Array<[number, number]> }) => void;
  onInteract: (id: InteractId) => void;
  onPromptChange: (id: InteractId | null) => void;
  onActorClick: (accountId: string) => void;
}

/** One other online member. `spot` = fixed place for classic-mode members; null = walking (game mode). */
export interface RosterEntry { id: string; name: string; badges: string; look: Look; spot: Spot | null }

export interface EngineOptions {
  localId: string;
  name: string;
  badges: string;
  look: Look;
  /** CSS font-family for canvas text (the VT323 family from next/font). */
  fontFamily: string;
  reducedMotion: boolean;
}

const KEYMAP: Record<string, keyof KeyState> = {
  ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down",
  ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right",
};
const KEEPALIVE_MS = 3000;
const BUBBLE_MS = 6000;
const REACTION_MS = 1600;
/** A walking member is hidden until their first state arrives (answers to `hello` take up to 1.5 s). */
const UNSEEN_GRACE_MS = 2000;
const NO_KEYS: KeyState = { up: false, down: false, left: false, right: false };

/** Canvas 2D game loop: input, local + remote actors, camera, depth-sorted rendering, overlays. Browser only. */
export class GameEngine {
  private readonly canvas: HTMLCanvasElement;
  private readonly map: GameMap;
  private readonly art: HallArt;
  private readonly cb: EngineCallbacks;
  private readonly opts: EngineOptions;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly buf: HTMLCanvasElement;
  private readonly bctx: CanvasRenderingContext2D;
  private readonly ro: ResizeObserver;
  private readonly local: Actor;
  private readonly remotes = new Map<string, Actor>();
  /** Last st/mv/pa per member, so members added to the roster later start at the right place. */
  private readonly lastState = new Map<string, GameMessage>();
  /** Walking members we have no state for yet → first seen at (ms). */
  private readonly unseen = new Map<string, number>();
  private readonly bubbles = new Map<string, { lines: string[]; until: number }>();
  private roster = new Map<string, RosterEntry>();
  private reactions: Array<{ id: string | null; emoji: string; born: number; dx: number }> = [];
  private localInfo: { name: string; badges: string; look: Look };
  private keys: KeyState = { ...NO_KEYS };
  private scale = 3;
  private vw = 320;
  private vh = 180;
  private dpr = 1;
  private cam: Vec = { x: 0, y: 0 };
  private inputEnabled = true;
  private pendingInteract: InteractId | null = null;
  private prompt: InteractId | null = null;
  private lastSent = { mv: false, vx: 0, vy: 0, at: 0 };
  private raf = 0;
  private lastT = 0;
  private destroyed = false;

  constructor(canvas: HTMLCanvasElement, map: GameMap, art: HallArt, cb: EngineCallbacks, opts: EngineOptions) {
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
    this.local = createActor(opts.localId, { ...map.spawn }, "left", performance.now());
    this.localInfo = { name: opts.name, badges: opts.badges, look: opts.look };
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
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
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
  }

  // ------------------------------------------------------------ data in

  setLocal(info: { name: string; badges: string; look: Look }): void {
    this.localInfo = info;
  }

  /** Everyone online except me. Walking members get an actor (placed with their last known state). */
  setRoster(entries: RosterEntry[]): void {
    const now = performance.now();
    const next = new Map<string, RosterEntry>();
    for (const e of entries) if (e.id !== this.opts.localId) next.set(e.id, e);
    for (const id of [...this.remotes.keys()]) {
      const e = next.get(id);
      if (!e || e.spot) {
        this.remotes.delete(id);
        this.unseen.delete(id);
      }
    }
    for (const e of next.values()) {
      if (e.spot || this.remotes.has(e.id)) continue;
      const a = createActor(e.id, { ...this.map.spawn }, "left", now);
      this.remotes.set(e.id, a);
      const last = this.lastState.get(e.id);
      if (last) this.applyTo(a, last, now);
      else this.unseen.set(e.id, now);
    }
    this.roster = next;
  }

  /** st / mv / pa from the network (other message types are handled by the caller). */
  applyMessage(msg: GameMessage): void {
    if (msg.id === this.opts.localId) return;
    if (msg.t !== "st" && msg.t !== "mv" && msg.t !== "pa") return;
    this.lastState.set(msg.id, msg);
    this.unseen.delete(msg.id);
    const a = this.remotes.get(msg.id);
    if (a) this.applyTo(a, msg, performance.now());
  }

  removeActor(id: string): void {
    this.remotes.delete(id);
    this.lastState.delete(id);
    this.unseen.delete(id);
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
    if (!enabled) this.keys = { ...NO_KEYS };
  }

  /** Trigger the interactable in range (E key / HUD button). */
  interact(): void {
    if (this.prompt) this.cb.onInteract(this.prompt);
  }

  /** My current state as a message — the answer to someone's `hello`. */
  snapshot(): GameMessage {
    const id = this.opts.localId;
    if (this.local.path && this.local.path.length > 0) {
      return {
        t: "pa", id, x: Math.round(this.local.pos.x), y: Math.round(this.local.pos.y),
        pts: this.local.path.slice(0, MAX_PATH_POINTS).map((p) => [Math.round(p.x), Math.round(p.y)] as [number, number]),
      };
    }
    return { t: "st", id, ...this.localMove() };
  }

  // ------------------------------------------------------------ internals

  private applyTo(a: Actor, msg: GameMessage, now: number): void {
    if (msg.t === "st" || msg.t === "mv") {
      applyStateMsg(a, { x: msg.x, y: msg.y, facing: codeToFacing(msg.d), moving: msg.mv, vx: msg.vx, vy: msg.vy }, now);
    } else if (msg.t === "pa") {
      applyPathMsg(a, { x: msg.x, y: msg.y, pts: msg.pts.map(([x, y]) => ({ x, y })) }, now);
    }
  }

  private localMove(): LocalMoveMsg {
    return {
      x: Math.round(this.local.pos.x),
      y: Math.round(this.local.pos.y),
      d: facingToCode(this.local.facing),
      mv: this.local.moving && !this.local.path,
      vx: (Math.sign(this.local.dir.x) || 0) as Unit,
      vy: (Math.sign(this.local.dir.y) || 0) as Unit,
    };
  }

  /** A walking member is drawn once we know where they are (or after the grace period). */
  private visible(id: string, now: number): boolean {
    const since = this.unseen.get(id);
    return since === undefined || now - since >= UNSEEN_GRACE_MS;
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
    const k = KEYMAP[e.code];
    if (k) {
      this.keys[k] = true;
      e.preventDefault();
      return;
    }
    if ((e.code === "KeyE" || e.code === "Enter") && this.prompt) {
      e.preventDefault();
      this.cb.onInteract(this.prompt);
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    const k = KEYMAP[e.code];
    if (k) this.keys[k] = false;
  };

  private readonly onBlur = (): void => {
    this.keys = { ...NO_KEYS };
  };

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (!this.inputEnabled || e.button !== 0) return;
    const r = this.canvas.getBoundingClientRect();
    const w: Vec = {
      x: ((e.clientX - r.left) * this.dpr) / this.scale + this.cam.x,
      y: ((e.clientY - r.top) * this.dpr) / this.scale + this.cam.y,
    };
    // Interactables win over people: the DJ stands right behind the booth.
    const it = interactableAt(this.map, w);
    if (it) {
      if (Math.hypot(this.local.pos.x - it.use.x, this.local.pos.y - it.use.y) <= PROMPT_RANGE) {
        this.cb.onInteract(it.id);
        return;
      }
      this.pendingInteract = it.id;
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
    for (const e of this.roster.values()) {
      const feet = e.spot ?? (this.visible(e.id, now) ? this.remotes.get(e.id)?.display : undefined);
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
    });
  }

  private positionOf(id: string, now: number): Vec | null {
    if (id === this.opts.localId) return this.local.display;
    const e = this.roster.get(id);
    if (!e) return null;
    if (e.spot) return e.spot;
    return this.visible(id, now) ? this.remotes.get(id)?.display ?? null : null;
  }

  private readonly frame = (t: number): void => {
    if (this.destroyed) return;
    const dt = Math.min(0.05, Math.max(0, (t - this.lastT) / 1000));
    this.lastT = t;
    this.update(dt, t);
    this.render(t);
    this.raf = requestAnimationFrame(this.frame);
  };

  private update(dt: number, now: number): void {
    const dir = this.inputEnabled ? inputDir(this.keys) : { x: 0, y: 0 };
    if (dir.x !== 0 || dir.y !== 0) {
      this.pendingInteract = null;
      setKeyboard(this.local, dir);
    } else if (!this.local.path && this.local.moving) {
      setKeyboard(this.local, dir);
    }
    const arrived = tickActor(this.map, this.local, dt, now, false);
    if (arrived && this.pendingInteract) {
      const id = this.pendingInteract;
      this.pendingInteract = null;
      // a long walk can end early (smoothPath caps the waypoints) — only trigger when we really got there
      const it = this.map.interactables.find((i) => i.id === id);
      if (it && Math.hypot(this.local.pos.x - it.use.x, this.local.pos.y - it.use.y) <= PROMPT_RANGE) this.cb.onInteract(id);
    }
    if (!this.local.path) {
      const m = this.localMove();
      const changed = m.mv !== this.lastSent.mv || m.vx !== this.lastSent.vx || m.vy !== this.lastSent.vy;
      if (changed || (m.mv && now - this.lastSent.at > KEEPALIVE_MS)) {
        this.cb.onLocalMove(m);
        this.lastSent = { mv: m.mv, vx: m.vx, vy: m.vy, at: now };
      }
    }
    const near = nearestInteractable(this.map, this.local.pos);
    if (near !== this.prompt) {
      this.prompt = near;
      this.cb.onPromptChange(near);
    }
    for (const a of this.remotes.values()) tickActor(this.map, a, dt, now, true);
    this.cam = cameraFor(this.local.display, this.vw, this.vh, this.map.width, this.map.height);
    for (const [id, b] of this.bubbles) if (b.until < now) this.bubbles.delete(id);
    this.reactions = this.reactions.filter((r) => now - r.born < REACTION_MS);
  }

  private render(t: number): void {
    const b = this.bctx;
    const camX = Math.round(this.cam.x), camY = Math.round(this.cam.y);
    b.imageSmoothingEnabled = false;
    b.fillStyle = "#2f6e8f";
    b.fillRect(0, 0, this.vw, this.vh);
    b.drawImage(this.art.background, -camX, -camY);
    this.art.drawAnimated(b, t, camX, camY, this.opts.reducedMotion);

    const items: Array<{ y: number; draw: () => void }> = [];
    for (const p of this.art.props) {
      const x = p.x - camX, y = p.y - camY;
      if (x > this.vw || y > this.vh || x + p.canvas.width < 0 || y + p.canvas.height < 0) continue;
      items.push({ y: p.sortY, draw: () => b.drawImage(p.canvas, x, y) });
    }
    const drawActor = (look: Look, pos: Vec, facing: Facing, frame: 0 | 1 | 2 | 3) => {
      const x = Math.round(pos.x) - camX, y = Math.round(pos.y) - camY;
      if (x < -16 || x > this.vw + 16 || y < -4 || y > this.vh + 50) return;
      b.fillStyle = "rgba(40, 25, 10, 0.28)";
      b.fillRect(x - 7, y - 1, 14, 2);
      b.fillRect(x - 5, y + 1, 10, 1);
      b.drawImage(getCharacterFrames(look)[facing][frame], x - 12, y - 46);
    };
    for (const e of this.roster.values()) {
      const spot = e.spot;
      if (spot) {
        items.push({ y: spot.y, draw: () => drawActor(e.look, spot, spot.dir, 0) });
        continue;
      }
      const a = this.remotes.get(e.id);
      if (a && this.visible(e.id, t)) items.push({ y: a.display.y, draw: () => drawActor(e.look, a.display, a.facing, walkFrame(a)) });
    }
    const me = this.local;
    items.push({ y: me.display.y, draw: () => drawActor(this.localInfo.look, me.display, me.facing, walkFrame(me)) });
    items.sort((p, q) => p.y - q.y);
    for (const it of items) it.draw();
    this.art.drawOverhead(b, t, camX, camY, this.opts.reducedMotion);

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
    const tags: Array<{ mine: boolean; label: string; pos: Vec }> = [
      { mine: true, label: this.label(this.localInfo.badges, this.localInfo.name), pos: this.local.display },
    ];
    for (const e of this.roster.values()) {
      const pos = this.positionOf(e.id, now);
      if (pos) tags.push({ mine: false, label: this.label(e.badges, e.name), pos });
    }
    tags.sort((p, q) => p.pos.y - q.pos.y);
    c.font = `${Math.round(4.4 * s)}px ${font}`;
    const tagBoxes = stackBoxes(tags.map((tg): Box => {
      const [x, y] = dev(tg.pos.x, tg.pos.y + 3);
      const w = Math.round(c.measureText(tg.label).width + 3 * s);
      return { x: Math.round(x - w / 2), y: Math.round(y), w, h: Math.round(5.2 * s) };
    }), 1, 1);
    tags.forEach((tg, i) => {
      const bx = tagBoxes[i];
      c.fillStyle = tg.mine ? "rgba(139, 90, 43, 0.92)" : "rgba(58, 36, 24, 0.78)";
      c.fillRect(bx.x, bx.y, bx.w, bx.h);
      c.fillStyle = "#fbf3dc";
      c.fillText(tg.label, bx.x + bx.w / 2, bx.y + bx.h / 2 + s * 0.3);
    });

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

    // floating reactions (id null = the whole room: rise from the top middle)
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
