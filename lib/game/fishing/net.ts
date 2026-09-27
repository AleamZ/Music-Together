// v18.2 Quăng lưới: the rules and the minigame's geometry. The server's scoring (`_net_quality`, `_net_catch`,
// `_net_beat_ms` of 0034_rods_nets.sql) is mirrored here (tests/unit/fishing-net.test.ts pins it): the hold sets the
// quality, and each of the five fish shadows the net misses counts as one "miss". Pure.

export const NET = {
  /** One swell of the power bar (empty → full → empty) while the button is held. */
  periodMs: 1200,
  /** The shadows swimming in front of the player — one per scored "beat" of the server's rule. */
  shadows: 5,
  /** A beat within this many ms is a hit (the server's rule; the client sends 0 for a shadow in the net). */
  hitMs: 150,
  /** What a missed shadow is sent as (any offset past hitMs is a miss). */
  missOffset: 9999,
  maxFish: 5,
  minFish: 2,
  /** A net at least this wide brings one more fish. */
  bigRadiusPx: 32,
  /** The power bar's green sweet zone: a full-size net that lands where aimed. */
  sweet: 0.85,
  /** The net lies in the water this long before it can be pulled. */
  sinkMs: 1500,
  /** The throw's flight. */
  flightMs: 700,
} as const;

/** The power (0 … 1) after holding for `ms`: (1 − cos 2πt/P) / 2 — full at P/2, then it falls back. */
export function ringSize(ms: number): number {
  return (1 - Math.cos((2 * Math.PI * Math.max(0, ms)) / NET.periodMs)) / 2;
}

/** The throw's quality: the power at release. */
export const chargeQuality = ringSize;

/** In the green zone. */
export function isSweet(q: number): boolean {
  return q >= NET.sweet;
}

/** The server's rhythm for a seed (550 … 750 ms); a throw may be pulled 0.9 × 5 of these after start_net. */
export function beatMs(seed: number): number {
  return 550 + 50 * (Math.abs(Math.trunc(seed)) % 5);
}

/** ms after start_net answered before finish_net accepts the pull (with a margin). */
export function pullWaitMs(beat: number): number {
  return Math.ceil(0.9 * 5 * beat) + 250;
}

export function isHit(offset: number | null | undefined): boolean {
  return typeof offset === "number" && Math.abs(offset) <= NET.hitMs;
}

/** The fish before misses: 2 + round(3q), +1 for a big net, at most 5. */
export function netBase(chargeMs: number, big: boolean): number {
  return Math.min(NET.maxFish, NET.minFish + Math.round(3 * chargeQuality(chargeMs)) + (big ? 1 : 0));
}

/** The fish a throw brings in: the base minus one per miss (a missing entry is a miss), never below 0. */
export function netCatch(chargeMs: number, offsets: ReadonlyArray<number | null>, big: boolean): number {
  let hits = 0;
  for (let i = 0; i < NET.shadows; i++) if (isHit(offsets[i])) hits++;
  return Math.max(0, netBase(chargeMs, big) - (NET.shadows - hits));
}

/** Which shadows the net covered → the offsets finish_net takes (0 = in the net, missOffset = got away). */
export function offsetsFor(inside: readonly boolean[]): number[] {
  return Array.from({ length: NET.shadows }, (_, i) => (inside[i] ? 0 : NET.missOffset));
}

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

/** The aim point, kept on the water and within range of the hands. */
export function clampAim(p: Pt): Pt {
  const x = Math.min(SCENE.w - 4, Math.max(4, p.x));
  const y = Math.min(SCENE.shore - 6, Math.max(SCENE.top, p.y));
  const dx = x - SCENE.hands.x, dy = y - SCENE.hands.y;
  const d = Math.hypot(dx, dy);
  if (d <= SCENE.range) return { x, y };
  const k = SCENE.range / d;
  return { x: SCENE.hands.x + dx * k, y: Math.min(SCENE.shore - 6, SCENE.hands.y + dy * k) };
}

/** The ring's radius on the scene for a net (24 px → 14, 36 px → 20) at power q: 40% … 100% of it. */
export function netRadius(radiusPx: number, q: number): number {
  const full = 14 + ((Math.max(24, radiusPx) - 24) / 12) * 6;
  return full * (0.4 + 0.6 * Math.min(1, Math.max(0, q)));
}

/** Where a throw at power q lands: the aim at full power, short of it (towards the hands) with less. */
export function landingPoint(aim: Pt, q: number): Pt {
  const k = isSweet(q) ? 1 : 0.45 + 0.55 * Math.min(1, Math.max(0, q)) / NET.sweet;
  const p = { x: SCENE.hands.x + (aim.x - SCENE.hands.x) * k, y: SCENE.hands.y + (aim.y - SCENE.hands.y) * k };
  return { x: p.x, y: Math.min(SCENE.shore - 4, p.y) };
}

/** Is `p` inside the net's ellipse around `c`? */
export function insideNet(p: Pt, c: Pt, r: number): boolean {
  const dx = (p.x - c.x) / r, dy = (p.y - c.y) / (r * SCENE.squash);
  return dx * dx + dy * dy <= 1;
}

