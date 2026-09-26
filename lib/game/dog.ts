import { facingForVector } from "./movement";
import type { Facing, Vec } from "./types";

// v17 (spec §7): the dog (chó cỏ). Its coats, its state from the server and the rules the UI shows (dogNameRefusal
// mirrors 0019's _pet_name, dogStatus and feedRefusal its dog calls), and the follower that walks it behind its owner
// on every client from the owner's drawn positions — no messages (C8, D24). Pure.

export type DogCoat = "vang" | "muc" | "ven" | "dom";
/** Chosen at adoption and fixed (D21): vàng, mực, vện, đốm. */
export const DOG_COATS: readonly DogCoat[] = ["vang", "muc", "ven", "dom"];
export const COAT_NAME: Record<DogCoat, string> = { vang: "Vàng", muc: "Mực", ven: "Vện", dom: "Đốm" };

const HOUR = 3_600_000;

export const DOG = {
  price: 20_000,
  nameMin: 2,
  nameMax: 16,
  /** A bịch feeds 24 h (D19); the dog refuses food while more than 12 h remain. */
  foodMs: 24 * HOUR,
  fullMs: 12 * HOUR,
  /** 5 minutes' rest after a catch (D18). */
  restMs: 5 * 60_000,
  /** The auto-hunt (D17, D30): a rat within 96 px of the owner, input within 3 minutes, 10 s quiet after a refusal. */
  huntRadius: 96,
  activeMs: 3 * 60_000,
  refusalPauseMs: 10_000,
  /** The follower (§7.3). */
  trailMs: 1000,
  lagMs: 450,
  moveGraceMs: 300,
  followSpeed: 84,
  snapDist: 64,
  sitAfterMs: 3000,
  /** The pounce: a run at 120 px/s, a 350 ms leap, then the carry back. */
  pounceSpeed: 120,
  leapMs: 350,
  /** Petting (D27): one every 3 s; the dog stays at its owner's front 2.5 s. */
  petEveryMs: 3000,
  petMs: 2500,
} as const;

export const isCoat = (v: unknown): v is DogCoat => typeof v === "string" && (DOG_COATS as readonly string[]).includes(v);

/** The account's dog as the server shows it (§10.3). */
export interface DogView {
  name: string;
  coat: DogCoat;
  adoptedAt: number;
  fedUntil: number | null;
  nextHuntAt: number | null;
  catches: number;
}

/** What the dog calls answer (§10.4): the dog, the food_dog count and the wallet. */
export interface DogAnswer { serverNow: number; dog: DogView | null; food: number; coins: number }

const time = (v: unknown): number | null => {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};
const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);

/** A dog from the server; null for none (or anything that is not one). */
export function parseDog(v: unknown): DogView | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const adoptedAt = time(o.adopted_at);
  if (typeof o.name !== "string" || !isCoat(o.coat) || adoptedAt === null) return null;
  return { name: o.name, coat: o.coat, adoptedAt, fedUntil: time(o.fed_until), nextHuntAt: time(o.next_hunt_at), catches: num(o.catches) };
}

/** A dog call's answer; null when it is not one. */
export function parseDogAnswer(v: unknown): DogAnswer | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const serverNow = time(o.server_now);
  if (serverNow === null) return null;
  return { serverNow, dog: parseDog(o.dog), food: num(o.food), coins: num(o.coins) };
}

// The name (§7.1, D20): register's rules with 2–16 characters. The same classes as 0015's register regex: control,
// odd-space, invisible and combining characters.
const HIDDEN: ReadonlyArray<readonly [number, number]> = [
  [0x0001, 0x001f], [0x007f, 0x009f], [0x00a0, 0x00a0], [0x00ad, 0x00ad], [0x0300, 0x036f], [0x034f, 0x034f], [0x061c, 0x061c],
  [0x115f, 0x1160], [0x1680, 0x1680], [0x17b4, 0x17b5], [0x180b, 0x180f], [0x1ab0, 0x1aff], [0x1dc0, 0x1dff], [0x2000, 0x200f],
  [0x2028, 0x202f], [0x205f, 0x206f], [0x20d0, 0x20ff], [0x3000, 0x3000], [0x3164, 0x3164], [0xfe00, 0xfe0f], [0xfe20, 0xfe2f],
  [0xfeff, 0xfeff], [0xffa0, 0xffa0], [0xfff0, 0xffff], [0xe0000, 0xe0fff],
];
const RESERVED: readonly string[] = ["aoca", "hoptacxa", "hethong", "quantri", "quantrivien", "admin", "root", "system"];

