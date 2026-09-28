// v18.2 Quăng lưới: the rules and the minigame's geometry. Server-replayed since 0056 (anti-cheat v2 #1, #2): every
// number that decides a catch comes from the server's seeds and is recomputed in SQL (0056_net_replay.sql,
// `_net_school`, `_net_haul_replay`, `_net_arrow_replay`) step for step — integer math only, 60 Hz ticks, mulberry32 on
// u32s (reel.ts `rand32`). tests/fixtures/net-cases.json is checked by both (fishing-net-replay.test.ts and
// tests/sql/anticheat-v2-net-smoke.sql). The client sends only its inputs: the press and release ticks with the aim, and
// the arrow keys with their ticks. Pure.

import { rand32 } from "./reel";

export const NET = {
  /** One swell of the power bar as the others see it (the thrower's own period comes from the seed). */
  periodMs: 1200,
  /** The shadows swimming in front of the player. */
  shadows: 5,
  maxFish: 5,
  minFish: 2,
  /** A net at least this wide brings one more fish. */
  bigRadiusPx: 32,
  /** The net lies in the water this long before it can be pulled. */
  sinkMs: 1500,
  /** The throw's flight. */
  flightMs: 700,
} as const;

/** The replay's constants (0056 uses the same): scene milli-pixels (1 px = 1000) and 60 Hz ticks. */
export const NETX = {
  hz: 60,
  flightTicks: 42,
  sinkTicks: 90,
  /** The release must come within this many ticks of the start_net answer (60 s). */
  maxRelease: 3600,
  /** The overlay gives the aim up here (N2): nothing is spent. */
  aimTicks: 3000,
  /** Quality ‰ from which the net lands where aimed at full size (the green zone). */
  sweet: 850,
  /** At most this many ticks catch up in one animation frame (a stalled tab plays slower, never faster). */
  maxCatchUp: 3,
  handsX: 80_000,
  handsY: 84_000,
  range: 70_000,
  aimMinX: 4_000,
  aimMaxX: 156_000,
  aimMinY: 8_000,
  aimMaxY: 74_000,
  landMaxY: 76_000,
  fishMinX: 6_000,
  fishMaxX: 154_000,
  fishMinY: 8_000,
  fishMaxY: 74_000,
  /** Kéo lưới: at most this many keys, at most keyRate keys in any 60 ticks, and it ends within 60 s. */
  maxKeys: 64,
  keyRate: 20,
  maxArrowTicks: 3600,
} as const;

// ---------- the scene (scene pixels: the water in front of the player, seen from behind) ----------

export interface Pt { x: number; y: number }
export const SCENE = {
  w: 160,
  h: 100,
  /** The water's edge: water above, the bank below. */
  shore: 80,
  /** The player's hands (where the net leaves). */
  hands: { x: 80, y: 84 } as Pt,
  /** How far the net can go. */
  range: 70,
  /** The ring's depth: an ellipse r across, r × this deep. */
  squash: 0.6,
  /** The shadows swim between these. */
  top: 8,
  bottom: 74,
} as const;

/** Truncating integer division, as plpgsql's bigint `/` (exact for the magnitudes used here). */
const tdiv = (a: number, b: number): number => Math.trunc(a / b) + 0;   // + 0: never -0
const clampI = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** ≈ 1000·sin(2πt/p) as a parabola per half period (p a multiple of 4, t ≥ 0): 0, 1000 at p/4, 0, −1000 at 3p/4. */
export function isin(t: number, p: number): number {
  const half = p / 2;
  const ph = t % p;
  const u = ph < half ? ph : ph - half;
  const m = tdiv(4000 * u * (half - u), half * half);
  return ph < half ? m : 0 - m;
}

export interface NetFish { ox: number; oy: number; rx: number; ry: number; pf: number; pfy: number; ph: number; size: 1 | 2 }
/** The school a seed makes: the power bar's period (ticks), the school's drift and each fish's wander (milli-px, ticks). */
export interface NetSchool { period: number; cx: number; cy: number; ax: number; ay: number; pw: number; pwy: number; ph: number; fish: NetFish[] }

