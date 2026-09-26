import { followerPose, newFollower, pet, pounce, recall, stepFollower, type DogCoat, type DogPose, type Follower } from "./dog";
import { RAT, ratAt, ratFleePos, ratHome, ratPos, type FieldRats, type RatLive } from "./farm/rats";
import type { Facing, Vec } from "./types";
import type { PresenceDog } from "@/lib/presence-modes";

// v17 (spec §5.4, §7.3): the dogs and the rats of a world, stepped every frame from what the engine sees — each dog
// follows its walker, pounces and is petted; each rat walks its seeded path, and each ending in `rats.recent` plays
// once. No messages (C8, D24). Pure; the engine draws what it returns.

type Blocked = (x: number, y: number) => boolean;

/** A walker with a dog this frame: where they are drawn, their dog, and when their latest `fa 11` started (remote). */
export interface DogWalker {
  id: string;
  x: number;
  y: number;
  facing: Facing;
  dog: PresenceDog;
  /** My own dog droops while hungry; the others' hunger is not known. */
  hungry: boolean;
  /** The start of the petting animation now playing on this walker, or null. */
  petAt: number | null;
}

export interface DrawnDog { id: string; x: number; y: number; facing: Facing; coat: DogCoat; pose: DogPose }
export interface DrawnRat { key: string; x: number; y: number; dir: 1 | -1; moving: boolean; fallen: boolean }

/** A sling catch shows the fallen rat and a puff this long; a dog's catch waits at most this long for the dog. */
export const SLING_END_MS = 600;
export const DOG_END_MS = 6000;

interface Ending {
  key: string;
  rat: RatLive;
  endedAt: number;
  how: "sling" | "dog" | "fled";
  /** The walker whose dog fetches it (a dog's catch on this map). */
  catcher: string | null;
  /** Where it was when it ended, and which way it faced. */
  at: Vec;
  dir: 1 | -1;
  /** When this client first saw the ending (it plays from then). */
  seenAt: number;
}

export class Pack {
  private readonly blocked: Blocked;
  private readonly localId: string;
  private readonly dogs = new Map<string, { f: Follower; coat: DogCoat; hungry: boolean; petAt: number | null }>();
  private live: RatLive[] = [];
  private recentIds = new Set<number>();
  private endings: Ending[] = [];
  /** Live rats my own dog is fetching: drawn fallen by their ending, not on their path. */
  private hidden = new Set<number>();

  constructor(blocked: Blocked, localId: string) {
    this.blocked = blocked;
    this.localId = localId;
  }

  /** The live rats, for the prompt and the auto-hunt. */
  get liveRats(): readonly RatLive[] {
    return this.live.filter((r) => !this.hidden.has(r.id));
  }

  /** The field's rats from the latest state (null: none). A `recent` entry seen for the first time starts its ending: a
   *  fled rat runs home, a sling catch lies fallen with a puff (whose points this returns), a dog's catch sends the
   *  catcher's dog when it walks here and otherwise plays as a sling catch. My own dog's catch is not replayed. */
  setRats(rats: FieldRats | null, now: number): Vec[] {
    this.live = rats?.live ?? [];
    this.hidden = new Set([...this.hidden].filter((id) => this.live.some((r) => r.id === id)));
    const recent = rats?.recent ?? [];
    const puffs: Vec[] = [];
    for (const r of recent) {
      if (this.recentIds.has(r.id) || (r.how === "dog" && r.by?.id === this.localId)) continue;
      const home = ratHome(r.plot);
      const p = home ? ratPos(r.seed, r.since, home.hole, home.rect, r.endedAt) : null;
      if (!p) continue;
      const catcher = r.how === "dog" && r.by && this.dogs.has(r.by.id) ? r.by.id : null;
      const how = r.how === "dog" && !catcher ? "sling" : r.how;
      if (catcher) this.update(catcher, (f) => pounce(f, p));
      if (how === "sling") puffs.push({ x: p.x, y: p.y });
      this.endings.push({ key: `e${r.id}`, rat: r, endedAt: r.endedAt, how, catcher, at: { x: p.x, y: p.y }, dir: p.dir, seenAt: now });
    }
    this.recentIds = new Set(recent.map((r) => r.id));
    return puffs;
  }

