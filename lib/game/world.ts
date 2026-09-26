import { applyPathMsg, applyStateMsg, createActor, tickActor, type Actor } from "@/lib/game/actor";
import type { GameMap, Spot } from "@/lib/game/maps/types";
import { codeToFacing, type FarmAnim, type FishPhase, type GameMessage } from "@/lib/game/net/protocol";
import type { Look } from "@/lib/game/types";
import type { PresenceDog } from "@/lib/presence-modes";

/** One other online member. `spot` = fixed place for classic-mode members; null = walking (game mode). `dog` (v17):
 *  the dog walking with them; seated members show none. */
export interface RosterEntry { id: string; name: string; badges: string; look: Look; spot: Spot | null; dog?: PresenceDog | null }

/** What the others see of a member's fishing (v14 spec §9.3). */
export interface RemoteFishing {
  phase: FishPhase;
  /** Species id of the fish in their hand. */
  hand: string | null;
  /** A fish they just landed (shown as a label for CATCH_LABEL_MS). */
  landed: { speciesId: string; weightG: number } | null;
}

/** An angler silent for this long is drawn idle again (covers a lost `fs`). */
export const FISHING_STALE_MS = 90_000;
/** How long a catch label stays over a member's head. */
export const CATCH_LABEL_MS = 3000;
/** How long a farm animation (`fa`) plays (v15 spec §12). */
export const FARM_ANIM_MS = 2500;

interface FishingNote { phase: FishPhase; hand: string | null; at: number; landed: { speciesId: string; weightG: number; at: number } | null }
const IDLE: RemoteFishing = { phase: 0, hand: null, landed: null };

type MoveMsg = Extract<GameMessage, { t: "st" | "mv" | "pa" }>;
const isMove = (m: GameMessage): m is MoveMsg => m.t === "st" || m.t === "mv" || m.t === "pa";

function applyTo(a: Actor, msg: MoveMsg, at: number): void {
  if (msg.t === "pa") applyPathMsg(a, { x: msg.x, y: msg.y, pts: msg.pts.map(([x, y]) => ({ x, y })) }, at);
  else applyStateMsg(a, { x: msg.x, y: msg.y, facing: codeToFacing(msg.d), moving: msg.mv, vx: msg.vx, vy: msg.vy }, at);
}

/**
 * Everyone else in the world, as the local player sees them: the roster (walking and seated members), one actor
 * per walking member, the last movement message of each member and who is still unseen. Pure; the engine draws it.
 */
export class RemoteWorld {
  private readonly map: GameMap;
  private readonly localId: string;
  private rosterById = new Map<string, RosterEntry>();
  private readonly actorById = new Map<string, Actor>();
  /** Last st/mv/pa per member with its arrival time, so a member who gets an actor later starts at the right place. */
  private readonly last = new Map<string, { msg: MoveMsg; at: number }>();
  /** Walking members we have no state for yet → since when (ms). */
  private readonly unseen = new Map<string, number>();
  /** Fishing phase, hand fish and last catch per member, with the time of their last message. */
  private readonly fishingById = new Map<string, FishingNote>();
  /** The last farm animation per member and when it started. */
  private readonly farmById = new Map<string, { a: FarmAnim; at: number }>();
  private walking = 0;

  constructor(map: GameMap, localId: string) {
    this.map = map;
    this.localId = localId;
  }

  /** Everyone online except me, by account id. */
  get roster(): ReadonlyMap<string, RosterEntry> {
    return this.rosterById;
  }

  /** One actor per walking roster member, by account id. */
  get actors(): ReadonlyMap<string, Actor> {
    return this.actorById;
  }

  /** How many roster members are walking (game mode). */
  walkers(): number {
    return this.walking;
  }

  /** Everyone online except me. Members who left or are now seated lose their actor; new walkers get one. */
  setRoster(entries: RosterEntry[], now: number): void {
    const next = new Map<string, RosterEntry>();
    for (const e of entries) if (e.id !== this.localId) next.set(e.id, e);
    for (const id of [...this.actorById.keys()]) {
      const e = next.get(id);
      if (!e || e.spot) {
        this.actorById.delete(id);
        this.unseen.delete(id);
      }
    }
    this.rosterById = next;
    this.walking = 0;
    for (const e of next.values()) {
      if (e.spot) continue;
      this.walking++;
      if (this.actorById.has(e.id)) continue;
      const a = this.addActor(e.id, now);
      const last = this.last.get(e.id);
      if (last) this.restore(a, last, now);
      else this.unseen.set(e.id, now);
    }
  }