export function netSchool(seed: number): NetSchool {
  let s = seed >>> 0;
  const r = (): number => {
    const [u, next] = rand32(s);
    s = next;
    return u;
  };
  const period = 2 * (33 + (r() % 7));
  const cx = 50_000 + (r() % 60_001), cy = 30_000 + (r() % 20_001);
  const ax = 20_000 + (r() % 20_001), ay = 6_000 + (r() % 8_001);
  const pw = 4 * (190 + (r() % 190)), pwy = 4 * (110 + (r() % 110)), ph = r() % 1000;
  const fish: NetFish[] = [];
  for (let i = 0; i < NET.shadows; i++) {
    const ox = (r() % 60_001) - 30_000, oy = (r() % 30_001) - 15_000;
    const rx = 4_000 + (r() % 10_001), ry = 2_000 + (r() % 5_001);
    const pf = 4 * (48 + (r() % 70)), pfy = 4 * (37 + (r() % 54)), fph = r() % 1000;
    fish.push({ ox, oy, rx, ry, pf, pfy, ph: fph, size: r() % 10 < 3 ? 2 : 1 });
  }
  return { period, cx, cy, ax, ay, pw, pwy, ph, fish };
}

export interface NetShadow { x: number; y: number; dir: 1 | -1; size: 1 | 2 }

/** Every shadow at tick t (milli-px, integers). */
export function netShadowsAt(s: NetSchool, t: number): NetShadow[] {
  const sx = s.cx + tdiv(s.ax * isin(t + s.ph, s.pw), 1000);
  const sy = s.cy + tdiv(s.ay * isin(t + s.ph + 250, s.pwy), 1000);
  return s.fish.map((f) => {
    const a = t + f.ph;
    const x = clampI(sx + f.ox + tdiv(f.rx * isin(a + f.pf / 4, f.pf), 1000), NETX.fishMinX, NETX.fishMaxX);
    const y = clampI(sy + f.oy + tdiv(f.ry * isin(a, f.pfy), 1000), NETX.fishMinY, NETX.fishMaxY);
    return { x, y, dir: isin(a, f.pf) < 0 ? 1 : -1, size: f.size };
  });
}

/** The power ‰ (0 … 1000) after holding `charge` ticks: 0 → 1000 at half the period → 0. */
export function netQuality(charge: number, period: number): number {
  if (charge <= 0) return 0;
  const ph = charge % period;
  return tdiv(4000 * ph * (period - ph), period * period);
}

/** In the green zone. */
export const isSweet = (q: number): boolean => q >= NETX.sweet;

/** Why an aim (milli-px) is one the client never sends; null when fine. */
export function netAimError(x: number, y: number): "aim" | null {
  if (!Number.isInteger(x) || !Number.isInteger(y)) return "aim";
  if (x < NETX.aimMinX || x > NETX.aimMaxX || y < NETX.aimMinY || y > NETX.aimMaxY) return "aim";
  const dx = x - NETX.handsX, dy = y - NETX.handsY;
  return dx * dx + dy * dy <= NETX.range * NETX.range ? null : "aim";
}

/** The aim point (scene px) kept on the water and within range, as the integer milli-px the server checks. */
export function clampAimInt(p: Pt): Pt {
  let x = Math.round(clampI(p.x * 1000, NETX.aimMinX, NETX.aimMaxX));
  let y = Math.round(clampI(p.y * 1000, NETX.aimMinY, NETX.aimMaxY));
  const dx = x - NETX.handsX, dy = y - NETX.handsY;
  const d2 = dx * dx + dy * dy;
  if (d2 > NETX.range * NETX.range) {
    const k = NETX.range / Math.sqrt(d2);
    x = NETX.handsX + Math.trunc(dx * k);
    y = Math.min(NETX.aimMaxY, NETX.handsY + Math.trunc(dy * k));
    while (netAimError(x, y) !== null) {
      if (Math.abs(x - NETX.handsX) >= Math.abs(y - NETX.handsY)) x += x > NETX.handsX ? -1 : 1;
      else y += 1;
    }
  }
  return { x, y };
}

/** Where a throw at quality q lands (milli-px): the aim at the green zone, short of it (towards the hands) below. */
export function netLanding(aimX: number, aimY: number, q: number): Pt {
  const k = q >= NETX.sweet ? 1000 : 450 + tdiv(550 * q, NETX.sweet);
  return {
    x: NETX.handsX + tdiv((aimX - NETX.handsX) * k, 1000),
    y: Math.min(NETX.landMaxY, NETX.handsY + tdiv((aimY - NETX.handsY) * k, 1000)),
  };
}

/** The ring's radius (milli-px) for a net (24 px → 14 000, 36 px → 20 000) at quality q: 40 % … 100 % of it. */
export function netRadiusMilli(radiusPx: number, q: number): number {
  const full = 14_000 + (Math.max(24, Math.trunc(radiusPx)) - 24) * 500;
  return tdiv(full * (4000 + 6 * clampI(q, 0, 1000)), 10_000);
}

