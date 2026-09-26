import { nextRandom } from "../fishing/reel";
import { FIELD_PLOTS, RAT_HOLES } from "../maps/field";
import type { GameMap, Interactable, Rect } from "../maps/types";
import { nearestInteractable } from "../scene";
import type { Vec } from "../types";

// v17 "Mùa chuột" (spec §5): the rats on the client. The server spawns them, judges which plots they eat, and prices and
// counts every catch; the client mirrors the damage (ratHours and ratFactor are 0019's _rat_hours and _rat_factor, the
// same operations in the same order, pinned by the shared fixtures), draws each rat from its seed the same way on every
// client (ratPos, from its plot's hole: ratAt), finds the one nearest a player (nearestRat) and reads the field's rats
// (parseRats). Pure.

export const RAT = {
  /** Mrat = 1 − min(lossCap, rate · rat-hours) (D6). */
  rate: 0.02,
  lossCap: 0.1,
  /** A rat pays floor(basePrice × M) at the catch (D11); the client only shows the server's price. */
  basePrice: 150,
  /** At most this many alive on a field (D2). */
  aliveCap: 3,
  /** Catches per account: an hourly window and a Vietnam day, slingshot and dog together (D13). */
  hourCap: 6,
  dayCap: 24,
  /** A catch or a flight is listed in `recent` this long. */
  recentMs: 10_000,
  /** How fast a rat runs on the field, px/s (§5.4). */
  speed: 48,
  /** The plot rect is inset this much for a rat's legs. */
  inset: 8,
  /** Each leg lasts 6 s: a run of at most 1.5 s to its point, then nibbling. */
  legMs: 6000,
  runMaxMs: 1500,
  /** Leg i's point comes from mulberry32(seed + legStep · i). */
  legStep: 7919,
  /** A fleeing rat runs back to its hole in 1.5 s. */
  fleeMs: 1500,
} as const;

/** A rat's stay on a crop (the crop's rat_log): from the sweep that found it until it was caught or fled. */
export interface RatLogEntry { r: number; from: number; to: number | null }

/** A rat on the field: its plot, when it came out of its hole (its path starts there) and its path's seed. */
export interface RatLive { id: number; plot: number; since: number; seed: number }

export type RatEnd = "sling" | "dog" | "fled";

/** A rat that ended in the last 10 s: how, by whom (a catch) and, for a pounce, the catcher's dog's name. */
export interface RatRecent extends RatLive {
  endedAt: number;
  how: RatEnd;
  by: { id: string; name: string } | null;
  dog: string | null;
}

/** The field's rats (§10.5). */
export interface FieldRats {
  /** When the next spawn candidate is due: the client refetches then, in rat season (§11). */
  nextAt: number;
  /** What a catch fetches now, floor(150 × M) — shown, never computed. */
  price: number;
  live: RatLive[];
  recent: RatRecent[];
  /** The rat logs of the plots that have one. */
  plots: Record<number, RatLogEntry[]>;
}

/** The rats in the account's bag: how many, and what cô Út pays for them together (their prices fixed at the catch). */
export interface RatBag { count: number; value: number }

/** What the catch caps leave (D13): this hour's window (null = no window open) and the Vietnam day. */
export interface RatCaps { hourLeft: number; hourResetsAt: number | null; dayLeft: number }

export const EMPTY_BAG: RatBag = { count: 0, value: 0 };
export const FULL_CAPS: RatCaps = { hourLeft: RAT.hourCap, hourResetsAt: null, dayLeft: RAT.dayCap };

/** Rat-hours of a crop's log at t: each entry that opened before t counts until it closed, or until t (§5.5). */
export function ratHours(log: readonly RatLogEntry[], t: number): number {
  let h = 0;
  for (const e of log) if (e.from < t) h += (Math.min(e.to ?? t, t) - e.from) / 3_600_000;
  return h;
}