/** The name as the server stores it: NFC, spaces trimmed, runs of spaces made one. */
export function normalizeDogName(raw: string): string {
  return raw.normalize("NFC").replace(/^ +| +$/g, "").replace(/ {2,}/g, " ");
}

/** The key reserved names are compared on (0015's _name_key): no accents, nothing but a–z and 0–9. */
function nameKey(v: string): string {
  return v.normalize("NFC").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d").replace(/[^a-z0-9]+/g, "");
}

export type DogNameProblem = "length" | "hidden" | "reserved";

/** Why the server would refuse this name ('invalid name'), or null: 2–16 characters (code points), no hidden character,
 *  no reserved name. A hint for the UI; the server decides. */
export function dogNameRefusal(raw: string): DogNameProblem | null {
  const v = normalizeDogName(raw);
  const chars = [...v];
  if (chars.length < DOG.nameMin || chars.length > DOG.nameMax) return "length";
  if (chars.some((ch) => HIDDEN.some(([lo, hi]) => ch.codePointAt(0)! >= lo && ch.codePointAt(0)! <= hi))) return "hidden";
  if (RESERVED.includes(nameKey(v))) return "reserved";
  return null;
}

/** The dog's state at `now` (D17–D19): fed or hungry, and whether it can hunt. */
export interface DogStatus { fed: boolean; foodLeftMs: number; hunt: "ready" | "resting" | "hungry"; restLeftMs: number }

export function dogStatus(d: DogView, now: number): DogStatus {
  const foodLeftMs = Math.max(0, (d.fedUntil ?? 0) - now);
  const restLeftMs = Math.max(0, (d.nextHuntAt ?? 0) - now);
  const fed = foodLeftMs > 0;
  return { fed, foodLeftMs, hunt: !fed ? "hungry" : restLeftMs > 0 ? "resting" : "ready", restLeftMs };
}

/** Why a meal would be refused, in the server's order: 'dog full' above 12 h, then no food. */
export function feedRefusal(d: DogView, food: number, now: number): "full" | "no_food" | null {
  if (d.fedUntil !== null && d.fedUntil > now + DOG.fullMs) return "full";
  return food < 1 ? "no_food" : null;
}

// The follower (§7.3): one per walking actor with a dog, stepped every frame from its owner's drawn position.

/** The heel spot by facing: behind the owner, a little to the side. */
export const HEEL: Record<Facing, Vec> = { down: { x: 10, y: -2 }, up: { x: -10, y: 2 }, left: { x: 8, y: 3 }, right: { x: -8, y: 3 } };
/** In front of the owner, for petting. */
export const FRONT: Record<Facing, Vec> = { down: { x: 0, y: 9 }, up: { x: 0, y: -9 }, left: { x: -11, y: 1 }, right: { x: 11, y: 1 } };

type Blocked = (x: number, y: number) => boolean;

/** The first free of: the spot, its mirror across the owner, the owner's own position. */
function spotBy(o: Vec, off: Vec, blocked: Blocked): Vec {
  for (const p of [{ x: o.x + off.x, y: o.y + off.y }, { x: o.x - off.x, y: o.y + off.y }]) if (!blocked(p.x, p.y)) return p;
  return { x: o.x, y: o.y };
}

export const heelSpot = (o: Vec, facing: Facing, blocked: Blocked): Vec => spotBy(o, HEEL[facing], blocked);
export const frontSpot = (o: Vec, facing: Facing, blocked: Blocked): Vec => spotBy(o, FRONT[facing], blocked);

export type DogMode = "follow" | "pounce" | "leap" | "carry" | "pet";
export type DogPose = "walk" | "idle" | "sit" | "hungry" | "run" | "leap" | "carry" | "wag";

export interface Follower {
  x: number;
  y: number;
  facing: Facing;
  /** When it was last stepped. */
  at: number;
  /** The owner's drawn positions of the last second, oldest first. */
  trail: ReadonlyArray<{ t: number; x: number; y: number }>;
  ownerMovedAt: number;
  /** When the dog last stood still after moving (it sits 3 s later). */
  stillSince: number;
  moving: boolean;
  mode: DogMode;
  /** The pounce's point (the rat). */
  goal: Vec | null;
  /** When a leap or a pet ends. */
  until: number;
}

export function newFollower(o: Vec, facing: Facing, now: number, blocked: Blocked): Follower {
  const h = heelSpot(o, facing, blocked);
  return {
    x: h.x, y: h.y, facing, at: now, trail: [{ t: now, x: o.x, y: o.y }], ownerMovedAt: -Infinity, stillSince: now, moving: false,
    mode: "follow", goal: null, until: 0,
  };
}