/** mulberry32: [value in [0, 1), next state]. */
function rnd(state: number): [number, number] {
  const s = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), s | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, s];
}

export interface Shadow { x: number; y: number; dir: 1 | -1; size: number }

/** The swim of each shadow for a seed: a school drifting across the water, each fish wandering around it. */
export interface School { cx: number; cy: number; ax: number; ay: number; w: number; fish: Array<{ ox: number; oy: number; rx: number; ry: number; w: number; p: number; size: number }> }

export function makeSchool(seed: number): School {
  let s = seed | 0;
  const r = () => {
    const [v, n] = rnd(s);
    s = n;
    return v;
  };
  const school: School = {
    cx: 50 + r() * 60, cy: 30 + r() * 20, ax: 20 + r() * 20, ay: 6 + r() * 8, w: 0.00025 + r() * 0.00025, fish: [],
  };
  for (let i = 0; i < NET.shadows; i++) {
    school.fish.push({ ox: (r() - 0.5) * 60, oy: (r() - 0.5) * 30, rx: 4 + r() * 10, ry: 2 + r() * 5, w: 0.0008 + r() * 0.0012, p: r() * 6.28, size: r() < 0.3 ? 2 : 1 });
  }
  return school;
}

/** Where every shadow is at `t` ms. */
export function shadowsAt(school: School, t: number): Shadow[] {
  const sx = school.cx + Math.sin(t * school.w) * school.ax;
  const sy = school.cy + Math.sin(t * school.w * 1.7 + 1) * school.ay;
  return school.fish.map((f) => {
    const a = t * f.w + f.p;
    const x = Math.min(SCENE.w - 6, Math.max(6, sx + f.ox + Math.cos(a) * f.rx));
    const y = Math.min(SCENE.bottom, Math.max(SCENE.top, sy + f.oy + Math.sin(a * 1.3) * f.ry));
    return { x, y, dir: Math.sin(a) < 0 ? 1 : -1, size: f.size };
  });
}

// ---------- kéo lưới: the arrow rounds (owner's change; mirrors `_net_rounds` of 0037_net_arrows.sql) ----------

export type Arrow = "up" | "down" | "left" | "right";
export const ARROWS: readonly Arrow[] = ["up", "down", "left", "right"];
export const ARROW_GLYPH: Record<Arrow, string> = { up: "↑", down: "↓", left: "←", right: "→" };

/** More than this many mistakes (the 4th) = kéo hụt: pulled into the pond. */
export const MAX_MISTAKES = 3;

export interface HaulFish { weightG: number; rarity: number }
export interface ArrowPlan { rounds: number; keys: number; timerMs: number }

/** The haul's weight: Σ(rarity + kg). */
export function haulWeight(fish: readonly HaulFish[]): number {
  return fish.reduce((a, f) => a + f.rarity + f.weightG / 1000, 0);
}

/** Heavier, rarer, more fish → more rounds (2 … 5), longer sequences (4 … 9 keys) and a shorter timer (4.2 … 3 s).
 *  1–2 common fish: 2 × 4 keys, ~4.1 s; five 1.5 kg uncommon: 5 × 9 keys, 3 s. */
export function arrowPlan(fish: readonly HaulFish[]): ArrowPlan {
  const d = haulWeight(fish);
  return {
    rounds: Math.min(5, Math.max(2, Math.floor(d / 2 + 0.5) + 1)),
    keys: Math.min(9, Math.max(4, 4 + Math.floor(d / 3))),
    timerMs: Math.round(Math.min(4200, Math.max(3000, 4200 - d * 80))),
  };
}

/** A round's sequence for a seed. */
export function arrowSequence(seed: number, n: number): Arrow[] {
  let s = seed | 0;
  const out: Arrow[] = [];
  for (let i = 0; i < n; i++) {
    const [v, next] = rnd(s);
    s = next;
    out.push(ARROWS[Math.floor(v * 4)]);
  }
  return out;
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

/** A round in play: the sequence, how far along, and whether it cost a mistake. */
export interface ArrowRound { seq: Arrow[]; at: number; wrongs: number; done: boolean }

export function createRound(seq: Arrow[]): ArrowRound {
  return { seq, at: 0, wrongs: 0, done: false };
}

/** A key pressed: right → the next key (the last one ends the round); wrong → one mistake, and the key must still be
 *  typed. */
export function pressArrow(r: ArrowRound, a: Arrow): ArrowRound {
  if (r.done) return r;
  if (r.seq[r.at] !== a) return { ...r, wrongs: r.wrongs + 1 };
  const at = r.at + 1;
  return { ...r, at, done: at >= r.seq.length };
}

/** How the round went: a clean round in the first half of the timer is Perfect, clean is Good, else Miss. */
export function roundGrade(r: ArrowRound, usedMs: number, timerMs: number): "perfect" | "good" | "miss" {
  if (!r.done || r.wrongs > 0) return "miss";
  return usedMs <= timerMs / 2 ? "perfect" : "good";
}

/** A round's mistakes: each wrong key, plus 1 when the timer ran out. */
export function roundMistakes(r: ArrowRound): number {
  return r.wrongs + (r.done ? 0 : 1);
}