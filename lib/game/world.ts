import { applyPathMsg, applyStateMsg, createActor, tickActor, type Actor } from "@/lib/game/actor";
import { HX } from "@/lib/game/heat/model";
import { decodeNet, netAlive, type NetState } from "@/lib/game/fishing/netcast";
import { decodeRain, RN, type RainLook } from "@/lib/game/rain/model";
import { WALK_SPEED } from "@/lib/game/movement";
import { buildSwimMap, swimSpeed, WET_MS } from "@/lib/game/swim";
import { rideSpeed } from "@/lib/game/travel/ride";
import type { VehicleId } from "@/lib/game/travel/vehicles";
import type { GameMap, Spot } from "@/lib/game/maps/types";
import { codeToFacing, type FarmAnim, type FishPhase, type GameMessage } from "@/lib/game/net/protocol";
import type { Facing, Look, Vec } from "@/lib/game/types";
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
  /** v18.2: each member's net throw and when its phase began (my clock). */
  private readonly netById = new Map<string, { s: NetState; at: number }>();
  /** The last farm animation per member and when it started. */
  private readonly farmById = new Map<string, { a: FarmAnim; at: number }>();
  /** The vehicle each member rides (v18.7), from their last movement message; absent = on foot. */
  private readonly ridingById = new Map<string, VehicleId>();
  /** v18.13: each member's lift tag (`ps` their passenger / `lf` their driver) from their last movement message. */
  private readonly liftTags = new Map<string, { ps?: string; lf?: string }>();
  /** v18.1: who swims (their actor collides on the swim grid at half speed) and who drips until when (ms). */
  private readonly swimming = new Set<string>();
  /** Members lying in the hall's hammock (`hm` on their last movement message). */
  private readonly inHammock = new Map<string, number>();
  private readonly wetUntil = new Map<string, number>();
  /** v18.10: each member's heat bits (`hx`) and, while cramping, when the countdown ends (ms, my clock). */
  private readonly heatById = new Map<string, { bits: number; crampEnd: number | null }>();
  /** v18.9: each member's rain bits (`rn`) and when I first saw their lightning strike (ms, my clock). */
  private readonly rainById = new Map<string, { bits: number; struckAt: number | null }>();
  /** The map with its open water walkable (the pond), for swimmers; null elsewhere. */
  private readonly swimMap: GameMap | null;
  private walking = 0;

  constructor(map: GameMap, localId: string) {
    this.map = map;
    this.localId = localId;
    this.swimMap = buildSwimMap(map);
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
      // v18.2: a throw's phase restarts its clock only when it changes; an `fs` without `n` ends it
      if (msg.n) {
        const prev = this.netById.get(msg.id);
        const s = decodeNet(msg.n);
        this.netById.set(msg.id, { s, at: prev && prev.s.show === s.show ? prev.at : now });
      } else this.netById.delete(msg.id);
      this.fishingById.set(msg.id, {
        phase: msg.f, hand: msg.h, at: now,
        landed: msg.c ? { speciesId: msg.c[0], weightG: msg.c[1], at: now } : this.fishingById.get(msg.id)?.landed ?? null,
      });
      return;
    }
    if (!isMove(msg)) return;
    this.noteMove(msg, now);
    if (msg.v) this.ridingById.set(msg.id, msg.v);
    else this.ridingById.delete(msg.id);
    this.noteLift(msg);
    this.noteSwim(msg, now);
    if (msg.hm === 1) { if (!this.inHammock.has(msg.id)) this.inHammock.set(msg.id, now); }
    else this.inHammock.delete(msg.id);
    // v18.10: the heat bits, and a cramp's deadline on my clock
    if (msg.hx) this.heatById.set(msg.id, { bits: msg.hx, crampEnd: msg.hx & HX.cramp ? now + (msg.cr ?? 0) : null });
    else this.heatById.delete(msg.id);
    this.noteRain(msg.id, msg.rn, now);                                    // v18.9
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
    this.netById.delete(id);
    this.farmById.delete(id);
    this.ridingById.delete(id);
    this.liftTags.delete(id);
    this.swimming.delete(id);
    this.inHammock.delete(id);
    this.wetUntil.delete(id);
    this.heatById.delete(id);
    this.rainById.delete(id);
  }

  /** v18.9: a member's rain bits; a strike starts when the struck bit first shows (it stays on for the strike). */
  private noteRain(id: string, bits: number | undefined, now: number): void {
    if (!bits) { this.rainById.delete(id); return; }
    const prev = this.rainById.get(id);
    const struck = (bits & RN.struck) !== 0;
    this.rainById.set(id, { bits, struckAt: struck ? (prev?.struckAt ?? now) : null });
  }

  /** v18.9: a member's rain look, and the ms since their lightning strike began (null: none). */
  rain(id: string, now: number): RainLook & { struckAge: number | null } {
    const r = this.rainById.get(id);
    const look = decodeRain(r?.bits);
    return { ...look, struckAge: r?.struckAt != null ? now - r.struckAt : null };
  }

  /** v18.10: a member's heat as of `now`: shocked (red face), warming up, and cramping with the ms left (a cramp whose
   *  countdown ran out reads as over — they drowned or were rescued, and their next message says which). */
  heat(id: string, now: number): { shocked: boolean; warming: boolean; crampLeft: number | null } {
    const h = this.heatById.get(id);
    if (!h) return { shocked: false, warming: false, crampLeft: null };
    const left = h.crampEnd === null ? null : h.crampEnd - now;
    return { shocked: (h.bits & HX.shocked) !== 0, warming: (h.bits & HX.warming) !== 0, crampLeft: left !== null && left > 0 ? left : null };
  }

  /** v18.1: a member's swim state as of `now`: swimming, dripping (WET_MS from the first wet message) or dry. */
  swim(id: string, now: number): "swim" | "wet" | null {
    if (this.swimming.has(id)) return "swim";
    const w = this.wetUntil.get(id);
    return w !== undefined && now < w ? "wet" : null;
  }

  /** Is the member lying in the hall's hammock? */
  hammock(id: string): boolean {
    return this.inHammock.has(id);
  }

  /** Since when (my clock) the member has lain in the hammock, or null. */
  hammockSince(id: string): number | null {
    return this.inHammock.get(id) ?? null;
  }

  /** The vehicle a member rides (v18.7), or null on foot. */
  riding(id: string): VehicleId | null {
    return this.ridingById.get(id) ?? null;
  }

  /** A member's farm animation as of `now` (0 = none): each `fa` plays for FARM_ANIM_MS. */
  farmAnim(id: string, now: number): FarmAnim {
    const n = this.farmById.get(id);
    return n && now - n.at < FARM_ANIM_MS ? n.a : 0;
  }

  /** When the farm animation playing on a member now started (null = none): a new `fa 11` pets their dog once (v17). */
  farmAnimAt(id: string, now: number): number | null {
    const n = this.farmById.get(id);
    return n && now - n.at < FARM_ANIM_MS ? n.at : null;
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

  /** v18.2: a member's net throw as of `now` and the ms since its phase began, or null (none, over or stale). */
  net(id: string, now: number): { s: NetState; since: number } | null {
    const n = this.netById.get(id);
    if (!n) return null;
    const since = now - n.at;
    return netAlive(n.s.show, since) ? { s: n.s, since } : null;
  }

  /** A walking member is shown once we know where they are, or once `graceMs` has passed without a state. */
  visible(id: string, now: number, graceMs: number): boolean {
    const since = this.unseen.get(id);
    return since === undefined || now - since >= graceMs;
  }

  tick(dtSec: number, now: number): void {
    for (const a of this.actorById.values()) tickActor(this.mapOf(a.id), a, dtSec, now, true, this.speedOf(a.id));
    // v18.13: a carried passenger sits on its driver's vehicle
    for (const a of this.actorById.values()) {
      const d = this.carrier(a.id);
      const da = d ? this.actorById.get(d) : undefined;
      if (da) this.pin(a.id, da.pos, da.display, da.facing);
    }
  }

  // ------------------------------------------------------------ v18.13 Đi nhờ xe

  /** A member's lift tag from their last movement message: `ps` (their passenger) or `lf` (their driver). */
  liftTag(id: string): { ps?: string; lf?: string } {
    return this.liftTags.get(id) ?? {};
  }

  /** The driver carrying member `id` — only while both say so (the driver's `ps` and the passenger's `lf`). */
  carrier(id: string): string | null {
    const d = this.liftTags.get(id)?.lf;
    return d && this.liftTags.get(d)?.ps === id ? d : null;
  }

  /** The passenger on member `id`'s vehicle — only while both say so. */
  passengerOf(id: string): string | null {
    const p = this.liftTags.get(id)?.ps;
    return p && this.liftTags.get(p)?.lf === id ? p : null;
  }

  /** Put member `id`'s actor right on a vehicle (my passenger rides on me; the engine pins it). */
  pin(id: string, pos: Vec, display: Vec, facing: Facing): void {
    const a = this.actorById.get(id);
    if (!a) return;
    a.pos = { x: pos.x, y: pos.y };
    a.display = { x: display.x, y: display.y };
    a.facing = facing;
    a.path = null;
    a.dir = { x: 0, y: 0 };
    a.moving = false;
  }

  private noteLift(msg: MoveMsg): void {
    if (msg.ps) this.liftTags.set(msg.id, { ps: msg.ps });
    else if (msg.lf) this.liftTags.set(msg.id, { lf: msg.lf });
    else this.liftTags.delete(msg.id);
  }

  /** `sw` on a movement message: 1 = swimming; 2 = wet (the drip timer starts on the first one); absent = dry. */
  private noteSwim(msg: MoveMsg, now: number): void {
    if (msg.sw === 1) {
      this.swimming.add(msg.id);
      this.wetUntil.delete(msg.id);
      return;
    }
    const wasSwimming = this.swimming.delete(msg.id);
    if (msg.sw === 2) {
      if (wasSwimming || !this.wetUntil.has(msg.id)) this.wetUntil.set(msg.id, now + WET_MS);
    } else {
      this.wetUntil.delete(msg.id);
    }
  }

  /** A swimmer's actor collides on the swim grid (water walkable). */
  private mapOf(id: string): GameMap {
    return this.swimMap && this.swimming.has(id) ? this.swimMap : this.map;
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

  /** A rider's actor is simulated at the ride speed, so it keeps pace between messages instead of snapping. */
  private speedOf(id: string): number {
    return WALK_SPEED * rideSpeed(this.riding(id)) * swimSpeed(this.swimming.has(id));
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
    tickActor(this.mapOf(a.id), a, Math.max(0, now - last.at) / 1000, now, true, this.speedOf(a.id));
    a.display = { ...a.pos };
  }
}