  /** One frame: each walker's dog follows them (a new one starts at the heel; a walker gone, or without a dog, loses
   *  it; a new coat is a new dog), a remote walker's fresh `fa 11` brings their dog to their front, and the endings that
   *  are over go. */
  step(walkers: readonly DogWalker[], now: number): void {
    const here = new Set<string>();
    for (const w of walkers) {
      here.add(w.id);
      let d = this.dogs.get(w.id);
      if (!d || d.coat !== w.dog.coat) {
        d = { f: newFollower(w, w.facing, now, this.blocked), coat: w.dog.coat, hungry: w.hungry, petAt: w.petAt };
        this.dogs.set(w.id, d);
      }
      const f = w.petAt !== null && w.petAt !== d.petAt ? pet(d.f, now) : d.f;
      d.f = stepFollower(f, { x: w.x, y: w.y, facing: w.facing }, now, this.blocked);
      d.hungry = w.hungry;
      d.petAt = w.petAt;
    }
    for (const id of [...this.dogs.keys()]) if (!here.has(id)) this.dogs.delete(id);
    this.endings = this.endings.filter((e) => !this.over(e, now));
  }

  /** My dog runs for live rat `ratId` (the dog_hunt call, §7.2); the rat lies fallen where it is drawn now until the
   *  dog carries it. False without my dog or the rat. */
  pounce(ratId: number, now: number, serverT: number): boolean {
    const r = this.live.find((x) => x.id === ratId);
    const p = r ? ratAt(r, serverT) : null;
    if (!r || !p || !this.dogs.has(this.localId)) return false;
    this.update(this.localId, (f) => pounce(f, p));
    this.hidden.add(ratId);
    this.endings.push({
      key: `p${ratId}`, rat: r, endedAt: serverT, how: "dog", catcher: this.localId, at: { x: p.x, y: p.y }, dir: p.dir, seenAt: now,
    });
    return true;
  }

  /** A refused hunt: my dog comes back, and the rat runs on. */
  recall(): void {
    this.update(this.localId, recall);
    this.endings = this.endings.filter((e) => e.key.charAt(0) !== "p");
    this.hidden.clear();
  }

  /** My pet (D27): my dog comes to my front for 2.5 s. */
  pet(now: number): void {
    this.update(this.localId, (f) => pet(f, now));
  }

  /** The dogs to draw. */
  drawnDogs(now: number): DrawnDog[] {
    return [...this.dogs].map(([id, d]) => ({ id, x: d.f.x, y: d.f.y, facing: d.f.facing, coat: d.coat, pose: followerPose(d.f, now, d.hungry) }));
  }

  /** The rats to draw: the live ones on their paths at server time `serverT`, and the endings as they play. */
  drawnRats(now: number, serverT: number): DrawnRat[] {
    const out: DrawnRat[] = [];
    for (const r of this.liveRats) {
      const p = ratAt(r, serverT);
      if (p) out.push({ key: `r${r.id}`, x: p.x, y: p.y, dir: p.dir, moving: p.moving, fallen: false });
    }
    for (const e of this.endings) {
      if (e.how !== "fled") {
        out.push({ key: e.key, x: e.at.x, y: e.at.y, dir: e.dir, moving: false, fallen: true });
        continue;
      }
      const home = ratHome(e.rat.plot);
      const p = home ? ratFleePos(e.rat.seed, e.rat.since, e.endedAt, home.hole, home.rect, e.endedAt + (now - e.seenAt)) : null;
      if (p) out.push({ key: e.key, x: p.x, y: p.y, dir: p.dir, moving: true, fallen: false });
    }
    return out;
  }

  private update(id: string, fn: (f: Follower) => Follower): void {
    const d = this.dogs.get(id);
    if (d) d.f = fn(d.f);
  }

  private over(e: Ending, now: number): boolean {
    const age = now - e.seenAt;
    if (e.how === "fled") return age >= RAT.fleeMs;
    if (e.how === "sling") return age >= SLING_END_MS;
    const mode = e.catcher ? this.dogs.get(e.catcher)?.f.mode : undefined;
    return age >= DOG_END_MS || (mode !== "pounce" && mode !== "leap");
  }
}
