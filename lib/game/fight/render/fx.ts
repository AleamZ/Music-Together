// v20 Võ đài: render-only effects (spec §v20.1 "Effects"): hit sparks, the block ring, the white flash, the shake and
// landing dust. Never in the sim. Every effect is keyed by (frame, fighter, move), so a rolled-back hit's spark is
// dropped and a replayed one is not doubled. Under reduced motion there is no shake or flash and a spark is a static
// star.

import {
  A_KNOCKDOWN, A_LAND, F_ACT, F_AF, F_HITF, F_HITK, F_HITMV, F_HITX, F_HITY, F_X, G_FRAME, HK_ARMOR, HK_BLOCK,
  HK_COUNTER, HK_HEAVY, HK_HIT, HK_THROW, SUB, fb, type State,
} from "../engine";
import type { PixelCtx } from "./rig";

/** The ground line on the 384 × 216 arena (a fighter's feet at y = 0). */
export const GROUND_Y = 196;

export type EffectKind = "spark" | "heavy" | "block" | "throw" | "armor" | "counter" | "dust";
export interface Effect {
  key: string;
  kind: EffectKind;
  /** The sim frame it belongs to. */
  frame: number;
  x: number;
  y: number;
}

const KIND_OF: Record<number, EffectKind> = {
  [HK_HIT]: "spark", [HK_HEAVY]: "heavy", [HK_BLOCK]: "block", [HK_THROW]: "throw", [HK_ARMOR]: "armor", [HK_COUNTER]: "counter",
};

/** The effects that start on this state's frame. */
export function effectsOf(s: State): Effect[] {
  const f = s[G_FRAME];
  const out: Effect[] = [];
  for (let side = 0; side < 2; side++) {
    const b = fb(side);
    if (s[b + F_HITF] === f && KIND_OF[s[b + F_HITK]]) {
      out.push({ key: `${f}:${side}:${s[b + F_HITMV]}`, kind: KIND_OF[s[b + F_HITK]], frame: f, x: s[b + F_HITX], y: GROUND_Y - s[b + F_HITY] });
    }
    const a = s[b + F_ACT];
    if ((a === A_LAND || a === A_KNOCKDOWN) && s[b + F_AF] === 1) {
      out.push({ key: `${f}:${side}:dust`, kind: "dust", frame: f, x: Math.trunc(s[b + F_X] / SUB), y: GROUND_Y });
    }
  }
  return out;
}

const LIFE = 12;

export class EffectTracker {
  private readonly live = new Map<string, Effect>();

  /** Call with every state the renderer shows (rollbacks included). */
  observe(s: State): void {
    const f = s[G_FRAME];
    this.prune(f);
    for (const e of effectsOf(s)) if (!this.live.has(e.key)) this.live.set(e.key, e);
  }

  /** Drops effects from frames after `frame` (a rollback went back past them) and old ones. */
  prune(frame: number): void {
    for (const [k, e] of this.live) if (e.frame > frame || frame - e.frame > LIFE) this.live.delete(k);
  }

  active(): Effect[] {
    return [...this.live.values()];
  }

  keys(): string[] {
    return [...this.live.keys()];
  }

  /** Screen shake (±2 px for 4 frames) after a heavy hit; 0 under reduced motion. */
  shake(frame: number, reduced: boolean): number {
    if (reduced) return 0;
    for (const e of this.live.values()) {
      const age = frame - e.frame;
      if ((e.kind === "heavy" || e.kind === "counter" || e.kind === "throw") && age >= 0 && age < 4) return age % 2 === 0 ? 2 : -2;
    }
    return 0;
  }
}

/** The hit fighter flashes white for 2 frames (not under reduced motion). */
export function isFlashing(s: State, side: number, reduced: boolean): boolean {
  if (reduced) return false;
  const b = fb(side), k = s[b + F_HITK];
  const age = s[G_FRAME] - s[b + F_HITF];
  return age >= 0 && age < 2 && (k === HK_HIT || k === HK_HEAVY || k === HK_COUNTER || k === HK_THROW);
}

const ORANGE = "#ffb13b";
const YELLOW = "#fff2a8";
const RED = "#e2462f";
const BLUE = "#6fc3ff";
const BLUE_D = "#2f6fc4";
const DUST = "#c9b394";

function star(c: PixelCtx, x: number, y: number, r: number, outer: string, inner: string): void {
  c.fillStyle = outer;
  c.fillRect(x - r, y, 2 * r + 1, 1);
  c.fillRect(x, y - r, 1, 2 * r + 1);
  const d = Math.max(1, r - 2);
  for (let i = 1; i <= d; i++) {
    c.fillRect(x - i, y - i, 1, 1);
    c.fillRect(x + i, y - i, 1, 1);
    c.fillRect(x - i, y + i, 1, 1);
    c.fillRect(x + i, y + i, 1, 1);
  }
  c.fillStyle = inner;
  c.fillRect(x - 1, y - 1, 3, 3);
}

function ring(c: PixelCtx, x: number, y: number, r: number, color: string): void {
  c.fillStyle = color;
  for (let a = 0; a < 16; a++) {
    const t = (a / 16) * Math.PI * 2;
    c.fillRect(Math.round(x + Math.cos(t) * r), Math.round(y + Math.sin(t) * r * 1.3), 1, 1);
  }
}

/** Paints the live effects at the shown frame. */
export function paintEffects(c: PixelCtx, effects: readonly Effect[], frame: number, reduced: boolean): void {
  for (const e of effects) {
    const age = frame - e.frame;
    if (age < 0) continue;
    if (e.kind === "dust") {
      if (age > 8 || reduced) continue;
      c.fillStyle = DUST;
      const r = 3 + age;
      c.fillRect(e.x - r - 2, e.y - 2, 3, 2);
      c.fillRect(e.x + r, e.y - 2, 3, 2);
      c.fillRect(e.x - r + 1, e.y - 4, 2, 1);
      c.fillRect(e.x + r - 1, e.y - 4, 2, 1);
      continue;
    }
    if (age > (reduced ? 6 : 3)) continue;
    const big = e.kind === "heavy" || e.kind === "counter" || e.kind === "throw";
    if (e.kind === "block") {
      ring(c, e.x, e.y, reduced ? 5 : 3 + age * 2, age < 2 ? BLUE : BLUE_D);
      continue;
    }
    const r = reduced ? (big ? 6 : 4) : (big ? 5 : 3) + age * (big ? 2 : 1);
    star(c, e.x, e.y, r, e.kind === "armor" ? BLUE : e.kind === "counter" ? RED : ORANGE, YELLOW);
  }
}