  /** Someone (re)entered the world: a walking member without an actor (e.g. after their `bye`) gets one at the
   *  spawn, hidden until their state arrives. An existing actor is left alone. */
  hello(id: string, now: number): void {
    if (!this.needsActor(id)) return;
    this.addActor(id, now);
    this.unseen.set(id, now);
  }

  /** st / mv / pa / fs / fa from the network; other message types are ignored. */
  applyMessage(msg: GameMessage, now: number): void {
    if (msg.id === this.localId) return;
    if (msg.t === "fa") {
      if (msg.a === 0) this.farmById.delete(msg.id);
      else this.farmById.set(msg.id, { a: msg.a, at: now });
      return;
    }
    if (msg.t === "fs") {
      this.fishingById.set(msg.id, {
        phase: msg.f, hand: msg.h, at: now,
        landed: msg.c ? { speciesId: msg.c[0], weightG: msg.c[1], at: now } : this.fishingById.get(msg.id)?.landed ?? null,
      });
      return;
    }
    if (!isMove(msg)) return;
    this.noteMove(msg, now);
    const last = { msg, at: now };
    this.last.set(msg.id, last);
    this.unseen.delete(msg.id);
    const a = this.actorById.get(msg.id);
    if (a) applyTo(a, msg, now);
    else if (this.needsActor(msg.id)) this.restore(this.addActor(msg.id, now), last, now);
  }

  /** The member left the world (`bye`). */
  remove(id: string): void {
    this.actorById.delete(id);
    this.last.delete(id);
    this.unseen.delete(id);
    this.fishingById.delete(id);
    this.farmById.delete(id);
  }

  /** A member's farm animation as of `now` (0 = none): each `fa` plays for FARM_ANIM_MS. */
  farmAnim(id: string, now: number): FarmAnim {
    const n = this.farmById.get(id);
    return n && now - n.at < FARM_ANIM_MS ? n.a : 0;
  }

  /** A member's fishing as of `now`: a phase older than FISHING_STALE_MS reads as idle, a catch label lasts CATCH_LABEL_MS. */
  fishing(id: string, now: number): RemoteFishing {
    const n = this.fishingById.get(id);
    if (!n) return IDLE;
    return {
      phase: now - n.at > FISHING_STALE_MS ? 0 : n.phase,
      hand: n.hand,
      landed: n.landed && now - n.landed.at < CATCH_LABEL_MS ? { speciesId: n.landed.speciesId, weightG: n.landed.weightG } : null,
    };
  }

  /** A walking member is shown once we know where they are, or once `graceMs` has passed without a state. */
  visible(id: string, now: number, graceMs: number): boolean {
    const since = this.unseen.get(id);
    return since === undefined || now - since >= graceMs;
  }

  tick(dtSec: number, now: number): void {
    for (const a of this.actorById.values()) tickActor(this.map, a, dtSec, now, true);
  }

  /** A movement message refreshes the fishing clock and may carry the hand fish (`h`) and, on `st`, the phase (`f`). */
  private noteMove(msg: MoveMsg, now: number): void {
    const prev = this.fishingById.get(msg.id);
    if (!prev && msg.h === undefined && (msg.t !== "st" || msg.f === undefined)) return;
    this.fishingById.set(msg.id, {
      phase: msg.t === "st" && msg.f !== undefined ? msg.f : prev?.phase ?? 0,
      hand: msg.h !== undefined ? msg.h : prev?.hand ?? null,
      at: now,
      landed: prev?.landed ?? null,
    });
  }

  private needsActor(id: string): boolean {
    return this.rosterById.get(id)?.spot === null && !this.actorById.has(id);
  }

  private addActor(id: string, now: number): Actor {
    const a = createActor(id, { x: this.map.spawn.x, y: this.map.spawn.y }, "left", now);
    this.actorById.set(id, a);
    return a;
  }

  /** Place an actor from a remembered message without replaying old motion as new: apply it at its arrival time,
   *  simulate the time since once (an old path is walked to its end, an old keyboard walk stops) and show it there. */
  private restore(a: Actor, last: { msg: MoveMsg; at: number }, now: number): void {
    applyTo(a, last.msg, last.at);
    tickActor(this.map, a, Math.max(0, now - last.at) / 1000, now, true);
    a.display = { ...a.pos };
  }
}