/** Is (x, y) inside the net's 0.6-deep ellipse around (cx, cy) of radius r (all milli-px)? 9dx² + 25dy² ≤ 9r². */
export function insideNetMilli(x: number, y: number, cx: number, cy: number, r: number): boolean {
  const dx = x - cx, dy = y - cy;
  return 9 * dx * dx + 25 * dy * dy <= 9 * r * r;
}

/** What the client sends for the throw (ticks since the start_net answer, the aim at release in milli-px). */
export interface NetThrowInput { press: number; release: number; aimX: number; aimY: number }

/** Why a throw's input is one no client can make; null when fine. */
export function netThrowError(i: NetThrowInput): "range" | "aim" | null {
  if (![i.press, i.release].every(Number.isInteger)) return "range";
  if (i.press < 0 || i.release < i.press || i.release > NETX.maxRelease) return "range";
  return netAimError(i.aimX, i.aimY);
}

export interface NetHaulReplay {
  quality: number;
  landTick: number;
  landX: number;
  landY: number;
  r: number;
  /** One per shadow: under the net at the landing tick. */
  caught: boolean[];
  hits: number;
  /** 2 + round(3q) (+1 big), at most 5, minus one per shadow missed; never below 0 (0034's rule). */
  count: number;
}

export function netHaulReplay(seed: number, radiusPx: number, i: NetThrowInput): NetHaulReplay {
  const school = netSchool(seed);
  const quality = netQuality(i.release - i.press, school.period);
  const land = netLanding(i.aimX, i.aimY, quality);
  const r = netRadiusMilli(radiusPx, quality);
  const landTick = i.release + NETX.flightTicks;
  const caught = netShadowsAt(school, landTick).map((s) => insideNetMilli(s.x, s.y, land.x, land.y, r));
  const hits = caught.filter(Boolean).length;
  const base = Math.min(NET.maxFish, NET.minFish + tdiv(3 * quality + 500, 1000) + (radiusPx >= NET.bigRadiusPx ? 1 : 0));
  return { quality, landTick, landX: land.x, landY: land.y, r, caught, hits, count: Math.max(0, base - (NET.shadows - hits)) };
}

// ---------- kéo lưới: the arrow rounds (server-derived since 0056) ----------

export type Arrow = "up" | "down" | "left" | "right";
/** Codes 0 … 3 (a key is sent as tick·4 + code). */
export const ARROWS: readonly Arrow[] = ["up", "down", "left", "right"];
export const ARROW_GLYPH: Record<Arrow, string> = { up: "↑", down: "↓", left: "←", right: "→" };

/** More than this many mistakes (the 4th) = kéo hụt: pulled into the pond. */
export const MAX_MISTAKES = 3;

export interface HaulFish { weightG: number; rarity: number }
/** `timer` in ticks. */
export interface ArrowPlan { rounds: number; keys: number; timer: number }

/** Heavier, rarer, more fish → more rounds (2 … 5, 0037's rule), longer sequences (4 … 9 keys) and a shorter timer
 *  (252 … 180 ticks = 4.2 … 3 s). dg = Σ(rarity·1000 + grams). */
export function netArrowPlan(fish: readonly HaulFish[]): ArrowPlan {
  const dg = fish.reduce((a, f) => a + Math.trunc(f.rarity) * 1000 + Math.trunc(f.weightG), 0);
  return {
    rounds: clampI(tdiv(dg + 1000, 2000) + 1, 2, 5),
    keys: clampI(4 + tdiv(dg, 3000), 4, 9),
    timer: clampI(252 - tdiv(dg * 48, 10_000), 180, 252),
  };
}

/** Round r's sequence for the arrow seed. */
export function netArrowSeq(seed: number, round: number, n: number): Arrow[] {
  let s = (seed + 7919 * round) >>> 0;
  const out: Arrow[] = [];
  for (let i = 0; i < n; i++) {
    const [u, next] = rand32(s);
    s = next;
    out.push(ARROWS[u >>> 30]);
  }
  return out;
}

/** Kéo lưới in play: the round (0-based) with its sequence, how far along, its wrong keys, the finished rounds'
 *  mistakes, the tick it started, and — once done — the tick it ended. */
export interface ArrowGame {
  seed: number;
  plan: ArrowPlan;
  round: number;
  seq: Arrow[];
  at: number;
  wrongs: number;
  mistakes: number;
  start: number;
  done: boolean;
  end: number;
}

export function arrowGame(seed: number, plan: ArrowPlan): ArrowGame {
  return { seed, plan, round: 0, seq: netArrowSeq(seed, 0, plan.keys), at: 0, wrongs: 0, mistakes: 0, start: 0, done: false, end: 0 };
}