/** The owner's position `t` ago: the latest one drawn at or before it, else the oldest kept. */
function lagged(trail: Follower["trail"], t: number): Vec {
  let p = trail[0];
  for (const q of trail) if (q.t <= t) p = q;
  return { x: p.x, y: p.y };
}

/** One frame (§7.3): while the owner moves (or moved in the last 0.3 s) the dog heads for where the owner was 450 ms
 *  ago, else for the heel spot; at up to 84 px/s, snapping beyond 64 px (portals, restores). A pounce runs to the rat at
 *  120 px/s, leaps 350 ms, then carries it back to the heel; a pet brings it to the owner's front for 2.5 s. */
export function stepFollower(f: Follower, o: { x: number; y: number; facing: Facing }, now: number, blocked: Blocked): Follower {
  const dt = Math.max(0, Math.min(0.1, (now - f.at) / 1000));
  const last = f.trail[f.trail.length - 1];
  const ownerMovedAt = !last || last.x !== o.x || last.y !== o.y ? now : f.ownerMovedAt;
  const trail = [...f.trail.filter((p) => p.t >= now - DOG.trailMs), { t: now, x: o.x, y: o.y }];
  let mode = f.mode, until = f.until;
  if (mode === "leap" && now >= until) mode = "carry";
  if (mode === "pet" && now >= until) mode = "follow";
  let target: Vec, speed: number = DOG.followSpeed;
  if (mode === "pounce" && f.goal) {
    target = f.goal;
    speed = DOG.pounceSpeed;
  } else if (mode === "leap") target = { x: f.x, y: f.y };
  else if (mode === "pet") target = frontSpot(o, o.facing, blocked);
  else if (mode === "carry" || now - ownerMovedAt > DOG.moveGraceMs) target = heelSpot(o, o.facing, blocked);
  else target = lagged(trail, now - DOG.lagMs);
  const dx = target.x - f.x, dy = target.y - f.y, d = Math.hypot(dx, dy);
  let x = f.x, y = f.y, moving = false;
  if (d > DOG.snapDist && (mode === "follow" || mode === "pet")) {
    x = target.x;
    y = target.y;
  } else if (d <= 0.5) {
    x = target.x;
    y = target.y;
  } else {
    const s = Math.min(d, speed * dt);
    x = s >= d ? target.x : x + (dx / d) * s;
    y = s >= d ? target.y : y + (dy / d) * s;
    moving = s > 0;
  }
  const arrived = Math.hypot(target.x - x, target.y - y) <= 0.5;
  if (arrived) {
    x = target.x;
    y = target.y;
  }
  if (mode === "pounce" && arrived) {
    mode = "leap";
    until = now + DOG.leapMs;
  } else if (mode === "carry" && arrived) mode = "follow";
  const facing = moving ? facingForVector({ x: dx, y: dy }, f.facing) : mode === "follow" ? o.facing : f.facing;
  return {
    x, y, facing, at: now, trail, ownerMovedAt, stillSince: moving || f.moving ? now : f.stillSince, moving,
    mode, goal: mode === "pounce" || mode === "leap" ? f.goal : null, until,
  };
}

/** The dog runs for a rat at `at` (its own pounce starts at the dog_hunt call; others' come from rats.recent). */
export function pounce(f: Follower, at: Vec): Follower {
  return { ...f, mode: "pounce", goal: { x: at.x, y: at.y } };
}

/** A refused pounce: the dog comes back. */
export function recall(f: Follower): Follower {
  return { ...f, mode: "follow", goal: null };
}

/** Petting (D27): to the owner's front for 2.5 s, wagging. */
export function pet(f: Follower, now: number): Follower {
  return { ...f, mode: "pet", goal: null, until: now + DOG.petMs };
}

/** How it is drawn: walking, standing, sitting 3 s after it stopped (drooping while hungry, for its owner's own dog),
 *  running, leaping, carrying or wagging. */
export function followerPose(f: Follower, now: number, hungry = false): DogPose {
  switch (f.mode) {
    case "pounce": return "run";
    case "leap": return "leap";
    case "carry": return "carry";
    case "pet": return f.moving ? "walk" : "wag";
    default:
      if (f.moving) return "walk";
      return now - f.stillSince >= DOG.sitAfterMs ? (hungry ? "hungry" : "sit") : "idle";
  }
}
