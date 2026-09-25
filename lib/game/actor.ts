import type { GameMap } from "@/lib/game/maps/types";
import type { Facing, Vec } from "@/lib/game/types";
import { facingFor, facingForVector, stepMove, WALK_SPEED } from "@/lib/game/movement";

/** One walking character. The local player and every remote player use the same simulation. */
export interface Actor {
  id: string;
  /** Simulated position (feet). */
  pos: Vec;
  /** Drawn position — remote players ease toward `pos`; the local player equals `pos`. */
  display: Vec;
  facing: Facing;
  /** Keyboard direction, each axis -1/0/1. */
  dir: Vec;
  moving: boolean;
  path: Vec[] | null;
  lastMsgAt: number;
  /** Seconds spent walking (animation clock). */
  walkT: number;
}

export const SNAP_DIST = 48;
export const STALE_MS = 4000;
export const BLEND_PER_SEC = 12;

export function createActor(id: string, at: Vec, facing: Facing = "down", now = 0): Actor {
  return { id, pos: { ...at }, display: { ...at }, facing, dir: { x: 0, y: 0 }, moving: false, path: null, lastMsgAt: now, walkT: 0 };
}

export function setKeyboard(a: Actor, dir: Vec): void {
  a.path = null;
  a.dir = { x: dir.x, y: dir.y };
  a.moving = dir.x !== 0 || dir.y !== 0;
  a.facing = facingFor(dir, a.facing);
}

export function setPath(a: Actor, pts: Vec[]): void {
  a.path = pts.map((p) => ({ x: p.x, y: p.y }));
  a.dir = { x: 0, y: 0 };
  a.moving = a.path.length > 0;
  if (!a.moving) a.path = null;
}

function snapIfFar(a: Actor): void {
  if (Math.hypot(a.display.x - a.pos.x, a.display.y - a.pos.y) > SNAP_DIST) a.display = { ...a.pos };
}

export function applyStateMsg(
  a: Actor,
  m: { x: number; y: number; facing: Facing; moving: boolean; vx: number; vy: number },
  now: number,
): void {
  a.pos = { x: m.x, y: m.y };
  a.facing = m.facing;
  a.moving = m.moving;
  a.dir = m.moving ? { x: m.vx, y: m.vy } : { x: 0, y: 0 };
  a.path = null;
  a.lastMsgAt = now;
  snapIfFar(a);
}

export function applyPathMsg(a: Actor, m: { x: number; y: number; pts: Vec[] }, now: number): void {
  a.pos = { x: m.x, y: m.y };
  setPath(a, m.pts);
  a.lastMsgAt = now;
  snapIfFar(a);
}

/** Advance one frame. Returns true exactly when a path has just been completed. */
export function tickActor(map: GameMap, a: Actor, dtSec: number, now: number, remote: boolean): boolean {
  let arrived = false;
  if (a.path) {
    let budget = WALK_SPEED * dtSec;
    while (budget > 0 && a.path.length > 0) {
      const t = a.path[0];
      const dx = t.x - a.pos.x, dy = t.y - a.pos.y, d = Math.hypot(dx, dy);
      if (d > 0.01) a.facing = facingForVector({ x: dx, y: dy }, a.facing);
      if (d <= budget) {
        a.pos = { x: t.x, y: t.y };
        budget -= d;
        a.path.shift();
      } else {
        a.pos = { x: a.pos.x + (dx / d) * budget, y: a.pos.y + (dy / d) * budget };
        budget = 0;
      }
    }
    if (a.path.length === 0) {
      a.path = null;
      a.moving = false;
      arrived = true;
    }
  } else if (a.moving) {
    if (remote && now - a.lastMsgAt > STALE_MS) {
      a.moving = false; // lost "stop" guard
      a.dir = { x: 0, y: 0 };
    } else {
      a.pos = stepMove(map, a.pos, a.dir, dtSec);
    }
  }
  a.walkT = a.moving ? a.walkT + dtSec : 0;
  if (remote) {
    const k = Math.min(1, BLEND_PER_SEC * dtSec);
    a.display = { x: a.display.x + (a.pos.x - a.display.x) * k, y: a.display.y + (a.pos.y - a.display.y) * k };
  } else {
    a.display = { x: a.pos.x, y: a.pos.y };
  }
  return arrived;
}

export function walkFrame(a: Actor): 0 | 1 | 2 | 3 {
  return a.moving ? ((Math.floor(a.walkT * 8) % 4) as 0 | 1 | 2 | 3) : 0;
}