/** Mrat: the share of the harvest the rats leave, the last factor of the yield (§5.5). */
export function ratFactor(h: number): number {
  return 1 - Math.min(RAT.lossCap, RAT.rate * h);
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const time = (v: unknown): number | null => {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};
const ENDS: readonly string[] = ["sling", "dog", "fled"];

function parseLive(v: unknown): RatLive | null {
  const o = obj(v);
  const since = time(o.since);
  if (typeof o.id !== "number" || since === null) return null;
  return { id: o.id, plot: num(o.plot), since, seed: num(o.seed) };
}

function parseLog(v: unknown): RatLogEntry[] {
  return (Array.isArray(v) ? v : []).map(obj).flatMap((e): RatLogEntry[] => {
    const from = time(e.from);
    return typeof e.r === "number" && from !== null ? [{ r: e.r, from, to: time(e.to) }] : [];
  });
}

/** The `rats` of a field_state answer; null for an answer from before 0019. */
export function parseRats(v: unknown): FieldRats | null {
  const o = obj(v);
  const nextAt = time(o.next_at);
  if (nextAt === null) return null;
  const plots: Record<number, RatLogEntry[]> = {};
  for (const [k, log] of Object.entries(obj(o.plots))) {
    const n = Number(k), entries = parseLog(log);
    if (Number.isInteger(n) && n >= 1 && n <= 10 && entries.length > 0) plots[n] = entries;
  }
  return {
    nextAt,
    price: num(o.price),
    live: (Array.isArray(o.live) ? o.live : []).map(parseLive).filter((r): r is RatLive => r !== null),
    recent: (Array.isArray(o.recent) ? o.recent : []).flatMap((x): RatRecent[] => {
      const r = parseLive(x), e = obj(x), endedAt = time(e.ended_at), by = obj(e.by);
      if (!r || endedAt === null || !ENDS.includes(String(e.how))) return [];
      return [{
        ...r, endedAt, how: e.how as RatEnd,
        by: typeof by.id === "string" ? { id: by.id, name: typeof by.name === "string" ? by.name : "" } : null,
        dog: typeof e.dog === "string" ? e.dog : null,
      }];
    }),
    plots,
  };
}

/** mine.rats; an answer without it holds none. */
export function parseRatBag(v: unknown): RatBag {
  const o = obj(v);
  return { count: num(o.count), value: num(o.value) };
}

/** mine.rat_caps; an answer without it leaves the caps full. */
export function parseRatCaps(v: unknown): RatCaps {
  if (!v || typeof v !== "object") return FULL_CAPS;
  const o = v as Record<string, unknown>;
  return { hourLeft: num(o.hour_left, RAT.hourCap), hourResetsAt: time(o.hour_resets_at), dayLeft: num(o.day_left, RAT.dayCap) };
}

/** Where a rat is drawn: its point, which way it faces (1 right, −1 left) and whether it runs or nibbles. */
export interface RatPose { x: number; y: number; dir: 1 | -1; moving: boolean }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const dist = (a: Vec, b: Vec) => Math.hypot(b.x - a.x, b.y - a.y);

function inset(r: Rect): Rect {
  return { x: r.x + RAT.inset, y: r.y + RAT.inset, w: r.w - 2 * RAT.inset, h: r.h - 2 * RAT.inset };
}

/** Leg i's point: the first two draws of mulberry32(seed + 7 919 · i), across the inset plot. */
function legPoint(seed: number, i: number, r: Rect): Vec {
  const [a, s] = nextRandom(seed + RAT.legStep * i);
  const [b] = nextRandom(s);
  return { x: r.x + a * r.w, y: r.y + b * r.h };
}

function between(from: Vec, to: Vec, f: number): RatPose {
  return { x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f, dir: to.x < from.x ? -1 : 1, moving: true };
}

/** Where a rat is at t (§5.4), the same on every client: out of its hole at `since`, it runs at 48 px/s to E, the point
 *  of the inset plot nearest the hole; then leg i (6 s each) runs from the last point to P(i) in min(1.5 s, distance /
 *  48), and nibbles there. O(1). Null before it comes out. */
export function ratPos(seed: number, since: number, hole: Vec, plot: Rect, t: number): RatPose | null {
  const dt = t - since;
  if (dt < 0) return null;
  const r = inset(plot);
  const e = { x: clamp(hole.x, r.x, r.x + r.w), y: clamp(hole.y, r.y, r.y + r.h) };
  const entry = (dist(hole, e) / RAT.speed) * 1000;
  if (dt < entry) return between(hole, e, dt / entry);
  const after = dt - entry, i = Math.floor(after / RAT.legMs), u = after - i * RAT.legMs;
  const from = i === 0 ? e : legPoint(seed, i - 1, r), to = legPoint(seed, i, r);
  const run = Math.min(RAT.runMaxMs, (dist(from, to) / RAT.speed) * 1000);
  if (u < run) return between(from, to, u / run);
  return { x: to.x, y: to.y, dir: to.x < from.x ? -1 : 1, moving: false };
}

/** A fled rat (§5.4): from where it was at its end, it runs back to its hole in 1.5 s; null once it is in. */
export function ratFleePos(seed: number, since: number, endedAt: number, hole: Vec, plot: Rect, t: number): RatPose | null {
  const f = (t - endedAt) / RAT.fleeMs;
  if (f >= 1) return null;
  const at = ratPos(seed, since, hole, plot, endedAt) ?? { x: hole.x, y: hole.y };
  return between(at, hole, Math.max(0, f));
}

/** A plot's hole and rect on the field map; null for a plot the map does not have. */
export function ratHome(plot: number): { hole: Vec; rect: Rect } | null {
  const g = FIELD_PLOTS.find((p) => p.no === plot), hole = RAT_HOLES[plot - 1];
  return g && hole ? { hole, rect: g.rect } : null;
}

/** Where a live rat is drawn at t; null before it comes out, or off the map. */
export function ratAt(r: RatLive, t: number): RatPose | null {
  const home = ratHome(r.plot);
  return home ? ratPos(r.seed, r.since, home.hole, home.rect, t) : null;
}

/** The live rat drawn nearest `pos` at t, within `radius` px (the auto-hunt's 96, the prompt's 40); null for none. */
export function nearestRat(live: readonly RatLive[], pos: Vec, t: number, radius: number): RatLive | null {
  let best: RatLive | null = null, bestD = Infinity;
  for (const r of live) {
    const p = ratAt(r, t);
    const d = p ? Math.hypot(p.x - pos.x, p.y - pos.y) : Infinity;
    if (d <= radius && d < bestD) {
      best = r;
      bestD = d;
    }
  }
  return best;
}

/** How near a rat must be drawn for its prompt (§12.1). */
export const RAT_PROMPT_RANGE = 40;

/** A live rat drawn at p as an interactable (kind "rat"): E shoots it, a tap walks toward it. */
export function ratInteractable(r: RatLive, p: Vec): Interactable {
  return {
    id: `rat_${r.id}`, kind: "rat", label: "Chuột đồng", prompt: "Bắn chuột", rect: { x: p.x - 6, y: p.y - 7, w: 12, h: 9 },
    use: { x: p.x, y: p.y }, rat: r.id,
  };
}

/** What E does where I stand (§12.1): the nearest map interactable within PROMPT_RANGE always wins; else, on the
 *  field, the nearest live rat drawn within 40 px. */
export function promptTarget(map: GameMap, feet: Vec, live: readonly RatLive[], t: number): Interactable | null {
  const near = nearestInteractable(map, feet);
  if (near || map.id !== "field") return near;
  const r = nearestRat(live, feet, t, RAT_PROMPT_RANGE);
  const p = r ? ratAt(r, t) : null;
  return r && p ? ratInteractable(r, p) : null;
}
