import { applyPathMsg, applyStateMsg, createActor, tickActor, type Actor } from "@/lib/game/actor";
import type { GameMap, Spot } from "@/lib/game/maps/types";
import { codeToFacing, type GameMessage } from "@/lib/game/net/protocol";
import type { Look } from "@/lib/game/types";

/** One other online member. `spot` = fixed place for classic-mode members; null = walking (game mode). */
export interface RosterEntry { id: string; name: string; badges: string; look: Look; spot: Spot | null }

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

  /** st / mv / pa from the network; other message types are ignored. */
  applyMessage(msg: GameMessage, now: number): void {
    if (msg.id === this.localId || !isMove(msg)) return;
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
  }

  /** A walking member is shown once we know where they are, or once `graceMs` has passed without a state. */
  visible(id: string, now: number, graceMs: number): boolean {
    const since = this.unseen.get(id);
    return since === undefined || now - since >= graceMs;
  }

  tick(dtSec: number, now: number): void {
    for (const a of this.actorById.values()) tickActor(this.map, a, dtSec, now, true);
  }

  private needsActor(id: string): boolean {
    return this.rosterById.get(id)?.spot === null && !this.actorById.has(id);
  }

  private addActor(id: string, now: number): Actor {
    const a = createActor(id, { ...this.map.spawn }, "left", now);
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