function nextRound(g: ArrowGame, at: number, add: number): ArrowGame {
  const mistakes = g.mistakes + add, round = g.round + 1;
  if (mistakes > MAX_MISTAKES || round >= g.plan.rounds) return { ...g, mistakes, round, done: true, end: at };
  return { ...g, mistakes, round, seq: netArrowSeq(g.seed, round, g.plan.keys), at: 0, wrongs: 0, start: at };
}

/** Times out every round whose deadline (start + timer) is at or before `tick`: each costs its wrong keys + 1, and the
 *  next round starts at the deadline. */
export function arrowAdvance(g: ArrowGame, tick: number): ArrowGame {
  let s = g;
  while (!s.done && tick >= s.start + s.plan.timer) s = nextRound(s, s.start + s.plan.timer, s.wrongs + 1);
  return s;
}

/** A key at `tick` (after the time-outs up to it): right → the next key (the last one ends the round there); wrong →
 *  a mistake, the key must still be typed; the 4th mistake ends the game there. */
export function arrowPress(g: ArrowGame, tick: number, a: Arrow): ArrowGame {
  const s = arrowAdvance(g, tick);
  if (s.done) return s;
  if (s.seq[s.at] !== a) {
    const wrongs = s.wrongs + 1;
    if (s.mistakes + wrongs > MAX_MISTAKES) return { ...s, wrongs, mistakes: s.mistakes + wrongs, done: true, end: tick };
    return { ...s, wrongs };
  }
  const at = s.at + 1;
  return at >= s.plan.keys ? nextRound({ ...s, at }, tick, s.wrongs) : { ...s, at };
}

/** How a finished round went (for the Perfect / Good / Miss flash). */
export function roundGrade(clean: boolean, usedTicks: number, timer: number): "perfect" | "good" | "miss" {
  if (!clean) return "miss";
  return usedTicks * 2 <= timer ? "perfect" : "good";
}

/** Plays the keys (tick·4 + code) through the game to its end: {mistakes 0 … 4, the end tick}, or a key after the end. */
export function netArrowReplay(seed: number, plan: ArrowPlan, keys: readonly number[]): { mistakes: number; ticks: number } | { error: "late" } {
  let g = arrowGame(seed, plan);
  for (const k of keys) {
    const tick = Math.floor(k / 4);
    g = arrowAdvance(g, tick);
    if (g.done) return { error: "late" };
    g = arrowPress(g, tick, ARROWS[k % 4]);
  }
  while (!g.done) g = arrowAdvance(g, g.start + g.plan.timer);
  return { mistakes: Math.min(MAX_MISTAKES + 1, g.mistakes), ticks: g.end };
}

/** Why kéo lưới's keys are ones no client sends; null when fine. `ticks`: the end tick claimed. */
export function netKeysError(keys: readonly number[], ticks: number): "ticks" | "too_many" | "range" | "order" | "rate" | null {
  if (!Number.isInteger(ticks) || ticks < 0 || ticks > NETX.maxArrowTicks) return "ticks";
  if (keys.length > NETX.maxKeys) return "too_many";
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (!Number.isInteger(k) || k < 0 || Math.floor(k / 4) > ticks) return "range";
    if (i > 0 && Math.floor(k / 4) < Math.floor(keys[i - 1] / 4)) return "order";
    if (i >= NETX.keyRate && Math.floor(k / 4) - Math.floor(keys[i - NETX.keyRate] / 4) < 60) return "rate";
  }
  return null;
}

/** Arrow keys and WASD → an arrow; anything else null. */
export function arrowForKey(code: string): Arrow | null {
  switch (code) {
    case "ArrowUp": case "KeyW": return "up";
    case "ArrowDown": case "KeyS": return "down";
    case "ArrowLeft": case "KeyA": return "left";
    case "ArrowRight": case "KeyD": return "right";
    default: return null;
  }
}

/** A fixed 60 Hz tick clock for the overlay: ticks since `origin` (performance ms), catching up at most maxCatchUp per
 *  frame, so the sim never runs ahead of real time (the server's time gates rely on it). */
export class TickClock {
  private tick = 0;
  private acc = 0;
  private last: number;
  constructor(origin: number) {
    this.last = origin;
  }
  /** Advance to `now` (performance ms); returns the tick. */
  advance(now: number): number {
    this.acc += Math.max(0, now - this.last);
    this.last = now;
    const due = Math.floor((this.acc * NETX.hz) / 1000 + 1e-7);
    const step = Math.min(due, NETX.maxCatchUp);
    this.tick += step;
    this.acc = due > step ? 0 : this.acc - step * (1000 / NETX.hz);
    return this.tick;
  }
  get now(): number {
    return this.tick;
  }
}
